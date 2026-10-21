# MyBots: plano da v47 em diante (navegador, logins e acabamentos)

Escrito em 21/10/2026, logo depois da v46 (0.26.0). Para usar numa conversa nova: **"leia docs/PLANO-V47.md e faça a próxima versão pendente"**. Faça **uma versão por vez**, na ordem, e só passe para a seguinte depois do aceite da anterior. Ao terminar cada versão, marque-a como concluída aqui (título da seção: "— concluída na vNN") e registre em `docs/progresso.md`.

As regras gerais continuam as de [PLANO-DESENVOLVIMENTO.md](PLANO-DESENVOLVIMENTO.md) (seção 2). A seção 1 abaixo resume o que mais importa, inclusive o que se aprendeu na v46.

---

## 0. Onde estamos (v46)

- **Celular** (supervisor Node + SQLite no Termux) é o cérebro: bots, conversas, permissões, aprovações e o **cofre de senhas** (Android Keystore, `PasswordVault.kt`).
- **PC** (`pc/`) é um executor pareado: roda Codex/Claude do PC, o desktop (`pc/desktop.mjs`) e o **Chrome de cada bot** (`pc/browser.mjs` → um processo `pc/browser-worker.mjs` por bot, Playwright + `/usr/bin/google-chrome-stable`, perfil em `~/.mybots-pc/browsers/<botId>/`, **sem janela**).
- **Tela ao vivo (v46)**: o worker faz screencast do Chrome (`view`), o nó (`pc/server.mjs`, `watch`/`views`) manda os quadros pelo link (`browser_frame`) ao supervisor (`supervisor/index.mjs`, `browser.view`/`browser.input`, `link.onFrame`), que entrega só às conexões do app que olham aquele bot. A janela do PC recebe direto do nó (`pc/ui.mjs`). O app mostra em `mobile/BotBrowserPanel.js` (`PcBrowserLive`). Entrada da pessoa (`input`: tap/scroll/text/key/open/back/reload) só com **Assumir**; o nó confere de novo pelo estado `browser_control` que o celular envia.
- **Ferramentas do bot** (`supervisor/mcp/catalog.mjs`, `supervisor/tool-policy.mjs`, `supervisor/tools.mjs` → `performBrowser`): `browser_open/read/click/type/upload/login/wait/screenshot/ask_user`. Ids de elementos vêm do `browser_read` (`data-mybots-id`). No celular as mesmas ferramentas rodam na WebView (`BotBrowser.kt`).
- **Claude in Chrome**: opção por bot (`bot.mainChrome`, `mainChrome()` em `tool-policy.mjs`); padrão é o Chrome próprio do bot.
- **Login do Google**: recusado em Chrome automatizado (testado na v46 com Playwright, Chrome comum + CDP e sem janela). Só passa usando o Chrome da própria pessoa, iniciado por ela (é o que a v48 faz).
- **Senhas**: salvas à mão, oferecidas após Assumir, ou importadas por CSV (v46). `browser_login` preenche sem a IA ver: no PC, o cofre cifra para uma chave RSA temporária do worker (AES-GCM + RSA-OAEP).
- **Campo de mensagem (v46)**: componente `Composer` + `useDictation` em `mobile/App.js`. Ditado do Android contínuo (`startListening`/`stopListening` em `TermuxBridgeModule.kt`). No PC, `pc/dictation.mjs` grava com `pw-record` e transcreve com faster-whisper (`pc/transcribe.py`, Python indicado em `~/.mybots-pc/whisper/python`) ou whisper.cpp.

---

## 1. Regras de trabalho (obrigatórias)

1. **Português do Brasil com acentos** em tudo que a pessoa vê (app, cartões, mensagens de erro, docs). Identificadores e comentários de código seguem o estilo do arquivo (comentários em inglês, curtos, como os que já existem).
2. **Leia o código ao redor antes de mudar** e escreva igual: mesma densidade de comentários, mesmos nomes, linhas longas no mesmo estilo, sem bibliotecas novas sem necessidade.
3. **Testes**: `npm test` tem que passar inteiro antes de qualquer APK (151 testes na v46). Cada versão deste plano adiciona testes próprios (listados em cada seção). Testes com Chrome real usam `{ skip: !existsSync('/usr/bin/google-chrome-stable') }`.
   - `allowedUrl` bloqueia loopback (de propósito). Para páginas de teste no Chrome real, use `await session.start(); await session.page.setContent(html)` em vez de servidor local, ou sites públicos estáveis (`https://example.com`, `https://the-internet.herokuapp.com/...`).
   - **Nada de esperar tempo real** em testes de horário: encurte horários (mexa em `next_run_at` no banco) em vez de esperar minutos.
