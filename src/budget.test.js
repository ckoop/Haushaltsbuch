import { describe, it, expect } from "vitest";
import { spentByCategory } from "./budget.js";

const tx = (o) => ({ type: "tx", account: "G", category: "c1", amount_cents: -1000, ...o });
const tr = (o) => ({ type: "transfer", account: "G", to_account: "S", category: "", amount_cents: 10000, ...o });

describe("spentByCategory", () => {
  it("summiert Ausgaben je Kategorie, Einnahmen zählen nicht", () => {
    const r = spentByCategory([tx({}), tx({ amount_cents: -500 }), tx({ category: "c2", amount_cents: -200 }), tx({ amount_cents: 9999 })]);
    expect(r).toEqual({ c1: 1500, c2: 200 });
  });
  it("Umbuchung ohne Kategorie bleibt draußen", () => {
    expect(spentByCategory([tr({})])).toEqual({});
  });
  it("Umbuchung mit Kategorie zählt wie eine Ausgabe der Kategorie", () => {
    expect(spentByCategory([tx({ category: "sp", amount_cents: -2000 }), tr({ category: "sp" })])).toEqual({ sp: 12000 });
  });
  it("zählt nur aus Sicht des Quellkontos", () => {
    const t = tr({ category: "sp" });
    expect(spentByCategory([t], new Set(["G"]))).toEqual({ sp: 10000 });
    expect(spentByCategory([t], new Set(["S"]))).toEqual({});
  });
  it("Quelle und Ziel in derselben Ansicht zählen einmal, nicht doppelt", () => {
    expect(spentByCategory([tr({ category: "sp" })], new Set(["G", "S"]))).toEqual({ sp: 10000 });
  });
  it("ohne Kontofilter ('alle') zählt die Umbuchung einmal", () => {
    expect(spentByCategory([tr({ category: "sp" })], null)).toEqual({ sp: 10000 });
  });
});
