import { describe, it, expect } from "vitest";
import { shiftDate, findDuplicateCandidates, originOf, matchRecurringRule, RULE_DUP_WINDOW_DAYS } from "./dauerauftraege.js";

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

describe("matchRecurringRule", () => {
  const rr = { id: "r1", type: "tx", account: "A", amount_cents: -12300, payee: "Beispiel Bank AG", frequency: "monthly", active: true };
  const row = { payee: "Beispiel Bank AG", purpose: "Depot Sparplan", cents: -12300 };
  it("trifft bei gleichem Konto, Betrag und Empfänger", () => {
    expect(matchRecurringRule(row, [rr], "A")).toBe(rr);
  });
  it("Empfänger darf auch im Zwecktext stehen, Groß-/Kleinschreibung egal", () => {
    expect(matchRecurringRule({ payee: "", purpose: "beispiel bank ag Sparplan", cents: -12300 }, [rr], "A")).toBe(rr);
  });
  it("anderer Betrag, anderes Konto oder anderer Empfänger trifft nicht", () => {
    expect(matchRecurringRule({ ...row, cents: -2 }, [rr], "A")).toBeNull();
    expect(matchRecurringRule(row, [rr], "B")).toBeNull();
    expect(matchRecurringRule({ ...row, payee: "Anderer" , purpose: "x" }, [rr], "A")).toBeNull();
  });
  it("inaktive Regeln, Umbuchungen und Regeln ohne Empfänger zählen nicht", () => {
    expect(matchRecurringRule(row, [{ ...rr, active: false }], "A")).toBeNull();
    expect(matchRecurringRule(row, [{ ...rr, type: "transfer" }], "A")).toBeNull();
    expect(matchRecurringRule(row, [{ ...rr, payee: "" }], "A")).toBeNull();
  });
  it("erster Treffer gewinnt", () => {
    const second = { ...rr, id: "r2" };
    expect(matchRecurringRule(row, [rr, second], "A").id).toBe("r1");
  });
});
