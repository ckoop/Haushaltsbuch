# Haushaltsbuch — Betrieb

Technische Referenz für Aufsetzen und Administration. Für den Überblick über
Funktionen und eine kurze Installationsanleitung siehe [README.md](README.md).

Ein Container im Heimnetz: PocketBase liefert Datenbank, Login, REST-API und
das Web-Frontend aus. Kein Reverse Proxy, kein Zertifikat, keine Domain.
Von unterwegs kommst du per WireGuard ins Heimnetz und rufst dieselbe Adresse
auf wie zu Hause.

## Einrichten

```bash
mkdir -p pb_data pb_public
docker compose up -d
```

Beim ersten Aufruf von `http://<server-ip>:8090/_/` legst du das
Superuser-Konto an. Danach das Schema erzeugen:

```bash
npm i pocketbase
PB_URL=http://<server-ip>:8090 \
PB_EMAIL=du@example.de \
PB_PASSWORD=... \
node setup/schema.mjs
```

Das Skript ist wiederholbar — vorhandene Sammlungen lässt es in Ruhe.

Zum Schluss unter *Collections → users* die Logins für die Haushaltsmitglieder
anlegen und die offene Registrierung abschalten (`createRule` leeren). Sonst
kann sich jeder, der die Domain kennt, selbst ein Konto anlegen.

### Frontend

```bash
cd app
npm install
npm run build          # baut direkt nach ../pb_public
```

Danach ist die App unter `http://<server-ip>:8090` erreichbar. Zum Entwickeln:

```bash
PB_DEV_URL=http://<server-ip>:8090 npm run dev
```

Beim ersten Anmelden bietet die App an, elf übliche Kategorien und ein
Girokonto anzulegen.

## CSV-Import

Unter *Konten → CSV-Datei importieren*, in drei Schritten: Datei wählen,
Spalten zuordnen, Vorschau prüfen. Kodierung, Trennzeichen, Kopfzeile und
Spaltenzuordnung werden geraten — bei den meisten deutschen Bank-Exporten
musst du nichts anfassen.

Die Vorschau zeigt drei Zahlen: neu, schon vorhanden, unlesbar. Sind viele
Zeilen unlesbar, stimmt fast immer das Datumsformat oder das
Dezimaltrennzeichen nicht. Ein Schritt zurück, umstellen, nochmal.

Jeder Lauf wird protokolliert und lässt sich vollständig zurücknehmen. Der
Dedup-Hash verhindert, dass dieselbe Buchung beim zweiten Import doppelt
landet — er wird bewusst ohne `crypto.subtle` berechnet, weil das im
unverschlüsselten Heimnetz nicht zur Verfügung steht.

## Zugriffsmodell

Alle Sammlungen benutzen dieselbe Regel: `@request.auth.id != ""`. Wer
angemeldet ist, sieht alles. Der Haushalt ist die Zugriffsgrenze, nicht die
einzelne Person — genau das willst du, wenn zwei Leute dieselbe Haushaltskasse
führen. Eine Trennung pro Nutzer wäre hier zusätzlicher Aufwand ohne Nutzen.

Die Admin-Oberfläche unter `/_/` ist im Heimnetz für jeden erreichbar, der die
Server-IP kennt. Wenn dir das zu offen ist, binde den Port in der
`docker-compose.yml` auf `127.0.0.1` und geh über einen SSH-Tunnel drauf.

## Ohne HTTPS im Heimnetz

Über `http://192.168.x.x:8090` bist du nicht in einem sicheren Kontext. Das
hat eine praktische Folge: Service Worker laufen nicht, die App lässt sich also
nicht als echte PWA installieren und nichts wird für offline zwischengelagert.
Als normale Seite im Browser funktioniert sie vollständig, und ein Icon auf dem
Startbildschirm kannst du trotzdem ablegen.

Wenn dich das später stört, ist der einfachste Weg Tailscale: du bekommst einen
Hostnamen mit gültigem Zertifikat, ohne selbst etwas auszustellen.

## Sammlungen

