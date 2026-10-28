#!/usr/bin/env bash
set -euo pipefail
project=$(cd "$(dirname "$0")/../.." && pwd)
classes="$project/mobile/modules/termux-bridge/android/build/tmp/kotlin-classes/release"
json=$(find "$project/.build-tools/gradle/caches/modules-2/files-2.1/org.json/json" -name '*.jar' -print -quit)
kotlin=$(find "$project/.build-tools/gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib" -name '*.jar' -print -quit)
if [ ! -f "$classes/expo/modules/termuxbridge/WalletGuard.class" ] || [ -z "$json" ] || [ -z "$kotlin" ]; then
  echo 'Compile antes :mybots-termux-bridge:compileReleaseKotlin com o Gradle do projeto.' >&2; exit 1
fi
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
classpath="$test_dir:$classes:$json:$kotlin"
javac -cp "$classpath" -d "$test_dir" "$project/tests/native-wallet-guard/android/content/Context.java" "$project/tests/native-wallet-guard/android/content/SharedPreferences.java" "$project/tests/native-wallet-guard/WalletGuardTest.java"
java -cp "$classpath" WalletGuardTest
