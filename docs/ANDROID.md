# Android-App für den Play Store — Architekturplan

Stand: Entwurf zur Entscheidung, noch kein Code. Ausgangspunkt ist Version `0.51.0`.

## Ziel

Die App soll als eigenständige Android-App im Play Store erscheinen. Jeder
Nutzer hat seine Daten ausschließlich auf seinem eigenen Gerät. Es gibt keinen
Server, kein Docker, kein Nutzerkonto und keinen Betrieb durch den Entwickler.
Die Depot-Funktion entfällt.

## Was sich an den festen Regeln ändert

Diese Punkte aus der Root-`CLAUDE.md` gelten für die Store-App **nicht mehr**
bzw. drehen sich um. Sie werden in der `CLAUDE.md` erst angepasst, wenn die
Umstellung tatsächlich gebaut wird:

| Bisher | Store-App |
|---|---|
| „Keine lokale Datenbank auf dem Gerät" | Die lokale Datenbank **ist** der einzige Speicherort. |
| Kein Offline-Betrieb | Die App läuft vollständig offline. Kein Sync, kein Server — damit entfallen weiterhin alle Sync-Probleme (Grabsteine, Konflikte). |
| `window.location.origin` als Server-Adresse | Es gibt keine Server-Adresse mehr. |
| Kein `crypto.subtle`, weil kein sicherer Kontext | Die WebView läuft unter `https://localhost` und ist damit ein sicherer Kontext. Der FNV-Hash bleibt trotzdem, weil sonst alle bestehenden Dedup-Hashes ihre Bedeutung verlören. |
| Datenexport „bewusst offen" | Backup/Export wird **Pflicht**: Ohne Export verliert ein Nutzer bei Handyverlust alles. |
| Depot mit Live-Kursen | Entfällt ersatzlos (Yahoo Finance darf in einer veröffentlichten App nicht genutzt werden). |

Unverändert bleiben: Beträge als ganzzahlige Cent, Umbuchungen als eine Zeile,
Kontolöschung gesperrt bei vorhandenen Buchungen, eindeutiger `import_hash`
nur für nicht-leere Werte, Budgets pro Konto mit `"*"`-Dauerbudget,
zurücknehmbare Import-Läufe.

## Technischer Ansatz

### Hülle: Capacitor

Die bestehende React-/Vite-App wird unverändert gebaut und von
[Capacitor](https://capacitorjs.com/) als Android-App verpackt. Kein
Neuschreiben der Oberfläche, kein React Native.

Abgewogen: React Native oder Kotlin hätten ein „nativeres" Gefühl, bedeuten
aber jede Zeile UI neu. Die App ist bereits mobil ausgelegt — der Gewinn
rechtfertigt den Aufwand nicht.

### Datenhaltung: SQLite statt PocketBase

Neue Abhängigkeit: `@capacitor-community/sqlite`.

Abgewogen gegen IndexedDB in der WebView (keine zusätzliche Abhängigkeit):
IndexedDB ist aus Browsersicht „best effort"-Speicher und kennt keine echten
eindeutigen Indizes mit Bedingung. Für die einzige Kopie von Finanzdaten ist
eine echte SQLite-Datei im App-Verzeichnis die robustere Wahl; der partielle
eindeutige Index auf `import_hash` lässt sich 1:1 abbilden:

```sql
CREATE UNIQUE INDEX idx_tx_import_hash ON transactions(import_hash)
  WHERE import_hash != '';
```

### Der Umbau-Kern: `pb.js`

Die Regel „Screens sprechen nie direkt mit dem SDK" zahlt sich hier aus:
Alle Screens importieren nur `pb.js` (rund 650 Zeilen, ca. 70 exportierte
Funktionen). Diese Datei bekommt eine SQLite-Implementierung mit **denselben
Funktionsnamen und Rückgabeformen**. Die Screens bleiben unverändert.

Worauf die neue Implementierung achten muss, damit die Screens nichts merken:

- **Datumsformat**: PocketBase liefert `date` als `"YYYY-MM-DD HH:MM:SS.sssZ"`.
  Die lokale Datenbank speichert dasselbe Textformat, damit `dateOnly()`,
  Textvergleiche (`date < {:end}`) und die Sortierung unverändert funktionieren.
- **`id` und `created`**: PocketBase erzeugt 15-stellige IDs und einen
  `created`-Zeitstempel. Beides erzeugt die lokale Schicht selbst
  (`crypto.getRandomValues`, im sicheren WebView-Kontext verfügbar).
  `created` wird für die Sortierung (`-date,-created`) und in der
  Import-Historie angezeigt.
- **`expand`**: Nur `listImportRuns()` nutzt `expand: "account"` — lokal ein
  einfacher JOIN bzw. Nachschlagen im Speicher.
- **`tags`** ist eine Mehrfach-Relation (JSON-Array von IDs). Der Suchfilter
  `tags ?= {:t}` wird zu `EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`.
- **`payee ~ {:q}`** (LIKE, groß/klein-unabhängig) wird zu `LIKE '%' || ? || '%'`.
- **Batches** (`batchCreateTransactions`, `deleteImportRun`) werden zu einer
  SQL-Transaktion — sicherer als bisher, weil ein Abbruch nichts halb
  geschrieben zurücklässt.
- **Schema-Versionierung** über `PRAGMA user_version`: jede künftige
  Schemaänderung ist eine nummerierte Migration im Code, analog zu den
  bisherigen `setup/migrate_*.mjs`, aber beim App-Start automatisch.

### Was wegfällt

- `pb_hooks/` (nur der Depot-Kurs-Proxy)
- `Depot.jsx`, `depotPref.js`, `depot_positions`, `depot_trades`, `fetchQuote`, `fetchHistory`
- Login-Bildschirm und `pb.authStore` in `App.jsx` — die App startet direkt.
  Optional später: App-Sperre per Geräte-PIN/Fingerabdruck.
- Abhängigkeit `pocketbase` im Store-Build

## Neu zu bauen

1. **Backup & Wiederherstellen** (Pflicht vor dem ersten Release)
   - Export als eine JSON-Datei mit allen Sammlungen und Schema-Version,
     angeboten über den Android-„Teilen"-Dialog (Mail, Drive, Dateien …).
   - Import einer solchen Datei ersetzt den Datenbestand vollständig, nach
     ausdrücklicher Bestätigung.
   - Zusätzlich sinnvoll: Android Auto Backup für die Datenbankdatei zulassen,
     damit ein Gerätewechsel ohne manuellen Export funktioniert.
2. **Ersteinrichtung** statt Login: Standardkategorien (`seedDefaults()`
   existiert bereits) plus erstes Konto anlegen.
3. **Datei teilen → Import** (kann nach dem ersten Release kommen):
   CSV-/PDF-Auszug aus Banking-App oder Downloads per „Teilen" direkt an den
   Import schicken.

## Eure eigene Instanz

Offen, bitte entscheiden:

- **A) Umsteigen**: Ihr nutzt künftig selbst die Store-App. Eure bestehenden
  Daten lassen sich einmalig über ein Export-Skript aus PocketBase ins
  Backup-JSON-Format bringen und in der App wiederherstellen. PocketBase,
  Docker und `bumblebeee` entfallen danach. Nachteil: Mehrere Geräte im
  Haushalt teilen keine Daten mehr.
