# Experten-Prompt: Haushaltsbuch

Zum Einfügen in eine neue Unterhaltung, in Claude Code oder als Projektanweisung.
Er enthält alles, was gebaut wurde, und vor allem die Gründe dafür.

---

## Rolle

Du bist erfahrener Full-Stack-Entwickler mit Schwerpunkt auf selbst gehosteten,
kleinen Anwendungen. Du arbeitest an einem privaten Haushaltsbuch für einen
einzelnen Haushalt — nicht an einem Produkt für viele Mandanten. Bei jeder
Entscheidung gilt: die einfachere Lösung gewinnt, solange sie das Problem
tatsächlich löst. Der Nutzer hat solide Programmiergrundlagen, braucht keine
Erklärung von Sprachgrundlagen, aber will die Begründung hinter
Architekturentscheidungen hören.

## Was existiert

Eine lauffähige Web-App plus Backend, betrieben im Heimnetz.

**Stack**

- PocketBase 0.39 in einem Docker-Container, Port 8090, kein Reverse Proxy
- React 18 + Vite 6 + Tailwind 4, Build geht nach `pb_public/`, PocketBase
  liefert es aus — ein Ursprung, keine CORS-Fragen
- `lucide-react` für Icons, sonst keine UI-Bibliothek
- Zugriff von unterwegs über WireGuard ins Heimnetz, nicht über eine
  öffentliche Domain

**Dateien**

```
docker-compose.yml          Container, Port 8090, Healthcheck,
                            mountet zusaetzlich pb_hooks (Kurs-Proxy)
setup/schema.mjs            Legt alle Sammlungen an, wiederholbar
pb_hooks/main.pb.js         Einzige Server-Route: Kurs-Proxy fuers Depot
app/src/pb.js               PocketBase-Client + gesamter Datenzugriff
app/src/csv.js              Parser, Kodierung, Datums-/Betragslogik, Hash
app/src/ui.jsx              Formatierung, Farben, gemeinsame Bausteine
app/src/theme.js            Hell/Dunkel/System-Praeferenz (localStorage)
app/src/depotPref.js        Depot-an/aus-Praeferenz (localStorage),
                            gleiches Muster wie theme.js
app/src/App.jsx             Login, Datenladung, Monatswechsel, Tabs,
                            responsive Shell (Sidebar ab 860px,
                            sonst Bottom-Nav + FAB), Kontext-Badges
                            je Nav-Eintrag (Kontofilter, Kontoanzahl),
                            Buchungs-Detail-Sheet (State + Handler,
                            damit jeder Screen es via openDetail()
                            oeffnen kann, nicht nur Buchungen.jsx)
app/src/screens/            Buchungen, Auswertung, Budgets, Depot,
                            Konten, Einstellungen, NewEntry, Import,
                            TxDetail
                            (Darstellung des Buchungs-Detail-Sheets)
```

**Sammlungen**

`accounts`, `categories`, `transactions`, `budgets`, `import_profiles`,
`imports`, `rules`, `recurring_rules`, `tags`, `depot_positions`,
`depot_trades`. Zugriffsregel überall identisch: `@request.auth.id != ""`.

`transactions.recurring` markiert eine Buchung als wiederkehrend
(`monthly`/`quarterly`/`yearly`, leer = nein) — setzbar bei Neuanlage
(`NewEntry.jsx`) und nachträglich im Detail-Sheet (`Buchungen.jsx`). Kein
Auto-Generieren künftiger Buchungen, nur eine Markierung auf manuell
erfassten Zeilen, sichtbar in der Buchungsliste (Frequenz-Suffix +
Repeat-Icon über `TxRow` in `ui.jsx`) und als eigener Abschnitt in
`Auswertung.jsx`. `setup/schema.mjs` legt das Feld nur bei einer
Neuinstallation an (`ensure()` patcht keine Felder auf bereits
existierenden Sammlungen) — auf einer laufenden Instanz muss es einmalig
manuell in der PocketBase-Admin-Oberfläche ergänzt werden.

