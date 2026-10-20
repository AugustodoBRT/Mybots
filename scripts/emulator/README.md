# Emulador de teste

Android 16 (API 36, x86_64) com Termux, Termux:API, `pkg install codex` e o MyBots, para testar como no celular.
Tudo fica em `.build-tools/` (fora do Git). O login do Codex no emulador é separado do celular e do PC.

- `start.sh [--window]` liga o emulador (sem janela por padrão; com `--window` aparece na tela).
- `install.sh` gera o APK **x86_64** (só para o emulador; a entrega ao celular continua ARM64 com `scripts/build-apk.sh`) e instala, aceitando versão menor (`-d`), para testar a atualização dentro do app com uma Release de teste.
- `wait-supervisor.sh` espera o supervisor da versão do APK subir no Termux e prepara o acesso pelo PC.
- `termux-run.sh < script.sh` roda um script **na sessão do app Termux** (com rede). `adb run-as` não tem rede.
- `termux-shell.sh < script.sh` roda pelo `adb run-as` (sem rede; serve para ler e escrever arquivos).
- `node rpc.mjs <método> '<json>'` chama o supervisor pelo mesmo WebSocket do app (ex.: `state.get`, `bot.create`, `chat.send`).
- `ask.sh <botId> "mensagem"` manda uma mensagem e espera a resposta; `ask-approve.sh` faz o mesmo aprovando os cartões.
- `node post-notification.mjs Gmail "título" "texto"` simula uma notificação chegando ao supervisor.
- `node send-file.mjs <botId> <arquivo> "mensagem"` manda um anexo como o botão ＋ do app e espera a resposta.
- `screen.sh <arquivo.png>` tira print da tela.

Cuidados aprendidos:
- O Termux do emulador usa DNS 8.8.8.8, que a rede do emulador não alcança: `printf "nameserver 10.0.2.3\n" > $PREFIX/etc/resolv.conf`.
- Para tocar em botões, prefira as coordenadas do `uiautomator dump` (o layout muda quando avisos aparecem). Telas do app com animação às vezes não deixam o `uiautomator` terminar ("could not get idle state"): use um print e coordenadas.
- Compartilhar com o bot: `adb shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'https://…' -n com.mybots.app/.MainActivity"`; para arquivos, use o app Arquivos (Downloads → segurar → Compartilhar).
- O teclado às vezes abre um aviso de "stylus" que engole o que é digitado: feche antes.
