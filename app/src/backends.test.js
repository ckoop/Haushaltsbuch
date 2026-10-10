import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Wachposten gegen Auseinanderlaufen der zwei Backends. Beide muessen dieselbe
// Schnittstelle liefern (die Screens importieren nur pb.js) und dasselbe
// Schema beschreiben (setup/schema.mjs fuer PocketBase, backend/sqlite-db.js
// fuer SQLite). Prueft den QUELLTEXT statt die Module zu laden: sqlite.js
// braucht Capacitor, pocketbase.js einen Browser.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const exportsOf = (src) => new Set(
  [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]),
);

// Nur in einer Fassung sinnvoll und von den Screens nie benutzt.
const BACKEND_ONLY = new Set(["pb"]);

describe("Backend-Schnittstelle", () => {
  const pocketbase = exportsOf(read("./backend/pocketbase.js"));
  const sqlite = exportsOf(read("./backend/sqlite.js"));

  it("PocketBase-Backend liefert alles, was das SQLite-Backend liefert", () => {
    const missing = [...sqlite].filter((n) => !pocketbase.has(n) && !BACKEND_ONLY.has(n));
    expect(missing).toEqual([]);
  });

  it("SQLite-Backend liefert alles, was das PocketBase-Backend liefert", () => {
    const missing = [...pocketbase].filter((n) => !sqlite.has(n) && !BACKEND_ONLY.has(n));
    expect(missing).toEqual([]);
  });

  it("jede von den Screens benutzte api.*-Funktion existiert in beiden", () => {
    const screens = ["./App.jsx", "./ui.jsx", "./screens/Auswertung.jsx", "./screens/Buchungen.jsx",
      "./screens/Budgets.jsx", "./screens/Depot.jsx", "./screens/Einstellungen.jsx", "./screens/Import.jsx",
      "./screens/ImportPdf.jsx", "./screens/Konten.jsx", "./screens/NewEntry.jsx", "./screens/RuleConflicts.jsx",
      "./screens/TxDetail.jsx"];
    const shared = new Set(["monthRange", "dateOnly", "addMonths", "MONTHS_PER"]); // pb.js re-exportiert
    const used = new Set(screens.flatMap((f) => [...read(f).matchAll(/\bapi\.([A-Za-z0-9_]+)/g)].map((m) => m[1])));
    const missingPb = [...used].filter((n) => !pocketbase.has(n) && !shared.has(n));
    const missingSql = [...used].filter((n) => !sqlite.has(n) && !shared.has(n));
    expect({ missingPb, missingSql }).toEqual({ missingPb: [], missingSql: [] });
  });
});

describe("Schema PocketBase gegen SQLite", () => {
  // Felder je Sammlung aus setup/schema.mjs: alles zwischen `name: "x"` und dem
  // naechsten `await ensure(` gehoert zu x (auch spaeter angepatchte Felder).
  const pbFields = () => {
    const src = read("../../setup/schema.mjs");
    const out = {};
    const re = /await ensure\(\{\s*name:\s*"([a-z_]+)"/g;
    const starts = [...src.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
    starts.forEach((s, i) => {
      const block = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
      const names = [
        ...block.matchAll(/\b(?:text|num|bool|sel|rel)\(\s*"([a-z_]+)"/g),
        ...block.matchAll(/\bname:\s*"([a-z_]+)"\s*[,}]/g),
      ].map((m) => m[1]).filter((n) => n !== s.name);
      out[s.name] = new Set(names);
    });
    return out;
  };

  // Spalten je Tabelle aus den CREATE-TABLE- und ALTER-TABLE-Anweisungen.
  const sqliteColumns = () => {
    const src = read("./backend/sqlite-db.js");
    const out = {};
    for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+) \(([\s\S]*?)\n  \);/g)) {
      out[m[1]] = new Set(m[2].split("\n").map((l) => l.trim().match(/^([a-z_]+)\s+(?:TEXT|INTEGER|REAL)/)?.[1]).filter(Boolean));
    }
    for (const m of src.matchAll(/ALTER TABLE ([a-z_]+) ADD COLUMN ([a-z_]+)/g)) out[m[1]]?.add(m[2]);
    return out;
  };

  it("jede Sammlung hat eine Tabelle und umgekehrt", () => {
    expect(Object.keys(sqliteColumns()).sort()).toEqual(Object.keys(pbFields()).sort());
  });

  it("jede Tabelle hat dieselben Felder wie die Sammlung", () => {
    const pbf = pbFields();
    const sql = sqliteColumns();
    const diffs = {};
    for (const table of Object.keys(pbf)) {
      const cols = new Set([...(sql[table] ?? [])].filter((c) => c !== "id"));
      const onlyPb = [...pbf[table]].filter((f) => !cols.has(f));
      const onlySql = [...cols].filter((c) => !pbf[table].has(c));
      if (onlyPb.length || onlySql.length) diffs[table] = { nurPocketBase: onlyPb, nurSqlite: onlySql };
    }
    expect(diffs).toEqual({});
  });
});