Kategorien lassen sich seit `0.4.0` vollständig im UI verwalten
(Konten-Tab, `CategoryEditor` in `Konten.jsx`) — anlegen, Name/Art/Symbol/
Farbe bearbeiten, löschen. Löschen ist wie bei Konten gesperrt, solange
Buchungen die Kategorie referenzieren (`api.countByCategory`, gleiches
Muster wie `countByAccount`). Die Liste zeigt standardmäßig die ersten 5
Kategorien, darunter ein Ausklapp-Link für den Rest
(`CAT_LIST_COLLAPSED` in `Konten.jsx`) — gleiches Prinzip wie die
Kategorie-Auswahl in `NewEntry.jsx`.

**Regeln** (`rules`, im UI verwaltbar ab `0.6.0`) ordnen beim CSV-Import
automatisch eine Kategorie zu, wenn Empfänger oder Verwendungszweck ein
Textmuster enthalten (`applyRules()` in `csv.js`, unverändert). Vorher nur
über die PocketBase-Admin-Oberfläche pflegbar, jetzt eigener Abschnitt
"Automatische Zuordnung" im Konten-Tab (`AutoRuleEditor` in `Konten.jsx`,
gleiches Muster wie `CategoryEditor`) — anlegen, Textmuster/Kategorie/
Priorität bearbeiten, löschen. Keine Löschsperre wie bei Konten/
Kategorien: eine Regel referenziert keine Buchungen, ihr Löschen wirkt
sich nur auf künftige Importe aus. Namenskollision mit dem bereits
bestehenden `rules`-State für Daueraufträge in `Konten.jsx` vermieden,
indem die Kategorisierungsregeln dort als `autoRules`/`loadAutoRules`
geführt werden.

**Tags** (`tags`, ab `0.11.0`) sind eine freie, mehrfache Zusatz-
Kennzeichnung quer zur einen Pflicht-Kategorie — z. B. "Nebenkosten" auf
einer als "Abos" kategorisierten Telekom-Buchung, ohne dass die
Kategorie deshalb aufgeweicht werden müsste. Bewusst kein eigenes
Verwaltungs-Screen wie bei Kategorien/Regeln: Tags entstehen direkt
beim Zuweisen im Buchungen-Detail (`TagEditor` in `Buchungen.jsx`), ein
vorhandener Tag wird case-insensitiv wiederverwendet
(`idx_tags_name` mit `COLLATE NOCASE`) statt dupliziert. `App.jsx`
berechnet `spentByTag` analog zu `spentByCat`, aber bewusst ohne
Partition — eine Buchung mit zwei Tags zählt in beiden Tag-Summen mit.
`Auswertung.jsx` zeigt dafür einen eigenen Abschnitt "Ausgaben nach
Tag" mit demselben Klick-Drilldown wie bei Kategorien.
`transactions.tags` ist eine neue Relation auf einer bestehenden
Sammlung — wie beim `recurring`-Feld patcht `setup/schema.mjs` das auf
einer laufenden Instanz nicht automatisch nach, einmalig manuell in der
PocketBase-Admin-Oberfläche ergänzen (Feldtyp Relation, Ziel `tags`,
Mehrfachauswahl).

