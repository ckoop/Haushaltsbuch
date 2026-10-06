import { describe, it, expect } from "vitest";
import { shiftDate, findDuplicateCandidates, originOf, RULE_DUP_WINDOW_DAYS } from "./dauerauftraege.js";

const rule = { id: "r1", type: "tx", account: "A", amount_cents: -10000, frequency: "monthly" };
const tx = (o) => ({ id: "t1", type: "tx", account: "A", amount_cents: -10000, date: "2026-10-05 00:00:00.000Z", import_hash: "abc", ...o });

describe("shiftDate", () => {
  it("verschiebt über Monats- und Jahresgrenzen", () => {
    expect(shiftDate("2026-10-07", -7)).toBe("2026-09-30");
    expect(shiftDate("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("bleibt über die Zeitumstellung stabil", () => {
    expect(shiftDate("2026-10-24", 2)).toBe("2026-10-26");
    expect(shiftDate("2026-03-28", 2)).toBe("2026-03-30");
  });
});

describe("findDuplicateCandidates", () => {
  it("findet eine importierte Buchung 2 Tage vor Fälligkeit", () => {
    expect(findDuplicateCandidates(rule, "2026-10-07", [tx()]).map((t) => t.id)).toEqual(["t1"]);
  });
  it("Fenster ist inklusive, einen Tag außerhalb nicht", () => {
    const edge = tx({ date: "2026-10-14 00:00:00.000Z" });
    const out = tx({ id: "t2", date: "2026-10-15 00:00:00.000Z" });
    expect(RULE_DUP_WINDOW_DAYS).toBe(7);
    expect(findDuplicateCandidates(rule, "2026-10-07", [edge, out]).map((t) => t.id)).toEqual(["t1"]);
  });
  it("anderer Betrag, anderes Konto oder anderer Typ zählt nicht", () => {
    const others = [tx({ amount_cents: -10001 }), tx({ account: "B" }), tx({ type: "transfer" })];
    expect(findDuplicateCandidates(rule, "2026-10-07", others)).toEqual([]);
  });
  it("aus Daueraufträgen entstandene Buchungen zählen nicht", () => {
    expect(findDuplicateCandidates(rule, "2026-10-07", [tx({ import_hash: "rule:r2:2026-10-06" })])).toEqual([]);
  });
  it("von Hand erfasste Buchung (leerer Hash) zählt", () => {
    expect(findDuplicateCandidates(rule, "2026-10-07", [tx({ import_hash: "" })])).toHaveLength(1);
  });
  it("bei Umbuchungen muss auch das Zielkonto passen", () => {
    const tr = { ...rule, type: "transfer", amount_cents: 5000, to_account: "S" };
    const ok = tx({ type: "transfer", amount_cents: 5000, to_account: "S" });
    const wrong = tx({ id: "t2", type: "transfer", amount_cents: 5000, to_account: "X" });
    expect(findDuplicateCandidates(tr, "2026-10-07", [ok, wrong]).map((t) => t.id)).toEqual(["t1"]);
  });
  it("bereits beanspruchte Buchungen werden übersprungen", () => {
    expect(findDuplicateCandidates(rule, "2026-10-07", [tx()], new Set(["t1"]))).toEqual([]);
  });
});

describe("originOf", () => {
  it("unterscheidet Import und manuell", () => {
    expect(originOf({ import_hash: "x" })).toBe("Import");
    expect(originOf({ import_hash: "" })).toBe("von Hand erfasst");
  });
});
