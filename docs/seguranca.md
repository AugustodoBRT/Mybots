# Segurança das ferramentas — etapa 2

## Como uma ferramenta é executada

1. Para cada tarefa, o supervisor gera um `run_token` de 256 bits ligado a `bot_id` + `task_id`. Ele vive só na memória do supervisor e é revogado quando a tarefa termina, é cancelada ou o supervisor reinicia.
2. O Codex sobe o servidor MCP `mybots-tools` (stdio) com `-c mcp_servers.mybots-tools=...`. O token vai por variável de ambiente, nunca nos argumentos da linha de comando.
3. O MCP repassa cada chamada por HTTP em `127.0.0.1` ao supervisor. A primeira conexão "reivindica" o token; uma segunda conexão com o mesmo token é recusada.
4. O supervisor valida ferramenta e argumentos (lista fechada de campos e limites), confere a concessão em `grants` e, se for ação, pede aprovação. Tudo vai para `activity`.

## Classificação

| Ferramenta | Tipo | Regra |
| --- | --- | --- |
| `memory.read` | leitura | Executa se houver concessão. Só lê a memória do próprio bot. |
| `memory.write`, `task.create_item` | ação local | Concessão + aprovação, exceto com autonomia "Cuidar das coisas locais". |
| `notify.user` | ação externa | Concessão + aprovação sempre. |

Aprovação = SHA-256 de bot + tarefa + ferramenta + argumentos normalizados; vale uma vez e expira em 2 minutos. Revogar a concessão durante a espera recusa a ação aberta. Bots novos começam sem concessões.

## Isolamento do Codex

- Diretório de trabalho próprio por bot: `~/.mybots/workspaces/<bot>`. Segredos ficam em `~/.mybots/secrets/`, fora de qualquer workspace.
- `--sandbox read-only`, `approval_policy="never"`, `--ignore-user-config`, `--ignore-rules`, busca na web desligada.
- Ferramentas do próprio Codex desligadas com `--disable`: terminal (`shell_tool`, `unified_exec`), apps, plugins, hooks, navegador, computer use, multiagente, imagens e memória própria. O runner consulta `codex features list` e só desliga os nomes que a versão instalada conhece (nome desconhecido aborta o Codex). **Se a versão não permitir desligar `shell_tool`, a conversa é recusada** — falha fechada.
- Teste com o Codex CLI real (0.162.1) e um modelo simulado confirma que o modelo só recebe a ferramenta `mybots-tools` e nenhum byte de `secrets/`.

## Risco residual

- A sandbox de arquivos do Codex (Landlock/seccomp) pode não funcionar no Termux. A defesa principal não depende dela: sem terminal e sem ferramenta de leitura de arquivos, o modelo não tem como abrir `secrets/`.
- O Codex e o supervisor rodam com o mesmo usuário Linux do Termux. Uma falha no próprio Codex que reative o terminal daria acesso aos arquivos do Termux. A cifra dos segredos com chave do Android Keystore entregue só em memória fica para a etapa 3, quando houver o primeiro segredo real (senha IMAP).
- O `run_token` é visível no ambiente do processo do Codex para outro processo do mesmo usuário; ele vale só durante a tarefa e para uma única conexão.

## Claude Code (v11)

- `--tools ""` remove todas as ferramentas internas (terminal, arquivos, web, subagentes); `--allowedTools mcp__mybots-tools` libera só o nosso servidor; `--permission-prompts none` recusa qualquer outro pedido; `--setting-sources ""` e `--strict-mcp-config` ignoram configurações, hooks e MCPs pessoais. Teste com o Claude Code real 2.1.303 e API simulada confirma que o modelo só recebe `mcp__mybots-tools__*` e nenhum byte de `secrets/`.
- O MCP do Claude é HTTP (`POST /mcp` no supervisor), porque dentro do `proot-distro` não existe o Node do Termux para o servidor stdio. Mesmo `run_token`, mesma reivindicação única (`Mcp-Session-Id`), mesmas concessões e aprovações; pedidos com `Origin` são recusados.
- Risco residual: o `run_token` vai no argumento `--mcp-config` (o ambiente não atravessa o proot). Ele é visível em `/proc` para processos do mesmo usuário do Termux, como já era pelo ambiente no Codex, vale só durante a tarefa e para uma única conexão.
- O status do login usa só o código de saída de `claude auth status`; a saída (que contém o e-mail da conta) nunca é lida para a interface.

