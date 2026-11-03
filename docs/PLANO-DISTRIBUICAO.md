# MyBots: distribuição (relé com TLS, instaladores e iPhone)

Escrito em 03/11/2026, depois da v119. Continua o beta descrito em [PLANO-SYNC.md](PLANO-SYNC.md). Serve para abrir uma conversa nova e pedir: **"leia docs/PLANO-DISTRIBUICAO.md e faça a próxima etapa pendente"**. As regras de trabalho, teste e entrega são as de [PLANO-DESENVOLVIMENTO.md](PLANO-DESENVOLVIMENTO.md) (seção 2).

## 1. Objetivo

Um usuário novo baixa o MyBots no computador (Linux, Windows ou Mac) e no celular (Android ou iPhone), conecta os dois por um QR e já usa: as contas de IA ficam no computador, o celular é a tela. Hoje o PC se instala por script (`scripts/build-desktop.sh`) e só em Linux/Hyprland; o iPhone não tem app.

## 2. Decisões (03/11/2026)

| Decisão | Escolha |
|---|---|
| Fase 1 | Os **três** instaladores: Linux (AppImage e .deb), Windows (.exe) e macOS (.dmg). Cada um sai quando estiver pronto, sem esperar os outros. |
| Assinatura | **Sem assinar** (Windows e Mac) no beta, com instruções para liberar o app. |
| TLS do relé | Domínio grátis do **DuckDNS** + **Caddy** na VM da Oracle, relé em `wss://` na porta 443. Domínio próprio (cerca de R$ 40/ano) fica para depois. |
| iPhone | **Web app (PWA)** servido em HTTPS; depende do PC ligado e não tem Termux. |
| Android | O app sem Termux passa a usar o relé com TLS e **perde a exceção de tráfego sem TLS** que hoje só vale para o IP do relé. |

## 3. Ordem

1. **Etapa 0 — relé com TLS (443).** Pré-requisito do iPhone, tira a exceção de segurança do Android e vence redes que bloqueiam a porta 3240.
2. **Fase 1 — instaladores.** 1.0 portabilidade do PC, 1.1 empacotamento, 1.2 CI e publicação, 1.3 atualização, 1.4 primeira execução. Ordem de lançamento: **Linux, Windows, Mac**.
3. **Fase 2 — PWA do iPhone.**

## 4. Etapa 0 — relé com TLS (FEITA em 03/11/2026, v120)

