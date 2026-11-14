set -eu
umask 077
release=$1
backup=${2:-}
export MYBOTS_PAIR_PUBLIC_KEY="$3"
export MYBOTS_PAIR_DIGEST="$4"
root="$HOME/.mybots"
mkdir -p "$root"
archive=$(mktemp "$root/supervisor.XXXXXX")
trap 'rm -f "$archive"' EXIT
# Large packages arrive first as parts in staging/<hash>; the hash check below covers the joined file.
# A staged pairing never reads stdin (nothing is sent there).
staging="$root/staging/$release"
if [ "${5:-}" = staged ]; then
  [ -d "$staging" ] || { printf 'As partes do pacote do supervisor não chegaram. Tente novamente.\n' >&2; exit 1; }
  cat "$staging"/[0-9][0-9][0-9][0-9] > "$archive"
else base64 -d > "$archive"; fi
actual=$(sha256sum "$archive"); actual=${actual%% *}
[ "$actual" = "$release" ] || { rm -rf "$staging"; printf 'O pacote do supervisor está incompleto. Tente novamente.\n' >&2; exit 1; }
rm -rf "$root/staging"
# The phone's Linux (in the APK) carries Node; checked before opening or migrating the database.
node_bin=$(command -v node || true)
[ -n "$node_bin" ] || { printf 'Node não encontrado no Linux do MyBots. Reinstale o app.\n' >&2; exit 1; }
{
  "$node_bin" -v &&
  "$node_bin" -e 'const { DatabaseSync } = require("node:sqlite"); const db=new DatabaseSync(":memory:"); console.log("SQLite nativo disponível"); db.close();'
} > "$root/ambiente-supervisor.txt" 2>&1 || { printf 'O supervisor precisa de Node 22.13 ou mais novo com node:sqlite. Confira ~/.mybots/ambiente-supervisor.txt.\n' >&2; exit 1; }
install="$root/runtime/$release"
if [ ! -f "$install/supervisor/index.mjs" ]; then
  mkdir -p "$install"
  tar -xzf "$archive" -C "$install"
fi
# The phone's Linux and this package ship together in the APK and were tested when it was built: mark it ready for restarts.
touch "$install/ready"
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
# Antigravity and opencode: wrapped like Claude.
for tool in agy opencode; do
  {
    printf '#!%s\n' "$BASH"
    cat "$install/supervisor/$tool-wrapper.sh"
  } > "$root/$tool-wrapper"
  chmod 700 "$root/$tool-wrapper"
done
export AGY_BIN="$root/agy-wrapper" OPENCODE_BIN="$root/opencode-wrapper" MYBOTS_MCP_NODE=node
"$AGY_BIN" --version >> "$root/ambiente-supervisor.txt" 2>&1 || printf 'Antigravity: não encontrado\n' >> "$root/ambiente-supervisor.txt"
"$OPENCODE_BIN" --version >> "$root/ambiente-supervisor.txt" 2>&1 || printf 'opencode: não encontrado\n' >> "$root/ambiente-supervisor.txt"
export MYBOTS_HOME="$root"
export MYBOTS_RELEASE="$release"
rm -f "$archive"
trap - EXIT
exec "$node_bin" "$install/supervisor/pair.mjs"
