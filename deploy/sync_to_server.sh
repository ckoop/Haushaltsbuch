#!/bin/bash
# Kopiert das Haushaltsbuch-Projekt (ohne node_modules/.git, s. .gitignore)
# auf einen anderen Server und startet dort den Container.
#
# Aufruf: ./sync_to_server.sh <user@host> <remote_pfad>
# Beispiel: ./sync_to_server.sh user@host /pfad/zum/ziel
#
# SKIP_DATA=1 ./sync_to_server.sh <user@host> <remote_pfad>
#   Ueberspringt das Kopieren von pb_data/ (PocketBase-DB) — nutzen, wenn
#   der Zielserver eine eigene, unabhaengige Datenbank hat und nur der Code
#   (+ der gebaute Frontend-Stand in pb_public/) aktualisiert werden soll
#   (sonst wird die dortige DB ueberschrieben).
#
# HOST_PORT=8091 ./sync_to_server.sh <user@host> <remote_pfad>
#   Schreibt den extern erreichbaren Port um (Standard: 8090, wie lokal) —
#   noetig, falls der Port auf dem Zielserver schon belegt ist. Wird bei
#   jedem Sync neu gesetzt, geht also bei einem erneuten Sync ohne diese
#   Variable wieder auf 8090 zurueck.
#
# Anders als beim Epoch-Projekt: kein Docker-Build (PocketBase ist ein
# fertiges Image, `ghcr.io/muchobien/pocketbase:latest`), deshalb muss
# pb_public/ (der gebaute Frontend-Stand) explizit mitkopiert werden - das
# Skript baut dafuer selbst per `npm run build` in app/ (s. u.), damit nie
# unbemerkt ein veralteter Stand auf dem Zielserver landet. Auch keine
# .env/SSL-Handhabung noetig
# (PocketBase laeuft rein ueber HTTP, keine feste Server-Adresse im Code -
# siehe CLAUDE.md), und keine Pfad-Ersetzung in der docker-compose.yml
# noetig, weil deren Bind-Mounts relativ sind (./pb_data:/pb_data etc.) und
# Docker Compose sie automatisch relativ zum Zielverzeichnis aufloest.

set -e

TARGET_HOST="${1:?Usage: $0 <user@host> <remote_pfad>}"
REMOTE_PATH="${2:?Usage: $0 <user@host> <remote_pfad>}"
REMOTE_PATH="${REMOTE_PATH%/}"   # trailing slash entfernen, falls vorhanden
HOST_PORT="${HOST_PORT:-8090}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Zielverzeichnis auf dem Server anlegen
ssh "$TARGET_HOST" "mkdir -p '$REMOTE_PATH'"

# Projekt kopieren (ohne node_modules, pb_data, pb_public, .git, deploy/ -
# die ersten drei stehen in .gitignore, die letzten beiden werden hier
# zusaetzlich ausgeschlossen und je nach Bedarf gezielt einzeln kopiert)
rsync -avz --exclude-from="$PROJECT_DIR/.gitignore" --exclude='.git' --exclude='deploy/' \
  "$PROJECT_DIR/" "$TARGET_HOST:$REMOTE_PATH/"

# Frontend frisch bauen - pb_public/ ist gitignored und wird lokal beim
# Entwickeln (`npm run dev`) nie angefasst, ein vorhandener Stand dort waere
# also fast immer veraltet. Baut deshalb bei jedem Sync neu, statt sich auf
# einen manuellen `npm run build`-Schritt davor zu verlassen.
echo "Baue Frontend (npm run build in app/)..."
npm --prefix "$PROJECT_DIR/app" run build

# Gebauter Frontend-Stand (pb_public/) - immer kopieren, da PocketBase ihn nur
# ausliefert, nie selbst baut. Ohne diesen Schritt liefe auf dem Zielserver
# der zuletzt dort vorhandene (oder gar kein) Stand.
rsync -avz --delete "$PROJECT_DIR/pb_public/" "$TARGET_HOST:$REMOTE_PATH/pb_public/"

# Datenbank kopieren (ueberspringbar via SKIP_DATA=1, s. Kopf des Skripts)
if [ "${SKIP_DATA:-0}" != "1" ]; then
  rsync -avz "$PROJECT_DIR/pb_data/" "$TARGET_HOST:$REMOTE_PATH/pb_data/"
else
  echo "SKIP_DATA=1 gesetzt — pb_data/ wird NICHT synchronisiert (Zielserver behaelt seine eigenen Daten)."
fi

# Extern erreichbaren Port umschreiben (Standard 8090, s. HOST_PORT oben).
# sed liefert bei 0 Treffern keinen Fehler (kein "set -e"-Abbruch) - darum
# hier aktiv verifizieren statt blind zu vertrauen.
ssh "$TARGET_HOST" "sed -i -E 's|^([[:space:]]*-[[:space:]]*\")[0-9]+(:8090\")|\1$HOST_PORT\2|' '$REMOTE_PATH/docker-compose.yml'"

NEW_PORT_LINE="$(ssh "$TARGET_HOST" "grep ':8090\"' '$REMOTE_PATH/docker-compose.yml'" || true)"
echo "Port-Zeile auf dem Zielserver jetzt: ${NEW_PORT_LINE:-<keine Zeile mit :8090 gefunden>}"
case "$NEW_PORT_LINE" in
  *"\"$HOST_PORT:8090\""*)
    echo "OK — Port korrekt auf $HOST_PORT gesetzt."
    ;;
  *)
    echo "WARNUNG: Port wurde NICHT wie erwartet auf $HOST_PORT gesetzt — bitte $REMOTE_PATH/docker-compose.yml auf dem Zielserver manuell pruefen."
    ;;
esac

echo
echo "Starte Container auf dem Zielserver neu..."
ssh "$TARGET_HOST" "cd '$REMOTE_PATH' && docker compose up -d"
echo "Fertig — Container auf dem Zielserver laeuft mit dem neuen Stand."
