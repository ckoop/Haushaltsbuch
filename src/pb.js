import { todayISO } from "./ui.jsx";
import { query, run, batch, genId, nowStamp, dateStamp, isUniqueViolation } from "./db.js";

// Store-App: lokale SQLite-Datenbank statt PocketBase, kein Server, keine
// Anmeldung (siehe docs/ANDROID.md). Diese Datei behaelt bewusst dieselben
// Funktionsnamen und Rueckgabeformen wie die fruehere PocketBase-Fassung -
// die Screens importieren ausschliesslich diese Datei und merken vom Umbau
// nichts.

// ------------------------------------------------------------------- Zeitraum

export const monthRange = (y, m) => {
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  const end = `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
  return { start, end, key: start.slice(0, 7) };
};

// Datumsfelder liegen wie frueher bei PocketBase als "2026-08-31 00:00:00.000Z" vor.
export const dateOnly = (v) => (v ?? "").slice(0, 10);

// -------------------------------------------------------------- Low-Level-Helfer

function encode(v) {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

// date/next_due sind PocketBase-artige "date"-Felder: reine "YYYY-MM-DD"-
// Eingaben von den Screens bekommen dieselbe Zeitstempel-Endung angehaengt,
// damit Textvergleiche (date < {:end}) und dateOnly() unveraendert funktionieren.
function encodeCol(col, v) {
  if (col === "date" || col === "next_due") return dateStamp(v);
  return encode(v);
}

const BOOL_COLS = {
  accounts: ["archived"], categories: ["archived"],
  import_profiles: ["decimal_comma"], recurring_rules: ["active"],
};
const JSON_COLS = {
  transactions: ["tags"], rules: ["tags"], recurring_rules: ["tags"],
};

function decodeRow(table, row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of BOOL_COLS[table] ?? []) out[c] = !!out[c];
  for (const c of JSON_COLS[table] ?? []) out[c] = out[c] ? JSON.parse(out[c]) : [];
  return out;
}
const decodeRows = (table, rows) => rows.map((r) => decodeRow(table, r));

async function getOne(table, id) {
  const rows = await query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return decodeRow(table, rows[0]);
}

async function upsert(table, cols, row) {
  if (row.id) {
    const sets = cols.map((c) => `${c} = ?`).join(", ");
    const params = cols.map((c) => encodeCol(c, row[c]));
    params.push(row.id);
    await run(`UPDATE ${table} SET ${sets} WHERE id = ?`, params);
    return getOne(table, row.id);
  }
  const id = genId();
  const allCols = ["id", ...cols];
  await run(
    `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})`,
    [id, ...cols.map((c) => encodeCol(c, row[c]))]
  );
  return getOne(table, id);
}

async function countWhere(sql, params) {
  const rows = await query(sql, params);
  return rows[0]?.c ?? 0;
}

// ------------------------------------------------------------------- Stammdaten

const ACCOUNT_COLS = ["name", "short", "type", "start_cents", "sort", "archived", "person", "icon", "parent_account"];
const CATEGORY_COLS = ["name", "icon", "kind", "color", "sort", "archived"];
const PEOPLE_COLS = ["name"];
const RULE_COLS = ["pattern", "category", "tags", "priority"];
const IMPORT_PROFILE_COLS = [
  "name", "delimiter", "encoding", "date_format", "decimal_comma", "skip_rows",
  "col_date", "col_amount", "col_payee", "col_purpose", "default_account",
];

export const listAccounts = async () =>
  decodeRows("accounts", await query("SELECT * FROM accounts ORDER BY sort, name"));

export const saveAccount = (a) => upsert("accounts", ACCOUNT_COLS, a);
export const deleteAccount = (id) => run("DELETE FROM accounts WHERE id = ?", [id]);

export const listCategories = async () =>
  decodeRows("categories", await query("SELECT * FROM categories ORDER BY sort, name"));

export const saveCategory = (c) => upsert("categories", CATEGORY_COLS, c);
export const deleteCategory = (id) => run("DELETE FROM categories WHERE id = ?", [id]);

// Nur ein Label an Konten, kein eigener Login - siehe CLAUDE.md.
export const listPeople = () => query("SELECT * FROM people ORDER BY name");
export const savePerson = (p) => upsert("people", PEOPLE_COLS, p);
export const deletePerson = (id) => run("DELETE FROM people WHERE id = ?", [id]);

export const countAccountsByPerson = (personId) =>
  countWhere("SELECT COUNT(*) as c FROM accounts WHERE person = ?", [personId]);

// Virtuelle Unterkonten (mehrere Sparziele auf einem echten Sparkonto, s.
// accounts.parent_account) - fuer die gruppierte Anzeige im Konten-Tab und
// den kombinierten Kontostand-Check beim CSV-Import.
export const listChildAccounts = async (parentId) =>
  decodeRows("accounts", await query("SELECT * FROM accounts WHERE parent_account = ?", [parentId]));

export const countChildAccounts = (accountId) =>
  countWhere("SELECT COUNT(*) as c FROM accounts WHERE parent_account = ?", [accountId]);

export const countByCategory = (categoryId) =>
  countWhere("SELECT COUNT(*) as c FROM transactions WHERE category = ?", [categoryId]);

export const listRules = async () =>
  decodeRows("rules", await query("SELECT * FROM rules ORDER BY priority DESC"));

// ------------------------------------------------------------------- Tags

export const listTags = () => query("SELECT * FROM tags ORDER BY name");
export const createTag = async (name) => {
  const id = genId();
  await run("INSERT INTO tags (id, name) VALUES (?, ?)", [id, name]);
  return getOne("tags", id);
};

export const saveRule = (r) => upsert("rules", RULE_COLS, r);
export const deleteRule = (id) => run("DELETE FROM rules WHERE id = ?", [id]);

// ------------------------------------------------------------------- Buchungen

const TX_COLS = [
  "date", "type", "account", "to_account", "category", "tags", "amount_cents",
  "payee", "note", "recurring", "import_hash", "import_batch", "created",
];

function txRow(t) {
  return {
    date: t.date, type: t.type, account: t.account, to_account: t.to_account ?? null,
    category: t.category ?? null, tags: t.tags ?? [], amount_cents: t.amount_cents,
    payee: t.payee ?? null, note: t.note ?? null, recurring: t.recurring ?? null,
    import_hash: t.import_hash ?? "", import_batch: t.import_batch ?? null, created: nowStamp(),
  };
}

export async function listTransactions(y, m) {
  const { start, end } = monthRange(y, m);
  const rows = await query(
    "SELECT * FROM transactions WHERE date >= ? AND date < ? ORDER BY date DESC, created DESC",
    [start, end]
  );
  return decodeRows("transactions", rows);
}

// Fuer den Kontostand: alles bis zum Monatsende, nicht nur der Monat selbst.
export function listTransactionsUntil(y, m) {
  const { end } = monthRange(y, m);
  return query(
    "SELECT id, type, account, to_account, amount_cents FROM transactions WHERE date < ?",
    [end]
  );
}

// Fuer die Jahresansicht in der Auswertung: ein Kalenderjahr auf einmal statt
// zwoelf Einzelaufrufen.
export async function listTransactionsForYear(y) {
  const start = `${y}-01-01`;
  const end = `${y + 1}-01-01`;
  const rows = await query(
    "SELECT * FROM transactions WHERE date >= ? AND date < ? ORDER BY date DESC, created DESC",
    [start, end]
  );
  return decodeRows("transactions", rows);
}

// Fuer die Einkommens-Hochrechnung in Buchungen.jsx: Buchungen der
// vorherigen `monthsBack` VOLLEN Monate vor y/m in einem Rutsch.
export function listTransactionsForAverage(y, m, monthsBack = 3) {
  const { start: end } = monthRange(y, m);
  const start = addMonths(end, -monthsBack);
  return query(
    "SELECT date, type, amount_cents, account, to_account FROM transactions WHERE date >= ? AND date < ?",
    [start, end]
  );
}

// Suche ueber Empfaenger/Verwendungszweck, bewusst ueber die komplette
// Historie statt nur den gerade sichtbaren Monat. Kategorie/Tags sind
// Relationen, kein Text - ein Treffer auf ihrem Namen laeuft deshalb ueber
// vom Aufrufer schon client-seitig aufgeloeste IDs, nicht ueber einen
// eigenen Textvergleich. minCents/maxCents/dateFrom/dateTo erweitern die
// reine Textsuche um Betrags- und Datumsbereich, UND-verknuepft mit der
// bisherigen Text/Kategorie/Tag-ODER-Gruppe.
export function searchTransactions(q, { categoryIds = [], tagIds = [], minCents, maxCents, dateFrom, dateTo } = {}) {
  const text = q.trim();
  const orParts = [];
  const params = [];
  if (text) {
    orParts.push("payee LIKE ? COLLATE NOCASE");
    params.push(`%${text}%`);
    orParts.push("note LIKE ? COLLATE NOCASE");
    params.push(`%${text}%`);
  }
  for (const id of categoryIds) { orParts.push("category = ?"); params.push(id); }
  for (const id of tagIds) {
    orParts.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)");
    params.push(id);
  }
  const andParts = [];
  if (orParts.length > 0) andParts.push(`(${orParts.join(" OR ")})`);
  if (minCents !== undefined) { andParts.push("amount_cents >= ?"); params.push(minCents); }
  if (maxCents !== undefined) { andParts.push("amount_cents <= ?"); params.push(maxCents); }
  if (dateFrom) { andParts.push("date >= ?"); params.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { andParts.push("date <= ?"); params.push(`${dateTo} 23:59:59`); }
  const where = andParts.length > 0 ? `WHERE ${andParts.join(" AND ")}` : "";
  return query(`SELECT * FROM transactions ${where} ORDER BY date DESC, created DESC`, params)
    .then((rows) => decodeRows("transactions", rows));
}

// Ungefiltert alle Budgets - fuer den "Nur ohne Budget"-Suchfilter (App.jsx).
export const listAllBudgets = () => query("SELECT * FROM budgets");

export async function createTransaction(t) {
  const id = genId();
  const row = txRow(t);
  await run(
    `INSERT INTO transactions (id, ${TX_COLS.join(", ")}) VALUES (?, ${TX_COLS.map(() => "?").join(", ")})`,
    [id, ...TX_COLS.map((c) => encodeCol(c, row[c]))]
  );
  return getOne("transactions", id);
}

export async function updateTransaction(id, patch) {
  const cols = Object.keys(patch);
  if (cols.length > 0) {
    const sets = cols.map((c) => `${c} = ?`).join(", ");
    const params = cols.map((c) => encodeCol(c, patch[c]));
    params.push(id);
    await run(`UPDATE transactions SET ${sets} WHERE id = ?`, params);
  }
  return getOne("transactions", id);
}

export const deleteTransaction = (id) => run("DELETE FROM transactions WHERE id = ?", [id]);

// Sucht auf dem gewaehlten Gegenkonto eine Buchung, die zu einer nachtraeglich
// in eine Umbuchung umzuwandelnden Buchung passen wuerde - gleicher Tag,
// spiegelverkehrter Betrag. Nur ein Hinweis fuers UI (TxDetail.jsx).
export async function findTransferCounterpart(accountId, date, amountCents, excludeId) {
  const d = dateOnly(date);
  const rows = await query(
    `SELECT id, date, amount_cents, payee FROM transactions
     WHERE account = ? AND date >= ? AND date <= ? AND amount_cents = ? AND type != 'transfer' AND id != ?`,
    [accountId, `${d} 00:00:00`, `${d} 23:59:59`, amountCents, excludeId]
  );
  return rows[0] ?? null;
}

export const countByAccount = (accountId) =>
  countWhere(
    "SELECT COUNT(*) as c FROM transactions WHERE account = ? OR to_account = ?",
    [accountId, accountId]
  );

// ------------------------------------------------------------- Daueraufträge

export async function listRecurringRules() {
  return decodeRows("recurring_rules", await query("SELECT * FROM recurring_rules ORDER BY next_due"));
}

// Sucht eine bereits bestehende aktive Regel, die zu den angegebenen Eckdaten
// passen wuerde - gleiches Matching wie der Duplikat-Schutz in
// saveRecurringRule() (Konto/Betrag/Rhythmus/Empfaenger und je nach Typ
// gleiche Kategorie bzw. gleiches Zielkonto).
export async function findRecurringRuleFor(r) {
  const rows = await query(
    "SELECT * FROM recurring_rules WHERE account = ? AND type = ? AND amount_cents = ? AND frequency = ? AND active = 1",
    [r.account, r.type, r.amount_cents, r.frequency]
  );
  const candidates = decodeRows("recurring_rules", rows);
  const payee = (r.payee || "").trim().toLowerCase();
  return candidates.find((c) =>
    (c.payee || "").trim().toLowerCase() === payee &&
    (r.type === "transfer" ? c.to_account === r.to_account : c.category === r.category)) ?? null;
}

const RR_COLS = [
  "type", "account", "to_account", "category", "tags", "amount_cents",
  "payee", "note", "frequency", "next_due", "active", "created",
];

// Verhindert doppelt angelegte Daueraufträge (kein Unique-Index moeglich -
// "gleich" ist hier eine Kombination aus mehreren Feldern). Betrifft nur das
// Anlegen, nicht das Bearbeiten (r.id gesetzt).
export async function saveRecurringRule(r) {
  if (r.id) {
    const cols = Object.keys(r).filter((c) => c !== "id");
    const sets = cols.map((c) => `${c} = ?`).join(", ");
    const params = cols.map((c) => encodeCol(c, r[c]));
    params.push(r.id);
    await run(`UPDATE recurring_rules SET ${sets} WHERE id = ?`, params);
    return getOne("recurring_rules", r.id);
  }
  const dup = await findRecurringRuleFor(r);
  if (dup) throw new Error("Dieser Dauerauftrag existiert schon (gleiches Konto, Betrag, Rhythmus und Empfänger).");
  const id = genId();
  const row = { ...r, tags: r.tags ?? [], active: r.active ?? true, created: nowStamp() };
  await run(
    `INSERT INTO recurring_rules (id, ${RR_COLS.join(", ")}) VALUES (?, ${RR_COLS.map(() => "?").join(", ")})`,
    [id, ...RR_COLS.map((c) => encodeCol(c, row[c]))]
  );
  return getOne("recurring_rules", id);
}

export const deleteRecurringRule = (id) => run("DELETE FROM recurring_rules WHERE id = ?", [id]);

export const countRecurringRulesByAccount = (accountId) =>
  countWhere(
    "SELECT COUNT(*) as c FROM recurring_rules WHERE account = ? OR to_account = ?",
    [accountId, accountId]
  );

export const countRecurringRulesByCategory = (categoryId) =>
  countWhere("SELECT COUNT(*) as c FROM recurring_rules WHERE category = ?", [categoryId]);

// Aktive Dauerauftraege mit unregelmaessiger Faelligkeit - Grundlage fuer die
// Ruecklagen-Anzeige in Budgets.jsx (siehe ruecklagen.js).
export async function listReserveRules(accountId) {
  const rows = await query(
    `SELECT * FROM recurring_rules
     WHERE account = ? AND active = 1 AND type = 'tx' AND (frequency = 'quarterly' OR frequency = 'yearly')`,
    [accountId]
  );
  return decodeRows("recurring_rules", rows);
}

// Alle bisher aus einer Regel automatisch entstandenen Buchungen (Hash-
// Praefix "rule:<id>:", s. runDueRecurringRules) - Grundlage, um den
// Ruecklagen-Saldo ueber mehrere Monate hinweg rein aus vorhandenen Daten
// abzuleiten, ohne einen eigenen fortgeschriebenen Saldo zu speichern.
export const listRuleTransactions = (ruleId) =>
  query(
    "SELECT date, amount_cents FROM transactions WHERE import_hash LIKE ? ORDER BY date",
    [`%rule:${ruleId}:%`]
  );

const MONTHS_PER = { monthly: 1, quarterly: 3, yearly: 12 };

// Naechstes Datum nach n Monaten, auf gueltigen Kalendertag begrenzt -
// 31. Jan + 1 Monat -> 28./29. Feb, nicht 3. Maerz.
export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

// Faellige Daueraufträge nachbuchen - client-getriggert beim App-Start, kein
// Cron. Dedup ueber den bestehenden import_hash-Unique-Index. Gibt die neu
// erzeugten Buchungen zurueck (nicht nur die Anzahl), damit die UI zeigen
// kann, was konkret automatisch gebucht wurde.
export async function runDueRecurringRules() {
  const today = todayISO();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const due = decodeRows(
    "recurring_rules",
    await query("SELECT * FROM recurring_rules WHERE active = 1 AND next_due < ?", [tomorrow])
  );
  const createdRows = [];
  for (const rule of due) {
    try {
      let next = dateOnly(rule.next_due);
      while (next <= today) {
        try {
          const row = await createTransaction({
            date: next, type: rule.type, account: rule.account,
            to_account: rule.to_account || undefined, category: rule.category || undefined,
            tags: rule.tags ?? [], amount_cents: rule.amount_cents, payee: rule.payee, note: rule.note,
            recurring: rule.frequency, import_hash: `rule:${rule.id}:${next}`,
          });
          createdRows.push(row);
        } catch (e) {
          // Unique-Verletzung = diese Periode wurde schon gebucht - ok.
          if (!isUniqueViolation(e)) throw e;
        }
        next = addMonths(next, MONTHS_PER[rule.frequency]);
      }
      if (next !== dateOnly(rule.next_due)) {
        await run("UPDATE recurring_rules SET next_due = ? WHERE id = ?", [dateStamp(next), rule.id]);
      }
    } catch (e) {
      // Eine kaputte Regel (z. B. Konto zwischenzeitlich geloescht) soll die
      // anderen nicht blockieren - naechster Versuch beim naechsten App-Start.
      console.error("Dauerauftrag fehlgeschlagen:", rule.id, e);
    }
  }
  return createdRows;
}

// ------------------------------------------------------------------- Budgets

// Budgets gelten pro Konto, nicht kontouebergreifend - ohne ein konkretes
// Konto gibt es deshalb keine Budgets zu zeigen ("Alle Konten"-Ansicht).
export async function listBudgets(monthKey, accountId) {
  if (!accountId || accountId === "alle") return [];
  const rows = await query(
    "SELECT * FROM budgets WHERE account = ? AND (month = ? OR month = '*')",
    [accountId, monthKey]
  );
  // Ein Monatsbudget schlaegt das Dauerbudget derselben Kategorie.
  const out = new Map();
  for (const b of rows) {
    const prev = out.get(b.category);
    if (!prev || (prev.month === "*" && b.month !== "*")) out.set(b.category, b);
  }
  return [...out.values()];
}

export async function setBudget(accountId, categoryId, month, cents) {
  const found = await query(
    "SELECT * FROM budgets WHERE account = ? AND category = ? AND month = ?",
    [accountId, categoryId, month]
  );
  if (cents <= 0) {
    if (found[0]) await run("DELETE FROM budgets WHERE id = ?", [found[0].id]);
    return null;
  }
  if (found[0]) {
    await run("UPDATE budgets SET amount_cents = ? WHERE id = ?", [cents, found[0].id]);
    return getOne("budgets", found[0].id);
  }
  const id = genId();
  await run(
    "INSERT INTO budgets (id, account, category, month, amount_cents) VALUES (?, ?, ?, ?, ?)",
    [id, accountId, categoryId, month, cents]
  );
  return getOne("budgets", id);
}

// ------------------------------------------------------------- Einnahmenziel

// Einnahmen setzen sich aus mehreren Posten zusammen, jeder mit eigener
// Beschriftung. Ein Monatsposten schlaegt die Dauerposten als Ganzes, gleiches
// Prinzip wie bei Budgets. Gilt pro Konto, nicht kontouebergreifend.
export async function listIncomeEntries(monthKey, accountId) {
  if (!accountId || accountId === "alle") return [];
  const rows = await query(
    "SELECT * FROM income_targets WHERE account = ? AND (month = ? OR month = '*') ORDER BY id",
    [accountId, monthKey]
  );
  const specific = rows.filter((r) => r.month === monthKey);
  return specific.length ? specific : rows.filter((r) => r.month === "*");
}

export async function createIncomeEntry(accountId, month, label, cents) {
  const id = genId();
  await run(
    "INSERT INTO income_targets (id, account, month, label, amount_cents) VALUES (?, ?, ?, ?, ?)",
    [id, accountId, month, label, cents]
  );
  return getOne("income_targets", id);
}

export async function updateIncomeEntry(id, label, cents) {
  await run("UPDATE income_targets SET label = ?, amount_cents = ? WHERE id = ?", [label, cents, id]);
  return getOne("income_targets", id);
}

export async function deleteIncomeEntry(id) {
  await run("DELETE FROM income_targets WHERE id = ?", [id]);
}

// Fuer den "Vorschlag"-Button im Budgets-Tab: tatsaechlich gebuchte Einnahmen
// eines Monats auf einem konkreten Konto.
export async function actualIncomeForMonth(y, m, accountId) {
  const { start, end } = monthRange(y, m);
  const rows = await query(
    `SELECT amount_cents FROM transactions
     WHERE date >= ? AND date < ? AND account = ? AND type != 'transfer' AND amount_cents > 0`,
    [start, end, accountId]
  );
  return rows.reduce((s, t) => s + t.amount_cents, 0);
}

// -------------------------------------------------------------- Monatsabschluss

// Pro Konto, nicht global. Gibt ein Set von "JJJJ-MM" zurueck, praktischer
// als die rohen Datensaetze fuer den .has()-Check in der Jahresansicht.
export async function listClosedMonths(accountId) {
  if (!accountId) return new Set();
  const rows = await query("SELECT month FROM closed_months WHERE account = ?", [accountId]);
  return new Set(rows.map((r) => r.month));
}

export async function closeMonth(accountId, month) {
  const id = genId();
  await run("INSERT INTO closed_months (id, account, month) VALUES (?, ?, ?)", [id, accountId, month]);
  return getOne("closed_months", id);
}

export async function reopenMonth(accountId, month) {
  await run("DELETE FROM closed_months WHERE account = ? AND month = ?", [accountId, month]);
}

// ------------------------------------------------------------------- Import

export const listProfiles = async () =>
  decodeRows("import_profiles", await query("SELECT * FROM import_profiles"));

export const saveProfile = (p) => upsert("import_profiles", IMPORT_PROFILE_COLS, p);

export async function createImportRun(r) {
  const id = genId();
  await run(
    "INSERT INTO imports (id, profile, account, filename, row_count, skipped_count, note, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, r.profile ?? null, r.account, r.filename ?? null, r.row_count ?? null, r.skipped_count ?? null, r.note ?? null, nowStamp()]
  );
  return getOne("imports", id);
}

export const listImportRuns = () => query("SELECT * FROM imports ORDER BY created DESC");

// Welche dieser Hashes gibt es schon? In Bloecken abgefragt, weil SQLite pro
// Statement nur eine begrenzte Anzahl Platzhalter erlaubt.
export async function existingHashes(hashes) {
  const found = new Set();
  for (let i = 0; i < hashes.length; i += 400) {
    const chunk = hashes.slice(i, i + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await query(`SELECT import_hash FROM transactions WHERE import_hash IN (${placeholders})`, chunk);
    for (const r of rows) found.add(r.import_hash);
  }
  return found;
}

// Weicher Duplikat-Check gegen den exakten Hash-Vergleich oben: derselbe
// Bank-Umsatz kann in zwei Export-Formaten unterschiedlichen Empfaenger-
// /Zwecktext haben - dann weicht der Hash ab. Datum und Betrag allein sind
// stabil, deshalb hier als reiner Hinweis (nicht blockierend).
export async function existingByDateAmount(account, minDate, maxDate) {
  const rows = await query(
    "SELECT date, amount_cents FROM transactions WHERE account = ? AND date >= ? AND date <= ?",
    [account, minDate, `${maxDate} 23:59:59`]
  );
  return new Set(rows.map((r) => `${r.date.slice(0, 10)}|${r.amount_cents}`));
}

// Kontostand eines Kontos zu einem Stichtag, fuer den Kontostand-Sanity-Check
// beim CSV-Import - Anfangssaldo + alle Buchungen bis zu diesem Datum,
// Umbuchungen richtig verrechnet.
export async function accountBalanceAsOf(accountId, throughDate) {
  const accRows = await query("SELECT start_cents FROM accounts WHERE id = ?", [accountId]);
  const rows = await query(
    `SELECT type, account, to_account, amount_cents FROM transactions
     WHERE date <= ? AND (account = ? OR to_account = ?)`,
    [`${throughDate} 23:59:59`, accountId, accountId]
  );
  let b = accRows[0]?.start_cents ?? 0;
  for (const t of rows) {
    if (t.type === "transfer") {
      if (t.account === accountId) b -= t.amount_cents;
      if (t.to_account === accountId) b += t.amount_cents;
    } else if (t.account === accountId) {
      b += t.amount_cents;
    }
  }
  return b;
}

// Mehrere Buchungen in einer SQL-Transaktion anlegen (Ersatz fuer
// PocketBase-Batches).
export async function batchCreateTransactions(rows, onProgress) {
  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const statements = chunk.map((r) => {
      const row = txRow(r);
      return {
        sql: `INSERT INTO transactions (id, ${TX_COLS.join(", ")}) VALUES (?, ${TX_COLS.map(() => "?").join(", ")})`,
        params: [genId(), ...TX_COLS.map((c) => encodeCol(c, row[c]))],
      };
    });
    await batch(statements);
    done += chunk.length;
    onProgress?.(done, rows.length);
  }
  return done;
}

// Sobald mindestens eine Buchung des Imports in einem fuer das Import-Konto
// abgeschlossenen Monat liegt, ist der ganze Ruecknahme-Vorgang gesperrt -
// lieber komplett blockiert als nur einzelne Zeilen still uebrig zu lassen.
export async function deleteImportRun(runId) {
  const runRows = await query("SELECT id, account FROM imports WHERE id = ?", [runId]);
  const theRun = runRows[0];
  const rows = await query("SELECT id, date FROM transactions WHERE import_batch = ?", [runId]);
  const months = new Set(rows.map((r) => dateOnly(r.date).slice(0, 7)));
  if (months.size > 0) {
    const closed = await listClosedMonths(theRun.account);
    if ([...months].some((m) => closed.has(m))) {
      throw new Error(
        "Dieser Import betrifft einen abgeschlossenen Monat und kann nicht mehr zurückgenommen werden."
      );
    }
  }
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await batch(chunk.map((r) => ({ sql: "DELETE FROM transactions WHERE id = ?", params: [r.id] })));
  }
  await run("DELETE FROM imports WHERE id = ?", [runId]);
  return rows.length;
}

// ------------------------------------------------------------------- Erstbefüllung

export const DEFAULT_CATEGORIES = [
  { name: "Lebensmittel", icon: "cart",      kind: "expense", color: "emerald" },
  { name: "Restaurant",   icon: "utensils",  kind: "expense", color: "orange" },
  { name: "Mobilität",    icon: "bus",       kind: "expense", color: "violet" },
  { name: "Wohnen",       icon: "home",      kind: "expense", color: "sky" },
  { name: "Energie",      icon: "zap",       kind: "expense", color: "yellow" },
  { name: "Freizeit",     icon: "film",      kind: "expense", color: "pink" },
  { name: "Gesundheit",   icon: "heart",     kind: "expense", color: "rose" },
  { name: "Kleidung",     icon: "shirt",     kind: "expense", color: "amber" },
  { name: "Abos",         icon: "phone",     kind: "expense", color: "teal" },
  { name: "Sonstiges",    icon: "dots",      kind: "expense", color: "stone" },
  { name: "Einkommen",    icon: "income",    kind: "income",  color: "lime" },
];

export async function seedDefaults() {
  const statements = DEFAULT_CATEGORIES.map((c, i) => ({
    sql: "INSERT INTO categories (id, name, icon, kind, color, sort, archived) VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [genId(), c.name, c.icon, c.kind, c.color, i, 0],
  }));
  statements.push({
    sql: "INSERT INTO accounts (id, name, short, type, start_cents, sort, archived) VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [genId(), "Girokonto", "Giro", "giro", 0, 0, 0],
  });
  await batch(statements);
}

// ------------------------------------------------------------ Backup/Restore

// Schema-Version des Backup-Formats, unabhaengig von PRAGMA user_version
// (db.js) - die dortige Zahl beschreibt das SQLite-Tabellenschema, diese hier
// das JSON-Exportformat. Beides aendert sich nicht zwangslaeufig gleichzeitig.
const BACKUP_SCHEMA_VERSION = 1;

// Reihenfolge ist die Loeschreihenfolge bei restoreBackup egal (keine
// Foreign-Key-Constraints in der SQLite-Datei, s. db.js), aber die
// Einfuegereihenfolge folgt trotzdem den Referenzen (Konten vor Buchungen
// usw.), damit ein spaeteres Nachruesten echter Constraints nichts bricht.
const BACKUP_TABLES = {
  people: ["id", "name"],
  accounts: ["id", "name", "short", "type", "start_cents", "sort", "archived", "person", "icon", "parent_account"],
  categories: ["id", "name", "icon", "kind", "color", "sort", "archived"],
  tags: ["id", "name"],
  import_profiles: [
    "id", "name", "delimiter", "encoding", "date_format", "decimal_comma", "skip_rows",
    "col_date", "col_amount", "col_payee", "col_purpose", "default_account",
  ],
  imports: ["id", "profile", "account", "filename", "row_count", "skipped_count", "note", "created"],
  rules: ["id", "pattern", "category", "tags", "priority"],
  transactions: [
    "id", "date", "type", "account", "to_account", "category", "tags", "amount_cents",
    "payee", "note", "recurring", "import_hash", "import_batch", "created",
  ],
  budgets: ["id", "account", "category", "month", "amount_cents"],
  income_targets: ["id", "account", "month", "label", "amount_cents"],
  closed_months: ["id", "account", "month"],
  recurring_rules: [
    "id", "type", "account", "to_account", "category", "tags", "amount_cents",
    "payee", "note", "frequency", "next_due", "active", "created",
  ],
};

// Eine JSON-Datei mit allen Tabellen - Grundlage fuer den Android-"Teilen"-
// Dialog (Einstellungen.jsx). Bewusst die volle, unveraenderte Historie ohne
// Zeitraum-Filter, anders als z. B. listTransactions(). Booleans/Tags kommen
// im logischen Format (true/false, Array) statt der rohen SQLite-Kodierung
// (0/1, JSON-Text) - lesbar und unabhaengig von db.js-Interna.
export async function exportBackup() {
  const data = {};
  for (const [table, cols] of Object.entries(BACKUP_TABLES)) {
    const rows = await query(`SELECT ${cols.join(", ")} FROM ${table}`);
    data[table] = decodeRows(table, rows);
  }
  return {
    app: "haushaltsbuch",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: nowStamp(),
    data,
  };
}

// Ersetzt den gesamten Datenbestand durch den Inhalt einer Sicherungsdatei -
// nur nach ausdruecklicher Bestaetigung im UI (Einstellungen.jsx), nicht
// rueckgaengig zu machen. IDs/Zeitstempel werden unveraendert aus der Datei
// uebernommen (nicht neu erzeugt), damit Relationen zwischen den Tabellen
// (z. B. transactions.account -> accounts.id) erhalten bleiben.
export async function restoreBackup(backup) {
  if (!backup || typeof backup !== "object" || !backup.data || typeof backup.data !== "object") {
    throw new Error("Das ist keine gueltige Haushaltsbuch-Sicherungsdatei.");
  }
  if (backup.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error("Diese Sicherung stammt aus einer neueren App-Version und kann hier nicht eingelesen werden.");
  }

  const tables = Object.keys(BACKUP_TABLES);
  await batch(tables.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] })));

  for (const table of tables) {
    const cols = BACKUP_TABLES[table];
    const rows = backup.data[table] ?? [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await batch(chunk.map((row) => ({
        sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        params: cols.map((c) => encode(row[c])),
      })));
    }
  }
}
