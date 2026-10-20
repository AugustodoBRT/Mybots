set -eu
umask 077
operation=$1
root="$HOME/.mybots"
mkdir -p "$root/backup"
json_quote() {
  local value=$1 character escaped code octal
  value=${value//\\/\\\\}; value=${value//\"/\\\"}
  for ((code=1; code<32; code++)); do
    printf -v octal '%03o' "$code"; printf -v character '%b' "\\$octal"
    printf -v escaped '\\u%04x' "$code"; value=${value//"$character"/"$escaped"}
  done
  printf '"%s"' "$value"
}
case "$operation" in
  backupPart)
    id=$2; index=$3
    [[ "$id" =~ ^[0-9a-fA-F-]{36}$ ]] && [[ "$index" =~ ^[0-9]+$ ]] && [ "$index" -lt 2000 ] || exit 1
    upload="$root/backup/.upload-$id"
    mkdir -p "$upload"
    printf -v part '%08d' "$index"
    cat > "$upload/$part.tmp"
    mv "$upload/$part.tmp" "$upload/$part"
    printf '{}\n'
    ;;
  backupFinish)
    id=$2; count=$3
    [[ "$id" =~ ^[0-9a-fA-F-]{36}$ ]] && [[ "$count" =~ ^[0-9]+$ ]] && [ "$count" -gt 0 ] && [ "$count" -le 2000 ] || exit 1
    upload="$root/backup/.upload-$id"
    name="mybots-$(date -u +%Y%m%dT%H%M%SZ)-$id.json"
    temporary="$root/backup/.$name.tmp"
    trap 'rm -f "$temporary"' EXIT
    for ((index=0; index<count; index++)); do
      printf -v part '%08d' "$index"
      [ -f "$upload/$part" ] || exit 1
      cat "$upload/$part"
    done > "$temporary"
    [ -s "$temporary" ] || exit 1
    mv "$temporary" "$root/backup/$name"
    rm -rf "$upload"
    printf '{"name":"%s","path":%s}\n' "$name" "$(json_quote "$root/backup/$name")"
    ;;
  backupList)
    printf '['
    separator=''
    for path in "$root"/backup/mybots-*.json; do
      [ -f "$path" ] || continue
      printf '%s%s' "$separator" "$(json_quote "${path##*/}")"
      separator=','
    done
    printf ']\n'
    ;;
  backupRead)
    name=$2; offset=$3
    [[ "$name" =~ ^mybots-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F-]{36}\.json$ ]] || exit 1
    [[ "$offset" =~ ^[0-9]+$ ]] && [ "$offset" -le 20000000 ] || exit 1
    value=$(cat "$root/backup/$name")
    chunk=${value:offset:12000}; next=null
    if [ "$((offset + 12000))" -lt "${#value}" ]; then next=$((offset + 12000)); fi
    printf '{"chunk":%s,"nextOffset":%s}\n' "$(json_quote "$chunk")" "$next"
    ;;
  environment)
    report=$(mktemp "$root/environment.XXXXXX")
    trap 'rm -f "$report"' EXIT
    {
      printf 'Verificado em: '; date -Iseconds
      printf '\nCodex: '; timeout 15s codex --version || printf 'indisponível\n'
      printf '\nNode: '
      if command -v node >/dev/null 2>&1; then
        node -v
        printf 'node:sqlite: '; node -e 'try { require("node:sqlite"); console.log("disponível"); } catch { console.log("indisponível"); }'
      else printf 'não encontrado no ambiente do Termux\n'; fi
      printf '\nApp-server: o catálogo de modelos utiliza app-server; confira o resultado da conexão no app.\n'
      if [ -f "$root/environment.txt" ]; then
        printf '\nVersão e ajuda registradas pelo executor:\n'
        head -c 14000 "$root/environment.txt"
      fi
    } > "$report" 2>&1
    cp "$report" "$root/diagnostico.txt"
    printf '{"report":%s}\n' "$(json_quote "$(cat "$report")")"
    ;;
  *) exit 1 ;;
esac
