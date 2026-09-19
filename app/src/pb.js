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

// Nur ein Label an Konten, kein eigener Login - siehe CLAUDE.md.
export const listPeople = () => pb.collection("people").getFullList({ sort: "name" });

export const savePerson = (p) =>
  p.id
    ? pb.collection("people").update(p.id, p)
    : pb.collection("people").create(p);

export const deletePerson = (id) => pb.collection("people").delete(id);

export const countAccountsByPerson = async (personId) => {
  const r = await pb.collection("accounts").getList(1, 1, {
    filter: pb.filter("person = {:id}", { id: personId }),
  });
  return r.totalItems;
};

// Virtuelle Unterkonten (mehrere Sparziele auf einem echten Sparkonto, s.
// accounts.parent_account) - fuer die gruppierte Anzeige im Konten-Tab und
// den kombinierten Kontostand-Check beim CSV-Import.
export const listChildAccounts = (parentId) =>
  pb.collection("accounts").getFullList({
    filter: pb.filter("parent_account = {:id}", { id: parentId }),
  });

export const countChildAccounts = async (accountId) => {
  const r = await pb.collection("accounts").getList(1, 1, {
    filter: pb.filter("parent_account = {:id}", { id: accountId }),
  });
  return r.totalItems;
};

export const countByCategory = async (categoryId) => {
  const r = await pb.collection("transactions").getList(1, 1, {
    filter: pb.filter("category = {:id}", { id: categoryId }),
  });
  return r.totalItems;
};

export const listRules = () =>
  pb.collection("rules").getFullList({ sort: "-priority" });

// ------------------------------------------------------------------- Tags

export const listTags = () => pb.collection("tags").getFullList({ sort: "name" });
export const createTag = (name) => pb.collection("tags").create({ name });

export const saveRule = (r) =>
  r.id
    ? pb.collection("rules").update(r.id, r)
    : pb.collection("rules").create(r);

export const deleteRule = (id) => pb.collection("rules").delete(id);

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

// Fuer die Jahresansicht in der Auswertung: ein Kalenderjahr auf einmal statt
// zwoelf Einzelaufrufen. Personendaten sind klein genug, dass Client-seitige
// Aggregation reicht - keine eigene Server-Aggregation noetig.
export function listTransactionsForYear(y) {
  const start = `${y}-01-01`;
  const end = `${y + 1}-01-01`;
  return pb.collection("transactions").getFullList({
    filter: pb.filter("date >= {:start} && date < {:end}", { start, end }),
    sort: "-date,-created",
  });
}

// Fuer die Einkommens-Hochrechnung in Buchungen.jsx: Buchungen der
// vorherigen `monthsBack` VOLLEN Monate vor y/m in einem Rutsch statt
// monthsBack Einzelabfragen - der aktuelle Monat selbst ist nicht enthalten,
// der laeuft ja gerade erst und waere als Vergleichswert fuer sich selbst
// sinnlos. Ein Durchschnitt ueber ganze Monate ist unabhaengig davon, an
// welchem Tag einzelne grosse Buchungen (Miete, Versicherungen) landen -
// anders als eine Tagesdurchschnitt-Hochrechnung des laufenden, erst
// teilweise vergangenen Monats, die genau dadurch verzerrt wird.
export function listTransactionsForAverage(y, m, monthsBack = 3) {
  const { start: end } = monthRange(y, m);
  const start = addMonths(end, -monthsBack);
  return pb.collection("transactions").getFullList({
    filter: pb.filter("date >= {:start} && date < {:end}", { start, end }),
    fields: "date,type,amount_cents,account,to_account",
  });
}

