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
    num("amount_cents", { required: true, onlyInt: true }),
    text("payee", { max: 120 }),
    text("note", { max: 500 }),
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

console.log("\nFertig.");
