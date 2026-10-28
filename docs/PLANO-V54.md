# MyBots: plano da v54 em diante (navegador de verdade, conversas rápidas e bot livre)

Escrito em 27/10/2026, logo depois da v53 (0.31.1). Para usar numa conversa nova: **"leia docs/PLANO-V54.md e faça a próxima versão pendente"**. Faça **uma versão por vez**, na ordem, e só passe para a seguinte depois do aceite da anterior. Ao terminar, marque a seção como "— concluída na vNN" e registre em `docs/progresso.md`.

As regras de trabalho são as da seção 1 de [PLANO-V47.md](PLANO-V47.md) (testes, emulador, nó de PC isolado, entrega, docs), com duas mudanças desta fase:

- Migração nova do banco: a 9 e a 10 já saíram (`room_messages`, `browser_steps`/`browser_downloads`); a da v61 é a **11** (negociações).
- A regra 9 (segurança) continua, mas a trilha "bot livre" (v59 a v61) muda **onde** fica o freio: em vez de pedir aprovação a cada ação, o supervisor aplica **limites duros** que o modelo não consegue mudar (orçamento, lojas, mandato). Continua proibido: senha, número de cartão ou código passar pela IA; disfarçar automação; quebrar CAPTCHA (quem resolve é a pessoa, agora com muito mais conforto).

**Versão intermediária 0.38.1 (versionCode 61, 28/10/2026):** entre a v60 e a v61 saiu uma entrega fora do plano, com skills por bot, "Usar a placa de vídeo" e salas com até 30 rodadas (detalhes em `docs/progresso.md` e `docs/seguranca.md`). Por isso, daqui em diante o **versionCode é o número da versão do plano mais 1**: a v61 sai como 0.39.0 com versionCode 62, a v62 com 63 e a v63 com 64. O nome "v61" continua sendo o da seção do plano, e `scripts/publish-release.sh` recebe o versionCode (62 para a v61).

Antes da v54: terminar e commitar o trabalho em andamento no `mobile/App.js` (rolagem que fica onde a pessoa lê, `useStickyScroll` + botão de descer), que já está no diff local.

---

## 0. Diagnóstico (27/10/2026)

### Navegador

| Sintoma | Causa no código |
|---|---|
| **Pisca muito com CAPTCHA** (Chrome do PC visto no celular) | `PcBrowserLive` troca o `source` de um único `<Image>` a cada quadro (`data:image/jpeg;base64,...`). No Android, o `Image` solta o bitmap antigo antes de decodificar o novo, e a tela fica vazia por um instante a cada troca. CAPTCHAs (Turnstile, reCAPTCHA, hCaptcha) animam o tempo todo, então chegam ~8 quadros/s e a tela pisca sem parar. |
| Quadros pesados e com atraso | Cada quadro é JPEG 1280×800 em base64 dentro de JSON: PC → link (JSON) → supervisor (`JSON.stringify` de novo) → WebSocket do app → `JSON.parse` na thread JS → `Image`. São 3 parses de strings de 100 a 200 KB por quadro, disputando a mesma thread JS com o chat. |
| Não dá para controlar direito pelo celular | A página é desktop 1280×800 encolhida para ~360 dp (escala ~0,28): o quadradinho do CAPTCHA fica com ~7 dp. Não há zoom. O toque só vira clique ao soltar, e o arrastar manda rodinha de mouse a cada 120 ms. Digitar exige uma caixa separada, há só 6 teclas e não aparece nenhum retorno de onde se tocou. |
| Painel apertado | O painel ocupa 42% da altura (`styles.frame`), fica acima da conversa e não tem tela cheia. No modo celular (WebView), `KeyboardAvoidingView behavior="height"` encolhe a WebView quando o teclado abre, e a página se reorganiza. |

**Como o OpenBot faz** (openbot.run, repositório `nightly-labs/openbot`): o navegador é um `WebContentsView` do Electron **de verdade** dentro do app, persistente, com sessão isolada por agente (própria, compartilhada ou nomeada) e downloads numa pasta própria. Não é uma imagem transmitida. O app móvel deles (Expo) **não mostra** o navegador: ele só usa WebRTC para eventos e comandos. Por isso, o diferencial do MyBots é justamente **o navegador do bot controlável de verdade pelo celular**.