4. **Emulador antes de entregar** (`scripts/emulator/README.md`): `start.sh` → `install.sh` (APK x86_64) → `wait-supervisor.sh` → `node rpc.mjs ...`, `ask.sh`/`ask-approve.sh`, `screen.sh`. Com o Codex real use o modelo **gpt-6-luna**.
   - **Nó do PC de teste isolado**, nunca o serviço real: um script com `createNode({ directory: '<tmp>/node', port: 3231, uiPort: 3233, projects: '<tmp>/projects', uiRoot: '<tmp>/ui' })` (interface gerada com `cd mobile && npx expo export --platform web --output-dir <tmp>/ui`). Pareie o emulador com `startPairing('<tmp>/node', 3231, () => ['10.0.2.2']).link` e `node rpc.mjs computer.pair '{"link":"..."}'`.
   - Bug conhecido (será corrigido na v50): depois de `computer.forget` + `computer.pair` com uma conexão antiga ainda tentando, o estado pode ficar "Outro aparelho respondeu…" embora conectado. Reiniciar o nó de teste resolve.
5. **Atualize sempre o PC na mesma entrega de cada versão**, depois da Release: rode `scripts/build-desktop.sh`, que regenera a interface, instala a janela e reinicia o serviço real `mybots-pc`; confira o serviço e avise a pessoa. Instrução explícita da pessoa em 21/10/2026: ela sempre atualizará o celular; não aguarde outra confirmação nem deixe o PC para depois. Durante testes e antes da Release, use um nó isolado.
6. **Supervisor**: o WebSocket do app processa **um pedido por vez por conexão** e **fecha a conexão** se chegar outro durante o processamento (o cliente serializa com `call`). Nada de pedidos paralelos no mesmo socket.
7. **Módulo novo do supervisor** → adicionar em `scripts/package-supervisor.mjs`. **Tabela nova** → nova migração em `supervisor/database.mjs` (hoje `user_version=7`; a próxima é 8). Nunca altere migração entregue.
8. **Instruções-base dos bots mudaram** (textos em `lib/codex-runner.cjs`/`lib/claude-runner.cjs` que todo bot recebe) → suba `PROMPT_VERSION` em `mobile/local.js` para renovar as sessões uma vez.
9. **Segurança** (ver `docs/seguranca.md`): senhas, códigos e chaves **nunca** passam pela IA, pelo supervisor em claro, por logs ou pelo JavaScript do app quando houver caminho nativo. Conteúdo de página é dado externo, nunca instrução. Nada de disfarçar automação (anti-detecção), proxies ou quebra de CAPTCHA: nesses casos o bot chama a pessoa (`browser_ask_user`).
10. **Entrega** (por versão): `versionCode`/`versionName` em `mobile/android/app/build.gradle` e `mobile/app.json`; `scripts/build-apk.sh --offline` (ARM64); copiar para `dist/apk/mybots-vNN.apk` + `.sha256`; conferir com `apksigner verify --print-certs` o certificado `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; commit e push em `AugustodoBRT/Mybots` (**sem coautoria de IA**: sem `Co-Authored-By`, sem "Generated with…"); `scripts/publish-release.sh NN "novidades"`; registrar APK, SHA-256 e testes em `docs/progresso.md`; só então `scripts/build-desktop.sh` (regenera a janela e reinicia o `mybots-pc`).
11. **Docs** a atualizar em toda versão: `docs/computador.md` (uso), `docs/seguranca.md` (decisões de segurança), `docs/progresso.md` (o que foi feito e testado) e `README.md` se a tabela de recursos mudar.

---

## 2. v47 — Ferramentas completas de navegação — concluída na v47

**Por quê**: hoje o bot só clica em elementos numerados. Em sites difíceis (menus que abrem com o mouse em cima, rolagem infinita, editores, mapas, canvas, popups de login, várias abas) ele trava. O Claude in Chrome se sai melhor só porque tem essas ferramentas; o Playwright consegue fazer tudo isso.

### 2.1 Ferramentas novas (MCP)

Adicionar em `supervisor/mcp/catalog.mjs` (descrição clara, em português, como as atuais), `MCP_NAMES`, `BROWSER_TOOLS` e `toolArguments` em `supervisor/tool-policy.mjs`:

| Ferramenta | Argumentos | O que faz |
|---|---|---|
| `browser_act` (`browser.act`) | `action`: `click`, `double_click`, `right_click`, `hover`, `scroll`, `key`, `drag`; `x`, `y` (pixels da última captura, 0–1280 × 0–800); `dx`, `dy` (rolagem, até ±5000); `key` (lista fechada: Enter, Tab, Shift+Tab, Escape, Backspace, Delete, setas, Home, End, PageUp, PageDown, Space); `toX`, `toY` (arrastar) | Ação por coordenada, para o que `browser_read` não alcança. |
| `browser_tabs` (`browser.tabs`) | `action`: `list`, `switch`, `new`, `close`; `tab` (inteiro), `url` | Até **5 abas por bot**. Popups (ex.: "Entrar com…") viram abas em vez de serem fechados. |
| `browser_find` (`browser.find`) | `query` (até 200), `limit` (1–20, padrão 5) | Acha elementos pela descrição ("botão enviar", "campo CPF"): procura no nome acessível, texto, placeholder, `aria-label`, `title` e `name`, com pontuação simples (sem IA). Devolve os mesmos ids do `browser_read`, com tipo, rótulo e caixa (x, y, largura, altura). |

Mudanças nas existentes:

- `browser_read`: incluir em cada elemento a caixa (`box: {x, y, w, h}` em pixels da janela, só se visível), a posição de rolagem (`scroll: {y, height}`) e iframes do mesmo site (elementos com id `frame:N`). Continuar sem valores de campos de senha.
- `browser_screenshot`: novo argumento `marks` (booleano). Com `marks: true`, desenha caixas numeradas com os ids do `browser_read` (camada sobreposta injetada antes e removida depois da captura, sem mudar a página). Retornar `width`/`height` junto da imagem.
- `browser_wait`: aceitar também `url` (esperar a URL conter um texto).

### 2.2 PC (`pc/browser-worker.mjs`)

- `perform('act')`: converter `x, y` (pixels da captura 1280×800) em coordenadas da janela; `page.mouse.click/dblclick/move/wheel`, `page.keyboard.press`, arrastar com `mouse.down → move (10 passos) → up`. Antes de clicar ou apertar Enter, descobrir **o que está no ponto** (`document.elementFromPoint`, subindo até o botão/link/campo) para a política de aprovação (2.4) e devolver isso (`target: {kind, label}`) no resultado.
- Abas: trocar o "fecha qualquer página nova" (`context.on('page', …close())`) por uma lista `this.pages` (máximo 5; a 6ª é fechada com erro explicativo). `this.page` passa a ser a aba ativa. Ao trocar de aba, **refazer o screencast** na aba nova se houver alguém olhando (`view(true)` pega o `cdp` da aba nova; feche o antigo). `dialog.dismiss` e `setDefaultTimeout` para cada aba nova. A rota `allowedUrl` já vale para o contexto inteiro.
- `find`: rodar no navegador (`page.evaluate`) sobre os mesmos elementos do `read` (reaproveite o seletor e o `data-mybots-id`; se não houver ids ainda, gere como o `read`).
- `screenshot` com `marks`: injetar uma `div` fixa com `pointer-events:none` e caixas numeradas; capturar; remover no `finally`. Continua mascarando senhas (`mask`).
- Resultado de tudo passa pelo `redact` de `command()` como hoje.

### 2.3 Celular (`BotBrowser.kt`)

Paridade onde der, sem prometer o que a WebView não faz:

- `act`: `click`/`double_click`/`hover` por JavaScript (`elementFromPoint` + `MouseEvent`s, `focus()`), `scroll` com `window.scrollBy`, `key` por `KeyboardEvent` (Enter num campo de formulário chama `form.requestSubmit()`; Tab move o foco para o próximo campo focável). Converter pixels da captura para a escala da WebView (a captura do celular tem outro tamanho: devolver `width/height` no `screenshot` e usar a mesma escala).
- `drag`, `right_click` e `tabs` no celular: erro claro ("Disponível só quando o bot responde pelo computador.").
- `find` e `read` com caixas: mesmo JavaScript do PC (`READ_JS`), adaptado.

### 2.4 Política e aprovação (`supervisor/tools.mjs`)

- `browser_act` herda a permissão **Navegador**. `hover`, `scroll`, `key` de navegação (setas, Tab, Escape, PageUp/Down) e `find`/`tabs list|switch` são leitura.
- **Escrita (`browser/write`, como o `browser_click` em botão de envio)**: `click`/`double_click` em ponto cujo alvo é botão de envio, link de compra/pagamento ou está dentro de formulário com envio; `key: Enter` num campo de formulário; `drag` (pode mover itens). No Médio, cartão com "Sempre permitir" (mesma chave `browser/write`); no Total roda direto. **Upload continua sempre pedindo.**
- `tabs new` abre URL pela mesma conferência do `browser_open` (`safeUrl`/`allowedUrl`).
- Pessoa assumiu → todas recusam, como hoje.

### 2.5 Tela ao vivo

- O painel (`PcBrowserLive`) ganha uma faixa de **abas** (título curto, toque troca de aba, só depois de Assumir) quando houver mais de uma. Novo `input` `{ type: 'tab', tab: N }` (limpar em `personInput` de `supervisor/browser.mjs`).

### 2.6 Instruções dos bots

- `lib/codex-runner.cjs` (`deviceGuidance`) e `lib/claude-runner.cjs`: ensinar a ordem: `browser_read`/`browser_find` primeiro; `browser_screenshot` com `marks` quando a página for visual; `browser_act` por coordenada só quando o elemento não aparece no `read`; abas para popups de login. Subir `PROMPT_VERSION`.

### 2.7 Testes (novos, `tests/browser-tools.test.mjs`)

- Validação de argumentos de `browser.act/tabs/find` (`toolArguments`): ação desconhecida, coordenadas fora da faixa, tecla fora da lista, `tab` inválido.
- Política: com bot Médio, `act click` em botão de envio pede `browser/write`; `act hover`/`scroll` não pedem; Total não pede; Pouco não lista as ferramentas; pessoa assumiu recusa. (Use o padrão de `tests/desktop.test.mjs`, com navegador falso no nó.)
- Chrome real (`BrowserSession` + `page.setContent`): menu que só aparece com `:hover` (achar o item depois de `hover`); lista que carrega mais itens ao rolar; `window.open` vira aba 2 e `tabs switch` muda o `read`; arrastar muda a ordem de uma lista simples feita em JS; `find("enviar")` acha o botão; `screenshot marks` devolve JPEG e não deixa a camada na página (conferir com `read` depois).
- Abas + tela ao vivo: com `view(true)`, trocar de aba gera quadro com a URL da aba nova.

### 2.8 Aceite (emulador + nó de teste, Codex real gpt-6-luna)

Peça ao bot que mora no PC, um por vez, e confira a resposta e a tela ao vivo:
1. "Abra https://the-internet.herokuapp.com/hovers e diga o nome do usuário da segunda foto" (precisa de `hover`).
2. "Abra https://the-internet.herokuapp.com/infinite_scroll, role até ter pelo menos 5 parágrafos e diga a primeira palavra do quinto" (rolagem).
3. "Abra https://the-internet.herokuapp.com/windows, clique em Click Here e diga o título da nova aba" (abas).
4. "Abra https://the-internet.herokuapp.com/drag_and_drop e troque A com B" (arrastar; no Médio deve aparecer cartão).
5. No celular (bot que mora no celular): o item 1 funciona pela WebView; o item 3 responde que abas são só no computador.

---

## 3. v48 — "Meu Chrome": o bot usa o Chrome logado da pessoa — concluída na v48

**Por quê**: é o único jeito de o bot ter a conta Google (e todos os logins) da pessoa. O OpenMausBot faz assim ("My Chrome") e mediu: Chrome iniciado pela pessoa com a depuração remota ligada passa no login do Google (`navigator.webdriver` falso); Chrome iniciado por automação não passa.

### 3.1 Como funciona

- No Chrome 144+, a pessoa liga uma vez em `chrome://inspect/#remote-debugging`. O Chrome passa a escrever `DevToolsActivePort` na pasta do perfil (`~/.config/google-chrome/DevToolsActivePort`: porta na 1ª linha, caminho do WebSocket na 2ª) e **pede confirmação na tela** a cada nova conexão.
- O worker conecta com `chromium.connectOverCDP('ws://127.0.0.1:<porta><caminho>')`, **cria uma aba própria** para o bot e trabalha só nela (e nas abas que ele mesmo abrir, limite 5). Nunca lê, fecha ou navega abas da pessoa; nunca fecha o Chrome; ao parar, fecha só as abas do bot.
- O nó (fora do bubblewrap) lê o `DevToolsActivePort`; a IA continua sem acesso a `~/.config/google-chrome` (já é escondido no bubblewrap; manter).

