#!/usr/bin/env bash
set -euo pipefail
project=$(cd "$(dirname "$0")/.." && pwd)
export ANDROID_HOME="$project/.build-tools/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$project/.build-tools/gradle"
if [ -d "$GRADLE_USER_HOME/jdks" ]; then
  cached_jdk=$(find "$GRADLE_USER_HOME/jdks" -mindepth 1 -maxdepth 1 -type d -name '*17*' -print -quit)
  if [ -n "$cached_jdk" ]; then export JAVA_HOME="$cached_jdk"; fi
fi
if [ ! -d "$ANDROID_HOME/platforms/android-36" ]; then
  echo 'SDK Android não encontrado em .build-tools/android-sdk.' >&2
  exit 1
fi
node "$project/scripts/package-connectors.mjs"
node "$project/scripts/package-supervisor.mjs"
"$project/scripts/runtime/stage.sh" arm64-v8a
cd "$project/mobile/android"
status=0
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain "$@" || status=$?
# The Gradle daemons keep ~2.8 GB of memory after a build; nothing else needs them, so they stop with it.
./gradlew --stop >/dev/null 2>&1 || true
exit $status