### Conversas longas e grupos

| Sintoma | Causa no código |
|---|---|
| ~5 s para abrir e travar com grupo cheio | Qualquer evento (`task.progress`, `activity.new`, vários por segundo enquanto um bot trabalha) dispara, após 150 ms, `state.get`. Ele devolve `db.snapshot()` **inteiro**: todos os bots com **todas** as mensagens (o chat privado não tem janela), todas as salas (`rooms()` faz `JSON.parse` do corpo inteiro, até 1000 mensagens, mesmo cortando para 60 depois), skills, memórias, permissões e pendências. Depois disso, `setData` troca tudo e o app inteiro renderiza de novo. |
| Lista lenta | As conversas usam `ScrollView`, que renderiza **todas** as mensagens. `Message` não é memoizado, e o Markdown e o `RichMessage` são refeitos a cada renderização. |
| Gravação cara no celular | `putBot` apaga e reinsere **todas** as mensagens do bot a cada mensagem nova (O(n) por mensagem, com `synchronous=FULL`). A sala é um único JSON de até 1000 mensagens, regravado a cada mensagem e a cada passo de progresso. |
| Código difícil de mexer | `mobile/App.js` tem 2310 linhas: todas as telas, o estado e a conexão no mesmo arquivo. |

---

## v54 — Navegador sem piscar e tela ao vivo nativa — concluída na v54

Objetivo: a tela do Chrome do PC fica estável no celular, mesmo com CAPTCHA animando, e o chat não engasga enquanto ela roda.

1. **Correção imediata (JS)**: em `PcBrowserLive`, usar duas camadas de `Image` alternadas. O quadro novo entra por baixo e só passa para cima em `onLoad`. Assim a imagem antiga nunca some antes da nova estar pronta. Isso já elimina o piscar e é entregue mesmo que o item 2 atrase.
2. **`BotFrameView` nativo** (`BotBrowser.kt` ou um arquivo novo no módulo `termux-bridge`): é uma `View` que decodifica o JPEG numa thread de fundo (`BitmapFactory` com `inBitmap` para reaproveitar memória) e desenha com troca atômica de bitmap (`invalidate` só depois de decodificar). Ela recebe os quadros **sem passar pela thread JS**:
   - o supervisor abre um endpoint só para quadros (`/frames?bot=<id>`, WebSocket binário no mesmo servidor 127.0.0.1, com o mesmo token do app);
   - a view se conecta com OkHttp (já vem no React Native) e manda à JS só os metadados (url, título, abas), no máximo 2 vezes por segundo.
3. **Quadros binários no link**: o PC manda JPEG binário (cabeçalho pequeno com botId, largura, altura e seq), sem base64 nem JSON. Isso dá cerca de 33% menos bytes e nenhum parse. Ajustar `pc/server.mjs` (`paced`), `supervisor/link.mjs` (`onFrame`) e `supervisor/index.mjs` (relay).
4. **Qualidade adaptativa**: o app informa o tamanho real do visor em pixels. O worker pede `maxWidth`/`maxHeight` desse tamanho e ajusta o ritmo: só olhando, até 5 quadros/s e qualidade 55; com Assumir, até 15 quadros/s e qualidade 70, com `screencastFrameAck` imediato. Quando `bufferedAmount` sobe, cai a qualidade antes de descartar quadros.
5. **Página de teste de CAPTCHA no emulador**: abrir `https://www.google.com/recaptcha/api2/demo` e `https://accounts.hcaptcha.com/demo` no Chrome do bot (nó de PC isolado). Gravar a tela do emulador antes e depois (`screenrecord`) e conferir quadro a quadro que não há tela vazia.

**Testes novos**: `paced` com quadros binários e descarte do intermediário; o relay entrega só a quem olha o bot e recusa token errado no `/frames`; o worker respeita `maxWidth` pedido; o teste real de Chrome (`skip` sem Chrome) gera quadros de uma página animada e confere a sequência crescente de `seq`.

## v55 — Controle de verdade pelo celular — concluída na v55

Objetivo: resolver um CAPTCHA, fazer login ou preencher um formulário pelo celular com a mesma facilidade de um navegador do próprio celular.