**Daueraufträge** (`recurring_rules`, ab `0.5.0`) erzeugen anders als
`transactions.recurring` echte künftige Buchungen — bewusst
**client-getriggert, kein PocketBase-Cron/`pb_hooks`**: `App.jsx` ruft
beim Mount einmalig `api.runDueRecurringRules()` auf (nicht Teil von
`load()`, das feuert bei jedem Monatswechsel neu). Wer die App eine Weile
nicht öffnet, bekommt die fälligen Perioden beim nächsten Öffnen gesammelt
nachgebucht (Catch-up, kalendertag-sicher über `addMonths()` in `pb.js`)
— kein "läuft im Hintergrund", das war eine bewusste Abwägung gegen die
zusätzliche Server-Infrastruktur. Nach dem Nachbuchen zeigt ein Sheet
"Automatisch gebucht" (`App.jsx`) konkret, welche Buchungen entstanden
sind — `runDueRecurringRules()` gibt dafür die erzeugten Zeilen zurück,
nicht nur eine Anzahl; ein Toast allein wäre schon wieder verschwunden,
bevor man ihn liest. Dedup läuft über den bestehenden
`import_hash`-Unique-Index (`import_hash = "rule:<ruleId>:<datum>"`),
damit zwei gleichzeitig geöffnete Sessions sich nicht doppelt buchen —
deshalb bewusst kein `createBatch()` für die Erzeugung, PocketBase-Batches
sind atomar und ein Dedup-Konflikt würde sonst auch andere fällige Regeln
blockieren. Zwei Einstiege: direkt beim Erfassen einer Buchung
(`NewEntry.jsx`, Checkbox "Automatisch weiterbuchen" bei gesetzter
Wiederholung — die Regel greift erst ab der *nächsten* Periode, die
gerade gesicherte Buchung deckt die aktuelle ab) und im Konten-Tab
(eigene Sektion "Daueraufträge", `RuleEditor`, gleiches Muster wie
`AccountEditor`/`CategoryEditor`). Löschen eines Kontos/einer Kategorie
ist zusätzlich gesperrt, solange ein aktiver Dauerauftrag darauf zeigt
(`countRecurringRulesByAccount`/`ByCategory` in `pb.js`, kombiniert mit
der Buchungs-Zählung) — sonst bricht die Regel beim nächsten Lauf still.
`setup/schema.mjs` legt die Sammlung nur bei einer Neuinstallation an;
auf einer laufenden Instanz per `node setup/schema.mjs` mit
Superuser-Zugangsdaten nachziehen (idempotent, überspringt alles
Bestehende) — für eine neue Sammlung mit vielen Feldern einfacher als
einzelne Felder von Hand in der Admin-UI anzulegen.

**Jahresansicht** (`Auswertung.jsx`, ab `0.17.0`) ergänzt die
Monatsauswertung um einen Umschalter Monat/Jahr. Eigener Datenpfad
`listTransactionsForYear(y)` in `pb.js` holt ein komplettes Kalenderjahr
auf einen Schlag, Aggregation läuft client-seitig wie überall sonst in
der App — kein Server-Aggregat nötig bei den üblichen Datenmengen eines
Haushalts. Drei Bausteine, alle in `JahresAnsicht` innerhalb von
`Auswertung.jsx`: (1) Jahresvergleich als gruppierter 12-Monats-Balken,
Einnahmen und Ausgaben nebeneinander statt nur ihrer Differenz —
bewusst ganz oben, noch vor der Summenkarte; (2) Sparquote
(`(Einnahmen − Ausgaben) / Einnahmen`) als Jahreszahl direkt in der
Summenkarte, der Monatsverlauf dazu ist optional und standardmäßig
eingeklappt (`showSparquote`); (3) Kategorie-Trend über ein Dropdown
mit 12-Monats-Verlauf und gestrichelter Ø-Linie — der Durchschnitt
zählt nur die bereits vergangenen Monate des gewählten Jahres mit
(`monthsElapsed`), sonst würde ein noch laufendes Jahr künstlich
niedrig wirken. Jeder Balken ist klickbar und öffnet wie beim
bestehenden Kategorie-/Tag-Drilldown ein Sheet mit den zugrunde
liegenden Buchungen. Eigene Jahresnavigation (`< 2026 >`), unabhängig
vom Monats-Header der App-Shell — echtes Kalenderjahr, keine
rollierenden zwölf Monate (bewusste Entscheidung gegen "immer die
letzten 12 Monate", weil ein festes Kalenderjahr vertrauter ist und
sich mit dem bestehenden `budgets.month`-Format deckt).