**Resultado:** `wss://mybots-rele.duckdns.org` no ar (Caddy 2.11 na VM, certificado Let's Encrypt obtido e renovado sozinho; `duckdns.timer` atualiza o IP a cada 5 min; 80 e 443 abertas no iptables e em `rules.v4`). Teste real contra a VM: conexão do PC ~340 ms, celular + sessão ~450 ms, ida e volta de bytes ~30–40 ms (ping ao IP: ver progresso.md). `DEFAULT_RELAY` é o `wss://`; o `ws://136.248.104.150:3240` é tentado quando o primeiro falha (`relayCandidates` em `supervisor/relay.mjs`); o app Android só usa `wss://` (um pareamento antigo com o IP é trocado pelo nome) e perdeu a exceção de tráfego sem TLS (ficou só loopback). O relé passou a ler o cliente real em `X-Forwarded-For` quando vem do loopback (senão o limite por endereço contaria todos como um só). Teste real opt-in: `MYBOTS_REAL_RELAY=1 node --test tests/relay-real.test.mjs`.

- **DuckDNS** dá um nome (por exemplo `mybots-rele.duckdns.org`) apontando para o IP da VM. É grátis e simples; o risco é depender de um serviço de terceiros. Como o endereço do relé viaja no QR e nas respostas do PC (`info.relay`), trocar de domínio depois não exige reparear.
- **Caddy** na VM recebe `wss://nome:443`, obtém e renova o certificado sozinho (desafio TLS-ALPN na própria 443; a porta 80 é opcional, só para redirecionar) e repassa para o relé em `127.0.0.1:3240`. O relé continua sem conteúdo nem log; a cifra de ponta a ponta é a do canal (`mobile/pc-channel.js`) e do TLS do Termux, que passam por dentro.
- **Oracle**: abrir a 443 (regra de entrada TCP na Security List e no iptables da VM, salvo em `rules.v4`), como foi feito com a 3240.
- **Cliente**: `validRelay` passa a aceitar `wss://`; o endereço padrão (`DEFAULT_RELAY`) vira o `wss://` novo; o `ws://IP:3240` continua funcionando para versões antigas (nenhum celular ou PC que já usa o relé quebra).
- **Android** (`network_security_config.xml`): remove o IP do relé da lista de tráfego sem TLS (fica só o loopback).
- **Critérios de aceite**: celular e PC se conectam pelo `wss://`; o teste real contra a VM passa; os testes do relé cobrem `wss://` (certificado de teste); o Android sem a exceção conecta.
- **Riscos**: o DuckDNS cair (o PC e os celulares caem para o `ws://` antigo até voltar); o certificado não renovar (monitorar a validade).

## 5. Fase 1 — instaladores

> **Estado em 03/11/2026 (v121): Linux entregue (AppImage e .deb); Windows e macOS não.** Feito: 1.1 empacotamento (`electron-builder`, `packaging/`, `scripts/stage-desktop.mjs`, o Electron sobe o nó do PC sozinho como Node via `ELECTRON_RUN_AS_NODE` e um lançador `node` em `<pasta do nó>/bin` para o que as IAs iniciam), 1.2 CI (`.github/workflows/desktop.yml`, matriz Linux/Windows/macOS; Windows e Mac só por pedido em `platforms`) e `scripts/publish-desktop.sh`, 1.3 atualização (feed genérico na Release rolante `pc-latest`; AppImage e Windows com `electron-updater`, .deb e Mac só avisam), 1.4 assistente de primeira execução (`desktop/electron/welcome.html`, comando `pc/node.mjs doctor`). Da 1.0: certificado em JavaScript (`pc/make-cert.mjs`, sem openssl), `pc/platform.mjs` (pasta de dados, ponto do pânico por pipe no Windows, isolamento e controle de tela só no Linux), identidade de processo e `taskkill` por sistema, sem isolamento = Codex só leitura (sem terminal) e Claude com cartão de aprovação, controle de tela desligado fora do Linux. **Falta:** testar tudo isso em Windows e macOS de verdade (a CI só empacota), ditado e `ydotool` já desligados mas sem substituto, soquete de pânico em pipe sem teste no Windows, `Notification`/abrir arquivos nos dois, Chrome do Windows/Mac no navegador dos bots (a janela já traz o próprio navegador), o isolamento próprio de cada sistema e a assinatura.

### 5.1 O que prende o PC a Linux hoje (1.0)

O trabalho de verdade de Windows e Mac é portar estas partes; empacotar é a parte fácil.

| Parte | Hoje (Linux) | Windows | macOS |
|---|---|---|---|
| Isolamento dos comandos dos bots (`pc/server.mjs`) | `bubblewrap` | sem equivalente simples | `sandbox-exec` (descontinuado) |
| Controle de tela e teclado (`pc/desktop.mjs`) | `ydotool`, `hyprctl`, `grim`, `wl-copy`, `wl-paste` | PowerShell e APIs do Windows | `osascript` e `screencapture` |
| Início automático e serviço (`pc/node.mjs`) | `systemctl --user`, `journalctl` | item de login do Electron | item de login do Electron |
| Certificado do PC (`pc/server.mjs`) | `openssl` na linha de comando | não existe por padrão | existe, mas varia |
| Soquete de pânico (`pc/server.mjs`, `pc/node.mjs`) | soquete unix em arquivo | pipe nomeado | soquete unix |
| Identidade de processo (`supervisor/process.mjs`) | `/proc/<pid>/stat` | consulta ao sistema | `ps` |
| Ditado (`pc/dictation.mjs`) | `parecord`/`pw-record` e `faster-whisper` | adiar | adiar |
| Notificações e abrir arquivos | `notify-send`, `xdg-open` | `Notification` e `shell.openPath` do Electron | idem |
| Navegador dos bots (`pc/browser-worker.mjs`) | Chrome ou Chromium do sistema | Chrome ou Edge | Chrome |

**Decisões de portabilidade:**
- **Sem isolamento** (Windows e Mac na primeira versão): comandos e escrita fora da pasta do bot passam sempre por cartão de aprovação (como no nível Médio), e o app avisa isso. O isolamento próprio de cada sistema fica para depois.
- **Controle de tela e teclado**: só Linux/Hyprland no início; o recurso aparece desligado nos outros sistemas. Windows e Mac vêm depois, um de cada vez.
- **Ditado**: só Linux no início.
- **Certificado**: trocar o `openssl` por geração em JavaScript (por exemplo a biblioteca `selfsigned`), igual nos três sistemas.
- **Pânico e identidade de processo**: uma camada fina por sistema, com testes.
- **Caminhos**: pasta de dados por sistema (`~/.mybots-pc` no Linux, `%APPDATA%` no Windows, `~/Library/Application Support` no Mac), com migração do que já existe no Linux.

**Windows (v122, beta):** portado o que impedia o app de rodar: início das IAs pelos atalhos `.cmd` do npm (`lib/cli-bin.cjs`), Chrome ou Edge e a pasta do perfil (`pc/chrome.mjs`), encerrar a árvore de processos (`taskkill`), abrir arquivos, avisos do sistema (toast por PowerShell), lançador do Node sem `.cmd` para o supervisor próprio e as habilidades, console escondido nos processos filhos, início com o Windows e as dicas de cliente do navegador da janela. Roteiro de teste em [windows.md](windows.md).

### 5.2 Empacotamento (1.1)

- **Ferramenta**: `electron-builder`. Alvos: AppImage e .deb (Linux), NSIS (.exe) no Windows, .dmg (x64 e arm64) no Mac.
- **Um aplicativo só**: o Electron passa a ser o processo principal. Ele sobe o nó do PC (`pc/node.mjs`) e o supervisor próprio como processos filhos com o Node do próprio Electron (`ELECTRON_RUN_AS_NODE`), fica na bandeja e mantém os bots online com a janela fechada, como hoje. O Electron empacotado precisa ter o Node 22.13 ou mais novo (para `node:sqlite`); o do sistema usado hoje (v44) tem.
- **Recursos embutidos**: `supervisor/`, `pc/`, `lib/`, a interface web (`pc/ui`), o `ws`, o `playwright-core` e o `qrcode`.
- **O que não vem junto**: as IAs (Codex, Claude Code, Antigravity, opencode) e o Chrome. O usuário instala e entra nelas, e o assistente de primeira execução (1.4) guia isso.
- **Linux**: o AppImage é o formato universal; o .deb é para Debian, Ubuntu e derivados. Desktop control só no Hyprland/Wayland por enquanto; a janela e o nó funcionam em qualquer ambiente.

### 5.3 CI e publicação (1.2)

- **GitHub Actions** com matriz Linux, Windows e macOS (o Mac só se compila numa máquina macOS). Cada execução roda os testes e gera o instalador do seu sistema.
- Os instaladores entram na **mesma Release** do APK (`vNN`), com `.sha256`, ou numa Release própria do PC se as versões divergirem.
- O script `scripts/publish-release.sh` passa a aceitar os artefatos do PC.

### 5.4 Atualização (1.3)

- **Linux (AppImage) e Windows**: `electron-updater` pelas Releases do GitHub. No Windows sem assinatura a atualização funciona, só o primeiro aviso do SmartScreen aparece.
- **Mac**: a atualização automática do Electron exige app assinado e notarizado. Sem assinatura, o app **só avisa** "há uma versão nova" com o link; a pessoa baixa e substitui.
- O app procura versões ao abrir e a cada poucas horas, como o do celular.

### 5.5 Primeira execução (1.4)

Um assistente curto, igual nos três sistemas:
1. Detecta quais IAs estão instaladas e logadas e, para as que faltam, mostra o comando e o link para instalar.
2. Detecta o Chrome (necessário para o navegador dos bots).
3. Mostra o QR para parear o celular e a explicação de que o PC precisa ficar ligado.

### 5.6 Sem assinatura: o que o usuário vê

- **Windows**: o SmartScreen avisa "aplicativo não reconhecido". Mais informações → Executar assim mesmo.
- **Mac**: "não pode ser aberto". Clique direito no app → Abrir; ou Ajustes do Sistema → Privacidade e Segurança → Abrir assim mesmo.
- **Linux**: AppImage precisa de permissão de execução (`chmod +x`); o .deb instala pelo gerenciador.
- As instruções ficam na página da Release e no README.

### 5.7 Entregas e aceite da Fase 1

| Entrega | Aceite |
|---|---|
| **Linux** (AppImage e .deb) | Instala em máquina limpa; assistente de primeira execução; o celular pareia por QR; um bot responde; sobrevive a reinício; atualiza pela Release. |
| **Windows** (.exe) | Instala em máquina limpa; nó, supervisor próprio e janela sobem; comandos dos bots pedem aprovação; pareia, responde e atualiza. |
| **Mac** (.dmg) | Instala em máquina limpa (liberado pelas instruções); mesmo critério do Windows; o aviso de versão nova aparece. |

Cada instalador sai na sua Release assim que passar nos testes do próprio sistema e num teste de instalação limpa. Se Windows ou Mac ficarem atrás, o Linux não espera.

## 6. Fase 2 — PWA do iPhone

**Estado (0.68.0): feito.** Servido em `https://mybots-rele.duckdns.org/` (Caddy, na mesma VM do relé: WebSocket vai para o relé, o resto é o site estático em `/var/www/mybots`, com CSP que só deixa a página falar com o relé). Publicar: `scripts/publish-pwa.sh` (constrói com `scripts/build-pwa.mjs` e troca a pasta). O QR do iPhone é o link `https://…/#p=<QR do Android>`; o computador mostra em Ajustes → Celular → Mostrar QR (iPhone). Como a página é HTTPS, só o relé é possível (`ws://` direto é bloqueado como conteúdo misto). O pareamento fica no `localStorage` da página. Não testado em iPhone de verdade (só no Chrome com viewport de celular, pelo `.build-tools/pwa-e2e.mjs`).

- **Base**: a versão web do app (a que a janela do PC já usa) com o layout de celular, mais o canal cifrado (`mobile/pc-channel.js`, JavaScript puro, que roda no Safari) e o cliente (`mobile/pc-client.js`) sobre `wss://`.
- **Onde fica**: página estática em HTTPS (GitHub Pages ou a própria VPS). Uma página HTTPS só abre `wss://`, por isso a Etapa 0 vem antes.
- **QR que abre direto**: o QR do PC passa a ser também um link `https://…/#pareamento` (os dados no fragmento, que nunca vai ao servidor). A câmera do iPhone abre o link e a página pareia sozinha, sem leitor de QR dentro do app. Tela de colar o código como reserva.
- **Armazenamento**: o segredo do pareamento fica no `IndexedDB` da página. Apps adicionados à Tela de Início não sofrem a limpeza de 7 dias do Safari; no navegador comum, sim (avisar).
- **Limites da primeira versão**: depende do PC ligado; sem Termux; sem notificações em segundo plano (só com o app aberto; push exige iOS 16.4 ou mais novo, service worker e um serviço de push, e fica para depois); sem navegador ao vivo do bot; sem controle de outros apps, senhas e carteira.
- **Aceite**: pareia pelo QR com a câmera nativa, abre bots e conversas, envia mensagem e recebe a resposta, reconecta ao voltar do segundo plano, e o PC esquece o aparelho pela lista de celulares do app.

## 7. Riscos e perguntas em aberto

- **Trabalho de Windows e Mac é grande** (seção 5.1). Cada recurso portado ganha teste no próprio sistema, e a CI é a única forma de testar o que não temos aqui.
- **Sem máquina Windows ou Mac para teste manual**: o beta desses dois depende do retorno de quem testar. Tratar como "beta" na Release.
- **Isolamento ausente no Windows e no Mac**: comandos sempre pedem aprovação. Pesquisar uma alternativa depois (contêiner ou WSL no Windows).
- **Mac sem atualização automática** enquanto o app não for assinado e notarizado.
- **DuckDNS**: ponto único de falha do `wss://`; a queda é coberta pelo `ws://` antigo enquanto ele existir. Quando o beta crescer, migrar para domínio próprio.
- **iPhone**: o Safari é o motor obrigatório; limites de segundo plano e de armazenamento do iOS são do sistema, não do MyBots.
- **Pendente do beta atual**: teste do app sem Termux em Android de verdade (v119) antes de apoiar o iPhone no mesmo código.
