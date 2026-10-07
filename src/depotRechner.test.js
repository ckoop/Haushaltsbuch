import { describe, it, expect } from "vitest";
import { historyRangeFor, closeOnOrBefore, estimateQuantity } from "./depotRechner.js";

describe("historyRangeFor", () => {
  it("waehlt die kleinste passende Spanne", () => {
    expect(historyRangeFor("2026-10-01", "2026-10-07")).toBe("1mo");
    expect(historyRangeFor("2026-08-20", "2026-10-07")).toBe("3mo");
    expect(historyRangeFor("2026-06-01", "2026-10-07")).toBe("6mo");
    expect(historyRangeFor("2026-01-15", "2026-10-07")).toBe("1y");
    expect(historyRangeFor("2023-03-01", "2026-10-07")).toBe("5y");
    expect(historyRangeFor("2010-01-01", "2026-10-07")).toBe("10y");
  });
});

describe("closeOnOrBefore", () => {
  const pts = [
    { date: "2026-10-05", price: 101 },
    { date: "2026-10-02", price: 100 },
    { date: "2026-10-06", price: 102 },
  ];
  it("trifft den Tag genau", () => {
    expect(closeOnOrBefore(pts, "2026-10-05").price).toBe(101);
  });
  it("nimmt am Wochenende den letzten Handelstag davor", () => {
    expect(closeOnOrBefore(pts, "2026-10-04").price).toBe(100);
  });
  it("kennt keine Kurse nach dem Datum", () => {
    expect(closeOnOrBefore(pts, "2026-10-01")).toBeNull();
  });
});

describe("estimateQuantity", () => {
  it("rechnet 350 EUR bei 105,37 EUR auf 4 Stellen", () => {
    expect(estimateQuantity(35000, 10537)).toBe(3.3216);
  });
  it("liefert null bei ungueltigen Werten", () => {
    expect(estimateQuantity(0, 10537)).toBeNull();
    expect(estimateQuantity(35000, 0)).toBeNull();
  });
});
