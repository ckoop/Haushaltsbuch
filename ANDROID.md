# Android-App

Dieselbe App wie der Docker-Container, als eigenständige Android-App: Capacitor-Hülle, Daten in einer lokalen SQLite-Datenbank auf dem Gerät, kein Server, kein Login. Die Codebasis ist `app/` — nur das Backend dahinter unterscheidet sich (`app/src/backend/`, Details in [app/CLAUDE.md](app/CLAUDE.md)).

**Kein Sync zwischen App und Server.** Beide haben eigene Daten. Umziehen geht über die JSON-Sicherung (Einstellungen → Sichern/Wiederherstellen): das Dateiformat ist dasselbe, eine Android-Sicherung lässt sich im Server einspielen und umgekehrt. Bereiche, die in der Datei fehlen, bleiben beim Einspielen unverändert.

## APK bauen

Voraussetzungen: Node, JDK 21, Android SDK (`ANDROID_HOME`). Aus `app/`:

```bash
npm install
npm run android:apk      # Frontend bauen, in die Hülle kopieren, Release-APK bauen
```

Ergebnis: `app/android/app/build/outputs/apk/release/app-release.apk`. Einzelschritte: `npm run build:android` (nur Frontend nach `app/dist/`), `npm run android:sync` (zusätzlich `cap sync`). Für den Debug-Build ohne Schlüssel reicht `./gradlew assembleDebug` in `app/android/`.

Installieren auf einem angeschlossenen Gerät:

```bash
adb install -r app/android/app/build/outputs/apk/release/app-release.apk
```

## Signierschlüssel

Release-Builds werden mit `app/android/keystore/release.keystore` signiert; Zugangsdaten in `app/android/keystore.properties`. **Beide Dateien sind per `.gitignore` ausgeschlossen und liegen nur lokal — sichern!** Mit einem anderen Schlüssel signierte Builds lassen sich nicht über eine installierte Fassung drüberinstallieren (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); dann erst in der alten App eine Sicherung machen, deinstallieren, neu installieren, einspielen. Ohne die Dateien baut nur der Debug-Build.

## Version

`versionName` kommt aus `app/package.json`, `versionCode` wird daraus abgeleitet (`MAJOR·10000 + MINOR·100 + PATCH`, `app/android/app/build.gradle`) — eine Versionsnummer für Server und App.

## Datenbank-Schema

SQLite-Schema und Migrationen: `app/src/backend/sqlite-db.js` (Version über `PRAGMA user_version`). Es muss zu `setup/schema.mjs` (PocketBase) passen — neue Felder in **beiden** Welten anlegen, s. Arbeitsweise in [CLAUDE.md](CLAUDE.md).

## Depot-Kurse

Die App fragt Yahoo Finance direkt über das native HTTP-Plugin von Capacitor ab (kein CORS-Problem auf dem Gerät, kein Proxy). Das ist die einzige Funktion mit Internetzugriff; ohne Netz bleiben die Kurse leer.

## F-Droid (offen)

`.fdroid.yml` im Repo-Root stammt aus dem alten Repo und ist **noch nicht angepasst**: Quell-URL, `commit`, `subdir` (jetzt `app/android`), die Init-Zeile (`cd ../.. `/ `app`) und die Beschreibung („komplett offline" stimmt wegen des Depots nicht mehr — vermutlich Anti-Feature `NonFreeNet`). Erst anpassen, wenn F-Droid wieder aufgenommen wird.
