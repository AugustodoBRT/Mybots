# MyBots no computador

O celular continua sendo o centro: bots, conversas, memória, rotinas, permissões e senhas ficam no SQLite do Termux. O computador é um **executor pareado**: responde pelos bots que vivem nele ("Computador") e pelos "Onde estiver" enquanto está ligado, usando o Claude Code e o Codex logados nele. Plano completo: [PLANO-PC.md](PLANO-PC.md).

## Usar

No computador (Linux, Node 22.13+, `openssl`, Claude Code e/ou Codex logados):

```bash
npm ci --prefix supervisor && npm install --prefix pc   # uma vez
node pc/node.mjs install     # sobe sozinho com a sessão (systemd do usuário)
node pc/node.mjs pair        # mostra o QR (vale 10 minutos, uma vez)
```

No celular: **Ajustes → Computador → Conectar computador** e leia o QR. Com a janela instalada, o QR também aparece nela: **Ajustes → Celular → Mostrar QR** (e na tela inicial enquanto nenhum celular estiver conectado); ele some sozinho quando o celular pareia.

**Janela do MyBots no computador** (Node, `cargo`, `webkit2gtk-4.1` e `libayatana-appindicator`):

```bash
npm install --prefix mobile    # uma vez
scripts/build-desktop.sh       # gera a interface e o app, instala no menu e no início da sessão (na bandeja)
```

A janela mostra o mesmo MyBots do celular (bots, conversas, salas, aprovações, atividade, perfis), ao vivo. Fechar a janela só a esconde na bandeja; os bots continuam online pelo serviço `mybots-pc`. Arquivos dos bots vão para `~/Downloads`. Backup, e-mail por senha de app, senhas de sites e o pareamento continuam só no celular. O navegador do bot abre no Chrome do PC quando ele responde por lá. Sem instalar o serviço, `node pc/node.mjs` roda o nó no terminal. Logs do serviço: `journalctl --user -u mybots-pc -f`. Remover o início automático: `node pc/node.mjs uninstall`.

Os dados do nó ficam em `~/.mybots-pc/` (diretório 700): identidade, certificado TLS, celulares pareados (com o segredo de cada um) e as pastas de trabalho dos bots.