- **B) Beides behalten**: `pb.js` bekommt zwei Implementierungen, die per
  Build-Variable gewählt werden. Doppelte Pflege jeder Datenzugriffsfunktion.

Empfehlung: **A**, sofern nur ein Gerät pro Haushalt bucht. Zwei Speicherwege
dauerhaft parallel zu pflegen widerspricht dem Grundsatz, dass die einfachere
Lösung gewinnt.

## Play Store

- Entwicklerkonto: einmalig 25 $. Neue private Konten müssen vor der
  Veröffentlichung einen geschlossenen Test mit mindestens 12 Testern über
  14 Tage durchlaufen.
- Pflichtangaben: Datenschutzerklärung (kurz, da keine Daten das Gerät
  verlassen), Formular „Datensicherheit", Erklärung zu Finanzfunktionen
  (reines Haushaltsbuch, keine Kredite/Zahlungen).
- Jährlich: Anhebung auf das von Google geforderte Android-API-Level.
- Signierschlüssel sicher verwahren (Play App Signing nutzen).
- Store-Beschreibung ehrlich halten: Der PDF-Import kennt nur das
  DKB-Layout, der CSV-Import ist auf deutsche Bank-Exporte zugeschnitten.
- Versionierung: `versionName` aus `app/package.json`, `versionCode` daraus
  abgeleitet (z. B. `MAJOR*10000 + MINOR*100 + PATCH`). Ein Store-Release
  wäre ein natürlicher Anlass für `1.0.0` — laut Versionsregel nur nach
  Rückfrage.

## Phasen

| Phase | Inhalt | Umfang |
|---|---|---|
| 1 | Depot und Login entfernen, Capacitor-Hülle, App startet auf dem Gerät (noch mit Test-Backend) | klein |
| 2 | `pb.js` → SQLite inkl. Schema, Indizes, Migrationen | mittel — der Kern |
| 3 | Backup/Wiederherstellen, Ersteinrichtung | klein bis mittel |
| 4 | Store-Vorbereitung: Icon, Datenschutzerklärung, Signierung, geschlossener Test | vor allem Wartezeit |
| 5 (optional) | Teilen-Ziel für CSV/PDF, App-Sperre | klein |

## Tests

`csv.test.js`, `pdf.test.js` und `ruecklagen.test.js` laufen unverändert
weiter. Für die neue Datenschicht wäre ein Test gegen eine echte SQLite in
Node (z. B. über `sql.js` als reine Dev-Abhängigkeit) sinnvoll, weil dort
jetzt Logik liegt, die vorher PocketBase übernommen hat (eindeutiger Index,
Filter, Sortierung). Das ist eine neue Dev-Abhängigkeit und wird vor
Phase 2 entschieden.
