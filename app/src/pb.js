import PocketBase from "pocketbase";
import { todayISO } from "./ui.jsx";

// Keine feste Adresse: die App spricht mit dem Server, von dem sie geladen wurde.
// Damit funktioniert sie im WLAN und im WireGuard-Tunnel gleichermassen.
export const pb = new PocketBase(import.meta.env.VITE_PB_URL || window.location.origin);
pb.autoCancellation(false);

// ------------------------------------------------------------------- Anmeldung

export const login = (email, password) =>
  pb.collection("users").authWithPassword(email, password);
export const logout = () => pb.authStore.clear();
export const currentUser = () => pb.authStore.record;

// ------------------------------------------------------------------- Zeitraum

export const monthRange = (y, m) => {
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  const end = `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
  return { start, end, key: start.slice(0, 7) };
};

// PocketBase liefert Datumsfelder als "2026-08-31 00:00:00.000Z" zurueck.
export const dateOnly = (v) => (v ?? "").slice(0, 10);

// ------------------------------------------------------------------- Stammdaten

export const listAccounts = () =>
  pb.collection("accounts").getFullList({ sort: "sort,name" });

export const saveAccount = (a) =>
  a.id
    ? pb.collection("accounts").update(a.id, a)
    : pb.collection("accounts").create(a);

export const deleteAccount = (id) => pb.collection("accounts").delete(id);

export const listCategories = () =>
  pb.collection("categories").getFullList({ sort: "sort,name" });

export const saveCategory = (c) =>
  c.id
    ? pb.collection("categories").update(c.id, c)
    : pb.collection("categories").create(c);

export const deleteCategory = (id) => pb.collection("categories").delete(id);

export const countByCategory = async (categoryId) => {
  const r = await pb.collection("transactions").getList(1, 1, {
    filter: pb.filter("category = {:id}", { id: categoryId }),
  });
  return r.totalItems;
};

export const listRules = () =>
  pb.collection("rules").getFullList({ sort: "-priority" });

// ------------------------------------------------------------------- Buchungen

export function listTransactions(y, m) {
  const { start, end } = monthRange(y, m);
  return pb.collection("transactions").getFullList({
    filter: pb.filter("date >= {:start} && date < {:end}", { start, end }),
    sort: "-date,-created",
  });
}

// Fuer den Kontostand: alles bis zum Monatsende, nicht nur der Monat selbst.
export function listTransactionsUntil(y, m) {
  const { end } = monthRange(y, m);
  return pb.collection("transactions").getFullList({
    filter: pb.filter("date < {:end}", { end }),
    fields: "id,type,account,to_account,amount_cents",
  });
}

export const createTransaction = (t) => pb.collection("transactions").create(t);
export const updateTransaction = (id, patch) => pb.collection("transactions").update(id, patch);
export const deleteTransaction = (id) => pb.collection("transactions").delete(id);

export const countByAccount = async (accountId) => {
  const r = await pb.collection("transactions").getList(1, 1, {
    filter: pb.filter("account = {:id} || to_account = {:id}", { id: accountId }),
  });
  return r.totalItems;
};

// ------------------------------------------------------------- Daueraufträge

export const listRecurringRules = () =>
  pb.collection("recurring_rules").getFullList({ sort: "next_due" });

export const saveRecurringRule = (r) =>
  r.id
    ? pb.collection("recurring_rules").update(r.id, r)
    : pb.collection("recurring_rules").create(r);

export const deleteRecurringRule = (id) => pb.collection("recurring_rules").delete(id);

export const countRecurringRulesByAccount = async (accountId) => {
  const r = await pb.collection("recurring_rules").getList(1, 1, {
    filter: pb.filter("account = {:id} || to_account = {:id}", { id: accountId }),
  });
  return r.totalItems;
};

export const countRecurringRulesByCategory = async (categoryId) => {
  const r = await pb.collection("recurring_rules").getList(1, 1, {
    filter: pb.filter("category = {:id}", { id: categoryId }),
  });
  return r.totalItems;
};

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

// Faellige Daueraufträge nachbuchen - client-getriggert beim App-Start,
// kein Server-Cron (siehe CLAUDE.md). Dedup ueber den bestehenden
// import_hash-Unique-Index, falls zwei Geraete gleichzeitig pruefen. Bewusst
// kein createBatch(): PocketBase-Batches sind atomar, ein Dedup-Konflikt
// wuerde sonst auch alle anderen faelligen Regeln blockieren.
// Gibt die neu erzeugten Buchungen zurueck (nicht nur die Anzahl), damit die
// UI zeigen kann, was konkret automatisch gebucht wurde.
export async function runDueRecurringRules() {
  const today = todayISO();
  const due = await pb.collection("recurring_rules").getFullList({
    filter: pb.filter("active = true && next_due <= {:today}", { today }),
  });
  const createdRows = [];
  for (const rule of due) {
    try {
      let next = dateOnly(rule.next_due);
      while (next <= today) {
        try {
          const row = await pb.collection("transactions").create({
            date: next, type: rule.type, account: rule.account,
            to_account: rule.to_account || undefined, category: rule.category || undefined,
            amount_cents: rule.amount_cents, payee: rule.payee, note: rule.note,
            recurring: rule.frequency, import_hash: `rule:${rule.id}:${next}`,
          });
          createdRows.push(row);
        } catch (e) {
          // Unique-Verletzung = ein anderes Geraet hat diese Periode schon gebucht - ok.
          if (e?.response?.data?.import_hash?.code !== "validation_not_unique") throw e;
        }
        next = addMonths(next, MONTHS_PER[rule.frequency]);
      }
      if (next !== dateOnly(rule.next_due)) {
        await pb.collection("recurring_rules").update(rule.id, { next_due: next });
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

export async function listBudgets(monthKey) {
  const rows = await pb.collection("budgets").getFullList({
    filter: pb.filter("month = {:m} || month = '*'", { m: monthKey }),
  });
  // Ein Monatsbudget schlaegt das Dauerbudget derselben Kategorie.
  const out = new Map();
  for (const b of rows) {
    const prev = out.get(b.category);
    if (!prev || (prev.month === "*" && b.month !== "*")) out.set(b.category, b);
  }
  return [...out.values()];
}

export async function setBudget(categoryId, month, cents) {
  const found = await pb.collection("budgets").getFullList({
    filter: pb.filter("category = {:c} && month = {:m}", { c: categoryId, m: month }),
  });
  if (cents <= 0) {
    if (found[0]) await pb.collection("budgets").delete(found[0].id);
    return null;
  }
  return found[0]
    ? pb.collection("budgets").update(found[0].id, { amount_cents: cents })
    : pb.collection("budgets").create({ category: categoryId, month, amount_cents: cents });
}

// ------------------------------------------------------------------- Import

export const listProfiles = () => pb.collection("import_profiles").getFullList();

export const saveProfile = (p) =>
  p.id
    ? pb.collection("import_profiles").update(p.id, p)
    : pb.collection("import_profiles").create(p);

export const createImportRun = (r) => pb.collection("imports").create(r);
export const listImportRuns = () =>
  pb.collection("imports").getFullList({ sort: "-created", expand: "account" });

// Welche dieser Hashes gibt es schon? Wird in Bloecken abgefragt, weil ein
// Filter mit tausend ODER-Zweigen die URL sprengt.
export async function existingHashes(hashes) {
  const found = new Set();
  for (let i = 0; i < hashes.length; i += 40) {
    const chunk = hashes.slice(i, i + 40);
    const filter = chunk.map((h) => pb.filter("import_hash = {:h}", { h })).join(" || ");
    const rows = await pb.collection("transactions").getFullList({
      filter, fields: "import_hash",
    });
    for (const r of rows) found.add(r.import_hash);
  }
  return found;
}

// PocketBase kann mehrere Schreibvorgaenge in einer Anfrage buendeln.
export async function batchCreateTransactions(rows, onProgress) {
  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = pb.createBatch();
    for (const r of rows.slice(i, i + 100)) batch.collection("transactions").create(r);
    await batch.send();
    done += Math.min(100, rows.length - i);
    onProgress?.(done, rows.length);
  }
  return done;
}

export async function deleteImportRun(runId) {
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter("import_batch = {:id}", { id: runId }),
    fields: "id",
  });
  for (let i = 0; i < rows.length; i += 100) {
    const batch = pb.createBatch();
    for (const r of rows.slice(i, i + 100)) batch.collection("transactions").delete(r.id);
    await batch.send();
  }
  await pb.collection("imports").delete(runId);
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
  const batch = pb.createBatch();
  DEFAULT_CATEGORIES.forEach((c, i) =>
    batch.collection("categories").create({ ...c, sort: i, archived: false }));
  batch.collection("accounts").create({
    name: "Girokonto", short: "Giro", type: "giro", start_cents: 0, sort: 0, archived: false,
  });
  await batch.send();
}