**Fora de casa**: instale a [Tailscale](https://tailscale.com) no computador e no celular, com a mesma conta, e pareie de novo (o QR passa a levar o endereço 100.x da Tailscale). Na mesma rede Wi-Fi não precisa de nada.

## O que o bot faz no computador

Com **Mexer no computador** (perfil → Acesso; vale para bots que vivem no computador ou "Onde estiver" com ele ligado):

- Cada bot tem uma pasta em `~/MyBots/<Nome>` (o nome fica, mesmo se o bot for renomeado). Nela, cria e edita arquivos e projetos sem perguntar.
- **Pastas no computador** (perfil → Acesso): até 10 pastas liberadas por bot, como `~/vscodeProjects`, onde ele também vê, cria e edita livremente (Claude: `--add-dir`; Codex: `writable_roots`). Nunca a pasta pessoal inteira nem pastas de chaves. No **Acesso total**, a pasta pessoal inteira fica livre.
- **Senhas e chaves escondidas de verdade**: toda resposta no computador roda dentro do bubblewrap, numa visão do disco em que `~/.ssh`, `~/.gnupg`, `~/.mybots-pc`, `~/.password-store`, `~/.aws`, `~/.kube`, `~/.docker`, chaveiros, `~/.config/gh` e `~/.config/rclone` aparecem vazios, e o login da outra IA também (o Codex não vê `~/.claude`, o Claude não vê `~/.codex`). Cada IA continua lendo o próprio login.
- **Claude Code**: ganha terminal e arquivos (Bash, Read, Write, Edit, Glob, Grep). Ler ou salvar fora da pasta e rodar comandos passam pelo MyBots: no **Acesso total** rodam direto; no **Médio** viram cartão de aprovação no celular (e na janela), com "Sempre permitir" por tipo (comandos, salvar fora, ler fora). `sudo`, `systemctl`, apagar `/` ou `~`, `git push`, `curl | sh` e parecidos **sempre** pedem. Caminhos com senhas e chaves (`~/.ssh`, `~/.gnupg`, `~/.mybots-pc`, credenciais do Claude/Codex, chaveiros) são recusados em qualquer nível.
- **Codex**: roda no sandbox `workspace-write` do próprio Codex: escreve e roda comandos só na pasta dele e nas liberadas (sem rede nos comandos); fora delas, só lê.
- **Pouco acesso**: o computador fica fechado; o bot é avisado e não finge salvar.

## Controlar a tela (v44)

No perfil → Acesso, ligue **Controlar a tela do computador**. É uma permissão própria: começa **desligada**, inclusive no Total, não vem de “Mexer no computador”, e **Pouco acesso nunca tem**. Só aparece como ferramenta quando a resposta roda no PC.

- `desktop_screenshot`: imagem da tela inteira, por `grim`.
- `desktop_windows`, `desktop_focus`, `desktop_launch`: janelas, foco e abertura de executável, por `hyprctl`. O foco também leva o ponteiro para dentro da janela: no Hyprland o monitor acompanha o mouse.
- `desktop_click`, `desktop_type`, `desktop_key`: clique, texto e teclas, por `ydotool`. No **Médio**, ações pedem aprovação no celular (e aparecem na janela), com **Sempre permitir** separado para cada tipo; no **Total**, executam direto depois que a permissão própria está ligada. Listar janelas e ver a tela não pedem a cada chamada.
- Enquanto controla o desktop ou o navegador, uma notificação crítica persistente do MyBots mostra o nome do bot. Se não conseguir mostrar o aviso, o controle é recusado. Ela some ao terminar, cancelar, desconectar ou acionar o pânico.
- Letras e números usam `ydotool type`; símbolos e acentos usam `wl-clipboard` + colagem pelo `ydotool`, restaurando o conteúdo anterior. Se houver vários formatos ricos que não consegue preservar, recusa com explicação, sem apagar o clipboard. Em sites, `browser_type` preenche diretamente e preserva os acentos.

Dependências no Arch (instalação/ajustes que exigem sudo são feitos pela pessoa):

```bash
sudo pacman -S grim hyprland ydotool wl-clipboard libnotify
sudo modprobe uinput
systemctl --user enable --now ydotool.service
```

O `ydotoold` precisa de acesso a `/dev/uinput`. Confira `getfacl /dev/uinput` e `systemctl --user status ydotool.service`; não abra permissões para todos. O pacote do Arch fornece a regra para o grupo `input`; adicionar ao grupo exige decisão da pessoa e uma sessão nova. Neste PC, a ACL já dá acesso ao usuário.

**Pânico**: `node pc/node.mjs panic` fala com um socket local privado e interrompe imediatamente as respostas e os navegadores do nó, sem esperar o celular. Usa `MYBOTS_PC_HOME` se definido, como o nó de teste. A linha abaixo foi confirmada pela pessoa antes de ser registrada neste PC:

```ini
bind = SUPER SHIFT, Escape, exec, /usr/bin/node /home/augusto/vscodeProjects/mybots/pc/node.mjs panic
```

Em outro computador, ajuste o caminho e peça confirmação antes de editar o `hyprland.conf`.

## Navegador no PC (v44–v46)

Para bots **Codex e Claude** (a partir da v46; Claude só usa o Chrome principal se a pessoa ligar a opção, abaixo), as mesmas ferramentas `browser_open/read/click/type/upload/login/wait/screenshot/ask_user` usam **Playwright com `/usr/bin/google-chrome-stable`** quando a resposta roda no PC. Não baixa outro Chromium. Rode `npm ci --prefix pc` ao atualizar as dependências. Cada bot tem seu perfil em `~/.mybots-pc/browsers/<id>/`, com cookies próprios e persistentes; Esse Chrome nunca é o perfil pessoal da pessoa. O navegador segue a permissão **Navegador**, independentemente da permissão do desktop.

- O celular continua aprovando envios de formulário no Médio (Sempre permitir por `browser/write`), uploads sempre e primeiro login no Médio (`browser/login`). Arquivos para upload são os anexos daquele bot no celular, nunca um caminho livre do disco do PC.
- `browser_login` não recebe senha como argumento. O processo do navegador cria uma chave RSA temporária; o cofre do Android confere https, site e bots autorizados e devolve só uma senha cifrada com AES-GCM/RSA-OAEP, válida para aquele pedido e página. O supervisor e o nó repassam a cifra; só o processo do navegador decifra, preenche e envia. Chave de uso único, até 60 s, descartada se a página mudar, cancelar ou terminar o turno. O gerenciador de senhas do Chrome fica desligado.
- Leituras não devolvem valores de campos de senha; capturas do navegador os cobrem. Senhas preenchidas também são filtradas dos resultados de texto e cobertas se aparecerem na página. A tela inteira continua podendo mostrar dados pessoais: é o motivo da permissão própria.
- **Dentro do MyBots (v46)**: o Chrome do bot roda **sem janela** no PC. O botão 🌐 da conversa mostra a página **ao vivo** no celular e na janela do MyBots no PC (screencast do Chrome em JPEG, até ~8 quadros/s e só quando a página muda; cada aparelho recebe só os bots que está olhando, e quadros atrasados são pulados). Toque em **Assumir** para usar a página ali mesmo: toque = clique, arrastar = rolar, campo de texto para digitar (com o botão da chave, o que você digita fica escondido: senhas e códigos vão só para a página, nunca para a IA nem para logs), teclas Enter/Tab/⌫/Esc/setas, voltar, recarregar e barra de endereço. Antes de Assumir, o PC recusa qualquer toque, mesmo vindo do celular: o celular informa ao nó quem controla cada navegador. **Devolver ao bot** libera de novo.
- **Login do Google**: o Google recusa entrar em Chrome automatizado (“This browser or app may not be secure”). Testado na v46 com Chrome 155 de três jeitos: Playwright, Chrome comum aberto pelo MyBots e conectado depois por depuração remota, e sem janela; todos recusados (`navigator.webdriver` verdadeiro). Para Gmail, Agenda e Drive use os apps da conta; nos sites, prefira e-mail e senha (cofre) em vez de “Entrar com o Google”. O MyBots não tenta disfarçar a automação. Downloads automáticos do Chrome ficam bloqueados nesta etapa; `browser_upload` segue disponível com aprovação.
- Links de arquivos, URLs com senha, loopback e link-local são recusados; requisições e redirecionamentos também passam pela conferência. Conteúdo de páginas e janelas é dado externo, nunca instrução.
- O bubblewrap de toda resposta esconde os perfis, sockets do Wayland/Hyprland/ydotool/DBus, dispositivos de entrada e processos do host. Isso fecha o acesso direto por terminal aos controles e ao processo que preenche senhas. Não substitui isolar o usuário Linux e os outros serviços locais da máquina.

## Ditado na janela do PC (v46)

O microfone do campo de mensagem também funciona na janela do MyBots no PC (conversas e salas). O nó grava o microfone do computador (`pw-record` do PipeWire ou `parecord`) até você tocar em ✓ e transcreve **localmente** em português; o áudio é apagado logo depois e só o texto vai para a caixa de mensagem, para você revisar. Transcrição: **faster-whisper** se `~/.mybots-pc/whisper/python` (ou `MYBOTS_WHISPER_PYTHON`) apontar para um Python que o tenha, com o modelo já baixado no cache do Hugging Face (`MYBOTS_WHISPER_MODEL`, padrão `medium`; GPU se o CUDA estiver completo, senão CPU int8). O modelo carrega enquanto você fala e fica aberto por 10 minutos sem uso. Senão, [whisper.cpp](https://github.com/ggml-org/whisper.cpp): `whisper-cli` no PATH e um modelo `ggml-*.bin` em `~/.mybots-pc/whisper/`. Sem nenhum dos dois, o botão explica o que falta. Gravação de até 10 minutos.

## Habilidades: programas que rodam sozinhos no celular

O bot do computador escreve um módulo JavaScript (`export async function run(input, kit)` que devolve `{ summary, items }`), testa com `node` no PC (os comandos do Codex no PC têm internet desde a v42) e propõe com `skill_propose`: nome, o que faz, os **sites** que acessa, e se quiser um **bot novo no celular** e uma **rotina diária**. A proposta **sempre** vira cartão de aprovação ("Instalar uma habilidade no celular"), mesmo no Acesso total. Aprovada, fica em `~/.mybots/skills/<id>/` no celular, com versão (propor de novo com o mesmo nome atualiza).

- **Roda isolada no Node do Termux** (`supervisor/skill-host.mjs`): `node --permission` lê só a pasta dela e grava só em `data/`; sem processos, workers ou addons; `node:net`, `http`, `https`, `dns`, `child_process` e afins são recusados no import; `fetch` só alcança os sites declarados (redirecionamentos também conferidos); tempo máximo de 5 a 300 s.
- **Sem IA**: a rotina da habilidade roda o programa direto; o resultado chega na conversa do bot (resumo e lista com "abrir"), numa planilha anexada e numa notificação. O bot também pode rodá-la numa conversa (`skill_run`) e responder sobre o resultado.
- Perfil do bot → Rotinas → **Habilidades**: o que faz, sites, versão, Rodar agora e Remover. O backup leva as habilidades.
- Limite honesto: o modelo de permissões do Node não fecha a rede sozinho; o bloqueio de rede é feito pelos imports recusados e pelo `fetch` conferido.

## Como funciona

- O **celular liga para o computador** (porta 3230); o supervisor do celular continua escutando só em `127.0.0.1`. Ele tenta os endereços salvos (rede local e Tailscale, atualizados a cada conexão), com espera de 2 a 30 segundos entre tentativas, e na hora quando o app volta à tela.
- **TLS 1.3 com certificado fixado**: o QR leva o SHA-256 do certificado autoassinado do computador; outro aparelho no mesmo endereço é recusado antes de qualquer dado.
- **Pareamento**: o código do QR é de uso único e vence em 10 minutos. O computador troca o código por um segredo de 256 bits do celular. A cada conexão o computador manda um desafio novo e o celular responde com HMAC-SHA256 desse segredo.
- **Respostas**: a fila do celular entrega o turno ao computador (`run`), que roda o Claude/Codex local e devolve a resposta; o ID de sessão volta assim que existe. Cancelar manda `cancel` e encerra o processo no computador. Se a conexão cai no meio, a resposta vira "O computador desconectou durante esta resposta" (não é repetida) e as outras esperam.
- **Política e dados do bot continuam no celular**: memória, pendências, rotinas, arquivos, notificações e decisões de permissão; desktop e navegador do PC executam no nó depois de autorizados. O computador abre um endpoint local (`127.0.0.1`, porta aleatória) que repassa pela conexão só `/mcp` e `/tools/*`, e o celular confere o token da execução como sempre.
- **Sessões de IA** pertencem à máquina: quando um bot "Onde estiver" muda de aparelho, começa uma sessão nova com o histórico recente.
- **Janela**: o nó serve a interface em `127.0.0.1:3232` (confere `Host` e `Origin`, contra páginas de outros sites e DNS rebinding), com um token novo a cada início que só vai na própria página. Cada pedido da janela vai ao celular pelo link, que responde só uma lista fechada de métodos (`DESKTOP_METHODS` em `supervisor/link.mjs`); os eventos do supervisor voltam para atualizar a janela ao vivo.
- **Contas**: o computador informa quais IAs estão logadas nele (a cada 5 minutos). Um bot do computador só precisa do login lá; modelos de uma IA que só existe no computador entram no seletor.

### Claude in Chrome oficial (v45, opcional desde a v46)

Desde a v46 é **opcional por bot**: perfil do bot → Acesso → **Navegador no computador → Usar meu Chrome principal** (só para bots Claude que vivem no computador ou “Onde estiver”). Desligado (padrão), o bot Claude usa o Chrome próprio dele, como o Codex. Ligado, usa a integração oficial do Claude Code (`--chrome`), com as ferramentas `mcp__claude-in-chrome__*`: leitura da página, busca de elementos, screenshots, navegação, cliques, preenchimento e JavaScript. No celular continuam usando o navegador do app; o Codex no PC continua com Playwright.

Por escolha do usuário, o Claude usa o **Chrome principal**, com os logins desse perfil compartilhados entre os bots Claude e a pessoa. Instale a [extensão oficial](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) nesse perfil e entre na mesma conta paga do Claude Code (login direto Anthropic; chave de API não habilita a integração). Mantenha o Chrome aberto. Se houver mais de um navegador conectado, selecione o perfil desejado na integração. Requer Claude Code **2.1.295 ou superior**; `claude update` atualiza o CLI. [Documentação oficial](https://code.claude.com/docs/en/chrome).

A permissão é **Navegador**, independente de “Mexer no computador”, “Controlar a tela” e apps da conta. Pouco acesso bloqueia. No Médio, leituras passam quando Navegador está liberado; ações pedem aprovação com “Sempre permitir”. No Total, ações individuais rodam direto. **Uploads e lotes (`browser_batch`) sempre pedem aprovação**, porque um lote pode conter um envio de arquivo. A extensão pode pedir autorizações próprias de sites/conexão; elas continuam sendo decididas pela pessoa no Chrome.

Toda chamada passa por um hook oficial antes de executar, pelo túnel até o celular. Se o supervisor recusar, desconectar ou o hook falhar/expirar, a ação é bloqueada. O PC mostra o mesmo aviso de controle e usa a mesma tecla de pânico; interromper o bot preserva o Chrome principal aberto. Uma ação já enviada à extensão pode terminar antes de o cancelamento chegar.

O painel informa “Chrome principal · Claude”. **Assumir** bloqueia novas chamadas de todos os bots Claude a esse Chrome até devolver. Login, senha, CAPTCHA e códigos são preenchidos manualmente nesse Chrome; `browser_ask_user` pede ajuda. O cofre do celular e `browser_login` cifrado continuam disponíveis para Codex/Playwright, não são usados pela extensão oficial. Não há troca silenciosa para Playwright se a extensão estiver desconectada.


## Navegação ampliada (v47)

O Chrome próprio de cada bot aceita até **5 abas**. Popups de login aparecem como abas; no painel ao vivo, a faixa de abas mostra a ativa. Depois de **Assumir**, toque numa aba para trocar. A sexta aba é recusada; feche outra antes de abrir mais.

O bot começa por `browser_read` ou `browser_find` (busca por rótulo, texto, placeholder, título e nome). A leitura inclui caixas, rolagem e iframes da mesma origem. Quando precisar da imagem, `browser_screenshot` com `marks: true` numera os elementos e informa o tamanho da captura. `browser_act` permite hover, rolagem, teclas, cliques por ponto e arraste; `browser_wait` também espera um trecho da URL.

No Médio, cliques que enviam formulários ou compram/pagam, Enter em formulário e arrastes pedem aprovação, com **Sempre permitir** para a mesma permissão de envio do navegador. No Total passam diretamente; uploads continuam pedindo sempre. Assumir bloqueia as ferramentas do bot até devolver.

No celular, a WebView oferece busca, caixas, capturas numeradas, cliques, hover, rolagem e teclas por eventos da página. Arrastar, clique direito e abas informam “Disponível só quando o bot responde pelo computador.” Eventos sintéticos podem não funcionar em sites que exigem eventos físicos; nesses casos o bot pede ajuda.


## Meu Chrome (v48)

No perfil do bot → **Acesso → Navegador no computador**, escolha:

- **Chrome próprio do bot**: padrão, perfil separado e Chrome sem janela, visto dentro do MyBots.
- **Meu Chrome**: Codex ou Claude usa seus logins do Chrome, inclusive Google, em abas criadas para esse bot. Os bots desse modo compartilham cookies e logins, mas têm abas próprias. Não lista, navega nem fecha suas outras abas.
- **Claude in Chrome**: opção só para Claude, com a extensão oficial. A escolha antiga “Usar meu Chrome principal” é convertida para esta opção.

Para usar Meu Chrome, primeiro libere **Navegador** (não existe em Pouco acesso). No seu Chrome do computador, abra `chrome://inspect/#remote-debugging` e ligue a depuração remota uma vez. Ao conectar, confirme a solicitação no Chrome. Mantenha o Chrome aberto; o MyBots não o inicia nem copia seu perfil. Para revogar o acesso, desligue a depuração nessa mesma tela.

A tela ao vivo, as cinco abas por bot e o cofre funcionam como no Chrome próprio. No Médio, leituras passam; abrir páginas, clicar, preencher, arrastar e outras ações pedem aprovação própria de **Meu Chrome**, com Sempre permitir. Upload continua pedindo sempre. Assumir em qualquer bot desse modo bloqueia novas ações de todos os bots Meu Chrome até devolver. Mudar o modo inicia uma sessão nova da IA e atualiza o painel.

Ao interromper ou encerrar o nó, o MyBots fecha só as abas que criou e desconecta; o Chrome e suas abas continuam abertos. Popups abertos pela página são convertidos em novas abas com endereço conferido antes da navegação. Sites que dependem de uma referência JavaScript à janela de origem podem exigir ajuda da pessoa; o bot deve pedir pelo cartão, sem tentar contornar.