1. **Tela cheia** ao Assumir: um modal de tela inteira com barra flutuante (voltar, recarregar, abas, teclado, zoom e **Devolver ao bot**), com rotação livre. No painel do chat, o visor fica do tamanho certo da proporção.
2. **Modo celular da página**: ao Assumir, o worker troca o viewport do Chrome para o do celular (`Emulation.setDeviceMetricsOverride` com `mobile: true`, a largura do visor em CSS px e `deviceScaleFactor` do aparelho) e liga `Emulation.setTouchEmulationEnabled`. O site passa a mostrar a versão mobile, em tamanho 1:1, sem zoom. Ao devolver, volta ao desktop. Um botão "Ver como computador" alterna (há sites que só funcionam no desktop). Fica guardado por bot e por site.
3. **Toques reais**: tocar, tocar duas vezes, segurar (menu de contexto e seleção) e arrastar com inércia viram `Input.dispatchTouchEvent`, e não mouse. O arrasto move a imagem localmente na hora (otimista) e sincroniza quando o quadro novo chega.
4. **Zoom com pinça** no próprio visor (transformação local), com os toques convertidos pelas coordenadas do zoom. Toque duplo aproxima o ponto tocado.
5. **Teclado nativo direto no campo**: o worker avisa quando um campo editável ganha foco (`focusin` exposto por binding). O app abre o teclado do celular sozinho, com um `TextInput` invisível, e cada tecla vai na hora (`Input.insertText`/`dispatchKeyEvent`, com composição do IME para acentos e autocorretor). Campo `type=password` liga sozinho o modo secreto: o texto não fica na tela nem vai para a IA. A caixa "Digitar no campo tocado" deixa de existir.
6. **Retorno visual**: um círculo onde se tocou, uma barra de carregamento da página e um aviso "lento" quando a latência passa de 500 ms.
7. **Fluxo de CAPTCHA**: quando o bot chama `browser_ask_user` por CAPTCHA, a notificação "Toque para resolver" abre direto na tela cheia, já com zoom na área do desafio (o worker acha o iframe de `challenges.cloudflare.com`, `recaptcha` ou `hcaptcha` e manda o retângulo). O worker percebe quando o desafio some ou o token aparece e oferece **Devolver ao bot** com um toque, ou devolve sozinho se a pessoa marcou essa opção.
8. **Celular (WebView)**: o mesmo modal de tela cheia para a WebView do bot, com zoom habilitado (`setBuiltInZoomControls(true)`, `setDisplayZoomControls(false)`) e sem encolher a página quando o teclado abre (`adjustResize` só no modal).

**Testes novos**: a conversão de coordenadas com zoom e rotação (função pura em `BotBrowserPanel`); `input` com `touch` e `insertText` no Chrome real; o modo celular troca e restaura o viewport; o detector de CAPTCHA acha o iframe em páginas de teste montadas com `setContent`; a senha no modo secreto nunca aparece em log nem na resposta do `input`.

## v56 — Conversas rápidas, parte 1 (supervisor e protocolo) — concluída na v56

Objetivo: abrir qualquer conversa em menos de 300 ms e não reenviar o mundo inteiro a cada passo do bot.

1. **Gravação só de acréscimo**: `appendMessage(botId, message)` e `updateMessage(id, patch)` no lugar de `putBot` para mensagens. `putBot` passa a gravar só o corpo do bot. Índice `messages(bot_id, rowid)`.
2. **Migração 9**: `room_messages(id, room_id, body, created_at)` com índice `(room_id, rowid)`. As mensagens saem do JSON da sala, e o limite de 1000 deixa de existir (só a busca e a paginação leem o histórico antigo).
3. **Estado enxuto**: `state.get` devolve os bots **sem** mensagens, só com a última, a contagem e o não lido, e as salas sem mensagens. Skills, memórias e permissões saem do estado geral e vão para `bot.profile`, carregado ao abrir o perfil.
4. **Páginas de conversa**: `chat.page { botId | roomId, before?, limit: 40 }`, por cursor (`rowid`), no lugar de `chat.history`/`room.history`.
5. **Eventos com conteúdo e número de sequência**: `message.added`, `message.updated`, `task.progress { taskId, botId, step }`, `bot.updated`, cada um com `seq` crescente. O app aplica o pedaço sem pedir o estado. Se faltar um `seq` (reconexão), ele pede `state.get` e recarrega as conversas abertas, como o buffer de eventos do OpenBot.
6. **Passos de progresso** não viram mais regravação da conversa: são eventos. Só a mensagem de progresso visível (`progressMessage`) é gravada, uma vez.

