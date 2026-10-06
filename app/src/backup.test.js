import { describe, it, expect } from "vitest";
import {
  BACKUP_SCHEMA_VERSION, BACKUP_COLLECTIONS, CREATED_ORDERED, stripRecord, validateBackup, orderForCreate,
} from "./backup.js";

// Frei erfundene Ids und Daten — keine echten Kontodaten.
const ID_A = "aaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbb";
const ID_C = "ccccccccccccccc";

const file = (data, extra = {}) => ({
  app: "haushaltsbuch", schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: "2026-10-06 08:00:00.000Z", data, ...extra,
});

describe("stripRecord", () => {
  it("entfernt PocketBase-Systemfelder, behält Daten und created", () => {
    const rec = {
      id: ID_A, collectionId: "x", collectionName: "accounts", expand: {}, updated: "u",
      created: "2026-01-01 10:00:00.000Z", name: "Giro",
    };
    expect(stripRecord(rec)).toEqual({ id: ID_A, created: "2026-01-01 10:00:00.000Z", name: "Giro" });
  });
});

describe("validateBackup", () => {
  it("liefert die Anzahl je Sammlung", () => {
    const counts = validateBackup(file({ accounts: [{ id: ID_A }, { id: ID_B }], tags: [] }));
    expect(counts).toEqual({ accounts: 2, tags: 0 });
  });

  it("lässt fehlende Sammlungen aus counts heraus (werden nicht geleert)", () => {
    const counts = validateBackup(file({ accounts: [{ id: ID_A }] }));
    expect(counts.depot_trades).toBeUndefined();
  });

  it("ignoriert unbekannte Sammlungen", () => {
    expect(validateBackup(file({ accounts: [], users: [{ id: "x" }] }))).toEqual({ accounts: 0 });
  });

  it("lehnt fremde Dateien ab", () => {
    expect(() => validateBackup(null)).toThrow(/keine gültige/);
    expect(() => validateBackup({ data: {} })).toThrow(/keine gültige/);
    expect(() => validateBackup(file({}, { app: "andere-app" }))).toThrow(/keine gültige/);
  });

  it("lehnt neuere Dateiformate ab, auch ohne Versionsfeld", () => {
    expect(() => validateBackup(file({ accounts: [] }, { schemaVersion: BACKUP_SCHEMA_VERSION + 1 }))).toThrow(/neueren/);
    expect(() => validateBackup(file({ accounts: [] }, { schemaVersion: undefined }))).toThrow(/neueren/);
  });

  it("lehnt eine Datei ohne bekannte Sammlung ab", () => {
    expect(() => validateBackup(file({ users: [] }))).toThrow(/keine Daten/);
  });

  it("lehnt ungültige und doppelte Ids ab", () => {
    expect(() => validateBackup(file({ accounts: [{ id: "kurz" }] }))).toThrow(/ungültige Id/);
    expect(() => validateBackup(file({ accounts: [{ id: "AAAAAAAAAAAAAAA" }] }))).toThrow(/ungültige Id/);
    expect(() => validateBackup(file({ accounts: [{ name: "ohne id" }] }))).toThrow(/ungültige Id/);
    expect(() => validateBackup(file({ accounts: [{ id: ID_A }, { id: ID_A }] }))).toThrow(/doppelte Id/);
  });

  it("lehnt eine Sammlung ab, die keine Liste ist", () => {
    expect(() => validateBackup(file({ accounts: {} }))).toThrow(/keine Liste/);
  });
});

describe("orderForCreate", () => {
  it("legt Konten vor ihren Unterkonten an", () => {
    const rows = [
      { id: ID_B, parent_account: ID_A },
      { id: ID_A, parent_account: "" },
      { id: ID_C },
    ];
    expect(orderForCreate("accounts", rows).map((r) => r.id)).toEqual([ID_A, ID_C, ID_B]);
  });

  it("legt Sammlungen mit created-Sortierung nach altem created aufsteigend an", () => {
    const rows = [
      { id: ID_A, created: "2026-09-02 10:00:00.000Z" },
      { id: ID_B, created: "2026-09-01 10:00:00.000Z" },
      { id: ID_C, created: "2026-09-02 09:59:59.999Z" },
    ];
    expect(orderForCreate("transactions", rows).map((r) => r.id)).toEqual([ID_B, ID_C, ID_A]);
    expect(rows.map((r) => r.id)).toEqual([ID_A, ID_B, ID_C]); // Eingabe bleibt unverändert
  });

  it("sortiert Zeilen ohne created nicht um und wirft nicht", () => {
    const rows = [{ id: ID_B }, { id: ID_A }];
    expect(orderForCreate("transactions", rows).map((r) => r.id)).toEqual([ID_B, ID_A]);
  });

  it("lässt andere Sammlungen unverändert", () => {
    const rows = [{ id: ID_B }, { id: ID_A }];
    expect(orderForCreate("budgets", rows)).toBe(rows);
  });
});

describe("BACKUP_COLLECTIONS", () => {
  it("kennt jede created-sortierte Sammlung", () => {
    for (const name of CREATED_ORDERED) expect(BACKUP_COLLECTIONS).toContain(name);
  });

  it("führt Relationsziele vor den Sammlungen, die darauf zeigen", () => {
    const at = (n) => BACKUP_COLLECTIONS.indexOf(n);
    expect(at("accounts")).toBeLessThan(at("transactions"));
    expect(at("categories")).toBeLessThan(at("transactions"));
    expect(at("tags")).toBeLessThan(at("rules"));
    expect(at("imports")).toBeLessThan(at("transactions"));
    expect(at("depot_positions")).toBeLessThan(at("depot_trades"));
  });
});
