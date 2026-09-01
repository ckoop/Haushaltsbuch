# Haushaltsbuch — Backend

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

Unter *Mehr → CSV-Datei importieren*, in drei Schritten: Datei wählen,
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

## Sicherung

PocketBase bringt eigene Sicherungen mit: *Settings → Backups*, dort einen
Zeitplan setzen. Die Dateien liegen in `pb_data/backups`, also im selben
Volume — kopier sie per Cron zusätzlich auf ein anderes Laufwerk:

```
0 4 * * * rsync -a /pfad/pb_data/backups/ /mnt/sicherung/haushaltsbuch/
```

Und spiel eine Sicherung einmal testweise zurück. Ein Backup, das nie
zurückgespielt wurde, ist eine Vermutung.