**Testes novos**: orçamento de tamanho (com 5 bots × 5000 mensagens e 3 salas × 3000, `state.get` fica abaixo de 50 KB e responde em menos de 50 ms); `chat.page` pagina sem repetir nem pular; a migração 9 move as mensagens das salas e mantém a ordem; a sequência de eventos detecta lacunas; gravar a mensagem 5000 custa o mesmo que a 10.

## v57 — Conversas rápidas, parte 2 (app) — concluída na v57

1. **Dividir `mobile/App.js`**: `screens/Chat.js`, `screens/Room.js`, `screens/Home.js`, `state/store.js`, `components/Message.js`. O comportamento fica igual, e esta é a primeira etapa, sozinha num commit.
2. **Loja com fatias** (`useSyncExternalStore`, sem biblioteca nova): cada tela assina só o que usa. Um passo do bot A não renderiza de novo o chat B nem a lista de bots inteira.
3. **Lista virtualizada**: `FlatList` invertida (a mais nova embaixo, sem `scrollToEnd`) com `initialNumToRender: 15`, `windowSize: 7`, carregamento de páginas antigas no topo e `maintainVisibleContentPosition`. A rolagem que fica onde a pessoa lê, do diff atual, é mantida.
4. **`Message` memoizado** por `id + status + text.length`. O Markdown é analisado uma vez por mensagem (cache por id) e os anexos são carregados sob demanda.
5. **Abrir na hora**: as últimas 40 mensagens de cada conversa ficam guardadas no aparelho (`local.js`). A conversa abre com o cache e atualiza por cima.
6. **Teclado suave**: `react-native-keyboard-controller` (o mesmo usado pelo OpenBot) no lugar de `KeyboardAvoidingView`. O campo acompanha o teclado sem pulo, e a lista não recalcula a cada quadro.
7. **Medição no emulador**: o script `scripts/emulator/seed-long.mjs` cria uma sala com 3000 mensagens (Markdown, tabelas e anexos) e um chat com 5000. As metas são: abrir em menos de 300 ms, rolar sem queda de quadro visível e nenhum travamento com 3 bots trabalhando ao mesmo tempo. Registrar os números em `docs/progresso.md`.

**Testes novos**: o redutor da loja aplica `message.added`/`updated` na ordem e ignora repetidos; o cache local respeita 40 por conversa e é apagado ao excluir o bot; o snapshot de renderização de `Message` não muda com a memoização.

## v58 — Navegador no estilo OpenBot — concluída na v58

Na entrega, a pedido da pessoa, o item 4 virou **navegador compartilhado por padrão** (todos os bots, no PC e no celular), com **Navegador separado** por bot. O perfil nomeado não foi feito.

1. **Barra de abas de verdade**, com favicon, título, fechar e "+". Endereço sempre visível, com voltar e avançar.
2. **Ver o bot trabalhando**: um cursor do bot no visor (onde ele vai clicar), um realce no elemento do `browser_click`/`browser_type` e uma legenda do passo ("Clicando em ‘Entrar’"). O worker manda o retângulo junto com o comando.
3. **Linha do tempo do navegador** na conversa: cada passo do bot com miniatura (a partir do quadro mais próximo). Tocar abre aquele momento.
4. **Perfis como no OpenBot**: além de Próprio, Meu Chrome e Claude in Chrome, um **perfil nomeado** compartilhado entre bots escolhidos (por exemplo, "Faculdade", com o login do SIGAA para dois bots).
5. **Downloads do navegador** numa lista própria (no PC, `~/.mybots-pc/downloads/<botId>`; no celular, a pasta do bot), com Abrir e Enviar ao bot.
6. **Tela larga** (tablet e janela do PC): o navegador fica ao lado da conversa (divisão lado a lado), e não por cima.

## v59 — Bot livre, parte 1: autonomia e controle do celular — concluída na v59