// Suche ueber Empfaenger/Verwendungszweck, bewusst ueber die komplette
// Historie statt nur den gerade sichtbaren Monat - eine gesuchte Buchung
// liegt so gut wie nie zufaellig im aktuellen Zeitraum. "~" ist PocketBase/
// SQLite LIKE, dadurch automatisch case-insensitiv (ASCII).
// Kategorie/Tags sind Relationen, kein Text - ein Treffer auf ihrem Namen
// laeuft deshalb ueber vom Aufrufer schon client-seitig aufgeloeste IDs
// (Name-Abgleich gegen die eh schon geladene Kategorie-/Tag-Liste), nicht
// ueber einen eigenen Server-Textvergleich. "?=" ist der PocketBase-Operator
// fuer "mindestens einer der Werte trifft" auf der Mehrfachauswahl-Relation
// tags; category ist eine einfache Relation, dafuer reicht "=" pro ID.
export function searchTransactions(query, { categoryIds = [], tagIds = [] } = {}) {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  const parts = [
    pb.filter("payee ~ {:q}", { q }),
    pb.filter("note ~ {:q}", { q }),
    ...categoryIds.map((id, i) => pb.filter(`category = {:c${i}}`, { [`c${i}`]: id })),
    ...tagIds.map((id, i) => pb.filter(`tags ?= {:t${i}}`, { [`t${i}`]: id })),
  ];
  return pb.collection("transactions").getFullList({
    filter: parts.join(" || "),
    sort: "-date,-created",
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
  // Exklusive Obergrenze statt "next_due <= today": next_due steht als
  // "2026-09-05 00:00:00.000Z" (Text) in der DB, ein Vergleich mit dem reinen
  // Datumsstring "2026-09-05" waere lexikographisch groesser (laengerer
  // String) - ein heute faelliger Auftrag wuerde so erst morgen erkannt.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const due = await pb.collection("recurring_rules").getFullList({
    filter: pb.filter("active = true && next_due < {:tomorrow}", { tomorrow }),
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
            tags: rule.tags ?? [], amount_cents: rule.amount_cents, payee: rule.payee, note: rule.note,
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

// Budgets gelten pro Konto, nicht kontouebergreifend - ohne ein konkretes
// Konto gibt es deshalb keine Budgets zu zeigen ("Alle Konten"-Ansicht).
export async function listBudgets(monthKey, accountId) {
  if (!accountId || accountId === "alle") return [];
  const rows = await pb.collection("budgets").getFullList({
    filter: pb.filter("account = {:a} && (month = {:m} || month = '*')", { a: accountId, m: monthKey }),
  });
  // Ein Monatsbudget schlaegt das Dauerbudget derselben Kategorie.
  const out = new Map();
  for (const b of rows) {
    const prev = out.get(b.category);
    if (!prev || (prev.month === "*" && b.month !== "*")) out.set(b.category, b);
  }
  return [...out.values()];
}

export async function setBudget(accountId, categoryId, month, cents) {
  const found = await pb.collection("budgets").getFullList({
    filter: pb.filter("account = {:a} && category = {:c} && month = {:m}", { a: accountId, c: categoryId, m: month }),
  });
  if (cents <= 0) {
    if (found[0]) await pb.collection("budgets").delete(found[0].id);
    return null;
  }
  return found[0]
    ? pb.collection("budgets").update(found[0].id, { amount_cents: cents })
    : pb.collection("budgets").create({ account: accountId, category: categoryId, month, amount_cents: cents });
}

// ------------------------------------------------------------- Einnahmenziel

// Einnahmen setzen sich aus mehreren Posten zusammen (z. B. "Gehalt" +
// "Nebenmieteinnahmen"), jeder mit eigener Beschriftung. Ein Monatsposten
// schlaegt die Dauerposten als Ganzes, gleiches Prinzip wie bei Budgets, nur
// ohne Kategorie zum Abgleichen pro Posten - entweder alle Dauerposten oder
// alle Monatsposten zaehlen, nicht gemischt.
export async function listIncomeEntries(monthKey) {
  // Kein sort: income_targets hat anders als z. B. transactions kein
  // created-Feld, "id" ist die einzige stabile, immer vorhandene Sortierung.
  const rows = await pb.collection("income_targets").getFullList({
    filter: pb.filter("month = {:m} || month = '*'", { m: monthKey }),
    sort: "id",
  });
  const specific = rows.filter((r) => r.month === monthKey);
  return specific.length ? specific : rows.filter((r) => r.month === "*");
}

export async function createIncomeEntry(month, label, cents) {
  return pb.collection("income_targets").create({ month, label, amount_cents: cents });
}

export async function updateIncomeEntry(id, label, cents) {
  return pb.collection("income_targets").update(id, { label, amount_cents: cents });
}

export async function deleteIncomeEntry(id) {
  return pb.collection("income_targets").delete(id);
}

// Fuer den "Vorschlag"-Button im Budgets-Tab: tatsaechlich gebuchte Einnahmen
// eines Monats, nur auf Anfrage geladen (nicht bei jedem Tab-Aufruf), damit
// das Eintragen des Einnahmenziels nicht jedes Mal komplett neu geschaetzt
// werden muss.
export async function actualIncomeForMonth(y, m) {
  const { start, end } = monthRange(y, m);
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter(
      "date >= {:start} && date < {:end} && type != 'transfer' && amount_cents > 0",
      { start, end }
    ),
    fields: "amount_cents",
  });
  return rows.reduce((s, t) => s + t.amount_cents, 0);
}

// -------------------------------------------------------- Monatsabschluss

// Pro Konto, nicht global - siehe schema.mjs. Gibt ein Set von "JJJJ-MM"
// zurueck, praktischer als die rohen Datensaetze fuer den .has()-Check in
// der Jahresansicht.
export async function listClosedMonths(accountId) {
  if (!accountId) return new Set();
  const rows = await pb.collection("closed_months").getFullList({
    filter: pb.filter("account = {:a}", { a: accountId }),
    fields: "month",
  });
  return new Set(rows.map((r) => r.month));
}

export const closeMonth = (accountId, month) =>
  pb.collection("closed_months").create({ account: accountId, month });

export async function reopenMonth(accountId, month) {
  const found = await pb.collection("closed_months").getFullList({
    filter: pb.filter("account = {:a} && month = {:m}", { a: accountId, m: month }),
  });
  if (found[0]) await pb.collection("closed_months").delete(found[0].id);
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

// Weicher Duplikat-Check gegen den exakten Hash-Vergleich oben: derselbe
// Bank-Umsatz kann in zwei Export-Formaten unterschiedlich formatierten
// Empfaenger-/Zwecktext haben ("Supermarkt XY Filiale 123" vs. "Supermarkt XY") - dann
// weicht der Hash ab und existingHashes() erkennt die Dublette nicht. Datum
// und Betrag allein sind dagegen stabil, deshalb hier als reiner Hinweis
// (nicht blockierend, siehe Import.jsx) fuer alle Buchungen im Datumsbereich
// der Datei auf dem Zielkonto.
export async function existingByDateAmount(account, minDate, maxDate) {
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter("account = {:account} && date >= {:min} && date <= {:max}", {
      account, min: minDate, max: `${maxDate} 23:59:59`,
    }),
    fields: "date,amount_cents",
  });
  return new Set(rows.map((r) => `${r.date.slice(0, 10)}|${r.amount_cents}`));
}

