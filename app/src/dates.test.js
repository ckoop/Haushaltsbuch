import { describe, it, expect } from "vitest";
import { monthRange, dateOnly, addMonths } from "./dates.js";

describe("addMonths", () => {
  it("verschiebt um Monate und über Jahresgrenzen", () => {
    expect(addMonths("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });
  it("rechnet rückwärts über die Jahresgrenze (Januar minus n Monate)", () => {
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-03-01", -3)).toBe("2025-12-01");
    expect(addMonths("2026-02-01", -6)).toBe("2025-08-01");
    expect(addMonths("2026-01-31", -2)).toBe("2025-11-30");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
  });
  it("klemmt auf den letzten Tag des Zielmonats", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
  });
});

describe("monthRange", () => {
  it("liefert [start, end) und Schlüssel (m ist 0-basiert)", () => {
    expect(monthRange(2026, 9)).toEqual({ start: "2026-10-01", end: "2026-11-01", key: "2026-10" });
    expect(monthRange(2026, 11)).toEqual({ start: "2026-12-01", end: "2027-01-01", key: "2026-12" });
  });
});

describe("dateOnly", () => {
  it("schneidet das PocketBase-Zeitformat auf den Tag", () => {
    expect(dateOnly("2026-08-31 00:00:00.000Z")).toBe("2026-08-31");
    expect(dateOnly(undefined)).toBe("");
  });
});