Na entrega: a lista "Sempre perguntar" é uma só para todos os bots Livres; códigos chegam pelas notificações (SMS pelo app de mensagens), no app e no navegador do bot no celular; no Codex, "Comandos no Termux" na lista deixa o bot sem terminal (o Codex não deixa perguntar comando a comando).

Objetivo: o bot consegue fazer praticamente tudo o que a pessoa faz no celular, sem pedir licença a cada passo, dentro de limites que só a pessoa muda.

1. **Nível de acesso "Livre"** (acima de Total): nenhum cartão de aprovação por ação, com exceção do que bater num limite duro (v60, v61) ou do que estiver na lista "sempre perguntar", que a pessoa edita. O nível é escolhido por bot, com aviso claro na primeira vez. Cada ação continua registrada na Atividade.
2. **Controle dos apps do Android** por um `AccessibilityService` do MyBots (`MyBotsAccess.kt`), com ferramentas `phone_screen` (árvore de acessibilidade e captura numerada, como no navegador), `phone_tap`, `phone_type`, `phone_scroll`, `phone_open_app` e `phone_back`. É o que permite pedir no iFood, mandar mensagem no WhatsApp ou mexer em qualquer app. Campos de senha aparecem mascarados para a IA, como no navegador.
   - Android 13+ bloqueia a acessibilidade de APK instalado por fora até a pessoa tocar em "Permitir configurações restritas" nas informações do app. O app guia esse passo.
   - Apps de banco costumam recusar acessibilidade. Nesses casos, o bot chama a pessoa.
3. **Ver e assumir o celular** do mesmo jeito que o navegador: tela ao vivo do que o bot faz em outro app e um botão **Parar** sempre visível (uma notificação fixa enquanto ele controla o celular).
4. **Códigos de verificação**: com permissão, o bot lê o código de uma notificação (o `MyBotsNotificationListener` já existe) ou de um SMS, só do remetente e do site esperados, e o código vai direto para o campo sem passar pela IA (preenchimento nativo, como a senha).
5. **Termux sem rédea** no nível Livre: o shell completo do Termux para instalar pacotes, rodar scripts e usar o Termux:API (localização, câmera, SMS com permissão).

**Testes novos**: a política do nível Livre (nada pede aprovação, exceto a lista "sempre perguntar" e os limites duros); as ferramentas `phone_*` validam argumentos; no emulador, com o serviço de acessibilidade ligado, o bot abre Configurações e lê um item.

## v60 — Carteira do bot: cartão e compras — concluída na v60

Objetivo: a pessoa cria um cartão virtual (Nubank, Inter, C6 e outros bancos permitem, com limite próprio), entrega ao bot e pede "compra tal coisa". O bot compra sozinho dentro do orçamento.

1. **Cartão no cofre**: número, validade, CVV, nome e endereço de cobrança ficam no `PasswordVault` (Android Keystore). **Nunca vão à IA**. A IA só vê "cartão final 1234, saldo do mês R$ 320".
2. **Preenchimento protegido no checkout** (`browser_pay`), do mesmo jeito que `browser_login`:
   - no PC, o cofre cifra para a chave temporária do worker, que preenche os campos `autocomplete=cc-*` ou os campos reconhecidos, inclusive dentro de iframes de pagamento (Stripe, Mercado Pago, Adyen, PagSeguro);
   - na WebView do celular, a injeção alcança os iframes por `WebViewCompat.addWebMessageListener`/`addDocumentStartJavaScript` com as origens das processadoras permitidas.
3. **Regras de gasto aplicadas pelo supervisor**, nunca pelo modelo: valor máximo por compra, por dia e por mês, lojas permitidas ou proibidas e categorias. Antes de preencher, o bot declara loja, itens e total (`wallet_intent`). O supervisor confere o total na própria página (o texto do total no checkout) e recusa se passar do limite ou se a loja não bater.
4. **Extrato e avisos**: cada compra vira um lançamento (loja, valor, itens, captura do comprovante), e a notificação "Bot comprou X por R$ Y" chega na hora. Um botão **Congelar carteira** bloqueia tudo num toque.
5. **3-D Secure e Pix**: a confirmação no app do banco é sempre da pessoa (o bot chama e espera). Pix copia e cola: o bot gera, e a pessoa paga no banco, a não ser que o app do banco aceite a v59.
6. **Proteção contra página maliciosa**: o conteúdo da página continua sendo dado externo. Uma página que mande "compre isto" não muda o orçamento nem a lista de lojas, porque os dois vivem no supervisor.

