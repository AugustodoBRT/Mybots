# Antigravity (agy) e opencode no Termux

Como o Claude Code, nenhum dos dois tem pacote no Termux. O MyBots usa o que achar, nesta ordem: um comando nativo no PATH do Termux; senão, o instalado num Debian do `proot-distro`. O supervisor chama `~/.mybots/agy-wrapper` e `~/.mybots/opencode-wrapper` (criados no pareamento a partir de `supervisor/agy-wrapper.sh` e `supervisor/opencode-wrapper.sh`). No PC não precisa de nada disso: eles usam o `agy`/`opencode` instalados no sistema.

## Preparar o Debian (uma vez; se já fez para o Claude, pule)

```sh
pkg install proot-distro
proot-distro install debian
proot-distro login debian
apt update && apt install -y curl ca-certificates unzip
```

## opencode

Dentro do Debian, com o instalador oficial (`curl -fsSL https://opencode.ai/install | bash`; o binário fica em `/root/.opencode/bin/opencode`) ou por `npm i -g opencode-ai`. Depois configure um provedor (`opencode auth login`) se quiser além dos modelos grátis. Conferir, no Termux:

```sh
~/.mybots/opencode-wrapper --version
~/.mybots/opencode-wrapper models | head
```

As ferramentas do MyBots chegam ao opencode por MCP HTTP (`/mcp` do supervisor, com o token do turno na configuração do turno), então o Debian não precisa de node.

## Antigravity (agy)

Dentro do Debian: `curl -fsSL https://antigravity.google/cli/install.sh | bash` (instala em `/root/.local/bin/agy`; precisa de glibc 2.28 ou mais nova, o Debian tem) e entre com sua conta Google rodando `agy` uma vez (ele mostra um link; abra no navegador do celular). Conferir:

```sh
~/.mybots/agy-wrapper models
```

As ferramentas do MyBots chegam ao agy como servidor MCP **stdio** que o próprio agy inicia (`node supervisor/mcp/index.mjs`). Por isso, dentro do Debian é preciso ter `node` (`apt install -y nodejs`); o wrapper compartilha a pasta `~/.mybots` com o Debian no mesmo caminho e passa o token do turno por `env`. Sem node no Debian o agy conversa e usa as ferramentas dele, mas não as do MyBots.

## Como o MyBots usa

- Os dois rodam **livres** (decisão da pessoa): agy com `--dangerously-skip-permissions`, opencode com `permission: { "*": "allow" }`. No celular eles ficam dentro do Debian do proot (o terminal e os arquivos que eles tocam são os do Debian, não os do Termux); um bot sem "Mexer no computador" perde o shell e a edição no opencode.
- Trocar a IA de um bot começa uma sessão nova; o histórico salvo é enviado na primeira mensagem.
- Se o wrapper não achar o programa, o perfil mostra "Instale o Antigravity (agy)" ou "Instale o opencode".

## Se não funcionar

- agy: em alguns kernels Android/ARM com endereços de 39 bits o binário oficial falha com um erro do TCMalloc (o mesmo acontece em Chromebooks ARM). Mande a saída de `uname -a` e `getconf PAGESIZE`; páginas de 16 KB também podem dar problema.
- opencode: se `npm i -g opencode-ai` falhar no `postinstall` com `opencode-android-arm64`, use o instalador oficial dentro do Debian (não instale no Termux puro).
- Login do agy expirado: rode `proot-distro login debian -- /root/.local/bin/agy` e entre de novo.

## O que foi testado

No emulador (Android 16 x86_64, Termux + proot Debian): o opencode 1.18.30 pelo `opencode-wrapper` listou os modelos grátis, conversou, criou uma pendência pela ferramenta `task_create_item` com o cartão de aprovação e respondeu. **Não testado**: o agy no Termux (exige login Google interativo) e nenhum dos dois em ARM64 real; o PC é x86_64.