### 3.2 Configuração por bot

- Substituir `bot.mainChrome` por `bot.browserMode`: `'own'` (padrão, Chrome próprio do bot), `'mine'` (**Meu Chrome**, Codex e Claude), `'claude'` (Claude in Chrome, só Claude). Migração na leitura: `mainChrome === true` → `'claude'`. Atualizar `mainChrome()` → helper `browserMode(bot)` em `tool-policy.mjs` e todos os usos (`queue.mjs` sessão `pc:claude-chrome`, `tools.mjs`, `index.mjs`, `pc/server.mjs`, `database.mjs` `configure`, `validateProfile`).
- `mobile/BotProfile.js`: "Navegador no computador" com 3 opções (rádio), explicando cada uma. "Meu Chrome" mostra o passo a passo de ligar a depuração. Mudar o modo renova a sessão da IA (como hoje).
- Permissão: `'mine'` exige **Navegador** liberado e não existe em Pouco acesso. No Médio, toda ação que não for leitura pede aprovação (chave própria `browser/mine/write`, com "Sempre permitir"); leitura passa. Upload sempre pede.

### 3.3 Implementação

- `pc/browser-worker.mjs`: `BrowserSession` ganha modo `mine` (argumento do processo, ex.: `fork(..., [profile, 'mine'])`): `launch()` conecta por CDP em vez de `launchPersistentContext`; usa `page.route` **na aba do bot** (não `context.route`, que afetaria as abas da pessoa) para `allowedUrl`; sem mexer em `Preferences`; `close()` fecha só as abas do bot e faz `browser.close()` só da conexão CDP (que não fecha o Chrome quando conectado por CDP; confirmar no teste).
- `pc/browser.mjs`: um único worker `mine` compartilhado (chave `'mine'`), com **uma aba por bot** (o worker guarda `botId → aba`). Assumir em qualquer bot `mine` bloqueia todos os bots `mine` (como o Claude in Chrome).
- Tela ao vivo: igual (screencast da aba do bot).
- Erros claros: Chrome fechado / depuração desligada → "Abra o Chrome e ligue a depuração em chrome://inspect/#remote-debugging (uma vez)."; a pessoa recusou a conexão → "Você recusou a conexão no Chrome."; o bot deve então chamar `browser_ask_user`.
- `browser_login` (cofre) funciona na aba do bot; o gerenciador de senhas do Chrome da pessoa continua dela.
- Indicador: enquanto um bot usa Meu Chrome, mostrar o mesmo aviso do desktop (`desktop.indicate`) com o nome do bot.

