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

- Até a v57: uma WebView por bot com perfil próprio (cookies/armazenamento separados); desde a v58 o padrão é o perfil compartilhado (ver "Navegador compartilhado (v58)"). Sem perfis no aparelho, o perfil único é apagado ao trocar de bot.
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

O `/frames?bot=<uuid>` também recebe entrada da pessoa. O token Bearer local é conferido no upgrade e em cada mensagem; a origem continua limitada ao app local. Cada mensagem deve ser JSON, ter `type: input`, sequência inteira crescente e uma ação da lista fechada, com coordenadas e tamanhos limitados. O bot é o da conexão; a pessoa precisa continuar com Assumir ativo. Há uma única entrada em andamento por conexão, confirmada pelo PC antes do próximo envio. Mensagens binárias, repetidas, concorrentes ou inválidas fecham a conexão. Uma entrada válida que não pode ser entregue (PC desconectado, ou toque atrasado depois de **Devolver ao bot**) recebe a confirmação com erro e a conexão continua: ela não é abuso e a tela ao vivo não pode congelar por isso. Movimentos são agrupados a cada 50 ms; o cliente nativo retém só o movimento mais recente, com fila limitada. O RPC principal permanece serial.

A digitação nativa é capturada por um campo Android invisível, com composição e correções do IME, agrupada em até 30 ms. O texto é cifrado no Android (AES-256-GCM, chave temporária envolvida com RSA-OAEP SHA-256 do worker, AAD `mybots-input`). Apenas o worker decifra: o JavaScript do app, o supervisor, os eventos e as respostas recebem somente metadados ou o envelope cifrado. O foco informa tipo e retângulo, nunca valor. Senha e `one-time-code` ativam entrada secreta sem sugestões, autofill ou texto visível; o valor inteiro do campo privado é retirado das leituras e metadados do worker, substituindo o valor parcial guardado a cada tecla (para "S", "Se"… não se acumularem). Trechos com menos de 4 caracteres nunca são substituídos, porque trocariam letras comuns em endereços, títulos e leituras. Na tela ao vivo, a senha aparece só como bolinhas. A resposta da entrada contém apenas `sent: true`.

O CAPTCHA continua sendo resolvido pela pessoa. O worker só localiza o desafio visível (inclusive o Turnstile dentro de shadow DOM fechado, pela lista de frames do Chrome), rola até ele uma vez por página e, quando o desafio de imagens do reCAPTCHA abre fora da largura de celular, deixa a aba no tamanho de computador só enquanto ele está aberto. Nada disso disfarça a automação: o Cloudflare ainda recusa o Chrome sem janela em alguns sites, e nesses casos o caminho é **Meu Chrome**.


## Conversas por página e eventos (v56)

- Mensagens novas saem para o app e para a janela do PC no evento, com o conteúdo, só depois de gravadas (os eventos de uma transação esperam o commit; numa falha, nada sai). O link para o PC continua levando só a lista fechada de eventos e métodos da janela: entraram `chat.page`, `chat.read`, `bot.profile` e os eventos de mensagem; backup, cofre e pareamento continuam só no celular.
- `chat.page` confere se o bot ou a sala existem e valida o cursor (inteiro positivo) e o tamanho (1 a 200). O estado geral deixou de levar memórias, permissões e o corpo das conversas a cada atualização; eles só saem quando a pessoa abre o perfil ou a conversa.
- O que os bots leem não mudou de regra: a sala que cada bot lê na vez dele continua limitada por tamanho (agora a partir das últimas 600 mensagens) e uma sessão nova do chat privado lê as últimas 400, avisando que o início não está no contexto.


## Cache e teclado das conversas (v57)

