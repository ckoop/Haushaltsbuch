// Legt alle Sammlungen in PocketBase an.
//
//   npm i pocketbase
//   PB_URL=https://haushalt.example.de PB_EMAIL=... PB_PASSWORD=... node setup/schema.mjs
//
// Das Skript ist wiederholbar: vorhandene Sammlungen werden uebersprungen,
// nicht ueberschrieben. Getestet gegen PocketBase 0.39 (fields-Format ab 0.23).

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

// Jeder angemeldete Nutzer sieht alles. Der Haushalt ist die Zugriffsgrenze,
// nicht die einzelne Person - du legst nur fuer Haushaltsmitglieder Logins an.
const HOUSEHOLD = '@request.auth.id != ""';
const rules = {
  listRule: HOUSEHOLD, viewRule: HOUSEHOLD, createRule: HOUSEHOLD,
  updateRule: HOUSEHOLD, deleteRule: HOUSEHOLD,
};

const text = (name, opts = {}) => ({ type: "text", name, ...opts });
const num = (name, opts = {}) => ({ type: "number", name, ...opts });
const bool = (name) => ({ type: "bool", name });
const sel = (name, values, opts = {}) =>
  ({ type: "select", name, maxSelect: 1, values, ...opts });
const rel = (name, collectionId, opts = {}) =>
  ({ type: "relation", name, collectionId, maxSelect: 1, cascadeDelete: false, ...opts });

const existing = await pb.collections.getFullList();
const idOf = (name) => existing.find((c) => c.name === name)?.id;

async function ensure(def) {
  const found = existing.find((c) => c.name === def.name);
  if (found) {
    console.log(`= ${def.name} existiert bereits, uebersprungen`);
    return found.id;
  }
  const created = await pb.collections.create(def);
  existing.push(created);
  console.log(`+ ${def.name} angelegt`);
  return created.id;
}

// ---------------------------------------------------------------- Stammdaten

const accountsId = await ensure({
  name: "accounts", type: "base", ...rules,
  fields: [
    text("name", { required: true, max: 60 }),
    text("short", { max: 12 }),
    sel("type", ["giro", "bar", "spar", "kk"], { required: true }),
    num("start_cents", { required: false, onlyInt: true }),
    num("sort", { onlyInt: true }),
    bool("archived"),
  ],
});

const categoriesId = await ensure({
  name: "categories", type: "base", ...rules,
  fields: [
    text("name", { required: true, max: 60 }),
    text("icon", { max: 40 }),
    sel("kind", ["expense", "income"], { required: true }),
    text("color", { max: 20 }),
    num("sort", { onlyInt: true }),
    bool("archived"),
  ],
});

const tagsId = await ensure({
  name: "tags", type: "base", ...rules,
  fields: [
    text("name", { required: true, max: 40 }),
  ],
  indexes: [
    // COLLATE NOCASE, damit "Urlaub" und "urlaub" nicht als zwei Tags landen.
    "CREATE UNIQUE INDEX idx_tags_name ON tags (name COLLATE NOCASE)",
  ],
});

// ------------------------------------------------------------------- Import

const importProfilesId = await ensure({
  name: "import_profiles", type: "base", ...rules,
  fields: [
    text("name", { required: true, max: 60 }),
    sel("delimiter", ["semicolon", "comma", "tab"], { required: true }),
    sel("encoding", ["utf-8", "windows-1252"], { required: true }),
    sel("date_format", ["dd.MM.yyyy", "yyyy-MM-dd", "dd/MM/yyyy"], { required: true }),
    bool("decimal_comma"),
    num("skip_rows", { onlyInt: true }),
    // Spaltennamen aus der Kopfzeile der Bank-Datei
    text("col_date", { max: 80 }),
    text("col_amount", { max: 80 }),
    text("col_payee", { max: 80 }),
    text("col_purpose", { max: 80 }),
    rel("default_account", accountsId),
  ],
});

const importsId = await ensure({
  name: "imports", type: "base", ...rules,
  fields: [
    rel("profile", importProfilesId),
    rel("account", accountsId, { required: true }),
    text("filename", { max: 200 }),
    num("row_count", { onlyInt: true }),
    num("skipped_count", { onlyInt: true }),
    { type: "autodate", name: "created", onCreate: true },
  ],
});