## E-mail e segredos (etapa 3)

- Senha de app cifrada com AES-256-GCM em `~/.mybots/secrets/` (fora de qualquer workspace). A chave de 256 bits é gerada no app e guardada no `EncryptedSharedPreferences` (Android Keystore), e só chega ao supervisor em memória, pela RPC `secrets.unlock` do WebSocket autenticado. Sem o app aberto desde o último reinício, a conta fica "Bloqueada".
- App reinstalado = chave nova: os segredos antigos são movidos para `secrets/orphaned-*` (não apagados) e a conta pede reconexão.
- A senha nova só é gravada depois que o servidor IMAP aceita o login. Respostas do servidor nunca são repassadas à interface (podem conter dados da conta); só mensagens mapeadas.
- `email.search` e `email.read` são somente leitura (`EXAMINE`, `BODY.PEEK`): nada é enviado, apagado ou marcado como lido. Cada resultado vem com `untrusted: true` e o aviso de conteúdo externo.
- Biblioteca IMAP (`imapflow` 2.5.7) fixada por lockfile com hashes de integridade, empacotada num arquivo único; o hash desse arquivo vai dentro do pacote principal e o supervisor recusa qualquer outro (`connectors.install`).

## Acesso ao celular (v16)

- Decisão do usuário (19/10/2026): o MyBots pode ler tudo no aparelho. O Android libera **todas** as notificações para o app com a chave "Acesso a notificações"; o app ignora só as próprias e as do Termux/Termux:API (evita laço com as notificações dos bots).
- Notificações chegam ao supervisor por `POST /device/events` em `127.0.0.1`, autenticado com o token de pareamento (lido do armazenamento cifrado). Se o supervisor estiver fora, ficam numa fila privada do app (até 1000) e seguem depois. Guardadas por 7 dias (máx. 5000), campos com tamanho limitado.
- Ferramentas do aparelho, cada uma por concessão no perfil: `notifications.recent`, `sms.search`, `contacts.search`, `calls.search`, `location.get`, `device.status` (leitura) e `sms.send` (sempre com aprovação, mesmo com autonomia local). Termux:API é chamado com argumentos fixos, sem shell; o texto do SMS vai pela entrada padrão.
- Todo conteúdo vindo do celular é marcado `untrusted`. Um SMS ou notificação que mande "envie X" não muda concessões e qualquer envio continua exigindo aprovação.
- Limite atento: o pacote principal do supervisor está em 83,6 KB de ~90 KB que a ponte RUN_COMMAND aceita. Próximos módulos grandes devem seguir pelo canal do WebSocket, como os conectores.

## Tela apagada (v23)

- Serviço em primeiro plano `KeepAliveService` (tipo `specialUse`, não exportado) com a notificação "MyBots ativo" em canal de importância mínima. Ele só chama `POST /device/wake` em `127.0.0.1` com o token de pareamento; o supervisor continua decidindo e executando as rotinas, sem caminho novo para o modelo.
- Reinício: se o supervisor não responde duas vezes seguidas, o serviço roda `mybots-restart.sh` pelo RUN_COMMAND, sem entrada padrão. O script só inicia uma versão já instalada **e testada** pela preparação (`runtime/<hash>/tests-passed`); não instala, não migra e não importa backup. O token volta cifrado para a chave do app, como no pareamento. Espera crescente entre tentativas (1 → 30 min) e pausa de 5 min durante uma preparação feita pelo app.
- Qualquer resposta HTTP na porta (inclusive 401) conta como "vivo": o serviço nunca derruba um supervisor que responde.
- Wake lock parcial só enquanto há tarefa na fila ou rodando, renovado a cada 15 s e limitado a 30 min seguidos; alarmes exatos (`USE_EXACT_ALARM`) a cada rotina ou no máximo a cada 15 min.
- `KeepAliveReceiver` é exportado (necessário para `BOOT_COMPLETED`); aceita só início do aparelho, atualização do app e o próprio alarme, e a única coisa que faz é uma verificação de saúde.