### 3.4 Testes

- Chrome real separado simulando "Meu Chrome": `google-chrome-stable --headless=new --user-data-dir=<tmp> --remote-debugging-port=0`, ler `DevToolsActivePort` do `<tmp>`, abrir uma aba "da pessoa" com `setContent`. O worker `mine` (apontado para `<tmp>`) cria a aba do bot, navega, lê; a aba da pessoa continua intacta (URL e conteúdo); `close()` fecha só a aba do bot e o Chrome segue vivo.
- Dois bots `mine`: cada um na sua aba; Assumir em um bloqueia o outro.
- Migração `mainChrome: true` → `browserMode: 'claude'`; `validateProfile` recusa modo inválido e `'claude'` para Codex.
- Política: Médio pede `browser/mine/write` em clique de envio; Pouco não tem `'mine'`.

### 3.5 Aceite (com a pessoa)

**Pendente na conta Google da pessoa**: implementação e aceite em Chrome separado/emulador concluídos; este passo exige ativar a depuração e confirmar a conexão no Chrome pessoal.

A pessoa liga a depuração. Bot Codex em "Meu Chrome": "Abra https://myaccount.google.com e me diga só o primeiro nome que aparece" (mostra que está logado no Google). Conferir que as abas da pessoa não mudaram e que, ao terminar, só a aba do bot fechou.

