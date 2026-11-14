# Shared paths for the emulator helpers (sourced, not run).
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
export ANDROID_HOME="$ROOT/.build-tools/android-sdk" ANDROID_SDK_ROOT="$ROOT/.build-tools/android-sdk" ANDROID_AVD_HOME="$ROOT/.build-tools/avd"
export GRADLE_USER_HOME="$ROOT/.build-tools/gradle"
jdk=$(find "$GRADLE_USER_HOME/jdks" -mindepth 1 -maxdepth 1 -type d -name '*17*' -print -quit 2>/dev/null); [ -n "$jdk" ] && export JAVA_HOME="$jdk"
ADB="$ANDROID_HOME/platform-tools/adb"
STATE="$ROOT/.build-tools/emulator-state"; mkdir -p "$STATE"
# The app's own Linux: /root inside is files/runtime/home (readable by adb run-as on the emulator's debuggable build).
APP=com.mybots.app
APPHOME=files/runtime/home