- A prévia local guarda no máximo as últimas 40 mensagens carregadas de cada bot e sala, no armazenamento privado do MyBots já usado antes. Ela permite abrir a conversa antes da resposta do supervisor; o histórico completo continua no SQLite do Termux. A exclusão de um bot remove a conversa da loja em memória e grava o cache sem suas mensagens; uma sala excluída também sai do cache. Tombstones de bots continuam sem mensagens para preservar a regra de não ressuscitar dados antigos.
- A loja usa os eventos numerados da v56: ignora repetidos, detecta lacunas e recarrega o estado e as páginas. As atualizações de passos e mensagens não acrescentam permissões nem alteram a serialização do RPC. Anexos continuam sendo buscados apenas quando a pessoa toca para abrir, compartilhar ou salvar.
- O campo de conversa usa `react-native-keyboard-controller` 1.21.9, com `react-native-reanimated` 4.5.1 e `react-native-worklets` 0.10.1, versões indicadas pelo Expo SDK 57. São bibliotecas locais de animação e teclado, sem conector, coleta remota ou nova permissão Android. A entrada protegida de senha no navegador continua no caminho nativo da v55. Instalação: [documentação do controlador](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/installation).
- A primeira compilação precisa preencher o cache Gradle das novas dependências nativas. Depois disso, a validação da entrega exige `scripts/build-apk.sh --offline`, sem buscar dependências pela rede.

## Navegador compartilhado (v58)

**Mudança de decisão**: até a v57 cada bot tinha o próprio Chrome no PC (`own`) e a própria WebView no celular, e os logins de um bot nunca chegavam a outro. A partir da v58 o padrão, a pedido da pessoa, é **um navegador compartilhado por aparelho**, como no OpenBot. Consequência direta: **qualquer bot com a permissão Navegador age logado nas contas em que a pessoa (ou outro bot) entrou nesse navegador**. Um bot criado hoje abre um site e já está dentro da conta.

- **Modos** (`browserMode`): `shared` (padrão), `separate` (Navegador separado), `mine` (Meu Chrome) e `claude` (Claude in Chrome). O valor antigo `own` é lido como `shared`; bots em Meu Chrome ou Claude in Chrome continuam como estavam. **Pouco acesso** usa sempre `separate`: um bot de Pouco acesso nunca age logado nas contas do navegador compartilhado.
- **PC**: um Chrome do MyBots (`~/.mybots-pc/browsers/shared/chrome`), separado do Chrome pessoal, sem janela, com um processo para todos os bots desse modo. Cada bot só enxerga as **próprias abas** (até 5): leitura, comandos, tela ao vivo, popups e downloads ficam presos às abas que ele abriu. Toda navegação continua passando por `allowedUrl` (rota do contexto inteiro). Parar um bot fecha só as abas dele; o Chrome compartilhado fecha de forma limpa (SIGTERM) para gravar os cookies.
- **Celular**: as WebViews dos bots compartilham o perfil `shared` (WebView 123+). `Navegador separado` usa `bot-<id>`. Sem perfis de WebView (aparelho antigo), o navegador compartilhado usa o perfil único do app e um bot separado, ao navegar, **apaga** esses logins — o app avisa.
- **PC e celular são navegadores diferentes**: um login feito num não vale no outro. A interface diz isso no perfil e no painel; nada é copiado entre aparelhos.
- **Aprovações continuam por nível**: no Médio, enviar formulário, comprar ou clicar em botões de envio pede `browser/write`; login salvo pede `browser/login`; upload pede sempre. Total roda direto, como antes. As regras de senha não mudam: **senhas e códigos nunca passam pelo modelo** (cofre cifrado para o worker, `browser_login`, modo secreto do teclado ao Assumir) e campos de senha aparecem como bolinhas na tela ao vivo e nas miniaturas.
- **Assumir** bloqueia só o bot assumido: os outros bots do navegador compartilhado continuam nas abas deles (o bloqueio de todos vale apenas para Meu Chrome, como na v48).
- **Migração dos logins antigos**: na primeira vez, o nó copia os **cookies persistentes** de cada perfil antigo `~/.mybots-pc/browsers/<bot>` (de bots que passaram a `shared`) para o Chrome compartilhado, do perfil mais antigo para o mais novo, e marca o perfil (`mybots-imported-to-shared`). O perfil antigo fica intacto e volta a ser usado se o bot passar a **Navegador separado**. Cookies de sessão (que somem ao fechar o navegador) e `localStorage` não são copiados; no celular não há como ler os cookies de cada perfil, então os bots do celular precisam entrar de novo uma vez.
- **Ícones das abas**: o worker baixa o `favicon` com o mesmo `allowedUrl`, **sem seguir redirecionamentos**, só imagens pequenas (até 16 KB); SVG é ignorado.
- **Downloads no PC**: `~/.mybots-pc/downloads/<bot>/`, nomes sem caminho, executáveis recusados, até 100 MB. A pessoa abre ou envia ao bot pelo app; só então o arquivo (até 20 MB) vai ao celular como arquivo do bot. O nó só lista, lê ou apaga dentro da pasta do bot pedido.
- **Linha do tempo**: cada passo guarda legenda, endereço e uma captura (migração 10, `browser_steps`, 120 por bot, apagados com o bot). A captura nunca vai ao modelo; só ao app.