---

## 4. v49 — Mais autonomia no login

### 4.1 Códigos de dois fatores (TOTP) no cofre

- `PasswordVault.kt`: entrada ganha `totp` opcional (segredo base32 ou URI `otpauth://`). Formulário de senha com campo "Chave do autenticador (opcional)" e botão para **ler o QR** do site (a câmera já existe no app, `CameraView`). Importação CSV: colunas `totp`, `login_totp` (Bitwarden), `otpauth`.
- Gerar o código **no Kotlin** (RFC 6238: HMAC-SHA1, 30 s, 6 dígitos; aceitar `digits`/`period`/`algorithm` do `otpauth://`).
- Nova ferramenta `browser_code` (`browser.code`): preenche o campo de código da página (achar `input[autocomplete=one-time-code]`, `inputmode=numeric` com maxlength 4–8, ou rótulos "código"/"code"/"token"/"verificação"). PC: mesmo envelope cifrado do `browser_login` (o código é decifrado só no worker). Celular: preenchido pela WebView. **A IA nunca recebe o código.** Política igual à de `browser.login` (primeiro uso no Médio pede).

### 4.2 Códigos que chegam por SMS ou e-mail

- Permissão nova e separada "Ler códigos de verificação" (desligada por padrão, inclusive no Total; Pouco nunca).
- `browser_code` com `from: 'message'`: espera até 90 s por uma notificação nova (o leitor de notificações já existe em `supervisor/device.mjs`) que contenha 4–8 dígitos e o nome do site/app ou palavras como "código"/"code"; pega a mais recente dos últimos 2 minutos; preenche como em 4.1. O texto da notificação e o código não vão à IA nem aos registros (registrar só "código preenchido de uma mensagem de X").
- Teste sem tempo real: injetar a notificação com `scripts/emulator/post-notification.mjs` logo após chamar a ferramenta.