| Sammlung | Zweck |
|---|---|
| `accounts` | Konten mit Art und Anfangssaldo |
| `categories` | Kategorien, getrennt nach Ausgabe und Einnahme |
| `transactions` | Buchungen und Umbuchungen |
| `budgets` | Monatslimit je Kategorie |
| `import_profiles` | Spaltenzuordnung je Bank, einmal einrichten |
| `imports` | Protokoll je Importlauf, macht Rückgängigmachen möglich |
| `rules` | Textmuster → Kategorie, für automatische Zuordnung |
| `recurring_rules` | Daueraufträge, erzeugen künftige Buchungen automatisch |
| `depot_positions` | Wertpapiere im Depot (ISIN, Name, Yahoo-Ticker) |
| `depot_trades` | Kauf-/Verkaufstrades je Position |
| `people` | Personen als reines Label an Konten, kein eigener Login |

### Entscheidungen, die im Schema stecken

**Beträge als `amount_cents`, ganzzahlig.** Fließkomma summiert sich falsch auf.
34,82 € steht als `3482` in der Datenbank.

**Umbuchungen sind eine Zeile**, nicht zwei. `type = "transfer"`, `account` ist
die Quelle, `to_account` das Ziel. Sie fallen aus Einnahmen, Ausgaben und
Budgets heraus — Geld zwischen eigenen Konten ist kein Umsatz.

**`import_hash` mit teilweise eindeutigem Index.** Der Hash aus Datum, Betrag
und Verwendungszweck verhindert, dass dieselbe Buchung beim zweiten Import
doppelt landet. Der Index gilt nur für nicht-leere Werte, sonst könntest du
keine zwei Buchungen von Hand erfassen.

**`import_batch` als Relation.** Jede importierte Zeile weiß, aus welchem Lauf
sie stammt. Damit kannst du einen misslungenen Import komplett zurücknehmen,
statt 200 Zeilen einzeln zu suchen.

**`budgets.month` ist Text.** `"2026-08"` für einen einzelnen Monat, `"*"` als
Dauerbudget. So musst du nicht jeden Monat alles neu anlegen.

**`transactions.recurring` markiert Wiederkehrendes** (`monthly`/`quarterly`/
`yearly`, leer = nein). Erzeugt keine künftigen Buchungen automatisch, macht
nur bereits erfasste Zeilen in der Buchungsliste und in der Auswertung
kenntlich.

⚠️ Auf einer bestehenden Instanz legt `setup/schema.mjs` dieses Feld **nicht**
automatisch nach — das Skript überspringt Sammlungen, die schon existieren.
Einmalig manuell ergänzen: Admin-Oberfläche → *Collections* → `transactions`
→ Feld hinzufügen → *Select*, Name `recurring`, Werte `monthly`/`quarterly`/
`yearly`, nicht required.

**`rules.tags` lässt eine automatische Zuordnung zusätzlich zur Kategorie
auch Tags setzen** (Mehrfachauswahl-Relation, gleiches Muster wie
`transactions.tags`). Trifft eine Regel beim CSV-Import, bekommt die
Buchung die dort hinterlegten Tags automatisch mit.

⚠️ Gleiches Problem wie oben: `setup/schema.mjs` patcht dieses Feld auf
einer bestehenden Instanz **nicht** automatisch nach. Einmalig manuell
ergänzen: Admin-Oberfläche → *Collections* → `rules` → Feld hinzufügen →
*Relation*, Name `tags`, Ziel-Sammlung `tags`, Mehrfachauswahl, nicht
required. Ohne dieses Feld läuft die App weiter, PocketBase verwirft das
`tags`-Feld beim Speichern einer Regel einfach kommentarlos — die Regel
selbst (Textmuster, Kategorie, Priorität) wird trotzdem gesichert.

**`recurring_rules` erzeugt echte Buchungen automatisch**, anders als das
`recurring`-Feld oben. Client-getriggert: Beim Öffnen der App wird geprüft,
ob fällige Daueraufträge offen sind, und nachgebucht — kein Server-Cron,
die App muss also ab und zu geöffnet werden. Wer länger nicht öffnet, bekommt
die fehlenden Perioden beim nächsten Mal gesammelt nachgetragen.

⚠️ Da `recurring_rules` eine **komplett neue Sammlung** ist (nicht nur ein
Feld), lohnt sich hier statt manueller Admin-UI-Klickerei das Setup-Skript
erneut auszuführen — es überspringt automatisch alles Bestehende und legt
nur die fehlende Sammlung neu an:

```bash
npm i pocketbase
PB_URL=http://<server-ip>:8090 PB_EMAIL=du@example.de PB_PASSWORD=... \
  node setup/schema.mjs
```

**Depot: erste Sammlung mit externem Netzzugriff.** `depot_positions` und
`depot_trades` sind eine komplett neue Sammlungspaar wie `recurring_rules`
oben — dasselbe Setup-Skript erneut ausführen, um sie nachzuziehen:

```bash
npm i pocketbase
PB_URL=http://<server-ip>:8090 PB_EMAIL=du@example.de PB_PASSWORD=... \
  node setup/schema.mjs
```

⚠️ Dazu kommt eine echte Infrastrukturänderung, kein reines Schema-Update:
`docker-compose.yml` mountet jetzt zusätzlich `./pb_hooks:/pb_hooks`. Auf
einer bestehenden Instanz nach `git pull` einmalig `docker compose up -d`
ausführen, damit der Container neu erzeugt wird und den Mount übernimmt
(ein reiner Neustart reicht nicht, Docker liest Volume-Definitionen nur bei
der Container-Erstellung).

In `pb_hooks/main.pb.js` liegt eine einzelne Route (`GET /api/depot/quote`),
die Kurse bei Yahoo Finance abruft und ans Frontend weiterreicht — Yahoo
liefert kostenlos und ohne API-Key, setzt aber keinen
`Access-Control-Allow-Origin`-Header, ein `fetch()` direkt aus dem Browser
scheitert deshalb an CORS. Die Route läuft stattdessen serverseitig (kein
CORS-Problem dort) und ist über `$apis.requireAuth()` genauso zugriffsgeschützt
wie alle Sammlungen (`wer angemeldet ist, sieht alles`). Bewusst **kein**
Cron/Scheduler: die Route wird nur aufgerufen, wenn die App tatsächlich einen
Kurs braucht (Depot-Tab geöffnet, "Aktualisieren" geklickt) — erstmalig ein
Bruch mit der bisherigen "kein `pb_hooks`"-Haltung des Projekts, aber
inhaltlich derselbe "nur bei Bedarf, nie im Hintergrund"-Ansatz wie bei den
Daueraufträgen.

Damit ist das Depot die **einzige Funktion der App, die das Internet
braucht** — alles andere läuft rein im Heimnetz. Ohne Internetzugang vom
Docker-Container aus bleiben Depot-Kurse einfach leer, der Rest der App ist
unberührt.

Bewusste Vereinfachung: Bestand und Einstandspreis laufen nach der
**Durchschnittsmethode** (kein FIFO/LIFO) — für ein privates Depot
nachvollziehbar genug.

**Bestehenden Bestand erfassen** (z. B. beim erstmaligen Anlegen einer
Position, deren Aktien du schon länger hältst): kein eigenes Feld dafür
nötig — einfach ein einzelner "Kauf"-Trade mit der aktuellen
Gesamtstückzahl und deinem Ø-Einstandspreis, Datum nach Wahl (z. B. dein
tatsächliches erstes Kaufdatum, wenn du es kennst — das bestimmt auch, ab
wann die Position im Verlaufs-Chart unten auftaucht).

**Trade-Preise sind immer Euro** — der Preis, den man tatsächlich gezahlt
hat, unabhängig davon, an welcher Börse und in welcher Währung das
Wertpapier notiert. Der Trade-Editor beschriftet die Felder entsprechend
("Kurs pro Stück (in Euro)").