## Nível Livre e controle do celular (v59)

**Mudança de decisão**: até a v58 o freio era pedir aprovação ação por ação. O nível **Livre**, acima de Acesso total, troca isso por **limites que o modelo não consegue mudar**. É escolhido por bot, só no app do celular, depois de um aviso na primeira vez.

### O que o nível Livre permite

- **Nada pede aprovação**, exceto o que estiver na lista **"Sempre perguntar"** e os limites duros abaixo. Cada ação continua registrada na **Atividade**, como em todos os níveis.
- **Controle dos outros apps do celular** pelo serviço de acessibilidade do MyBots (`MyBotsAccess`): `phone_screen` (a tela como lista numerada, com captura opcional), `phone_tap`, `phone_type`, `phone_scroll`, `phone_open_app`, `phone_back`, `phone_fill_code` e `phone_ask_user`. Essas ferramentas só aparecem para bots no Livre; nos outros níveis, a permissão `phone` é sempre negada.
- **Terminal completo do Termux** quando o bot responde pelo celular: instalar pacotes, rodar scripts, usar o Termux:API (localização, câmera, SMS, com a permissão do Android). Nos outros níveis o celular continua **sem terminal**, como antes. Codex roda com `--sandbox danger-full-access` (o Android continua isolando o Termux dos outros apps); Claude recebe `Bash,Read,Write,Edit,Glob,Grep` e **cada comando** passa pela ferramenta de permissão do MyBots.
- No computador, um bot Livre tem o mesmo alcance de Acesso total (inclusive a pasta pessoal), com a lista "Sempre perguntar" no lugar das aprovações.

### A lista "Sempre perguntar"

Uma lista só, para todos os bots Livres, editada no perfil (aba Acesso). Itens: comandos perigosos (sudo, apagar pastas inteiras, git push — no PC ou no Termux), instalar habilidades, anexar arquivos em sites, enviar SMS (esses quatro começam ligados, e o pagamento com a carteira também), enviar formulários, entrar com senha salva, preencher códigos, comandos no Termux, comandos no PC, agir nos apps da conta, controlar a tela do PC, mandar notificações e criar rotinas. O cartão do Livre **não tem "Sempre permitir"**: a lista só muda pela tela dela. Um app conectado marcado como "ações sempre pedem aprovação" continua pedindo também no Livre.

**Limite do Codex**: o Codex não deixa o MyBots decidir comando a comando dentro do terminal. Por isso, com **"Comandos no Termux"** na lista, um bot Codex fica **sem terminal** no celular; **"Comandos perigosos"** vale para ele só como instrução. Para o Claude, os dois itens geram cartão de verdade.

### O que continua bloqueado no Livre (limites duros)