// Kontostand eines Kontos zu einem Stichtag, fuer den Kontostand-Sanity-Check
// beim CSV-Import (Import.jsx) - dieselbe Formel wie `balances` in App.jsx
// (Anfangssaldo + alle Buchungen bis zu diesem Datum, Umbuchungen richtig
// verrechnet), nur als eigener Request statt aus dem schon geladenen
// App-weiten State, weil Import.jsx dessen "running"-Liste nicht haelt.
export async function accountBalanceAsOf(accountId, throughDate) {
  const acc = await pb.collection("accounts").getOne(accountId, { fields: "start_cents" });
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter("date <= {:end} && (account = {:id} || to_account = {:id})", {
      end: `${throughDate} 23:59:59`, id: accountId,
    }),
    fields: "type,account,to_account,amount_cents",
  });
  let b = acc.start_cents ?? 0;
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

// Sobald mindestens eine Buchung des Imports in einem fuer das Import-Konto
// abgeschlossenen Monat liegt, ist der ganze Ruecknahme-Vorgang gesperrt -
// lieber komplett blockiert als nur einzelne Zeilen still uebrig zu lassen.
export async function deleteImportRun(runId) {
  const run = await pb.collection("imports").getOne(runId, { fields: "id,account" });
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter("import_batch = {:id}", { id: runId }),
    fields: "id,date",
  });
  const months = new Set(rows.map((r) => dateOnly(r.date).slice(0, 7)));
  if (months.size > 0) {
    const closed = await listClosedMonths(run.account);
    if ([...months].some((m) => closed.has(m))) {
      throw new Error(
        "Dieser Import betrifft einen abgeschlossenen Monat und kann nicht mehr zurückgenommen werden."
      );
    }
  }
  for (let i = 0; i < rows.length; i += 100) {
    const batch = pb.createBatch();
    for (const r of rows.slice(i, i + 100)) batch.collection("transactions").delete(r.id);
    await batch.send();
  }
  await pb.collection("imports").delete(runId);
  return rows.length;
}

// -------------------------------------------------------------------- Depot

export const listDepotPositions = () =>
  pb.collection("depot_positions").getFullList({ sort: "name" });

export const saveDepotPosition = (p) =>
  p.id
    ? pb.collection("depot_positions").update(p.id, p)
    : pb.collection("depot_positions").create(p);

export const deleteDepotPosition = (id) => pb.collection("depot_positions").delete(id);

export const countDepotTradesByPosition = async (positionId) => {
  const r = await pb.collection("depot_trades").getList(1, 1, {
    filter: pb.filter("position = {:id}", { id: positionId }),
  });
  return r.totalItems;
};

export const listDepotTrades = () =>
  pb.collection("depot_trades").getFullList({ sort: "-date,-created" });

export const saveDepotTrade = (t) =>
  t.id
    ? pb.collection("depot_trades").update(t.id, t)
    : pb.collection("depot_trades").create(t);

export const deleteDepotTrade = (id) => pb.collection("depot_trades").delete(id);

// Server-seitiger Kurs-Proxy (pb_hooks/main.pb.js) - Yahoo Finance setzt
// keinen CORS-Header, ein fetch() direkt aus dem Browser wuerde scheitern.
// Entweder { isin } (loest einmalig einen Ticker auf) oder { ticker } (der
// uebliche Fall, sobald der Ticker an der Position gespeichert ist).
export const fetchQuote = ({ isin, ticker }) =>
  pb.send("/api/depot/quote", isin ? { isin } : { ticker });

// Historische Kursreihe fuer den Verlaufs-Chart im Depot - dieselbe Route,
// range/interval werden unveraendert an Yahoo weitergereicht (z. B.
// "3mo"/"1d" oder "5y"/"1wk"). Antwort: { symbol, currency, points: [{t, price}] }.
export const fetchHistory = (ticker, range, interval) =>
  pb.send("/api/depot/quote", { ticker, range, interval });

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
