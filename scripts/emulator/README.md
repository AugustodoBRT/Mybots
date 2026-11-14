# Emulador de teste

Android 16 (API 36, x86_64) com o MyBots, para testar como no celular. O MyBots do celular roda no Linux do próprio app (veja [scripts/runtime/README.md](../runtime/README.md)); na primeira tela, escolha "Usar neste celular".
Tudo fica em `.build-tools/` (fora do Git). O login do Codex no emulador é separado do celular e do PC.

- `start.sh [--window]` liga o emulador (sem janela por padrão; com `--window` aparece na tela).
- `install.sh` gera o APK **x86_64** e **depurável** (só para o emulador, para o `adb run-as` ler o Linux do app; a entrega ao celular continua ARM64 com `scripts/build-apk.sh`, e `publish-release.sh` recusa um APK depurável) e instala, aceitando versão menor (`-d`), para testar a atualização dentro do app com uma Release de teste.
- `wait-supervisor.sh` espera o supervisor da versão do APK subir no Linux do app e prepara o acesso pelo PC.
- `runtime-shell.sh < script.sh` roda um script bash **dentro do Linux do app** (o mesmo PRoot que o app usa; `/root` é a pasta do MyBots).
- `node rpc.mjs <método> '<json>'` chama o supervisor pelo mesmo WebSocket do app (ex.: `state.get`, `bot.create`, `chat.send`).
- `ask.sh <botId> "mensagem"` manda uma mensagem e espera a resposta; `ask-approve.sh` faz o mesmo aprovando os cartões.
- `node post-notification.mjs Gmail "título" "texto"` simula uma notificação chegando ao supervisor.
- `node send-file.mjs <botId> <arquivo> "mensagem"` manda um anexo como o botão ＋ do app e espera a resposta.
- `screen.sh <arquivo.png>` tira print da tela.
- `node seed-long.mjs [5000] [3000]` cria o bot "Histórico longo" com milhares de mensagens e a "Sala longa" com milhares mais (Markdown, tabelas, código, anexos), direto no banco do emulador, para medir abrir e rolar conversas longas.

Cuidados aprendidos:
- Para tocar em botões, prefira as coordenadas do `uiautomator dump` (o layout muda quando avisos aparecem). Telas do app com animação às vezes não deixam o `uiautomator` terminar ("could not get idle state"): use um print e coordenadas.
- Compartilhar com o bot: `adb shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'https://…' -n com.mybots.app/.MainActivity"`; para arquivos, use o app Arquivos (Downloads → segurar → Compartilhar).
- O teclado às vezes abre um aviso de "stylus" que engole o que é digitado: feche antes.