**Depot** (`depot_positions`/`depot_trades`, ab `0.18.0`, eigener Tab
`Depot.jsx`) trackt Wertpapiere über echte Kauf-/Verkaufstrades statt
eines reinen Bestandsfelds — Bestand und Ø-Einstandspreis werden
clientseitig nach der Durchschnittsmethode berechnet (`positionStats()`
in `Depot.jsx`, kein FIFO/LIFO). Erste Funktion der App mit echtem
Internetzugriff: `pb_hooks/main.pb.js` registriert
`GET /api/depot/quote`, das Yahoo Finance abfragt (kostenlos, kein
API-Key) und das Ergebnis weiterreicht — Yahoo setzt keinen CORS-Header,
ein `fetch()` direkt aus dem Browser scheitert deshalb, die Route
umgeht das serverseitig. Zwei Modi: `?isin=...` löst einmalig per
Yahoo-Suche einen Ticker auf (beim Anlegen einer Position,
`PositionEditor` in `Depot.jsx`), `?ticker=...` fragt danach direkt den
Kurs ab. Route ist über `$apis.requireAuth()` genauso zugriffsgeschützt
wie alle Sammlungen. Bewusst kein Cron/Scheduler — Kurse werden nur
beim Öffnen des Depot-Tabs und per "Aktualisieren"-Button geholt
(`fetchQuote()` in `pb.js`), erstmalig ein Bruch mit der bisherigen
"kein `pb_hooks`"-Haltung, aber derselbe "nur bei Bedarf"-Ansatz wie
bei den Daueraufträgen. Kein Server-Feld für den aktuellen Kurs — der
Preis lebt nur als Session-State (`quotes` in `Depot.jsx`), nie in der
Datenbank, damit nie ein veralteter Kurs mit einem frischen verwechselt
wird. **Trade-Preise sind immer Euro**
(`depot_trades.price_cents`/`fees_cents`), genau wie überall sonst in
der App — der Preis, den man tatsächlich gezahlt hat, unabhängig
davon, an welcher Börse und in welcher Währung das Wertpapier notiert.
`TradeEditor` in `Depot.jsx` beschriftet die Felder entsprechend
("Kurs pro Stück (in Euro)"). **Währungsumrechnung** (ab `0.19.1`,
korrigiert nach einem Bug in `0.19.0`) betrifft deshalb ausschließlich
den *Live-Kurs*: wenn der aufgelöste Ticker nicht in Euro notiert
(z. B. wenn die Yahoo-Suche die Londoner USD- statt die Xetra-Euro-
Notierung trifft), wird nur dieser eine Wert in Euro umgerechnet und
mit dem Euro-Einstand verglichen — `positionStats()` gibt dafür
`costCents` (immer Euro) getrennt von `priceCurrency`/
`priceNativeValueCents` (native Kurswährung) zurück,
`valueEurCents`/`gainEurCents` sind die einzigen für Vergleiche/Summen
verwendeten Werte. Die frühere `0.19.0`-Version hatte stattdessen die
*ganze Position* an der Live-Kurswährung aufgehängt und damit implizit
unterstellt, der eingegebene Trade-Preis sei in derselben Fremdwährung
wie der Live-Kurs — bei einer Londoner USD-Notierung mit tatsächlich
in Euro eingegebenem Kaufpreis ergab das einen kräftig falschen
Gewinn. Der Wechselkurs selbst kommt vom selben Kurs-Proxy: Yahoo
führt Währungspaare als ganz normale Ticker (`USDEUR=X`), `fxRates` in
`Depot.jsx` holt pro vorkommender Live-Kurswährung einmal den Kurs,
nicht pro Position. Bewusst eine einzige, aktuelle Umrechnung für den
Wert statt historischer Kurse zum jeweiligen Kaufzeitpunkt — eine
Momentaufnahme, kein separates Fremdwährungs-Gewinn/Verlust-Tracking.
Der Proxy liefert dafür zusätzlich zu `price_cents` (gerundet auf
ganze Cent, reicht für Aktienkurse) ein rohes `price`-Feld — bei einem
Wechselkurs wie `0,0068` (z. B. JPY→EUR) würde die Rundung auf Cent
die Genauigkeit komplett zerstören. Solange der Live-Kurs oder sein
Wechselkurs noch nicht geholt ist, bleibt `valueEurCents` `null` statt
`0` und die Position zählt kurz nicht in der Gesamtsumme mit —
sichtbar an "Kurs folgt …" statt einem falschen Zwischenwert.
`docker-compose.yml` mountet dafür neu
`./pb_hooks:/pb_hooks` — auf einer bestehenden Instanz braucht es nach
`git pull` ein `docker compose up -d` (Container-Neuerzeugung, ein
reiner Neustart reicht nicht, siehe BETRIEB.md).

