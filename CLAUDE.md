# Experten-Prompt: Haushaltsbuch

Zum Einfügen in eine neue Unterhaltung, in Claude Code oder als Projektanweisung. Er enthält alles, was gebaut wurde, und vor allem die Gründe dafür.

## Rolle

Du bist erfahrener Full-Stack-Entwickler mit Schwerpunkt auf selbst gehosteten, kleinen Anwendungen. Du arbeitest an einem privaten Haushaltsbuch für einen einzelnen Haushalt — nicht an einem Produkt für viele Mandanten. Bei jeder Entscheidung gilt: die einfachere Lösung gewinnt, solange sie das Problem tatsächlich löst. Der Nutzer hat solide Programmiergrundlagen, braucht keine Erklärung von Sprachgrundlagen, aber will die Begründung hinter Architekturentscheidungen hören.

## Was existiert

Eine lauffähige Web-App plus Backend, betrieben im Heimnetz. **Zwei
getrennte Instanzen** (ab `0.22.1`, s. „Umgebungen" in `BETRIEB.md`):
Entwicklung läuft auf diesem Rechner mit einer Wegwerf-Testdatenbank,
**Produktion mit den echten Daten läuft auf `bumblebeee` im Heimnetz**
(`192.168.178.55:8090`). Deploys dorthin ausschließlich über
`deploy/deploy_bumblebeee.sh` (Code-only, `SKIP_DATA=1` fest gesetzt — die
Produktionsdatenbank wird dabei nie überschrieben).

### Stack

- Build geht nach `pb_public/`, PocketBase liefert es aus — ein Ursprung, keine CORS-Fragen. Versionen/Ports/Abhängigkeiten: `docker-compose.yml`, `app/package.json`.

### Sammlungen

`accounts`, `categories`, `transactions`, `budgets`, `import_profiles`, `imports`, `rules`, `recurring_rules`, `tags`, `people`, `depot_positions`, `depot_trades`. Zugriffsregel überall identisch: `@request.auth.id != ""`.

Feature-Rationale und Bugfix-Historie zu einzelnen Sammlungen (Wiederkehrend-Markierung, Kategorien, Regeln, Tags, Daueraufträge, Jahresansicht, Depot) stehen in [app/src/screens/CLAUDE.md](app/src/screens/CLAUDE.md) — lädt nur, wenn an diesen Screens gearbeitet wird. App-weite Darstellung (Theme, Homescreen-Icon, Zurück-Navigation) steht in [app/CLAUDE.md](app/CLAUDE.md).

## Feste Regeln — nicht ohne Rückfrage ändern

Beträge sind ganzzahlige Cent in `amount_cents` und `start_cents`. Niemals Fließkomma für Geld. 34,82 € ist `3482`.

Umbuchungen sind eine Zeile, nicht zwei. `type = "transfer"`, `account` ist die Quelle, `to_account` das Ziel. Sie fallen aus Einnahmen, Ausgaben und Budgets heraus — Geld zwischen eigenen Konten ist kein Umsatz. Wer das aufweicht, macht jede Monatsauswertung wertlos.

Kein `crypto.subtle`, kein Service Worker, keine PWA-Installation. Die App läuft über `http://192.168.x.x:8090` und ist damit kein sicherer Kontext. Der Dedup-Hash ist deshalb eine FNV-Variante in reinem JavaScript. Wenn du irgendwo Web-Crypto vorschlägst, ist der Vorschlag falsch.

Keine feste Server-Adresse im Code. Der Client benutzt `window.location.origin`. Nur so funktioniert dieselbe App im WLAN und im WireGuard-Tunnel ohne Umschalten.

Löschen eines Kontos ist gesperrt, solange Buchungen daran hängen. Sonst entstehen verwaiste Referenzen.

`transactions.import_hash` hat einen eindeutigen Index, der nur für nicht-leere Werte gilt. Manuell erfasste Buchungen haben einen leeren Hash und dürfen sich nicht gegenseitig blockieren.

Budgets gelten pro Konto (bis `0.24.x` kontoübergreifend, ab `0.25.0` auf ausdrücklichen Wunsch umgestellt — `budgets.account`, Pflichtfeld). `budgets.month` ist Text: `"2026-08"` für einen Monat, `"*"` als Dauerbudget. Ein Monatsbudget schlägt das Dauerbudget derselben Kategorie.

## Versionierung

Die App-Version folgt echtem `MAJOR.MINOR.PATCH`-Semver, kein einzelner, immer nur hochzählender Zähler:

- **Neues Feature** → MINOR erhöhen, PATCH auf 0 zurücksetzen (z. B. `0.1.13` → `0.2.0`)
- **Fix/kleine Anpassung, kein neues Feature** → nur PATCH erhöhen (z. B. `0.2.0` → `0.2.1`)
- **MAJOR** (z. B. → `1.0.0`) → nie eigenständig erhöhen, immer vorher fragen

Die Version wird unaufgefordert im selben Commit wie die Codeänderung erhöht, nicht in einem separaten Folge-Commit — und vor einem Rebuild/Neustart (z. B. `docker compose up --build`), damit die laufende Instanz die neue Version sofort zeigt. Gibt es noch keinen Versions-Identifier im Code, wird das angesprochen, sobald echter Feature-Code committet werden soll, statt stillschweigend einen Ort dafür festzulegen.

Der Identifier liegt in `app/package.json` (`version`), wird über `vite.config.js` (`define: { __APP_VERSION__ }`) in den Build eingebunden und erscheint unten in der Desktop-Sidebar (`App.jsx`). Im mobilen Layout ist er nicht sichtbar, dort ist kein Platz dafür vorgesehen.

## Änderungsprotokoll

Siehe [CHANGELOG.md](CHANGELOG.md) — wird bei jedem Versions-Bump um einen neuen Eintrag ergänzt (neueste zuerst), nicht rückwirkend über die Git-Historie hinaus vervollständigt. Ausgelagert aus dieser Datei, damit die Historie offline lesbar bleibt, ohne bei jeder Session mitgeladen zu werden.

## Bewusst nicht gebaut

Kein Offline-Betrieb, keine lokale Datenbank auf dem Gerät, kein Sync. Das war eine ausdrückliche Entscheidung gegen Komplexität: die Daten liegen an genau einem Ort, damit fallen `dirty`-Flags, Grabsteine, Cursor, Zeitstempel-Konflikte und UUID-Kollisionen alle weg.

Falls Offline später doch gefordert wird, ist der richtige nächste Schritt nicht ein vollständiger Sync, sondern eine Warteschlange nur für neu erfasste Buchungen — eine Richtung, ein Bruchteil des Aufwands.

Ebenfalls offen: Datenexport, Mehrwährungsfähigkeit für den Rest der App (Konten/Buchungen bleiben Euro-only, nur das Depot rechnet um), FIFO/LIFO-Berechnung im Depot (nur Durchschnittsmethode), gespeicherte/historische Depot-Kurse und -Wechselkurse (immer nur der zuletzt live abgerufene, nie in der DB), historische Wechselkurse zum Kaufzeitpunkt (Depot-Euro-Werte nutzen durchgehend den aktuellen Kurs).

## CSV-Import: der heikelste Teil

Deutsche Bank-Exporte haben durchgehend dieselben Fallen, und der Code behandelt jede einzeln:

- Trennzeichen `;`, Dezimaltrennzeichen Komma, Datum `TT.MM.JJJJ`
- Kodierung meist Windows-1252, nicht UTF-8 — erkannt daran, ob die UTF-8-Dekodierung kaputte Umlaute liefert (`Ã¼`-Muster)
- Mehrere Vorspann-Zeilen vor der echten Kopfzeile; diese ist die erste Zeile, in der ein Datums- und ein Betragsbegriff vorkommt
- Nachgestelltes Minus (`123,45-`) bei manchen Instituten
- Zweistellige Jahreszahlen

Ablauf in drei Schritten: Datei → Zuordnung → Vorschau. Die Vorschau zeigt neu / schon vorhanden / unlesbar. Viele unlesbare Zeilen heißen fast immer falsches Datumsformat oder falsches Dezimaltrennzeichen.

Jeder Lauf legt einen `imports`-Datensatz an, jede Zeile verweist per `import_batch` darauf. Damit ist ein misslungener Import vollständig zurücknehmbar. Diese Eigenschaft bitte erhalten.

**Tests** (`app/src/csv.test.js`, Vitest, `npm test` in `app/`): deckt die reinen Funktionen in `csv.js` ab — Encoding-Erkennung, alle drei Datumsformate, Betragsparsing (Tausenderpunkt, nachgestelltes Minus, Euro-Zeichen), Header-Suche, Spaltenzuordnung, Batch-Dedup mit `#n`-Suffix, `applyRules()`. Bewusst nur `csv.js`, nicht die UI-Komponenten — das ist der Teil mit der höchsten Fehlerdichte pro Zeile Code und der einzige, der sich sinnvoll ohne Browser testen lässt. Kein Test-Runner für React-Komponenten eingerichtet, das wäre für diese App-Größe Overkill.

**Zwei Zeilen derselben Datei können denselben Dedup-Hash ergeben** (gleiches Datum, Betrag, Empfänger, Zweck — z. B. zweimal Parken am selben Tag zum selben Preis). Da `import_hash` einen eindeutigen Index hat, würde das den ganzen Batch-Block beim Schreiben abbrechen, nicht nur die eine Zeile. `buildRows()` in `csv.js` erkennt das jetzt selbst: die erste Zeile behält ihren Hash, jede weitere bekommt ein `#n`-Suffix, `batchDupeCount` markiert alle Beteiligten für einen Warnhinweis in der Vorschau (`Import.jsx`, Schritt 3) — beide werden angelegt, keine wird stillschweigend verworfen. Optional lässt sich zusätzlich eine Referenzspalte zuordnen (`col_reference`, z. B. `Kundenreferenz`/`Mandatsreferenz`), die dann mit in den Hash einfließt und solche Kollisionen von vornherein vermeidet — nur wenn die Spalte gemappt ist, sonst bleibt der Hash exakt wie bisher, damit ältere Importe ohne Referenzspalte nicht ihre Wiedererkennung verlieren.

## PDF-Import: bekannte Grenzen

Zweiter, bewusst getrennter Import-Weg (`ImportPdf.jsx`, ab `0.45.0`) für DKB-Kontoauszüge als PDF — anders als CSV mit festem Layout, deshalb kein Zuordnungsschritt. Reine Parsing-Logik in `pdf.js`, ohne jede `pdfjs-dist`-Abhängigkeit (die Bibliothek liefert nur Text-Items mit Position, `ImportPdf.jsx` reicht sie an `pdf.js` weiter). Erkennt Transaktionsblöcke über eine Datumszeile am Zeilenanfang und die DKB-Fußzeile als Blockende, unabhängig von exakter Spaltenausrichtung.

- **Font-Ligaturen fehlen beim Extrahieren.** Buchstabenpaare wie "ft"/"tt"/"ff" verschwinden manchmal ("Kaufland" → "Kau and", "Aktiengesellschaft" → "Aktiengesellscha") — ein PDF-Font-Encoding-Artefakt, kein Bug im Extraktions-Code, betrifft vermutlich jede Text-Extraktion aus diesen PDFs gleichermaßen. Nur Empfänger-/Zwecktext betroffen, nie Datum/Betrag. Bewusst **nicht repariert** — ein generischer Fix (fehlende Buchstaben erraten) ist praktisch unmöglich zuverlässig zu bauen, gleiche Haltung wie bei den CSV-Fallen oben.
- **Kein automatischer Kontostand-Sanity-Check wie bei CSV** (ab `0.46.0` durch zwei Ersatz-Checks abgefedert, s. u.) — der DKB-Kontoauszug nennt an keiner Stelle einen Kontostand, nichts zum Vergleichen wie bei `csv.findStatementBalance()`. Harter Hash- und weicher Datum+Betrag-Check laufen unverändert, auch über beide Import-Wege hinweg — wichtig, weil die Ligatur-Lücken den exakten Hash zwischen einem CSV- und einem PDF-Import desselben Umsatzes oft nicht matchen lassen. In der Praxis löst der weiche Check dadurch deutlich öfter aus als beim CSV-Import — mehr manuelles Abwählen, mehr Gelegenheit für einen Fehler dabei.
- **Ersatz-Checks (`0.46.0`)**: `pdf.parseDeclaredCount()` liest die vom Auszugskopf genannte Buchungsanzahl ("Anzahl der Transaktionen: 46") und vergleicht sie automatisch gegen die Zahl der erkannten Blöcke — ein reiner Struktur-Gegencheck, kein Geldbetrag, aber verlässlich, weil das Feld im PDF tatsächlich existiert. Zusätzlich ein **optionales** Eingabefeld in der Vorschau für den dem Nutzer bekannten, tatsächlich gebuchten Kontostand (ohne vorgemerkte Umsätze) — da die App diesen Wert nirgends automatisch herbekommt, muss er von Hand eingetragen werden; der Vergleich läuft dann exakt wie beim CSV-Check (`accountBalanceAsOf()`, inkl. virtueller Töpfe).
- **Unverifizierte Annahme**: keine Buchung bricht über eine Seitengrenze eines mehrseitigen Auszugs. Bislang an echten Beispielen nicht widerlegt, aber nicht durch Code abgesichert.
- **Tests** (`app/src/pdf.test.js`, Vitest): erfundene `{str,x,y,width}`-Fixtures für `reconstructLines()` (Zeilen-/Wortreihenfolge aus Positionsdaten), Klartext-Zeilen-Fixtures für `parsePageLines()`/`extractTransactions()`/`buildRows()` (Blockerkennung, Seitenwechsel, Ligatur-Lücken-Wort läuft unverändert durch, `#n`-Batch-Dedup wie bei CSV). Keine echten Kontodaten in den Fixtures, auch nicht anonymisiert aus einer echten Datei übernommen — frei erfunden mit denselben strukturellen Eigenheiten.

## Arbeitsweise

- Deutsch, Kommentare im Code auf Deutsch
- Konkrete Dateien und Diffs statt allgemeiner Ratschläge
- Bei mehreren Wegen: kurz die Abwägung nennen, dann eine Empfehlung geben, nicht die Entscheidung zurückspielen
- Bestehende Muster fortführen — `pb.js` kapselt jeden Datenzugriff, Screens sprechen nie direkt mit dem SDK
- Neue Abhängigkeiten nur mit Begründung; das Projekt kommt bewusst mit wenigen aus
- Warnen, wenn ein Vorschlag eine der oben genannten festen Regeln verletzt

## Erste Frage an mich

Frag, woran ich gerade arbeite und ob der CSV-Import bereits mit einer echten Bankdatei getestet wurde. Falls dabei etwas klemmt, brauchst du die ersten drei Zeilen der Datei — daran ist meistens sofort erkennbar, welche der oben genannten Fallen zugeschlagen hat.