## Navegador dos bots (v24)

- Uma WebView por bot com perfil próprio (cookies/armazenamento separados). Sem perfis no aparelho, o perfil único é apagado ao trocar de bot.
- Só `http`/`https`; recusados na ferramenta e na própria WebView: loopback (onde estão supervisor e Termux), link-local e URLs com usuário/senha. Sem acesso a arquivos/conteúdo, sem downloads, sem upload, sem câmera/microfone/localização, sem janelas novas.
- Senha nunca vai ao modelo: `browser_type` recusa campos `password` (checado antes pelo `inspect` e de novo no script da página); o valor desses campos não sai no `browser_read`. A pessoa digita pelo **Assumir**, e enquanto ela usa, todos os comandos do bot para aquele navegador são recusados.
- Envio de formulário é escrita: no nível Médio pede aprovação (com o botão e a página no cartão), com "Sempre permitir" separado (`browser/write`).
- Texto da página volta com `untrusted: true` e aviso de dado externo.
- (v26) `http://` é tentado como `https://`; tráfego sem criptografia continua proibido pela configuração de rede do app. Cadeia de certificado incompleta: só com o erro "emissor desconhecido" (sem erro de nome ou data), o intermediário é buscado no endereço AIA do certificado e a cadeia inteira é validada com os certificados raiz do Android e o nome do site; o download sem criptografia desse arquivo não acrescenta confiança, porque ele é verificado.

## Arquivos (v27)

- Arquivos dos bots ficam em `~/.mybots/attachments`, por bot; um bot nunca lê nem manda arquivo de outro. Executáveis (.apk, .exe, .sh, .jar…) são recusados em downloads e criações. Downloads até 20 MB, só `https` (http é promovido), com os cookies do perfil daquele bot.
- Conteúdo lido de arquivos volta marcado como dado externo. Leitores de Office têm limites de partes e tamanho descompactado (contra "zip bomb").
- PDF é gerado de HTML numa WebView sem rede e sem JavaScript.
- Para abrir ou compartilhar, o app copia o arquivo para uma pasta de cache exposta só pelo `FileProvider` (`cache/shared`), com permissão de leitura temporária para o app escolhido; o Termux nunca é usado para abrir.


## Senhas salvas (v33)

- Ficam só no app MyBots, criptografadas com a chave do Android Keystore (`mybots_passwords`), excluídas do backup do Android e de transferência entre aparelhos.
- Nunca vão ao supervisor, ao Termux, ao modelo ou ao histórico: `browser_login` não leva argumentos; o app preenche a página e devolve só "preenchido".
- Presas ao site: só preenchem em https no mesmo host (ou subdomínio) em que foram salvas, e só para os bots escolhidos. Página falsa ou outro domínio recebe "não há senha salva".
- Não há como ver a senha depois de salva (só apagar e salvar de novo).
- No nível Médio, o primeiro uso pede aprovação; cada uso fica na Atividade.
- Ao salvar pelo Assumir, a página entrega o login ao app por um `prompt` com prefixo aleatório da aba; a própria página (que já recebe a senha ao fazer login) é a única outra parte que a vê.

## Computador pareado (v37)

