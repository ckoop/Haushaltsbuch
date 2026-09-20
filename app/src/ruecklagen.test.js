import { describe, it, expect } from "vitest";
import { monthsBetweenInclusive, reserveStatus } from "./ruecklagen.js";

describe("monthsBetweenInclusive", () => {
  it("zählt denselben Monat als 1", () => {
    expect(monthsBetweenInclusive("2026-01", "2026-01")).toBe(1);
  });

  it("zählt über einen Jahreswechsel hinweg korrekt", () => {
    expect(monthsBetweenInclusive("2025-11", "2026-02")).toBe(4);
  });
});

describe("reserveStatus", () => {
  // amount_cents ist wie bei Ausgabe-Buchungen negativ.
  const quarterlyRule = { amount_cents: -15000, frequency: "quarterly", created: "2026-01-03 00:00:00.000Z" };

  it("berechnet den Monatsanteil für quarterly (Ziel/3)", () => {
    const status = reserveStatus(quarterlyRule, [], "2026-01");
    expect(status.monthly).toBe(5000);
    expect(status.target).toBe(15000);
  });

  it("berechnet den Monatsanteil für yearly (Ziel/12)", () => {
    const yearlyRule = { amount_cents: -48000, frequency: "yearly", created: "2026-01-03 00:00:00.000Z" };
    expect(reserveStatus(yearlyRule, [], "2026-01").monthly).toBe(4000);
  });

  it("wächst über mehrere ruhige Monate an", () => {
    expect(reserveStatus(quarterlyRule, [], "2026-01").saved).toBe(5000);
    expect(reserveStatus(quarterlyRule, [], "2026-02").saved).toBe(10000);
    expect(reserveStatus(quarterlyRule, [], "2026-03").saved).toBe(15000);
  });

  it("wird im Fälligkeitsmonat durch die echte Buchung vollständig verbraucht", () => {
    // created ist Januar, drei volle Monate (Jan-Mär) angespart passen genau
    // zum quartalsweisen Zieltbetrag.
    const txs = [{ date: "2026-03-15", amount_cents: -15000 }];
    const status = reserveStatus(quarterlyRule, txs, "2026-03");
    expect(status.saved).toBe(0);
    expect(status.withdrawn).toBe(15000);
    expect(status.dueInMonth).toBe(true);
    expect(status.deficit).toBe(0);
  });

  it("startet den zweiten Zyklus erst nach der ersten Abbuchung, nicht wieder ab created", () => {
    const txs = [{ date: "2026-04-01", amount_cents: -15000 }];
    // Zwei Monate nach der ersten Abbuchung (Mai, Juni) sind erst 2 Monatsanteile
    // angespart, nicht 6 (was ein Reset auf "created" faelschlich ergeben wuerde).
    const status = reserveStatus(quarterlyRule, txs, "2026-06");
    expect(status.saved).toBe(10000);
  });

  it("zeigt ein Defizit, wenn die Regel kurz nach Anlage schon fällig wird", () => {
    const freshRule = { amount_cents: -15000, frequency: "quarterly", created: "2026-03-20 00:00:00.000Z" };
    const txs = [{ date: "2026-04-01", amount_cents: -15000 }];
    const status = reserveStatus(freshRule, txs, "2026-04");
    // Nur Maerz + April angespart = 2 * 5000 = 10000, entnommen 15000.
    expect(status.saved).toBe(0);
    expect(status.deficit).toBe(5000);
  });
});
