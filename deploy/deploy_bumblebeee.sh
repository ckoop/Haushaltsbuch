#!/bin/bash
# Deployt Haushaltsbuch auf den zweiten Server (bumblebeee@192.168.178.55).
# Port 8090 ist dort frei (anders als bei Epoch, das wegen 3000 auf 8030
# ausweichen musste) - deshalb kein HOST_PORT-Override noetig. Ueberspringt
# den DB-Sync (SKIP_DATA=1), damit die eigenstaendigen Buchungen auf dem
# Zielserver erhalten bleiben.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_DATA=1 "$SCRIPT_DIR/sync_to_server.sh" bumblebeee@192.168.178.55 /home/bumblebeee/docker/haushaltsbuch