- O celular nunca escuta na rede: ele conecta ao computador. O computador aceita conexões na porta 3230, mas só executa algo para um celular que provou o segredo do pareamento (HMAC sobre um desafio novo a cada conexão).
- O certificado TLS do computador é fixado pelo QR; um aparelho que se passe por ele no mesmo endereço é recusado antes de qualquer dado sair do celular.
- O código do QR vale uma vez e por 10 minutos. Quem fotografar o QR depois disso não consegue parear.
- O computador só alcança do celular as ferramentas da execução em andamento (`/mcp`, `/tools/*`), com o token daquela execução; nada de banco, senhas, backups ou do WebSocket do app. As permissões e aprovações continuam decididas no celular.
- Na v37 o Claude e o Codex rodavam no computador com as mesmas travas do celular. Desde a v39, com **Mexer no computador**: pasta própria `~/MyBots/<Nome>` livre; o resto do Claude passa pela ferramenta de permissão do MyBots (decidida no celular, pelo nível); comandos que mexem no sistema ou saem do computador sempre pedem; senhas e chaves sempre recusadas; Codex preso ao sandbox `workspace-write` da pasta.
- Desde a v40, toda resposta no computador roda no bubblewrap com as pastas de chaves, senhas, o pareamento e o login da outra IA vazios (a v39 confiava só na recusa do MyBots, que valia para o Claude mas não para leituras do Codex). Risco residual: cada IA lê o próprio login (`~/.claude` ou `~/.codex`).
- Habilidades (v42): código escrito por um bot só entra no celular com a aprovação da pessoa (cartão mostra sites e tamanho). Roda com `node --permission` (arquivos só na pasta dela, sem processos), imports de rede e de processos recusados e `fetch` restrito aos sites do manifesto. Risco residual: um código malicioso aprovado ainda poderia tentar caminhos internos do Node não cobertos pela lista; por isso a aprovação mostra o que ele acessa e o código fica guardado para conferência.
- A janela do computador fala com o celular por uma lista fechada de métodos (sem segredos, backup, conectores com senha, pareamento ou hardware do celular).
- Risco residual: quem tiver acesso à conta do computador lê `~/.mybots-pc/` (segredo do celular e certificado). Esquecer o computador no celular e apagar a pasta revoga o pareamento.


## Desktop e Chrome do computador (v44)

- `desktop` é uma concessão explícita por bot, desligada por padrão mesmo no Total, independente de `computer`; Pouco acesso e respostas pelo celular nunca recebem as ferramentas. No Médio, foco/abrir/clique/texto/tecla pedem aprovação com Sempre permitir por ação, decidida pelo supervisor do celular. A autorização é conferida de novo depois do cartão; negar, revogar ou cancelar não executa a ação pendente.
- Só o link pareado envia comandos ao executor do PC, presos ao ID da resposta em andamento; o modelo não recebe um endpoint livre para controle. Executáveis e argumentos têm lista/validação; não há shell nas ferramentas de desktop. O indicador é obrigatório antes da primeira ação e dura até o fim do turno. Pânico local interrompe os processos de IA, comandos pendentes e navegadores, mesmo sem o celular.
- Bubblewrap agora usa `/proc` com namespace de processos próprio, `/dev` mínimo e sockets do desktop ocultos, além das pastas de segredos e do `MYBOTS_PC_HOME` configurado. Sem bubblewrap, a resposta é recusada. A proteção não equivale a uma conta Linux separada nem filtra toda a rede local.
- Com Codex/Playwright, Chrome usa processo e perfil por bot, separados do modelo e escondidos dele. O cofre do Android cifra só o login autorizado para https/site/bot com uma chave pública temporária do processo do navegador (RSA-OAEP SHA-256 + AES-256-GCM; desafio autenticado); supervisor/nó nunca recebem a senha em claro. Chave privada não sai do processo do navegador, vale até 60 s, é consumida uma vez e confere a URL exata antes de preencher. Senhas não são gravadas pelo gerenciador do Chrome; cookies de sessão persistem no perfil do bot. Quem tem acesso à conta Linux do PC continua tendo acesso aos cookies e ao processo do navegador.
- `browser_type` recusa password também no executor; leituras omitem valores, capturas cobrem campos, e senhas usadas são filtradas de textos/capturas do navegador. A captura do desktop abrange a tela da pessoa e pode mostrar dados privados. Nunca use `desktop_type` para senhas. Texto com símbolos/acentos usa clipboard temporário, restaurado se a pessoa não tiver copiado outro conteúdo; formatos ricos que não consegue preservar são recusados.