**Testes novos**: o cartão nunca aparece em log, resposta MCP ou evento (busca pelo número em tudo que sai); o limite por compra, dia e mês barra no supervisor mesmo com a IA insistindo; o total divergente da página é recusado; o preenchimento funciona em um checkout de teste com iframe (página montada com `setContent`); congelar bloqueia na hora.

## v61 — Negociar e agir em seu nome — concluída na v61

1. **Mandato de negociação**: a pessoa define o objetivo ("comprar a bicicleta por até R$ 900", "vender o monitor por no mínimo R$ 600"), o preço-alvo, o teto, se o bot **pode fechar** ou só trazer a melhor proposta, e o prazo. O supervisor guarda o mandato e confere cada oferta que o bot vai mandar.
2. **Canais**: WhatsApp (app, pela v59, ou WhatsApp Web no navegador do bot), OLX e Facebook Marketplace (navegador do bot, logado pela pessoa) e e-mail (já existe). Cada conversa negociada fica num painel com histórico, última oferta e status.
3. **Fechar**: dentro do mandato, o bot fecha e, se for compra, paga pela carteira (v60). Fora dele, ele para e traz a proposta com um botão Aceitar/Recusar.
4. **Na sua conta, no seu nome**: o bot escreve como a pessoa e no tom que ela definir. A configuração deixa a pessoa escolher se ele se apresenta como assistente.

**Testes novos**: uma oferta acima do teto é bloqueada pelo supervisor; um mandato vencido para a negociação; fechar sem permissão gera o cartão Aceitar/Recusar.

## v62 — Acabamentos que fazem diferença — concluída na v62 (0.40.0, versionCode 64)

- **Resposta aparecendo enquanto é escrita** (streaming): Claude `stream-json` com mensagens parciais e Codex por itens, em lotes de ~32 ms.
- **Busca em todas as conversas** (SQLite FTS5 sobre `messages` e `room_messages`).
- **Responder pela notificação** (RemoteInput) e **Aprovar/Recusar** direto nela.
- **Fila controlável**, como no OpenBot: pausar, retomar, cancelar item e **"Corrigir rumo"** (manda uma instrução para a tarefa em andamento sem esperar a vez).
- **Modelo reserva** quando o limite da assinatura acaba (Codex ↔ Claude), com a conversa mantida.
- **Ações na mensagem** (segurar): copiar, responder citando, fixar e reenviar.

## v63 — Design novo: identidade própria, celular e PC

Pedido do usuário em 28/10/2026: o app faz muita coisa, mas o design é fraco. Ele é "meio cinza, meio verde" (`C.mint` em tudo, sobre fundos azulados `#090B10`/`#12161E`), o robozinho dos bots (`BotAvatar.js`, `BotFace.kt`) não tem graça, as opções estão mal colocadas e o PC é só o app do celular esticado (`desktop.js` centraliza tudo numa coluna de 820 px). Objetivo: um visual **único e bonito**, que não pareça um template, com movimento e com o PC aproveitando a tela.

**Antes de codar: discutir a identidade dos bots com o usuário.** Não implemente nenhum avatar antes disso. Leve 3 ou 4 direções com protótipo (uma página HTML ou artifact com as opções animadas lado a lado, nos dois temas) e deixe o usuário escolher ou misturar. Ponto de partida para a conversa, sem decidir nada:
- formas abstratas vivas (uma "gota" ou orbe que respira, muda de forma e de cor conforme o estado);
- personagens ilustrados gerados por semente (cada bot nasce único; a pessoa pode sortear de novo);
- monograma ou glifo com animação (letra do nome em um selo que se mexe);
- foto ou imagem escolhida pela pessoa, com moldura animada do estado por cima.

Em qualquer direção: o estado (trabalhando, esperando você, dormindo, erro) aparece no próprio avatar, também no widget (`MyBotsWidget.kt`) e nas notificações.