**Währungsumrechnung** (ab `0.19.1`, korrigiert nach einem Bug in
`0.19.0`) betrifft deshalb ausschließlich den *Live-Kurs*: wenn der
aufgelöste Ticker nicht in Euro notiert (z. B. wenn "Ticker suchen" die
Londoner USD- statt die Xetra-Euro-Notierung trifft), wird nur dieser
eine Wert in Euro umgerechnet und dem Euro-Einstand gegenübergestellt.
Die `0.19.0`-Version hatte stattdessen die ganze Position an der
Live-Kurswährung aufgehängt — bei einer Fremdwährungs-Notierung mit
tatsächlich in Euro eingegebenem Kaufpreis ergab das einen deutlich
falschen Gewinn, weil der (schon Euro-native) Einstand fälschlich noch
einmal umgerechnet wurde. Der Wechselkurs selbst kommt vom selben
Kurs-Proxy wie die Kurse: Yahoo führt Währungspaare als ganz normale
Ticker (`USDEUR=X`), einmal pro vorkommender Live-Kurswährung geholt,
nicht pro Position. Bewusst eine einzige, aktuelle Umrechnung für den
Wert statt historischer Kurse zum jeweiligen Kaufzeitpunkt — eine
Momentaufnahme, kein separates Fremdwährungs-Gewinn/Verlust-Tracking.
Solange der Live-Kurs oder sein Wechselkurs noch nicht geholt ist, zählt
die betroffene Position kurz nicht in der Gesamtsumme mit ("Kurs
folgt …" statt eines falschen Zwischenwerts).

**Depot-Verlauf** (ab `0.20.0`): Portfolio-Wert über die Zeit als Linienchart
mit Einstand als Vergleichslinie, filterbar auf 3 Monate/3 Jahre/5 Jahre.
Dieselbe Kurs-Route liefert auf Anfrage (`range`/`interval`-Parameter) statt
eines einzelnen Kurses eine historische Reihe. Der Wechselkurs für
Fremdwährungs-Positionen ist auch hier nur der aktuelle, keine eigene
historische FX-Reihe — bei 5 Jahren dadurch eine leichte, akzeptierte
Ungenauigkeit. Wichtig für die Aussagekraft: die Kurve zeigt den tatsächlich
gehaltenen Bestand zu jedem Zeitpunkt, nicht rückwirkend den heutigen — ein
frisch angelegter Anfangsbestand (siehe oben, "ein einzelner Kauf-Trade als
Bestand") erscheint im Chart deshalb erst ab seinem eingetragenen Datum,
davor korrekt bei 0.

## Umgebungen: Entwicklung vs. Produktion

Zwei getrennte Instanzen, nicht zu verwechseln:

- **Entwicklungsrechner** (dieser Rechner, `localhost:8090`) — Code wird
  hier geschrieben und getestet. Die dortige `pb_data` ist eine
  Wegwerf-Testdatenbank, kein Backup nötig.
- **`bumblebeee` (192.168.178.55:8090)** — die **Produktionsumgebung**,
  die echten Haushaltsbuch-Daten leben dort. Diese Datenbank ist die
  wichtige und muss bei jedem Deploy erhalten bleiben.

Deploys laufen deshalb ausschließlich als Code-Update in Richtung
Entwicklungsrechner → `bumblebeee`, nie umgekehrt, und **nie** mit einem
Daten-Sync, der `bumblebeee`s Datenbank überschreibt — siehe
`deploy_bumblebeee.sh` unten (`SKIP_DATA=1` ist dort bewusst fest gesetzt,
nicht nur ein Default).

## Sicherung

Gilt für die **Produktionsdatenbank auf `bumblebeee`**, nicht für die
Testdatenbank auf dem Entwicklungsrechner. PocketBase bringt eigene
Sicherungen mit: *Settings → Backups* (auf `http://192.168.178.55:8090/_/`),
dort einen Zeitplan setzen. Die Dateien liegen in `pb_data/backups`, also im
selben Volume — kopier sie per Cron zusätzlich auf ein anderes Laufwerk:

```
0 4 * * * rsync -a /home/bumblebeee/docker/haushaltsbuch/pb_data/backups/ /mnt/sicherung/haushaltsbuch/
```

Und spiel eine Sicherung einmal testweise zurück. Ein Backup, das nie
zurückgespielt wurde, ist eine Vermutung.

**Stand 2026-09-06:** PocketBase-eigener Zeitplan ist auf `bumblebeee`
aktiv (täglich `0 3 * * *` UTC, 7 Backups Aufbewahrung — Settings →
Backups in der Admin-UI), ein manueller Testlauf hat erfolgreich
`pb_data/backups/pb_backup_*.zip` erzeugt. **Der Cron-rsync auf ein
zweites Laufwerk/einen zweiten Ort fehlt noch** — die Backups liegen
bisher nur im selben `pb_data`-Volume wie die Live-Datenbank und würden
einen Ausfall der Platte/des Servers selbst nicht überleben. Das ist die
verbleibende Lücke.

## Buchungen eines Monats löschen

Für den Fall, dass Testdaten oder ein verunglückter Import ganze Monate
verunreinigt haben: `setup/clear_months.mjs` löscht alle Buchungen eines
oder mehrerer Kalendermonate und danach die `imports`-Protokolle, die
dadurch keine einzige Buchung mehr referenzieren (ein Import-Batch, der
auch Buchungen außerhalb der gewählten Monate enthält, bleibt erhalten —
sonst blieben andere Buchungen mit einem verwaisten `import_batch`-Verweis
zurück).

**Vorher immer ein frisches Backup ziehen** (`http://<server-ip>:8090/_/` →
Settings → Backups → „Backup jetzt", s. „Sicherung" oben) — das Skript
prüft das nicht selbst.

Standardmäßig ein Trockenlauf, der nur zählt und Beispielzeilen zeigt,
nichts löscht:

```bash
npm i pocketbase
PB_URL=http://<server-ip>:8090 PB_EMAIL=du@example.de PB_PASSWORD=... \
  MONTHS=2026-09,2026-04 node setup/clear_months.mjs
```

Erst wenn die Ausgabe (Anzahl, Summe, Beispielzeilen) stimmt, mit
`CONFIRM=1` wirklich löschen:

```bash
PB_URL=http://<server-ip>:8090 PB_EMAIL=du@example.de PB_PASSWORD=... \
  MONTHS=2026-09,2026-04 CONFIRM=1 node setup/clear_months.mjs
```

`MONTHS` ist eine kommagetrennte Liste im Format `JJJJ-MM`, beliebig viele
Monate in einem Lauf. Zuletzt genutzt am 2026-09-07 auf `bumblebeee` für
`2026-09,2026-04` (67 Buchungen, 132,41 € Summe, 1 Import-Protokoll).

## Deploy auf einen zweiten Server

`deploy/sync_to_server.sh <user@host> <remote_pfad>` kopiert das Projekt
(ohne `node_modules`/`.git`, s. `.gitignore`) auf einen anderen Server und
startet dort den Container — nach demselben Muster wie im Epoch-Projekt
(`deploy/`-Ordner dort), an PocketBase angepasst:

- **Kein Docker-Build nötig** (fertiges Image
  `ghcr.io/muchobien/pocketbase:latest`) — dafür wird `pb_public/` (der
  gebaute Frontend-Stand) explizit mitkopiert. Das Skript baut dafür selbst
  per `npm run build` in `app/`, kein manueller Schritt vorher nötig.
- **Keine `.env`/SSL-Handhabung** wie bei Epoch nötig — die App läuft rein
  über HTTP, keine feste Server-Adresse im Code (s. „Feste Regeln" in
  `CLAUDE.md`).
- **Keine Pfad-Ersetzung in der `docker-compose.yml`** nötig — die
  Bind-Mounts sind relativ (`./pb_data:/pb_data` usw.), Docker Compose löst
  sie automatisch relativ zum Zielverzeichnis auf.
- `SKIP_DATA=1` überspringt `pb_data/` (für Code-only-Deploys auf einen
  Server mit eigenständiger Datenbank), `HOST_PORT=...` schreibt den extern
  erreichbaren Port um, falls 8090 auf dem Ziel belegt ist.

`deploy/deploy_bumblebeee.sh` ist der fertige Aufruf für den Produktions-
server im Heimnetz (`bumblebeee@192.168.178.55`, Port 8090 dort frei,
`SKIP_DATA=1` fest gesetzt — **nicht** nur ein Default, sondern eine
bewusste Sicherung: `bumblebeee` hält die echten Produktionsdaten, die bei
keinem Code-Deploy überschrieben werden dürfen). Einmaliger Voll-Sync ohne
`SKIP_DATA` (am 2026-09-06 für die Erstinstallation gelaufen) ist seitdem
nicht mehr vorgesehen — jeder weitere Sync läuft über
`deploy_bumblebeee.sh`.

**Wichtig, falls als Backup gedacht:** Ein Code-Deploy mit `SKIP_DATA=1`
ist **kein** Backup der Daten — es aktualisiert nur den Code auf einer
eigenständig laufenden zweiten Instanz mit eigener Datenbank. Für eine
echte zweite Kopie der Daten (Backup-Zweck) muss ein Sync ohne
`SKIP_DATA=1` laufen — dann aber nicht mehr parallel als eigenständige
Live-Instanz betreiben, sonst laufen beide Datenbanken auseinander.