- **Senhas, números de cartão e códigos nunca passam pela IA nem pelos logs.** Campos de senha aparecem como `••••` em `phone_screen` e tapados de preto nas capturas; `phone_type` recusa campos de senha. Senhas salvas continuam sendo preenchidas pelo app (`browser_login`).
- **Códigos de verificação**: quando chega uma notificação ou SMS (pelo app de mensagens) que fala de código, o `MyBotsNotificationListener` esconde o número **antes** de mandar ao supervisor (`[código protegido]`) e guarda o código só na memória do app por 15 minutos. `phone_fill_code` escreve o código direto no campo, dentro do app, e só aceita o código **do remetente que o bot indicou**. Se a mensagem **não cita** o app ou o site do campo (por exemplo, um código do banco num site estranho), aparece um cartão para a pessoa decidir, mesmo no Livre e mesmo com o item fora da lista. Todo código visto vira segredo por 30 minutos: é mascarado em qualquer tela lida pelo bot (inclusive a conversa do SMS e o campo já preenchido), tapado nas capturas e removido de toda resposta que o app manda ao supervisor. O supervisor também mascara códigos nas notificações gravadas e no `sms_search`.
- **CAPTCHA, biometria e confirmação de pagamento** são sempre da pessoa (`phone_ask_user`, `browser_ask_user`). Nada de anti-detecção ou quebra de CAPTCHA.
- **Apps que recusam acessibilidade** (bancos, pagamentos): o serviço **não** se declara ferramenta de acessibilidade (`isAccessibilityTool=false`), então apps que se escondem desses serviços continuam escondidos. A tela vem vazia (`refused`) e o bot chama a pessoa.
- **Telas que são sempre da pessoa**: o próprio MyBots, instaladores de apps, a tela de permissões do Android e telas de Configurações sobre o MyBots (acessibilidade, permissões, desinstalar, forçar parada). Nelas o bot só lê; tocar, digitar e rolar são recusados no app.
- **Arquivos do supervisor e chaves**: no Termux, caminhos de `~/.mybots`, do supervisor e de chaves (`.ssh` e afins) são recusados antes de qualquer comando do Claude.
- **O modelo nunca muda o próprio nível nem a lista.** Não há ferramenta para isso; `team_create_bot` recusa `access: free` e um bot Livre cria bots no máximo com Acesso total; a janela do PC não escolhe Livre nem edita a lista (só o app do celular).

### Por que o app confere o nível

No Livre o bot tem um shell no Termux, o mesmo usuário Linux do supervisor. Um comando disfarçado poderia, em tese, mexer nos arquivos do supervisor. Por isso o que mais importa é conferido **pelo app**, fora do alcance do Termux:

- O app guarda **a sua própria cópia** de quais bots estão no Livre e da lista "Sempre perguntar" (preferências privadas do app). O `MyBotsAccess` **só obedece bots que essa cópia lista**.
- Ao carregar o estado, se o supervisor disser que um bot é Livre sem o app ter escolhido, o app o devolve para Acesso total e avisa a pessoa. Se a lista do supervisor divergir da cópia do app, o app restaura a cópia e avisa.
- Senhas (Keystore), códigos (memória do app) e o controle dos apps (serviço de acessibilidade) vivem no app, não no Termux.

### Parar, ver e assumir

- Enquanto um bot controla o celular aparecem **uma barra sobre os outros apps** (o que ele está fazendo, Assumir e **Parar**) e **uma notificação fixa** com Parar e Assumir. O app mostra um cartão "Celular ao vivo" na conversa, com a captura depois de cada passo, e a linha do tempo guarda os passos ("No celular: …").
- **Parar** funciona na hora: o app marca o turno como parado e todo passo nativo em andamento confere isso a cada 50 ms (abrir app, toques, rolagens); depois o supervisor cancela o turno e recusa o que ainda estava na fila. Parar também funciona pelo botão Parar do chat e pela janela do PC.
- Um bot de cada vez controla o celular. **Assumir** faz o app e o supervisor recusarem comandos até a pessoa tocar em Devolver.

### Ligar o serviço

O serviço de acessibilidade é ligado pela pessoa em Ajustes → Controle do celular. No Android 13 ou mais novo, um APK instalado fora de loja fica bloqueado ("Configuração restrita") até a pessoa tocar em **Permitir configurações restritas** no menu ⋮ das informações do app; o app guia esse passo. Bots fora do Livre não usam o serviço mesmo com ele ligado.

