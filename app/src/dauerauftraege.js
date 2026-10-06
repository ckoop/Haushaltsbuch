// Reine Logik rund um das Nachbuchen fälliger Daueraufträge - ohne
// PocketBase-Zugriff, wie csv.js/ruecklagen.js, damit sie ohne Browser testbar
// bleibt. Der Datenzugriff (Kandidaten laden, buchen) lebt in pb.js.

// Wie weit vom Fälligkeitstag entfernt eine schon vorhandene Buchung liegen
// darf und trotzdem als "evtl. dieselbe" gilt. Banken buchen Daueraufträge
// gern ein paar Tage früher/später (Wochenende, Feiertag, abweichender
// Ausführungstag) - 7 Tage deckt das ab, ohne bei einer monatlichen Regel in
// die Nachbarperiode zu greifen.
export const RULE_DUP_WINDOW_DAYS = 7;

const DAY_MS = 86400000;

// ISO-Datum (YYYY-MM-DD) um n Tage verschieben. Über UTC gerechnet, damit
// Sommer-/Winterzeit-Umstellungen kein Datum verrutschen lassen.
export function shiftDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

const dayOf = (v) => (v ?? "").slice(0, 10);

// Welche der schon vorhandenen Buchungen könnten dieselbe sein wie die, die
// der Dauerauftrag `rule` für den Fälligkeitstag `due` (ISO) gleich anlegen
// würde? Gleiches Konto, gleicher Typ, gleicher Betrag (bei Umbuchungen auch
// gleiches Zielkonto), Datum im Fenster um den Fälligkeitstag.
// Bewusst NICHT mitgezählt: Buchungen, die selbst aus einem Dauerauftrag
// stammen (import_hash "rule:..."). Zwei Regeln mit gleichem Betrag auf
// demselben Konto würden sich sonst gegenseitig blockieren, und ein
// Doppelbuchungsschutz für dieselbe Regel läuft ohnehin schon über den
// eindeutigen Hash. `claimed` (Set von Buchungs-IDs) verhindert, dass eine
// vorhandene Buchung bei mehreren Regeln gleichzeitig als Kandidat auftaucht.
export function findDuplicateCandidates(rule, due, txs, claimed = new Set()) {
  const from = shiftDate(due, -RULE_DUP_WINDOW_DAYS);
  const to = shiftDate(due, RULE_DUP_WINDOW_DAYS);
  return txs.filter((t) => {
    if (claimed.has(t.id)) return false;
    if ((t.import_hash ?? "").startsWith("rule:")) return false;
    if (t.account !== rule.account || t.type !== rule.type) return false;
    if (t.amount_cents !== rule.amount_cents) return false;
    if (rule.type === "transfer" && (t.to_account ?? "") !== (rule.to_account ?? "")) return false;
    const d = dayOf(t.date);
    return d >= from && d <= to;
  });
}

// Herkunft einer vorhandenen Buchung für die Beschriftung in der Rückfrage:
// mit Import-Hash kommt sie aus einem CSV-/PDF-Import, ohne wurde sie von
// Hand erfasst.
export const originOf = (t) => ((t.import_hash ?? "") ? "Import" : "von Hand erfasst");
