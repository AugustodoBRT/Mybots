set -eu
umask 077
# Started by the app's keep-alive service when the supervisor stopped answering. It starts the release
# already installed by the pair script; it never installs, migrates or reads stdin.
release=$1
export MYBOTS_PAIR_PUBLIC_KEY="$2"
export MYBOTS_PAIR_DIGEST="$3"
root="$HOME/.mybots"
# The app may have been updated without being opened yet: keep the release that last ran here.
# ("tests-passed" is how versions before 0.94.17 marked an installed release.)
ready() { [ -f "$1/ready" ] || [ -f "$1/tests-passed" ]; }
if ! ready "$root/runtime/$release" && [ -f "$root/endpoint.json" ]; then
  pattern='"release":"([0-9a-f]{64})"'
  if [[ "$(cat "$root/endpoint.json")" =~ $pattern ]]; then release=${BASH_REMATCH[1]}; fi
fi
install="$root/runtime/$release"
node_bin=$(command -v node || true)
if ! ready "$install" || [ ! -x "$root/codex-wrapper" ] || [ -z "$node_bin" ]; then
  printf 'Abra o MyBots para preparar o supervisor.\n' >&2
  exit 3
fi
export CODEX_BIN="$root/codex-wrapper"
if [ -x "$root/claude-wrapper" ]; then export CLAUDE_BIN="$root/claude-wrapper"; fi
if [ -x "$root/agy-wrapper" ]; then export AGY_BIN="$root/agy-wrapper" MYBOTS_MCP_NODE=node; fi
if [ -x "$root/opencode-wrapper" ]; then export OPENCODE_BIN="$root/opencode-wrapper"; fi
export MYBOTS_HOME="$root"
export MYBOTS_RELEASE="$release"
unset MYBOTS_IMPORT || true
printf '%s reinício pelo MyBots\n' "$(date -Iseconds)" >> "$root/supervisor.log"
exec "$node_bin" "$install/supervisor/pair.mjs"