## Carteira do bot (v60)

A pessoa entrega ao bot um cartão (de preferência virtual, com limite próprio no banco) e regras de gasto. O bot compra sozinho dentro dessas regras; **quem confere as regras é o app, nunca o modelo nem o supervisor**.

### Onde fica cada coisa

- **O cartão** (número, validade, código, nome e endereço de cobrança) é digitado num formulário nativo do app, com a tela protegida contra capturas, e fica no cofre cifrado do Android (`PasswordVault`, Keystore), fora do backup. O JavaScript do app e os bots só recebem o **final** (ex.: "final 3831").
- **As regras** (máximo por compra, por dia e por mês, lojas permitidas e proibidas, categorias e o "congelada") ficam nas preferências privadas do app (`WalletGuard`), fora do backup e fora do alcance do Termux. Só se mudam no editor nativo de Ajustes → Carteira; não há ferramenta, RPC nem caminho pelo PC para isso. A carteira começa **congelada**.
- **O extrato** (loja, valor, itens, bot, data, comprovante) fica no app. "Desconsiderar" (compra que não aconteceu) só existe no app.

### Como um pagamento acontece (`browser_pay`)

1. O bot abre a etapa final do checkout e declara loja, itens, categoria e total.
2. **Aprovação**: abaixo do Livre, toda compra pede aprovação, sempre sem "Sempre permitir". No Livre, "Pagar com a carteira" vem ligado na lista "Sempre perguntar" (a lista de quem já usava o Livre ganha o item uma vez).
3. **O total e o endereço vêm da própria página**: no celular, o app lê o checkout na WebView; no PC, o processo do navegador lê a página. Um total ambíguo, ausente ou diferente do declarado é recusado.
4. **O app confere as regras** (`WalletPolicy`): carteira descongelada, página https, loja do checkout igual à declarada e permitida (e não proibida), categoria permitida, limites por compra, dia e mês (dia e mês do relógio do celular). Só então **reserva a compra no extrato** e libera o cartão.
5. **O cartão vai só para os campos do checkout**: no celular, o app preenche a página (e os quadros de processadoras conhecidas, como Stripe, Mercado Pago, Adyen, PagSeguro, só pelo canal de cada quadro); no PC, o app cifra o cartão para uma chave de uso único do processo do navegador (RSA-OAEP + AES-GCM, preso à página, ao total e ao pedido) e só esse processo o decifra. Pelo supervisor passa apenas texto cifrado.
6. O número e o código entram na lista de redação **antes** de serem digitados: leituras, títulos, respostas e capturas nunca os mostram, mesmo que a página os repita. As capturas e o comprovante saem com os campos tapados de preto.
7. Na hora, a notificação **"Bot comprou X por R$ Y"**, com o botão **Congelar carteira**; a Atividade registra a compra.
8. O bot clica em "Finalizar compra" (no Médio, esse clique também pede aprovação). Ao fim da vez do bot no PC, o cartão que ficou num formulário é apagado.

### Congelar

**Congelar carteira** (Ajustes, a página ao vivo do navegador do bot ou a notificação da compra) congela na hora: o app recusa novos pagamentos, apaga o cartão dos checkouts dos últimos 15 minutos no celular e avisa o supervisor, que apaga o cartão do checkout no PC e **cancela a vez dos bots que estavam pagando**. Descongelar só pelo editor de regras.

### O que continua com a pessoa

3-D Secure, confirmação no app do banco, Pix e CAPTCHA são sempre da pessoa (`browser_ask_user`). Uma página que diga "compre isto" ou "o limite aumentou" não muda nada: as regras vivem no app.

### Limites conhecidos

