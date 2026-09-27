import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

// Store-App: eine einzige lokale SQLite-Datei ist der einzige Speicherort
// (siehe docs/ANDROID.md). Schema-Version ueber PRAGMA user_version, damit
// kuenftige Aenderungen als nummerierte Migration im Code laufen koennen,
// analog zu den fruehreren setup/migrate_*.mjs gegen PocketBase.
const DB_NAME = "haushaltsbuch";
const SCHEMA_VERSION = 1;

const MIGRATIONS = [
  // Version 1: Erststand, deckungsgleich mit setup/schema.mjs (ohne depot_*).
  `
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short TEXT,
    type TEXT NOT NULL,
    start_cents INTEGER,
    sort INTEGER,
    archived INTEGER NOT NULL DEFAULT 0,
    person TEXT,
    icon TEXT,
    parent_account TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    kind TEXT NOT NULL,
    color TEXT,
    sort INTEGER,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags (name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS import_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    delimiter TEXT NOT NULL,
    encoding TEXT NOT NULL,
    date_format TEXT NOT NULL,
    decimal_comma INTEGER NOT NULL DEFAULT 0,
    skip_rows INTEGER,
    col_date TEXT,
    col_amount TEXT,
    col_payee TEXT,
    col_purpose TEXT,
    default_account TEXT
  );

  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    profile TEXT,
    account TEXT NOT NULL,
    filename TEXT,
    row_count INTEGER,
    skipped_count INTEGER,
    note TEXT,
    created TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    priority INTEGER
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    account TEXT NOT NULL,
    to_account TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    amount_cents INTEGER NOT NULL,
    payee TEXT,
    note TEXT,
    recurring TEXT,
    import_hash TEXT NOT NULL DEFAULT '',
    import_batch TEXT,
    created TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
  CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions (account);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_import_hash ON transactions (import_hash) WHERE import_hash != '';

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    category TEXT NOT NULL,
    month TEXT NOT NULL,
    amount_cents INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_acc_cat_month ON budgets (account, category, month);

  CREATE TABLE IF NOT EXISTS income_targets (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    month TEXT NOT NULL,
    label TEXT,
    amount_cents INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_income_targets_acc_month ON income_targets (account, month);

  CREATE TABLE IF NOT EXISTS closed_months (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    month TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_month_acc_month ON closed_months (account, month);

  CREATE TABLE IF NOT EXISTS recurring_rules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    account TEXT NOT NULL,
    to_account TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    amount_cents INTEGER NOT NULL,
    payee TEXT,
    note TEXT,
    frequency TEXT NOT NULL,
    next_due TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created TEXT NOT NULL
  );
  `,
];

let dbPromise = null;

async function open() {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistent = await sqlite.checkConnectionsConsistency();
  const already = (await sqlite.isConnection(DB_NAME, false)).result;
  const db = consistent.result && already
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, "no-encryption", SCHEMA_VERSION, false);
  await db.open();

  const { value: currentVersion } = await db.query("PRAGMA user_version");
  const version = currentVersion?.[0]?.user_version ?? 0;
  for (let v = version; v < MIGRATIONS.length; v++) {
    await db.execute(MIGRATIONS[v]);
  }
  if (version < MIGRATIONS.length) {
    await db.execute(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }
  return db;
}

export function getDb() {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

// crypto.getRandomValues ist im sicheren WebView-Kontext (https://localhost)
// verfuegbar - siehe docs/ANDROID.md. 15 Stellen wie bisherige PocketBase-Ids,
// funktional aber beliebig, es wird nirgends auf das genaue Format geprueft.
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function genId() {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

// Gleiches Textformat wie PocketBase fuer date/autodate-Felder
// ("2026-08-31 00:00:00.000Z"), damit dateOnly() und Textvergleiche
// (date < {:end}) unveraendert funktionieren - s. docs/ANDROID.md.
export function nowStamp() {
  return new Date().toISOString().replace("T", " ");
}
export function dateStamp(isoDateOnly) {
  return isoDateOnly.length > 10 ? isoDateOnly.replace("T", " ") : `${isoDateOnly} 00:00:00.000Z`;
}

export async function query(sql, params = []) {
  const db = await getDb();
  const { values } = await db.query(sql, params);
  return values ?? [];
}

export async function run(sql, params = []) {
  const db = await getDb();
  return db.run(sql, params);
}

// Mehrere Schreibvorgaenge in einer SQL-Transaktion - Ersatz fuer
// PocketBase-Batches (createBatch/send), sicherer als bisher, weil ein
// Abbruch nichts halb geschrieben zuruecklaesst.
export async function batch(statements) {
  const db = await getDb();
  if (statements.length === 0) return;
  await db.executeSet(statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })));
}

export function isUniqueViolation(e) {
  return /unique/i.test(e?.message ?? "");
}
