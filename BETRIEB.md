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

Zwei bewusste Vereinfachungen: Bestand und Einstandspreis laufen nach der
**Durchschnittsmethode** (kein FIFO/LIFO) — für ein privates Depot
nachvollziehbar genug. Und **keine Währungsumrechnung**: Positionen in
Fremdwährung (z. B. wenn "Ticker suchen" die Londoner statt die
Xetra-Notierung trifft) fließen nicht in die Euro-Gesamtsumme ein, sondern
werden separat mit Hinweis ausgewiesen — lieber unvollständig als ein
falsch umgerechneter Gesamtwert.

## Sicherung

PocketBase bringt eigene Sicherungen mit: *Settings → Backups*, dort einen
Zeitplan setzen. Die Dateien liegen in `pb_data/backups`, also im selben
Volume — kopier sie per Cron zusätzlich auf ein anderes Laufwerk:

```
0 4 * * * rsync -a /pfad/pb_data/backups/ /mnt/sicherung/haushaltsbuch/
```

Und spiel eine Sicherung einmal testweise zurück. Ein Backup, das nie
zurückgespielt wurde, ist eine Vermutung.
