#!/bin/bash
# Baut beide Ziele, wenn sich Quellen seit dem letzten erfolgreichen Lauf
# geaendert haben, und legt die APK ab:
#   1. Tests (vitest) - ein roter Test bricht ab, es wird nichts gebaut
#   2. Server-Frontend -> pb_public/ (der lokale Docker-Container liefert es
#      direkt aus; der Container selbst wird nur bei geaenderten pb_hooks
#      neu gestartet, weil PocketBase die nur beim Start liest)
#   3. Android: signierte Release-APK -> $HB_APK_DIR/haushaltsbuch-<version>.apk
#      und haushaltsbuch-latest.apk (Standard: ~/haushaltsbuch-apk)
# Deployt NICHT auf bumblebeee - das bleibt deploy/deploy_bumblebeee.sh auf Zuruf.
#
# Aufruf: scripts/build_all.sh [--force]. Wird vom Stop-Hook in
# .claude/settings.json nach jeder Claude-Antwort gerufen; ohne Aenderung
# endet es sofort und still.

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
STAMP="$ROOT/.build-stamp"
APK_DIR="${HB_APK_DIR:-$HOME/haushaltsbuch-apk}"
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk-21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

# Hook-Aufruf: stdin ist JSON; stop_hook_active heisst "Claude laeuft wegen
# eines Hook-Fehlers weiter" - dann nicht nochmal blockieren (Endlosschleife).
HOOK_ACTIVE=false
if [ ! -t 0 ]; then
  HOOK_ACTIVE="$(cat | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
fi

exec 9>"$ROOT/.build.lock"
flock -n 9 || exit 0   # laeuft schon

fingerprint() {   # Inhalt aller bauwirksamen Quellen, ohne Build-Ausgaben
  (
    find app/src app/public app/android/app/src/main/java app/android/app/src/androidTest pb_hooks -type f -print0 2>/dev/null
    for f in app/package.json app/package-lock.json app/vite.config.js app/index.html \
             app/capacitor.config.json app/android/app/build.gradle app/android/build.gradle \
             app/android/variables.gradle app/android/app/src/main/AndroidManifest.xml; do
      [ -f "$f" ] && printf '%s\0' "$f"
    done
  ) | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}
hooks_fp() { find pb_hooks -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1; }

NOW="$(fingerprint)"; NOW_HOOKS="$(hooks_fp)"
OLD="$(sed -n 1p "$STAMP" 2>/dev/null)"; OLD_HOOKS="$(sed -n 2p "$STAMP" 2>/dev/null)"
if [ "$1" != "--force" ] && [ "$NOW" = "$OLD" ]; then exit 0; fi

LOG="$(mktemp)"
fail() {   # $1 = Schritt
  msg="Build fehlgeschlagen ($1). Letzte Zeilen:"$'\n'"$(tail -n 15 "$LOG")"
  if [ "$HOOK_ACTIVE" = true ]; then
    jq -n --arg m "$msg" '{systemMessage: $m}'
  else
    jq -n --arg m "$msg" '{decision: "block", reason: ($m + "\nBitte beheben; gebaut wird beim naechsten Stopp erneut.")}'
  fi
  exit 0
}

cd "$ROOT/app" || exit 1
{ npm test 2>&1; } >"$LOG" || fail "Tests"
{ npm run build 2>&1; } >"$LOG" || fail "Server-Frontend"
{ npm run android:apk 2>&1; } >"$LOG" || fail "Android-APK"

VERSION="$(jq -r .version package.json)"
SRC="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$SRC" ] || { echo "APK nicht gefunden: $SRC" >"$LOG"; fail "APK ablegen"; }
mkdir -p "$APK_DIR"
cp "$SRC" "$APK_DIR/haushaltsbuch-$VERSION.apk"
cp "$SRC" "$APK_DIR/haushaltsbuch-latest.apk"

NOTE=""
if [ "$NOW_HOOKS" != "$OLD_HOOKS" ] && docker inspect haushaltsbuch >/dev/null 2>&1; then
  docker restart haushaltsbuch >/dev/null 2>&1 && NOTE=", Container neu gestartet (pb_hooks geaendert)"
fi

printf '%s\n%s\n' "$NOW" "$NOW_HOOKS" >"$STAMP"
jq -n --arg m "Gebaut $VERSION: Tests ok, Server-Frontend in pb_public$NOTE, APK: $APK_DIR/haushaltsbuch-$VERSION.apk" '{systemMessage: $m}'
