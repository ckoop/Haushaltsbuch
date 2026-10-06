// Reine Logik für die JSON-Sicherung (Einstellungen) — ohne PocketBase-Zugriff,
// damit sie sich wie csv.js/pdf.js ohne Server testen lässt. Das Lesen und
// Schreiben der Datensätze selbst steht in pb.js (exportBackup/restoreBackup).

// Eigenes Versionsfeld für das Dateiformat, unabhängig von der App-Version —
// es ändert sich nur, wenn sich die Struktur der Datei ändert. Dasselbe Format
// schreibt die Android-App (haushaltsbuch-capacitor), beide Dateien sind
// untereinander einlesbar.
export const BACKUP_SCHEMA_VERSION = 1;

// Anlege-Reihenfolge: Ziel einer Relation vor allem, was darauf zeigt.
// Gelöscht wird in umgekehrter Reihenfolge (eine Pflicht-Relation sperrt das
// Löschen ihres Ziels, solange noch etwas darauf zeigt).
export const BACKUP_COLLECTIONS = [
  "people", "accounts", "categories", "tags", "import_profiles", "imports",
  "rules", "transactions", "budgets", "income_targets", "closed_months",
  "recurring_rules", "depot_positions", "depot_trades",
];

// PocketBase-Ids: genau 15 Zeichen aus [a-z0-9]. Beim Anlegen mit eigener Id
// lehnt PocketBase alles andere ab — lieber vorab in der ganzen Datei prüfen
// als mitten im Einspielen.
const ID_RE = /^[a-z0-9]{15}$/;

// Systemfelder, die PocketBase selbst setzt und nicht zum Datensatz gehören.
// `updated` entfällt bewusst: PocketBase überschreibt es beim Anlegen ohnehin.
const SYSTEM_FIELDS = ["collectionId", "collectionName", "expand", "updated"];

export function stripRecord(rec) {
  const out = { ...rec };
  for (const f of SYSTEM_FIELDS) delete out[f];
  return out;
}

// Prüft eine eingelesene Datei, ohne etwas zu schreiben. Liefert die Zahl der
// Datensätze je Sammlung für die Bestätigungsansicht. Sammlungen, die in der
// Datei ganz fehlen (z. B. Depot in einer Android-Sicherung), landen nicht in
// `counts` — restoreBackup() lässt sie unverändert, statt sie zu leeren.
export function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || backup.app !== "haushaltsbuch"
      || !backup.data || typeof backup.data !== "object") {
    throw new Error("Das ist keine gültige Haushaltsbuch-Sicherungsdatei.");
  }
  if (!(backup.schemaVersion <= BACKUP_SCHEMA_VERSION)) {
    throw new Error("Diese Sicherung stammt aus einer neueren App-Version und kann hier nicht eingelesen werden.");
  }
  const counts = {};
  for (const name of BACKUP_COLLECTIONS) {
    const rows = backup.data[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`Sicherung beschädigt: "${name}" ist keine Liste.`);
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !ID_RE.test(row.id)) {
        throw new Error(`Sicherung beschädigt: ungültige Id in "${name}".`);
      }
      if (seen.has(row.id)) throw new Error(`Sicherung beschädigt: doppelte Id in "${name}".`);
      seen.add(row.id);
    }
    counts[name] = rows.length;
  }
  if (Object.keys(counts).length === 0) {
    throw new Error("Die Sicherung enthält keine Daten.");
  }
  return counts;
}

// Sammlungen mit einem `created`-Autodate-Feld, nach dem die App sortiert
// (z. B. "-date,-created" für mehrere Buchungen am selben Tag). PocketBase
// setzt es beim Anlegen immer selbst auf "jetzt" und lässt sich weder beim
// Anlegen noch per Update überschreiben — die ursprüngliche Anlagezeit geht
// beim Wiederherstellen deshalb verloren. Erhalten bleibt nur die Reihenfolge:
// diese Sammlungen werden einzeln und nach altem `created` aufsteigend
// angelegt, damit die neuen Zeitstempel dieselbe Rangfolge ergeben.
export const CREATED_ORDERED = new Set(["imports", "transactions", "recurring_rules", "depot_trades"]);

// Ein Unterkonto (Topf) zeigt auf sein Konto — das muss zuerst existieren.
// Bewusst nur eine Ebene, wie überall sonst in der App.
export function orderForCreate(name, rows) {
  if (name === "accounts") {
    return [...rows.filter((r) => !r.parent_account), ...rows.filter((r) => r.parent_account)];
  }
  if (CREATED_ORDERED.has(name)) {
    return [...rows].sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? "")));
  }
  return rows;
}
