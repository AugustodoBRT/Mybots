set -eu
umask 077
release=$1
backup=${2:-}
export MYBOTS_PAIR_PUBLIC_KEY="$3"
export MYBOTS_PAIR_DIGEST="$4"
root="$HOME/.mybots"
mkdir -p "$root"
archive=$(mktemp "$root/supervisor.XXXXXX.tar.gz")
trap 'rm -f "$archive"' EXIT
# Packages larger than one RUN_COMMAND arrive first as parts in staging/<hash>; the hash check below covers the joined file.
# Termux leaves stdin open when no stdin extra is sent, so a staged pairing must never read it.
staging="$root/staging/$release"
if [ "${5:-}" = staged ]; then
  [ -d "$staging" ] || { printf 'As partes do pacote do supervisor não chegaram. Tente novamente.\n' >&2; exit 1; }
  cat "$staging"/[0-9][0-9][0-9][0-9] > "$archive"
else base64 -d > "$archive"; fi
actual=$(sha256sum "$archive"); actual=${actual%% *}
[ "$actual" = "$release" ] || { rm -rf "$staging"; printf 'O pacote do supervisor está incompleto. Tente novamente.\n' >&2; exit 1; }
rm -rf "$root/staging"
# Runtime selection is made against the real Termux, before opening or migrating the database.
node_bin=$(command -v node || true)
if [ -z "$node_bin" ] || ! "$node_bin" -e 'require("node:sqlite")' >/dev/null 2>&1; then
  printf 'Preparando Node.js no Termux...\n' >&2
  command -v pkg >/dev/null 2>&1 || { printf 'Node não encontrado. Instale nodejs-lts no Termux.\n' >&2; exit 1; }
  pkg install -y nodejs-lts >&2
  node_bin="$PREFIX/bin/node"
fi
{
  "$node_bin" -v &&
  "$node_bin" -e 'const { DatabaseSync } = require("node:sqlite"); const db=new DatabaseSync(":memory:"); console.log("SQLite nativo disponível"); db.close();' &&
  codex --version &&
  codex exec --help &&
  codex exec resume --help &&
  codex features list
} > "$root/ambiente-supervisor.txt" 2>&1 || { printf 'O supervisor precisa de Node 22.13 ou mais novo com node:sqlite e do Codex instalado. Confira ~/.mybots/ambiente-supervisor.txt.\n' >&2; exit 1; }
install="$root/runtime/$release"
if [ ! -f "$install/supervisor/index.mjs" ]; then
  mkdir -p "$install"
  tar -xzf "$archive" -C "$install"
fi
if [ ! -f "$install/tests-passed" ]; then
  "$node_bin" --test --test-timeout=15000 "$install/tests/supervisor.test.mjs" "$install/tests/tools.test.mjs" "$install/tests/claude.test.mjs" "$install/tests/routines.test.mjs" "$install/tests/apps.test.mjs" "$install/tests/access.test.mjs" > "$root/testes-supervisor.txt" 2>&1 || {
    printf 'Os testes do supervisor não passaram neste aparelho. Confira ~/.mybots/testes-supervisor.txt. Seus dados foram preservados.\n' >&2
    exit 1
  }
  touch "$install/tests-passed"
fi
if [ -n "$backup" ]; then
  [[ "$backup" =~ ^mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F-]{36}\.json$ ]] || exit 1
  export MYBOTS_IMPORT="$root/backup/$backup"
else unset MYBOTS_IMPORT || true; fi
{
  printf '#!%s\n' "$BASH"
  cat <<'WRAPPER'
exec bash -lc 'cd -- "$1"; shift; codex "$@"' mybots "$PWD" "$@"
WRAPPER
} > "$root/codex-wrapper"
chmod 700 "$root/codex-wrapper"
export CODEX_BIN="$root/codex-wrapper"
{
  printf '#!%s\n' "$BASH"
  cat "$install/supervisor/claude-wrapper.sh"
} > "$root/claude-wrapper"
chmod 700 "$root/claude-wrapper"
export CLAUDE_BIN="$root/claude-wrapper"
"$CLAUDE_BIN" --version >> "$root/ambiente-supervisor.txt" 2>&1 || printf 'Claude Code: não encontrado\n' >> "$root/ambiente-supervisor.txt"
export MYBOTS_HOME="$root"
export MYBOTS_RELEASE="$release"
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock >/dev/null 2>&1 || true; fi
rm -f "$archive"
trap - EXIT
exec "$node_bin" "$install/supervisor/pair.mjs"