1. **Sistema visual novo** (`theme.js` vira tokens por tema):
   - **Escuro com preto de verdade** (`#000` de fundo, superfícies quase pretas, bom em tela OLED) e **claro** de verdade, não um escuro invertido. Opção em Ajustes: Escuro, Claro, Seguir o sistema. O PC segue a mesma escolha, inclusive a barra de rolagem e o `document.body` (hoje fixo em `#090B10`).
   - Paleta e tipografia novas, com personalidade. Acabar com o verde como cor de tudo: uma cor de destaque da marca e a cor de cada bot só onde ela importa.
   - Ícones, cantos, sombras, espaçamento e estados (pressionado, desativado, carregando) revisados em todo o app.
2. **Movimento**: transições entre telas, folhas e cartões que entram com mola, mensagem nova aparecendo com suavidade, avatar vivo, retorno ao tocar. Tudo leve (Reanimated na thread de UI, sem pesar na conversa da v56–v57) e respeitando "reduzir movimento" do sistema.
3. **Ajustes reorganizados**: hoje é uma lista longa. Exemplo do problema: com as senhas importadas (`PasswordsPanel`), aparece a lista inteira e é preciso rolar muito para chegar às outras opções.
   - Ajustes por **categorias** (Conta e IA, Bots, Celular, Computador, Senhas e carteira, Backup, Sobre), cada uma numa tela ou seção recolhível, com busca nos ajustes.
   - Senhas: um resumo ("312 senhas · 4 bots com acesso") que abre uma tela própria com busca, agrupada por site e carregando aos poucos. O mesmo vale para qualquer lista que possa crescer (conexões, rotinas, pastas).
   - Revisar também o perfil do bot (`BotProfile.js`): o que se usa muito fica no alto, o avançado fica recolhido.
4. **PC com cara de PC** (`DesktopShell`, `desktop.js`):
   - Layout próprio em vez da coluna centralizada: barra lateral recolhível, conversa e um painel lateral que muda conforme o contexto (navegador do bot ao vivo, perfil, Hoje e Atividade), com divisórias que dá para arrastar.
   - Ajustes e perfil em páginas largas com navegação à esquerda, em vez de folhas de celular abertas no meio da tela.
   - Atalhos de teclado (Ctrl+K para buscar e trocar de bot, Ctrl+N para um bot novo, Esc para fechar), hover, menus de clique direito, arrastar arquivos para a conversa.
   - Aproveitar a largura: Atividade e pendências em colunas, navegador do bot ao lado da conversa sem espremer.
5. **Telas principais redesenhadas**: Início, conversa, sala, Atividade, aprovações, navegador do bot, criação de bot e primeira abertura (onboarding).

**Como fazer**: começar pelo protótipo de direção visual (tema e avatar), conversar com o usuário e só depois aplicar. Trocar os tokens primeiro e depois tela por tela, para o app não ficar meio novo e meio velho por muito tempo.

**Testes novos**: as telas principais nos dois temas, no celular e no PC, conferidas por capturas no emulador e na janela do PC (guardadas em `docs/screenshots/`); contraste mínimo AA nos textos; troca de tema sem reiniciar; "reduzir movimento" desliga as animações; lista com 1.000 senhas abre e rola sem travar e não empurra as outras opções; o avatar mostra cada estado; nenhuma função perdida (comparar a lista de ações de cada tela antes e depois).

---

## Ordem e por quê

1. **v54–v55**: o navegador é o que mais incomoda hoje e é o diferencial no celular (o OpenBot nem mostra o navegador no app).
2. **v56–v57**: as conversas longas travando afetam todo uso diário. Vêm antes do resto porque as v59–v61 multiplicam o número de passos e eventos.
3. **v58**: o acabamento do navegador usa o protocolo de eventos da v56.
4. **v59–v61**: o bot livre depende de ver e parar o bot com conforto (v55, v58) e de um app que aguente muitos eventos (v56, v57).
5. **v62**: acabamentos independentes, que podem ser puxados antes se algum fizer falta.
6. **v63**: o redesenho vem por último porque mexe em todas as telas. Feito depois que as funções estiverem no lugar, ninguém precisa redesenhar duas vezes. Começa com a conversa sobre a identidade dos bots.