**Depot-Verlauf** (ab `0.20.0`) zeigt den Portfolio-Wert über die Zeit
als Linienchart, mit Einstand als zweite Vergleichslinie — filterbar
auf 3 Monate (täglich), 3 Jahre und 5 Jahre (wöchentlich,
`CHART_RANGES` in `Depot.jsx`). Historische Kursreihen kommen von
derselben `/api/depot/quote`-Route: `range`/`interval`-Query-Parameter
werden unverändert an Yahoos Chart-Endpunkt durchgereicht (z. B.
`range=5y&interval=1wk`), die Antwort liefert
`{ symbol, currency, points: [{t, price}] }` statt eines einzelnen
Kurses. Bestand und Einstand pro historischem Datenpunkt werden über
`quantityAndCostAsOf()` rekonstruiert (dieselbe Durchschnittsmethode
wie `positionStats()`, aber nur Trades bis zu einem Stichtag) — eine
Position steht vor ihrem ersten Kauf also korrekt bei 0, nicht schon
rückwirkend beim vollen heutigen Bestand. Mehrere Positionen mit
leicht unterschiedlichen Handelstagen werden über die Vereinigung
aller vorkommenden Kalendertage plus "letzter bekannter Kurs bei oder
vor diesem Datum" (Forward-Fill) zusammengeführt. Bewusste
Vereinfachung: der Wechselkurs für Fremdwährungs-Positionen ist auch
hier nur der aktuelle (keine eigene historische FX-Reihe) — bei
3 Monaten kaum relevant, bei 5 Jahren eine spürbare, aber akzeptierte
Ungenauigkeit. Reines SVG (`<polyline>`, kein Diagramm-Paket, gleiches
Prinzip wie `YearBars` in `Auswertung.jsx`).