## Chrome do bot dentro do MyBots (v46)

- O Chrome de cada bot no PC roda sem janela; a imagem ao vivo vai só para as conexões autenticadas do app (supervisor no celular) e da janela local do PC (token local) que pediram aquele bot. Quadros nunca entram nos eventos gerais, no widget nem nos registros, e não são vistos pela IA.
- Toques, teclas, texto e endereços da pessoa só são aceitos com o navegador **assumido**. O supervisor confere e limpa cada campo; o nó do PC confere de novo pelo estado de controle que o celular envia, e o recusa se o celular desconectar. Endereços passam pela mesma conferência de loopback/link-local e protocolos. O texto digitado com a chave ligada vai direto para a página.
- A IA não recebe a tela ao vivo: ela só vê o que pede pelas ferramentas `browser_*`, com as mesmas permissões de antes. Claude no PC usa esse Chrome isolado por padrão; o Chrome principal compartilhado (Claude in Chrome) passou a ser uma opção explícita por bot.

## Importar senhas por CSV (v46)

- Ajustes → Senhas → **Importar CSV** abre o seletor do Android; o arquivo é lido e interpretado no código nativo do app (Kotlin) e vai direto para o cofre cifrado (Android Keystore). As senhas não passam pelo JavaScript do app, pelo supervisor nem pela IA. Só entram linhas com endereço http/https e senha; o resto é contado e ignorado. Mesmo site e usuário substituem a senha antiga.
- Depois de importar, o app oferece apagar o arquivo exportado (que tem todas as senhas sem proteção) pelo próprio provedor de documentos do Android.

## Claude in Chrome oficial (v45)

- No PC, Claude com Navegador liberado usa a extensão oficial no **perfil principal**, por escolha explícita da pessoa. Os bots Claude compartilham os logins desse perfil e podem acessar o conteúdo dos sites autenticados. Isso substitui o isolamento por bot da v44 somente para Claude no PC. Codex mantém o perfil isolado e o login cifrado; no celular não muda.
- `PreToolUse` cobre todas as ferramentas `mcp__claude-in-chrome__*`, inclusive leituras e ferramentas já pré-autorizadas pelo CLI. O hook HTTP usa o token temporário da resposta pelo túnel autenticado, sem abrir uma API remota de controle. Valida execução ativa, aparelho, provedor, argumentos e ID único; não reutiliza uma decisão. Conectores da conta não concedem Navegador.
- Leituras seguem Navegador; ações no Médio pedem aprovação lembrável, no Total passam. JavaScript e ferramentas desconhecidas contam como ações; uploads e lotes pedem aprovação a cada chamada em qualquer nível. Caminhos sensíveis em uploads são recusados. Conteúdo de páginas continua sendo dado externo, nunca instrução.
- `onFailure: "block"` impede execução em falha, HTTP não autorizado ou timeout; versões antigas do Claude Code são recusadas antes da resposta. Revogar a permissão ou assumir o navegador bloqueia chamadas seguintes. “Assumir” vale para o Chrome compartilhado, inclusive outros bots Claude. O aviso e o dono único do controle são adquiridos no PC antes de liberar a ferramenta.
- Pânico cancela a resposta/processo do Claude, sem fechar o Chrome da pessoa. Não desfaz ações já enviadas à extensão. Autorizações próprias da extensão não são contornadas. O perfil `~/.config/google-chrome` fica vazio dentro do bubblewrap para impedir leitura direta de cookies e bancos de senhas pelo terminal/modelo.
- Senhas do cofre do celular não são entregues à integração oficial: login manual no Chrome principal. Sites já autenticados ficam acessíveis pela extensão; não prometer isolamento entre bots nem a mesma separação de credenciais do Playwright.


## Ações por coordenada e abas (v47)