### 4.3 Cadastro com senha criada pelo cofre

- Nova ferramenta `browser_new_password` (`browser.new_password`): o cofre gera uma senha forte (20 caracteres, letras, números e símbolos, `SecureRandom`), preenche o campo de senha e o de confirmação da página, e guarda uma **entrada pendente** (site + usuário lido do campo de e-mail/usuário do mesmo formulário). Quando o bot chamar `browser_login`/terminar o turno sem erro e a pessoa confirmar no cartão "Conta criada em X?", a entrada vira definitiva; se a pessoa recusar, é apagada.
- Aprovação: **sempre** um cartão "Criar conta em <site> com o usuário <usuário>" no Médio (cadastrar aceita termos em nome da pessoa); no Total, "Sempre permitir" por site.
- Confirmação de e-mail: o bot usa os conectores/apps da conta que já existem. CAPTCHA e SMS com número próprio: `browser_ask_user`.

### 4.4 Sites logados por bot

- PC: ops `sites` e `signout` no worker: `context.cookies()` agrupado pelo domínio mais largo que o próprio navegador guarda (como o OpenMausBot; sem lista de sufixos públicos), e `signout` apaga os cookies daquele domínio e limpa `localStorage`/`sessionStorage`/IndexedDB das origens dele (`Storage.clearDataForOrigin` via CDP).
- App: perfil do bot → "Sites logados (computador)" com "Sair" por site e "Sair de todos". No celular a WebView não lista cookies: mostrar só "Limpar navegador deste bot" (apagar o perfil da WebView do bot).

