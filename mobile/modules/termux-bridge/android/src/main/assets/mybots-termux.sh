set -eu
set -o pipefail
operation=$1
id=$2
model=${3:-}
effort=${4:-}
session=${5:-}
root="$HOME/.mybots"
directory="$root/responses"
umask 077
mkdir -p "$directory"
file="$directory/$id.json"
json_quote() {
  local value=$1 character escaped code octal
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  for ((code=1; code<32; code++)); do
    printf -v octal '%03o' "$code"
    printf -v character '%b' "\\$octal"
    printf -v escaped '\\u%04x' "$code"
    value=${value//"$character"/"$escaped"}
  done
  printf '"%s"' "$value"
}
save() { printf '%s\n' "$1" > "$file.tmp.$$"; mv -f "$file.tmp.$$" "$file"; }
running() {
  local current=${session:-}
  if [ -f "$file.session" ]; then current=$(cat "$file.session"); fi
  save "{\"requestId\":\"$id\",\"status\":\"running\",\"pid\":$$,\"deadline\":$deadline,\"codexSessionId\":\"$current\"}"
}
if [ "$operation" = recover ]; then
  offset=${model:-0}
  if [ ! -f "$file" ]; then
    value="{\"requestId\":\"$id\",\"status\":\"missing\"}"
  else
    value=$(cat "$file")
    if [[ "$value" == *'"status":"running"'* ]]; then
      pid_pattern='"pid":([0-9]+)'
      deadline_pattern='"deadline":([0-9]+)'
      if [[ "$value" =~ $pid_pattern ]]; then owner=${BASH_REMATCH[1]}; else exit 1; fi
      if [[ "$value" =~ $deadline_pattern ]]; then deadline=${BASH_REMATCH[1]}; else exit 1; fi
      if ! kill -0 "$owner" 2>/dev/null || [ "$(date +%s)" -gt "$deadline" ]; then
        current=""
        if [ -f "$file.session" ]; then current=$(cat "$file.session"); fi
        value="{\"requestId\":\"$id\",\"status\":\"error\",\"error\":\"A execução no Termux foi interrompida. Tente novamente.\",\"codexSessionId\":\"$current\"}"
        save "$value"
      fi
    fi
  fi
  chunk=${value:offset:12000}
  next=null
  if [ "$((offset + 12000))" -lt "${#value}" ]; then next=$((offset + 12000)); fi
  printf '{"chunk":%s,"nextOffset":%s}\n' "$(json_quote "$chunk")" "$next"
  exit 0
fi
[ "$operation" = reply ] || exit 1
duration=180
if [ "$effort" = max ] || [ "$effort" = ultra ]; then duration=600; fi
deadline=$(( $(date +%s) + duration + 75 ))
# Never invoke Codex twice for the same persisted request.
if ! (set -C; printf '{"requestId":"%s","status":"running","pid":%s,"deadline":%s}\n' "$id" "$$" "$deadline" > "$file") 2>/dev/null; then
  printf '{"requestId":"%s"}\n' "$id"
  exit 0
fi
work=$(mktemp -d "$root/reply.XXXXXX")
finished=false
cleanup() {
  if [ "$finished" != true ]; then
    current=$session
    if [ -f "$file.session" ]; then current=$(cat "$file.session"); fi
    save "{\"requestId\":\"$id\",\"status\":\"error\",\"error\":\"Não foi possível preparar ou concluir a resposta no Termux. Confira os logs.\",\"codexSessionId\":\"$current\"}"
  fi
  rm -rf "$work"
}
trap cleanup EXIT
# Verify the installed CLI before using its flags; keep diagnostics outside its workspace.
{
  printf 'Verificado em: '; date -Iseconds
  timeout 15s codex --version
  timeout 15s codex exec --help > "$work/exec-help"
  timeout 15s codex exec resume --help > "$work/resume-help"
  cat "$work/exec-help" "$work/resume-help"
} > "$root/environment.txt"
for flag in --ignore-user-config --ignore-rules --json --sandbox --output-last-message; do
  if ! grep -q -- "$flag" "$work/exec-help"; then printf 'Atualize o Codex: opção necessária indisponível: %s\n' "$flag" >&2; exit 1; fi
done
for flag in --json --output-last-message; do
  if ! grep -q -- "$flag" "$work/resume-help"; then printf 'Atualize o Codex: retomada incompatível: %s\n' "$flag" >&2; exit 1; fi
done
args=(exec --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only --color never --json --output-last-message "$work/reply.txt" -c 'approval_policy="never"' -c 'web_search="disabled"')
for feature in shell_tool unified_exec apps plugins hooks browser_use computer_use multi_agent code_mode_host memories view_image image_generation sleep_tool; do args+=(--disable "$feature"); done
args+=(--enable skip_host_skill_discovery --model "$model")
if [ -n "$effort" ]; then args+=(-c "model_reasoning_effort=\"$effort\""); fi
if [ -n "$session" ]; then args+=(resume "$session"); fi
args+=(-)
cd "$work"
code=0
timeout "${duration}s" codex "${args[@]}" 2> "$work/stderr" | while IFS= read -r line; do
  if [[ "$line" =~ \"type\"[[:space:]]*:[[:space:]]*\"thread.started\" ]]; then
    pattern='"thread_id"[[:space:]]*:[[:space:]]*"([0-9a-fA-F-]{36})"'
    if [[ "$line" =~ $pattern ]]; then
      found=${BASH_REMATCH[1]}
      if [ -n "$session" ] && [ "$found" != "$session" ]; then
        touch "$work/wrong-session"
      else
        printf '%s' "$found" > "$file.session"
      fi
      running
    fi
  fi
  if [[ "$line" =~ \"type\"[[:space:]]*:[[:space:]]*\"turn.completed\" ]]; then touch "$work/completed"; fi
  if [[ "$line" =~ \"type\"[[:space:]]*:[[:space:]]*\"turn.failed\" ]]; then touch "$work/failed"; fi
done || code=$?
current=$session
if [ -f "$file.session" ]; then current=$(cat "$file.session"); fi
error=""
if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then error='O Codex demorou mais que o esperado. A conversa continua disponível.'
elif [ -f "$work/wrong-session" ]; then error='O Codex abriu outra sessão. A conversa não foi retomada.'; current=$session
elif [ "$code" -ne 0 ] || [ ! -f "$work/completed" ] || [ -f "$work/failed" ] || [ -z "$current" ] || [ ! -s "$work/reply.txt" ]; then error='O Codex não confirmou uma resposta completa. Confira a conexão e o login.'
fi
if [ -n "$error" ]; then
  save "{\"requestId\":\"$id\",\"status\":\"error\",\"codexSessionId\":\"$current\",\"error\":$(json_quote "$error")}"
  cat "$work/stderr" >&2
else
  text=$(cat "$work/reply.txt")
  save "{\"requestId\":\"$id\",\"status\":\"complete\",\"codexSessionId\":\"$current\",\"model\":\"$model\",\"reasoningEffort\":$(json_quote "$effort"),\"text\":$(json_quote "$text")}"
fi
finished=true
printf '{"requestId":"%s"}\n' "$id"