- `browser_act`, `browser_tabs` e `browser_find` herdam exclusivamente Navegador; Pouco acesso não as lista. A pessoa assumiu: chamadas recusadas. Entrada de troca de aba é limpa pelo supervisor e só passa no nó com Assumir.
- Ações por ponto inspecionam o elemento antes de executar. Clique/clique duplo/direito em envio, link de compra/pagamento ou campo de formulário, Enter em formulário e arraste seguem `browser/write`, com Sempre permitir no Médio. Teclas de edição e espaço também são tratadas como escrita. O alvo (tipo, rótulo e URL) é conferido novamente depois da aprovação; se mudou, a ação é recusada.
- Coordenadas, deslocamentos, teclas, consultas e números de aba têm limites e listas fechadas. Não há JavaScript arbitrário para a IA. Abas novas usam as mesmas conferências de URL e DNS; o bloqueio de rede vale para o contexto inteiro, inclusive popups. Limite de cinco abas por perfil do bot.
- Leitura e busca não incluem valores de campos de senha. Iframes só são lidos na mesma origem; ids e caixas são reutilizados pela busca e pelas capturas numeradas. A camada de marcação é removida no `finally`; capturas mascaram campos de senha. No PC, resultados continuam passando pela remoção dos segredos preenchidos pelo cofre. A tela ao vivo continua restrita às conexões que estão olhando o bot.


## Meu Chrome e configuração do navegador (v48)

- `browserMode` distingue `own`, `mine` e `claude`. Perfis antigos `mainChrome: true` de Claude migram na leitura para `claude`; nenhum bot é migrado automaticamente para Meu Chrome. Codex não aceita `claude`; Pouco acesso volta ao Chrome próprio. Mudar o modo renova a sessão e a marca de dispositivo das conversas/salas.
- Meu Chrome só funciona com Navegador liberado. No Médio, ações usam `browser/mine/write`, separado de `browser/write` e `browser/chrome/write`; leitura, busca, captura, espera e seleção de abas passam. Upload continua sempre pedindo. Assumir em qualquer bot Meu Chrome bloqueia os demais no supervisor e no executor do PC. O aviso de controle do desktop permanece ativo durante a resposta.
- O nó lê apenas `DevToolsActivePort` do perfil local, valida porta/caminho e conecta exclusivamente ao loopback. A IA não recebe o endpoint nem acesso aos arquivos do perfil; `~/.config/google-chrome` continua oculto no isolamento. Não há cópia de perfil, mudança de `Preferences`, alteração de permissões do contexto ou disfarce de automação.
- Uma conexão compartilhada por worker, com sessões/abas próprias por bot. A conexão usa `noDefaults` para preservar configurações do Chrome existente. Só abas criadas pelo MyBots recebem rotas, scripts internos, tratamento de diálogos e dimensão da captura. A dimensão é aplicada por alvo, sem redimensionar a janela/aba da pessoa. Não há `context.route`, enumeração de abas pessoais nos resultados ou `context.close` no modo Meu Chrome. Fechar a conexão CDP não encerra o Chrome (conferido em teste real separado).
- A primeira requisição de um popup não passa por `page.route`; por isso, nas abas do bot, `window.open` e links para novas janelas abrem pelo caminho que confere URL/DNS antes de navegar. Formulários com destino de nova janela permanecem na aba do bot; popups nativos inesperados são fechados. Isso preserva o bloqueio de loopback nas ações do bot sem afetar a navegação pessoal. Popups que exigem o objeto da janela de origem podem precisar de ajuda manual.
- Senhas do cofre continuam em envelope cifrado até o worker; os segredos conhecidos são removidos dos resultados de todos os bots que usam o worker compartilhado. Campos de senha são mascarados nas capturas. Os logins do perfil da pessoa são compartilhados entre bots Meu Chrome; isolamento de cookies só existe no Chrome próprio.


## Descoberta do computador (v49)

