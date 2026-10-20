# Claude Code no Termux

O Codex tem pacote no Termux (`pkg install codex`) porque é código aberto e o Termux o compila para Android. O Claude Code não tem: desde a versão 2.1.113 o pacote npm traz apenas binários Linux (glibc/musl), que não rodam direto no Android. A forma suportada é um Debian dentro do Termux com o instalador oficial.

## Instalar (uma vez)

No Termux:

```sh
pkg update
pkg install proot-distro
proot-distro install debian
proot-distro login debian
```

Agora dentro do Debian (o prompt muda para `root@localhost`):

```sh
apt update && apt install -y curl ca-certificates
curl -fsSL https://claude.ai/install.sh | bash
~/.local/bin/claude
```

Na primeira abertura, escolha o tema e faça o login com a sua conta Claude: ele mostra um link, abra no navegador do celular, autorize e cole o código de volta no terminal. Depois digite `/exit` e `exit` para voltar ao Termux.

## Conferir

No Termux (fora do Debian):

```sh
proot-distro login debian -- /root/.local/bin/claude auth status --text
```

Deve dizer que está conectado. No MyBots, abra **Backup e diagnóstico → Ver diagnóstico**: aparece a linha `Claude Code: Claude conectado`. No perfil de um bot surge o campo **IA** com Codex e Claude.

## Como o MyBots usa

- O supervisor chama `~/.mybots/claude-wrapper`. Ele usa um `claude` nativo se existir no PATH; senão, procura `/root/.local/bin/claude` em qualquer container do proot-distro (layout novo `containers/<nome>/rootfs` da v5 e o antigo `installed-rootfs/<nome>`) e roda `proot-distro login <nome> -- /root/.local/bin/claude`.
- As ferramentas próprias do Claude (terminal, arquivos, web) ficam desligadas com `--tools ""`. O bot só enxerga `mybots-tools`, por MCP HTTP em `127.0.0.1`, com as mesmas permissões e aprovações do Codex.
- Configurações pessoais do Claude (`~/.claude/settings.json`, hooks, plugins, MCPs seus) são ignoradas nas conversas do MyBots (`--setting-sources ""`, `--strict-mcp-config`).
- Trocar a IA de um bot começa uma sessão nova; o histórico salvo é enviado na primeira mensagem.

## Se não funcionar

- `Claude Code não encontrado`: confira o caminho `/root/.local/bin/claude` dentro do Debian.
- Erro ao abrir o binário dentro do Debian (por exemplo `Illegal instruction` ou falha de página de memória): mande a saída de `uname -a` e `getconf PAGESIZE` do Termux. Alguns kernels Android novos usam páginas de 16 KB, que o binário pode não aceitar.
- Login expirado: rode `~/.local/bin/claude` dentro do Debian e use `/login`.