const rulesId = await ensure({
  name: "rules", type: "base", ...rules,
  fields: [
    text("pattern", { required: true, max: 120 }),
    rel("category", categoriesId, { required: true }),
    num("priority", { onlyInt: true }),
  ],
});

// ---------------------------------------------------------------- Buchungen

await ensure({
  name: "transactions", type: "base", ...rules,
  fields: [
    { type: "date", name: "date", required: true },
    sel("type", ["tx", "transfer"], { required: true }),
    rel("account", accountsId, { required: true }),
    rel("to_account", accountsId),
    rel("category", categoriesId),
    // Zusaetzliche, freie Dimension neben der einen Pflicht-Kategorie - z. B.
    // "Nebenkosten" quer zu Abos/Wohnen. Mehrfachauswahl, kein eigenes
    // Verwaltungs-Screen: Tags entstehen beim Zuweisen an der Buchung selbst.
    rel("tags", tagsId, { maxSelect: 10 }),
    num("amount_cents", { required: true, onlyInt: true }),
    text("payee", { max: 120 }),
    text("note", { max: 500 }),
    sel("recurring", ["monthly", "quarterly", "yearly"]),
    text("import_hash", { max: 64 }),
    rel("import_batch", importsId),
    { type: "autodate", name: "created", onCreate: true },
  ],
  indexes: [
    "CREATE INDEX idx_tx_date ON transactions (date)",
    "CREATE INDEX idx_tx_account ON transactions (account)",
    // Verhindert Doppel-Import. Leere Hashes sind ausgenommen, damit
    // manuell erfasste Buchungen sich nicht gegenseitig blockieren.
    "CREATE UNIQUE INDEX idx_tx_import_hash ON transactions (import_hash) WHERE import_hash != ''",
  ],
});

await ensure({
  name: "budgets", type: "base", ...rules,
  fields: [
    rel("category", categoriesId, { required: true }),
    // "2026-08" fuer einen einzelnen Monat, "*" als Dauerbudget
    text("month", { required: true, max: 7 }),
    num("amount_cents", { required: true, onlyInt: true }),
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_budget_cat_month ON budgets (category, month)",
  ],
});

// ------------------------------------------------------------- Daueraufträge

await ensure({
  name: "recurring_rules", type: "base", ...rules,
  fields: [
    sel("type", ["tx", "transfer"], { required: true }),
    rel("account", accountsId, { required: true }),
    rel("to_account", accountsId),
    rel("category", categoriesId),
    rel("tags", tagsId, { maxSelect: 10 }),
    num("amount_cents", { required: true, onlyInt: true }), // bereits vorzeichenrichtig
    text("payee", { max: 120 }),
    text("note", { max: 500 }),
    sel("frequency", ["monthly", "quarterly", "yearly"], { required: true }),
    { type: "date", name: "next_due", required: true },
    bool("active"),
    { type: "autodate", name: "created", onCreate: true },
  ],
});

// ------------------------------------------------------------------- Depot

const depotPositionsId = await ensure({
  name: "depot_positions", type: "base", ...rules,
  fields: [
    text("isin", { required: true, max: 12 }),
    text("name", { required: true, max: 120 }),
    // Von Yahoo Finance ueber die ISIN aufgeloest, einmalig zwischengespeichert
    // statt bei jedem Kursabruf neu gesucht - siehe pb_hooks/main.pb.js.
    // Manuell ueberschreibbar, falls Yahoo nicht die gewuenschte Boerse traf
    // (z. B. Londoner USD-Notierung statt Xetra in Euro).
    text("ticker", { max: 20 }),
    text("currency", { max: 3 }),
    bool("archived"),
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_depot_pos_isin ON depot_positions (isin)",
  ],
});

await ensure({
  name: "depot_trades", type: "base", ...rules,
  fields: [
    rel("position", depotPositionsId, { required: true }),
    { type: "date", name: "date", required: true },
    sel("type", ["buy", "sell"], { required: true }),
    // Bewusst kein onlyInt: Sparplaene buchen oft Bruchteile von Anteilen.
    num("quantity", { required: true }),
    num("price_cents", { required: true, onlyInt: true }),
    num("fees_cents", { onlyInt: true }),
    text("note", { max: 500 }),
    { type: "autodate", name: "created", onCreate: true },
  ],
  indexes: [
    "CREATE INDEX idx_depot_trade_position ON depot_trades (position)",
  ],
});

console.log("\nFertig.");