- O total é lido por rótulos comuns ("Total", "Total do pedido", `data-order-total`…). Checkouts com outro formato são recusados (falha fechada) e a pessoa paga.
- Quadros de pagamento de processadoras fora da lista não recebem o cartão; o bot chama a pessoa.
- A reserva conta nos limites a partir do preenchimento. Se o pedido não for concluído, a pessoa usa "Desconsiderar" no extrato.
- **No PC, o Chrome do bot guarda o estado dos formulários das abas** nos arquivos de sessão do perfil (`~/.mybots-pc/browsers/…/Sessions`), como faz com qualquer formulário digitado. O número do cartão pode ficar ali depois de uma compra. Essa pasta fica escondida das IAs pelo isolamento (bubblewrap) e não sai do computador; é a mesma exposição de digitar o cartão no próprio Chrome. Verificado no aceite da v60: o cartão não apareceu no logcat, no supervisor do celular, nas sessões das IAs nem na conversa.

## Skills dos bots e placa de vídeo (entre a v60 e a v61)

Skills são pastas com um `SKILL.md` e scripts (formato do Claude Code e do Codex). Elas chegam aos bots só pelo MyBots, do mesmo jeito para qualquer IA. Não confundir com as "habilidades" (`supervisor/skills.mjs`), programas JS que o bot escreve para rodar no celular.