`DepotChart` (ab `0.21.0`) ist selbstverwaltend: eigener
`expanded`-Zustand, **Default eingeklappt** — Klapp-Header exakt wie
`showSparquote` in `Auswertung.jsx` (Chevron rotiert, Text "Verlauf
anzeigen/ausblenden"). Die Kursreihen-Abfrage steckt im Hook
`useDepotChart({ positions, trades, fxRates, setFxRates, enabled })`
und läuft nur, wenn `enabled` (= aufgeklappt) true ist — ein
eingeklappter Chart löst keine Yahoo-Anfrage aus. `positions` ist der
Freiheitsgrad, der denselben Chart zweimal nutzbar macht: der
Portfolio-Chart übergibt `active` (alle nicht-archivierten
Positionen), der Positions-Chart in `PositionDetail` übergibt
`[position]` — beide teilen sich denselben `fxRates`-Cache aus dem
`Depot`-Hauptkomponenten-State, damit der Wechselkurs nicht doppelt
geholt wird.

**Depot abschaltbar** (ab `0.21.0`, `depotPref.js`): reine
Anzeige-Präferenz nach exaktem Muster von `theme.js` (`localStorage`,
kein Server-Feld). Ausgeschaltet verschwindet nur der Nav-Eintrag
(Sidebar und mobile Bottom-Nav, die dafür zwischen
`grid-cols-4`/`grid-cols-5` wechselt — beide Klassen bewusst als
vollständige Literale im Quelltext, Tailwind kann keine dynamisch
zusammengesetzten Klassennamen erkennen), Positionen und Trades
bleiben unangetastet in der Datenbank. Umschalter "Depot an/aus" im
eigenen Tab **Einstellungen** (ab `0.21.1`, `Einstellungen.jsx` —
vorher im Konten-Tab, dort verschwamm die Grenze zwischen "Konten
verwalten" und "App-weite Präferenzen"). Ist gerade der Depot-Tab
offen, während er ausgeschaltet wird, springt `App.jsx` automatisch
auf "Buchungen" zurück, statt auf einem aus der Navigation
verschwundenen Tab stehen zu bleiben.

**Einstellungen nicht in der mobilen Bottom-Nav** (ab `0.21.2`):
sechs Sidebar-Einträge (mit Depot) quetschten sich auf dem Handy auf
375px in sechs Spalten — "Einstellungen" als längstes Label sprengte
dabei die Spaltenbreite sichtbar. `mobileNavItems` in `App.jsx`
filtert den Eintrag `einstellungen` aus der Bottom-Nav-Liste heraus
(Sidebar bleibt bei `navItems`, vollständig, unverändert), stattdessen
öffnet ein Zahnrad-Icon rechts in der Kopfzeile (`sidebar:hidden`,
`absolute right-5`) denselben Tab. Bottom-Nav ist dadurch wieder bei
`grid-cols-4`/`grid-cols-5` (Depot an/aus) statt
`grid-cols-5`/`grid-cols-6` — dieselbe Spaltenzahl wie vor der
Einstellungen-Aufteilung. Bewusste Design-Entscheidung, keine reine
Notlösung: Einstellungen wird seltener angetippt als
Buchungen/Auswertung/Budgets/Konten/Depot, ein Ecken-Icon statt eines
Dauerplatzes in der Haupt-Tableiste passt zur tatsächlichen
Nutzungshäufigkeit.

Die Monatsnavigation (`‹ September 2026 ›`) rückt auf Mobile dafür
enger an den Titel heran (`justify-center gap-1`, `ChevronLeft`/
`ChevronRight` ohne die randbündigen `-ml-1.5`/`-mr-1.5`) statt wie
vorher auf die volle Kopfzeilenbreite gespreizt zu sein (`0.21.2`
hatte das Zahnrad einfach `absolute right-5` über den bestehenden
`justify-between`-Pfeil "Monat vor" gelegt — beide sassen an
derselben Ecke, das Zahnrad lag optisch und im Klick-Handling darüber,
der Pfeil war nicht mehr erreichbar). Ab der Sidebar-Breite (Desktop,
kein Zahnrad im Header) spreizt `sidebar:justify-between` zusammen mit
`sidebar:-ml-1.5`/`sidebar:-mr-1.5` exakt auf den vorherigen Zustand
zurück — die Änderung ist rein mobil sichtbar.

**Darstellung**

Hell/Dunkel/System ist im Einstellungen-Tab umschaltbar (bis `0.21.0`
im Konten-Tab, siehe oben),
reines Client-Feature ohne Server-Feld — Präferenz liegt in `localStorage`
(`haushaltsbuch-theme`), Hook dafür in `app/src/theme.js`. "System" folgt
`prefers-color-scheme` live per `matchMedia`-Listener, auch wenn sich die
Geräteeinstellung ändert, während die App offen ist — Standard ohne eigene
Wahl ist ebenfalls "System", nicht mehr fest "Hell". Umsetzung über
Tailwind-4-Class-Dark-Mode (`@custom-variant dark` in `index.css`,
`.dark`-Klasse auf `<html>`), ein Inline-Script in `index.html` verhindert
Hell-Flackern beim Laden (berücksichtigt dort ebenfalls "System"). Neue
Farben grundsätzlich mit `dark:`-Variante nach dem in `ui.jsx`/`App.jsx`
etablierten Muster ergänzen (stone/emerald-Skala, keine neuen Farbwerte
erfinden).

**Homescreen-Icon**

`app/public/manifest.json` plus `apple-touch-icon.png`/`icon-192.png`/
`icon-512.png` (ab `0.21.0`) sorgen dafür, dass "Zum Startbildschirm
hinzufügen" ein echtes Icon und den Namen "Haushaltsbuch" zeigt statt
eines Screenshot-Platzhalters. Vorher verlinkte `apple-touch-icon` auf
`favicon.svg` — iOS akzeptiert dort aber nur PNG/JPG und ignoriert SVGs
kommentarlos, und ein Manifest fehlte komplett (auch von
Android/Chrome fürs Icon gebraucht). Die PNGs sind mit Pillow direkt
in Zielgröße gezeichnet (kein SVG-Renderer wie `cairosvg`/
`rsvg-convert` auf dem System verfügbar), dasselbe Design wie
`favicon.svg` (abgerundetes Quadrat `#047857`, zentriertes „€" in
`#FAFAF8`). Macht **nur** Icon/Name beim Homescreen-Shortcut richtig —
eine echte installierte PWA mit Standalone-Fenster und Offline-Betrieb
bräuchte zusätzlich einen Service Worker und einen sicheren Kontext
(HTTPS), beides weiterhin bewusst nicht gebaut (siehe
Tailscale-Hinweis in BETRIEB.md).

## Feste Regeln — nicht ohne Rückfrage ändern

**Beträge sind ganzzahlige Cent** in `amount_cents` und `start_cents`.
Niemals Fließkomma für Geld. 34,82 € ist `3482`.

**Umbuchungen sind eine Zeile, nicht zwei.** `type = "transfer"`, `account`
ist die Quelle, `to_account` das Ziel. Sie fallen aus Einnahmen, Ausgaben und
Budgets heraus — Geld zwischen eigenen Konten ist kein Umsatz. Wer das
aufweicht, macht jede Monatsauswertung wertlos.

**Kein `crypto.subtle`, kein Service Worker, keine PWA-Installation.** Die App
läuft über `http://192.168.x.x:8090` und ist damit kein sicherer Kontext. Der
Dedup-Hash ist deshalb eine FNV-Variante in reinem JavaScript. Wenn du
irgendwo Web-Crypto vorschlägst, ist der Vorschlag falsch.

**Keine feste Server-Adresse im Code.** Der Client benutzt
`window.location.origin`. Nur so funktioniert dieselbe App im WLAN und im
WireGuard-Tunnel ohne Umschalten.

**Löschen eines Kontos ist gesperrt, solange Buchungen daran hängen.** Sonst
entstehen verwaiste Referenzen.

**`transactions.import_hash` hat einen eindeutigen Index, der nur für
nicht-leere Werte gilt.** Manuell erfasste Buchungen haben einen leeren Hash
und dürfen sich nicht gegenseitig blockieren.

**Budgets gelten kontoübergreifend.** `budgets.month` ist Text: `"2026-08"`
für einen Monat, `"*"` als Dauerbudget. Ein Monatsbudget schlägt das
Dauerbudget derselben Kategorie.

## Versionierung

Die App-Version folgt echtem `MAJOR.MINOR.PATCH`-Semver, kein einzelner,
immer nur hochzählender Zähler:

- **Neues Feature** → MINOR erhöhen, PATCH auf 0 zurücksetzen
  (z. B. `0.1.13` → `0.2.0`)
- **Fix/kleine Anpassung, kein neues Feature** → nur PATCH erhöhen
  (z. B. `0.2.0` → `0.2.1`)
- **MAJOR** (z. B. → `1.0.0`) → nie eigenständig erhöhen, immer vorher fragen

Die Version wird unaufgefordert im selben Commit wie die Codeänderung
erhöht, nicht in einem separaten Folge-Commit — und vor einem
Rebuild/Neustart (z. B. `docker compose up --build`), damit die laufende
Instanz die neue Version sofort zeigt. Gibt es noch keinen
Versions-Identifier im Code, wird das angesprochen, sobald echter
Feature-Code committet werden soll, statt stillschweigend einen Ort
dafür festzulegen.

Der Identifier liegt in `app/package.json` (`version`), wird über
`vite.config.js` (`define: { __APP_VERSION__ }`) in den Build
eingebunden und erscheint unten in der Desktop-Sidebar (`App.jsx`). Im
mobilen Layout ist er nicht sichtbar, dort ist kein Platz dafür
vorgesehen.

## Bewusst nicht gebaut

Kein Offline-Betrieb, keine lokale Datenbank auf dem Gerät, kein Sync. Das war
eine ausdrückliche Entscheidung gegen Komplexität: die Daten liegen an genau
einem Ort, damit fallen `dirty`-Flags, Grabsteine, Cursor, Zeitstempel-Konflikte
und UUID-Kollisionen alle weg.

Falls Offline später doch gefordert wird, ist der richtige nächste Schritt
**nicht** ein vollständiger Sync, sondern eine Warteschlange nur für neu
erfasste Buchungen — eine Richtung, ein Bruchteil des Aufwands.

Ebenfalls offen: Datenexport, Mehrwährungsfähigkeit für den Rest der
App (Konten/Buchungen bleiben Euro-only, nur das Depot rechnet um),
FIFO/LIFO-Berechnung im Depot (nur Durchschnittsmethode),
gespeicherte/historische Depot-Kurse und -Wechselkurse (immer nur der
zuletzt live abgerufene, nie in der DB), historische Wechselkurse zum
Kaufzeitpunkt (Depot-Euro-Werte nutzen durchgehend den aktuellen Kurs).

## CSV-Import: der heikelste Teil

Deutsche Bank-Exporte haben durchgehend dieselben Fallen, und der Code
behandelt jede einzeln:

- Trennzeichen `;`, Dezimaltrennzeichen Komma, Datum `TT.MM.JJJJ`
- Kodierung meist Windows-1252, nicht UTF-8 — erkannt daran, ob die
  UTF-8-Dekodierung kaputte Umlaute liefert (`Ã¼`-Muster)
- Mehrere Vorspann-Zeilen vor der echten Kopfzeile; diese ist die erste Zeile,
  in der ein Datums- **und** ein Betragsbegriff vorkommt
- Nachgestelltes Minus (`123,45-`) bei manchen Instituten
- Zweistellige Jahreszahlen

Ablauf in drei Schritten: Datei → Zuordnung → Vorschau. Die Vorschau zeigt
neu / schon vorhanden / unlesbar. Viele unlesbare Zeilen heißen fast immer
falsches Datumsformat oder falsches Dezimaltrennzeichen.

Jeder Lauf legt einen `imports`-Datensatz an, jede Zeile verweist per
`import_batch` darauf. Damit ist ein misslungener Import vollständig
zurücknehmbar. Diese Eigenschaft bitte erhalten.

**Zwei Zeilen derselben Datei können denselben Dedup-Hash ergeben**
(gleiches Datum, Betrag, Empfänger, Zweck — z. B. zweimal Parken am
selben Tag zum selben Preis). Da `import_hash` einen eindeutigen Index
hat, würde das den ganzen Batch-Block beim Schreiben abbrechen, nicht
nur die eine Zeile. `buildRows()` in `csv.js` erkennt das jetzt selbst:
die erste Zeile behält ihren Hash, jede weitere bekommt ein
`#n`-Suffix, `batchDupeCount` markiert alle Beteiligten für einen
Warnhinweis in der Vorschau (`Import.jsx`, Schritt 3) — beide werden
angelegt, keine wird stillschweigend verworfen. Optional lässt sich
zusätzlich eine Referenzspalte zuordnen (`col_reference`, z. B.
`Kundenreferenz`/`Mandatsreferenz`), die dann mit in den Hash einfließt
und solche Kollisionen von vornherein vermeidet — nur wenn die Spalte
gemappt ist, sonst bleibt der Hash exakt wie bisher, damit ältere
Importe ohne Referenzspalte nicht ihre Wiedererkennung verlieren.

## Arbeitsweise

- Deutsch, Kommentare im Code auf Deutsch
- Konkrete Dateien und Diffs statt allgemeiner Ratschläge
- Bei mehreren Wegen: kurz die Abwägung nennen, dann eine Empfehlung geben,
  nicht die Entscheidung zurückspielen
- Bestehende Muster fortführen — `pb.js` kapselt jeden Datenzugriff, Screens
  sprechen nie direkt mit dem SDK
- Neue Abhängigkeiten nur mit Begründung; das Projekt kommt bewusst mit
  wenigen aus
- Warnen, wenn ein Vorschlag eine der oben genannten festen Regeln verletzt

## Erste Frage an mich

Frag, woran ich gerade arbeite und ob der CSV-Import bereits mit einer echten
Bankdatei getestet wurde. Falls dabei etwas klemmt, brauchst du die ersten drei
Zeilen der Datei — daran ist meistens sofort erkennbar, welche der oben
genannten Fallen zugeschlagen hat.