### 4.5 Testes e aceite

- Kotlin TOTP: vetores do RFC 6238 (tempo 59 → `287082` com o segredo de teste do RFC, 8 dígitos `94287082`) num teste de instrumentação ou num utilitário JS espelhado nos testes do Node, além do teste no emulador.
- Envelope do código no PC: mesmo padrão do teste `saved PC login` de `tests/desktop.test.mjs`.
- Cadastro: página `setContent` com e-mail + senha + confirmação; conferir que os dois campos recebem a mesma senha, que o resultado devolvido não contém a senha e que a entrada só fica após confirmar.
- Aceite no emulador: TOTP com um segredo de teste num site de demonstração de 2FA (ou página `setContent` no nó de teste); código por notificação simulada.

---

## 5. v50 — Acabamentos

### 5.1 Ditado do PC independente e na placa de vídeo

- Comando `node pc/node.mjs whisper` (pergunta antes, mostra o tamanho do download): cria `~/.mybots-pc/whisper/venv`, `pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12`, baixa o modelo (`large-v3-turbo` com GPU; `medium` sem GPU) uma vez e grava o Python em `~/.mybots-pc/whisper/python`. Hoje aponta para o venv de `~/vscodeProjects/CODEXAssistenteinterview` (CPU, `medium`), que funciona mas é de outro projeto.
- `pc/dictation.mjs`: ao iniciar o `transcribe.py`, acrescentar ao `LD_LIBRARY_PATH` as pastas `lib` dos pacotes `nvidia/*` do venv (é o que faltava para a GPU: `libcublas.so.12`). Manter o fallback para CPU.
- Teste: o existente com Python falso + conferir que o `LD_LIBRARY_PATH` inclui as pastas `nvidia/*/lib` quando existem.

### 5.2 Tela ao vivo maior

- Botão "Tela cheia" no `PcBrowserLive`: `Modal` ocupando a tela, imagem girada para paisagem se o celular estiver em retrato (ou com rolagem horizontal), mesmos controles.
- Zoom com dois dedos (escala + deslocamento) no quadro; o mapeamento de toque para fração da página tem que considerar escala e deslocamento (testar tocar num link pequeno com zoom).

### 5.3 Bug do pareamento

- `supervisor/link.mjs`: uma tentativa de conexão antiga (`connect()` aguardando `reach`) que termina depois de `forget()`/`pair()` chama `retry()` e marca "offline/Outro aparelho…" por cima da conexão nova. Corrigir com um contador `this.generation` incrementado em `forget`, `pair` e `drop`; `connect()` guarda o valor no início e, ao terminar, ignora o resultado (fecha o socket aberto e não chama `retry`) se mudou.
- Teste em `tests/link.test.mjs`: primeiro endereço que demora (servidor TCP que aceita e não responde), `forget` + `pair` com outro nó durante a espera; o estado final tem que ser `online` sem erro.

### 5.4 Fontes no Chrome sem janela

- Páginas com chinês/árabe/hebraico apareceram com quadradinhos na tela ao vivo. Conferir se faltam fontes no sistema (`noto-fonts-cjk`, `noto-fonts`) e, se faltarem, **avisar a pessoa** com o comando de instalação (não instalar pacotes do sistema por conta própria).

---

## 6. O que não fazer

- Não disfarçar automação (`--disable-blink-features=AutomationControlled`, patches tipo rebrowser, user-agent falso), não usar proxies, não resolver CAPTCHA automaticamente.
- Não copiar o perfil do Chrome da pessoa para os bots (sessões copiadas caem e espalham credenciais).
- Não dar à IA ferramenta de JavaScript livre na página (`evaluate` arbitrário).
- Não mandar quadros da tela ao vivo para a IA, para eventos gerais (`broadcast`), widget ou logs.
- Não ler, fechar ou navegar abas da pessoa no "Meu Chrome".
- Não reiniciar o `mybots-pc` real nem regerar a janela antes da Release. Depois de publicar, atualizar sempre o PC na mesma entrega, sem aguardar confirmação do celular (instrução da pessoa em 21/10/2026).