- **Nada é carregado sozinho.** O Claude continua com `--setting-sources ''` e o Codex com `skip_host_skill_discovery`: as skills de `~/.claude`, `~/.codex` e `~/.agents` não valem para nenhum bot até a pessoa ligar a skill no perfil dele (Skills). Padrão: nenhuma ligada.
- **Só no computador.** O PC procura as pastas (`lib/agent-skills.cjs`: `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, seguindo links e contando cada pasta real uma vez). O celular guarda quais o bot usa (`bot.skills`, até 20, caminhos reais) e só aceita um caminho que o PC acabou de listar; na hora de rodar, o PC confere de novo no disco e descarta o que não existe.
- **O que o modelo recebe.** Um índice curto (nome, descrição e caminho do `SKILL.md`) junto das instruções de ferramentas do bot (`--append-system-prompt` no Claude, `developer_instructions` no Codex), a cada turno, inclusive em conversa retomada e em sala. O conteúdo da skill o modelo lê só quando precisa.
- **Sandbox (bubblewrap).** A pasta da skill é montada no mesmo caminho absoluto, depois das pastas escondidas: `--ro-bind`, ou `--bind` se "pode melhorar a skill" estiver ligado. Para um bot Codex, `~/.claude` continua vazio, só com a pasta da skill dentro; as credenciais, o `auth.json` e as sessões nunca são montados. Para um bot Claude, `~/.claude` já é visível, porque o próprio Claude Code roda dentro do sandbox e precisa do login dele; isso não mudou.
- **Sem cartão para a skill, com limites.** No Médio, ler a pasta de uma skill ligada, gravar nela (só com "pode melhorar") e rodar comandos que só tocam nela não geram cartão. Um comando assim junta passos com `&&` ou `;` (nunca `|`, `&`, redirecionamento, crase ou `$( )`), e cada passo é um `cd` para dentro da skill, um leitor simples (`ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`) ou um programa dela (`./setup.sh`, `bash setup.sh`, `node render.js`, caminho absoluto). Depois de um `cd` na skill, caminhos relativos sem `..` contam como dela; um nome solto como `rm` ou `curl`, `python -c` e `env` não contam. Comando perigoso, caminho de senhas e qualquer outra coisa (inclusive criar um projeto fora da pasta do bot) seguem as regras de sempre. O script da skill roda com o acesso do bot: a pessoa escolhe em quais skills confia.
- **Placa de vídeo.** O sandbox usa um `/dev` mínimo, sem `/dev/dri` nem `/dev/nvidia*`. "Usar a placa de vídeo" (por bot, desligada por padrão, com aviso no perfil) liga esses dispositivos só para aquele bot. Quem a usa passa a ter acesso direto à GPU do computador. No Codex há um custo a mais: o sandbox interno dele monta o próprio `/dev` e esconderia a placa, então, com a GPU ligada, o Codex roda em `danger-full-access` e o isolamento fica só com o bubblewrap do MyBots (senhas e chaves escondidas, só a pasta das skills e a GPU à mostra). O bot Codex com GPU pode gravar em toda a pasta pessoal, como num bot em Acesso total; decisão do usuário. Nos bots Claude isso não muda.
- **Comandos longos.** Um bot com skill ligada pode ficar até 45 minutos sem escrever nada (o padrão é 10) e o Bash do Claude aceita comandos de até 1 hora; o limite total de 2 horas por resposta não mudou.
- **Salas:** o limite de rodadas entre bots que se chamam passou de 6 para 30 (`MAX_ROUNDS`).

## Negociar e agir em seu nome (v61)

O bot pode negociar, mas **o que ele pode oferecer vive no supervisor, fora do alcance do modelo**: o mandato (objetivo, preço-alvo, teto ou mínimo, canais, prazo, se pode fechar, tom) é criado e editado só pelo app do celular (`negotiation.save`, `negotiation.cancel`, `negotiation.respond`; o computador pareado não alcança esses métodos) e não há ferramenta para o bot mudá-lo.

- **Cada oferta é declarada antes de ser enviada** (`negotiation_offer`). O supervisor recusa: valor acima do teto (compra) ou abaixo do mínimo (venda), canal fora do mandato, mandato de outro bot, mandato encerrado ou vencido, oferta enquanto uma proposta espera a pessoa, e **texto que cita um preço diferente do declarado**. As recusas ficam no histórico e na Atividade.
- **O relógio é o do supervisor.** O prazo vencido encerra o mandato (`expired`), recusa a proposta pendente e bloqueia novas ofertas.
- **Fechar** (`negotiation_close`): só fecha sozinho dentro do mandato e com "pode fechar". Fora do mandato, ou sem permissão, vira o cartão **Aceitar/Recusar** (sem "Sempre permitir"). Aceitar a proposta não paga nada: o pagamento continua passando pela carteira (regras de gasto, aprovação, total da página).
- **Senha, cartão e código nunca passam pela IA.** CAPTCHA continua sendo da pessoa. O bot escreve como a pessoa, no tom escolhido; se "apresentar-se como assistente" estiver ligado, ele se apresenta, e **nunca nega ser um assistente** se perguntarem.
- **Limite conhecido**: o MyBots confere o que o bot *declara* e o que ele manda como texto na declaração. O envio em si acontece pelas ferramentas de sempre (WhatsApp, navegador, e-mail); um bot que escrevesse algo diferente do declarado, direto num app, não seria barrado pelo mandato — por isso ele só tem o mandato como guia nos canais abertos a ele. E, como o supervisor roda no Termux, um bot **Livre** com shell poderia, em tese, editar o banco do supervisor; no Claude esses caminhos são recusados, no Codex isso vale como instrução.

### Carteira com vários cartões (v61)

A carteira guarda até 10 cartões no cofre do Android. **Quais bots podem pagar com cada cartão** é uma regra da pessoa, guardada nas preferências privadas do app (`WalletGuard`), e só se muda na tela Carteira; escolher os bots conta como mudar as regras (invalida pagamentos reservados antes). Um cartão que ninguém liberou não é usado. Com mais de um cartão liberado, o bot informa o final (`card`); um final que não foi liberado para ele é recusado. Apagar um cartão leva junto a lista de bots dele. O cartão da v60 (único) é movido para a lista na primeira leitura e **começa sem nenhum bot liberado** (falha fechada): a pessoa escolhe os bots em Carteira.

### Ajustes da 0.39.1

- **Livre não pergunta ação a ação no celular.** "Tocar e digitar em outros apps" e "Abrir apps no celular" saíram da lista "Sempre perguntar": num bot Livre, abrir um app, tocar, digitar, rolar e voltar nunca geram cartão (uma lista antiga que ainda os traga é ignorada). O que continua barrando no celular são os limites duros (senhas e códigos fora da IA, telas que são sempre da pessoa, apps que recusam acessibilidade) e os itens que a pessoa ligar na lista, como preencher códigos.
- **Carteira: lojas permitidas e categorias são opcionais.** Vazio significa qualquer loja https. Continuam valendo, sempre, os três limites (por compra, dia e mês), o total lido na própria página, a lista de lojas proibidas, o cartão liberado para o bot e o congelamento. Seed phrase e chaves privadas de carteiras de criptomoedas continuam fora do alcance da IA; o bot usa conta em corretora ou uma carteira da pessoa.

## Acabamentos da v62

- **Notificação com botões**: `POST /device/notification-action` no supervisor, com o token do pareamento (só o app no celular). Aprovar/Recusar exigem o `actionHash` exato da aprovação, valem uma vez e nunca viram "Sempre permitir". O supervisor recusa de novo (`noticeDecision`) o que só o app pode decidir: `wallet/*`, login, upload, `phone.*` (inclui códigos), `termux`, `skill.propose`, `desktop/*`, Chrome principal/Meu Chrome e `negotiation*`; resumo com mais de 600 caracteres, ou argumentos que o aviso não mostra, também abrem o app. No Android 12+ o botão pede o aparelho destravado. Aprovação respondida em outro lugar tira o aviso da tela.
- **Modelo reserva**: só para conversa privada e para a outra IA. A troca usa o mesmo bot (nível, concessões, "Sempre perguntar"), e as opções de execução são recalculadas pelo provedor que responde (o Codex só ganha terminal no Termux se o Livre não o mantiver na lista de perguntas). Claude in Chrome vira navegador compartilhado na reserva. A sessão da IA reserva nunca é gravada e a do bot é apagada para recomeçar do histórico salvo. Uso e limites são lançados no provedor que respondeu.
- **Busca**: índice FTS5 local no banco do supervisor (mesmo conteúdo que já estava nas conversas); consulta tratada como palavras, sem sintaxe FTS.
- **Corrigir rumo**: instrução da pessoa (pelo app ou PC pareado) que para a tarefa em andamento; entra no prompt como instrução da pessoa, não como conteúdo externo.

## Rostos e aparência (v63, parte 1)

- **O rosto é só desenho.** `bot.face` (semente, cor, peças) é validado no supervisor (`validFace`: semente até 40 letras sem caracteres de controle, cor `#rrggbb`, peças só da lista conhecida, nenhum outro campo). Nada do que o modelo escreve vira rosto sem passar por essa validação (`team.create_bot` continua só com cor e avatar antigos).
- **Widget, atalhos de compartilhar e notificações** recebem um quadro parado do rosto, gerado no supervisor (`lib/face.mjs`) e pintado pelo Kotlin (`FacePainter`). O quadro tem só caracteres, cores e opacidades; não leva texto de conversa. O resumo do widget continua só pelo `127.0.0.1` com o token do pareamento.
- **Aparência (escuro, claro, sistema)** é uma preferência da pessoa guardada em `metadata` (`person.theme`), editável só por `person.update`; o PC pareado a lê junto com o resto do estado.

## Parte 2 do redesenho (v66)

- **Senhas guardadas** viraram uma tela própria (busca, agrupada por site, carregada aos poucos). Ela lista só site, usuário e quais bots podem usar a senha, como antes; o segredo continua no cofre do Android e nunca chega ao JavaScript, à IA ou aos logs. Nada mudou em salvar, importar ou apagar.
- **Criar bot em passos**: o rosto escolhido (sortear ou montar) passa pela mesma validação do supervisor (`validFace`). O nível **Livre** nunca é enviado na criação: o bot nasce no Médio e o app aplica o Livre depois, mostrando o mesmo aviso de sempre (`applyAccess`); se a pessoa recusar o aviso, o bot fica no Médio. A primeira mensagem só é colocada no campo da conversa; nada é enviado sem a pessoa tocar em enviar.
- **Uma decisão aparece uma vez por tela**: a Atividade mostra só o contador de decisões esperando; Aprovar e Recusar ficam na Home e na conversa do bot, como antes. Nenhuma regra de aprovação mudou.
- **`@bot tarefa` na busca** só abre a conversa com o texto no campo; não envia nem dá permissão.