- UDP 3234: o PC só responde a perguntas com o próprio identificador, enviadas por IPv4 privado (10/8, 172.16/12, 192.168/16 ou 100.64/10). Resposta unicast com identificador, porta e endereços locais; nenhum segredo, token ou dado dos bots. Pacotes maiores que 512 bytes e JSON inválido são ignorados. Limite de uma resposta por remetente a cada dois segundos, com memória limitada.
- O celular procura por broadcast global e pelos broadcasts calculados das interfaces IPv4. Só considera respostas do mesmo identificador, com porta válida e endereços privados. A descoberta dura até dois segundos, no máximo uma vez a cada 15 segundos; fechar o link cancela a busca. Loopback só é aceito quando explicitamente configurado nos testes isolados.
- Descoberta não autentica: o TLS continua conferindo o certificado fixado no QR antes de enviar a prova de pareamento. Endereços descobertos só são salvos depois de conferir certificado e identidade. Respostas falsas são recusadas e não impedem tentar outras respostas corretas. O segredo salvo nunca é substituído pela descoberta.
- Falha no UDP não desliga o serviço nem apaga o pareamento. Os caminhos por endereço salvo e por QR continuam disponíveis. Tailscale é opcional e requer instalação e entrada na conta pela pessoa; nenhuma instalação ou abertura de portas do roteador é feita automaticamente.


## Tela ao vivo nativa (v54)

- PC → supervisor: JPEG binário com cabeçalho MBF1 (bot, dimensões, sequência e metadados só quando mudam), no mesmo link TLS com certificado fixado no pareamento. O supervisor valida cabeçalho e limites antes do relay. Não há base64 ou JSON de imagem nesse trecho.
- Android: `/frames?bot=<id>` é WebSocket binário no mesmo servidor **127.0.0.1** do supervisor. Exige o token do app em `Authorization: Bearer`, confere o bot e a permissão de Meu Chrome; token incorreto recebe HTTP 401 antes do upgrade. Cada socket recebe apenas o bot escolhido, mantém ping/pong e termina junto com o supervisor.
- JPEG e bitmap ficam no Kotlin, com decodificação em segundo plano e reaproveitamento de bitmap fora da camada visível. A JS recebe apenas metadados, até duas vezes por segundo. Sem view nativa, a reserva web/PC usa duas imagens alternadas. Quadros nunca são enviados à IA, aos eventos gerais, widgets ou logs. O RPC do app continua aceitando um pedido por vez por conexão.
- Dimensões pedidas têm limites. Quem controla o navegador continua sendo decidido pelo supervisor e conferido novamente no PC; só Assumir habilita entradas e o perfil de 15 quadros/s. Campos de senha também recebem máscara visual na transmissão ao vivo. Não há disfarce de automação nem resolução automática de CAPTCHA.

### Entrada ao vivo (v55)

O `/frames?bot=<uuid>` também recebe entrada da pessoa. O token Bearer local é conferido no upgrade e em cada mensagem; a origem continua limitada ao app local. Cada mensagem deve ser JSON, ter `type: input`, sequência inteira crescente e uma ação da lista fechada, com coordenadas e tamanhos limitados. O bot é o da conexão; a pessoa precisa continuar com Assumir ativo. Há uma única entrada em andamento por conexão, confirmada pelo PC antes do próximo envio. Mensagens binárias, repetidas, concorrentes ou inválidas fecham a conexão. Movimentos são agrupados a cada 50 ms; o cliente nativo retém só o movimento mais recente, com fila limitada. O RPC principal permanece serial.

A digitação nativa é capturada por um campo Android invisível, com composição e correções do IME, agrupada em até 30 ms. O texto é cifrado no Android (AES-256-GCM, chave temporária envolvida com RSA-OAEP SHA-256 do worker, AAD `mybots-input`). Apenas o worker decifra: o JavaScript do app, o supervisor, os eventos e as respostas recebem somente metadados ou o envelope cifrado. O foco informa tipo e retângulo, nunca valor. Senha e `one-time-code` ativam entrada secreta sem sugestões, autofill ou texto visível; fragmentos privados e valor final são retirados das leituras e metadados do worker. A resposta da entrada contém apenas `sent: true`.
