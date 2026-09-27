import { describe, it, expect } from "vitest";
import { reconstructLines, parsePageLines, extractTransactions, buildRows, parseDeclaredCount } from "./pdf.js";

// Baut Text-Items einer Zeile wie sie pdfjs' getTextContent() liefern wuerde:
// x waechst mit jedem Wort, y bleibt fuer alle Items der Zeile gleich. gap
// steuert den Abstand zwischen den Woertern (< xGap => kein Leerzeichen beim
// Rekonstruieren, wie bei einem mitten im Wort gesplitteten Font-Run; > xGap
// => genau ein Leerzeichen, auch fuer den Ligatur-Luecken-Fall unten).
function mkLine(y, words, { gap = 5, charW = 6 } = {}) {
  let x = 0;
  return words.map((w) => {
    const it = { str: w, x, y, width: w.length * charW };
    x += it.width + gap;
    return it;
  });
}

describe("reconstructLines", () => {
  it("setzt Items unabhaengig von ihrer Reihenfolge im Array zu Zeilen zusammen (oben nach unten, links nach rechts)", () => {
    const items = [
      ...mkLine(10, ["Betrag"]),
      ...mkLine(30, ["Datum", "Erläuterung"]),
    ];
    const shuffled = [items[2], items[0], items[1]];
    expect(reconstructLines(shuffled)).toEqual(["Datum Erläuterung", "Betrag"]);
  });

  it("toleriert leichten Y-Jitter innerhalb einer Zeile (Schriftschnitt-Wechsel)", () => {
    const items = [
      { str: "23.09.2026", x: 0, y: 100.4, width: 60 },
      { str: "Hetzner", x: 70, y: 100.0, width: 40 }, // 0.4pt Jitter, gleiche Zeile
      { str: "-13.91", x: 300, y: 100.6, width: 30 },
    ];
    expect(reconstructLines(items)).toEqual(["23.09.2026 Hetzner -13.91"]);
  });

  it("fuegt bei kleinem X-Abstand kein Leerzeichen ein (mitten im Wort gesplitteter Font-Run)", () => {
    const items = mkLine(10, ["Kauf", "land"], { gap: 0 });
    expect(reconstructLines(items)).toEqual(["Kaufland"]);
  });

  it("laesst eine Ligatur-Luecke (groesserer X-Abstand) als getrennte Woerter durch, ohne sie zu reparieren", () => {
    // Nachgestellt: eine im PDF-Font fehlende Ligatur ("fl") reisst eine
    // sichtbare Luecke, real z. B. "Kaufland" -> "Kau and". Erfundenes
    // Beispielwort hier, keine echten Daten.
    const items = mkLine(10, ["Bei", "spielhof"], { gap: 8 });
    expect(reconstructLines(items)).toEqual(["Bei spielhof"]);
  });
});

describe("parsePageLines", () => {
  const HEADER = "Datum                  Erläuterung                                  Betrag EUR";
  const FOOTER = "Deutsche Kreditbank           Vorsitzender des Aufsichtsrats";

  it("ignoriert alles vor der Spaltenkopfzeile (Adressblock, Auszug-Titel, IBAN-Zeile)", () => {
    const lines = [
      "Max Mustermann", "Musterstr. 1", "12345 Musterstadt",
      "Auszug", "DE00 0000 0000 0000 0000 00", "Anzahl der Transaktionen: 1",
      HEADER,
      "01.09.2026             Testfiliale                                         -10.00",
      "IBAN DE00 0000 0000 0000 0000 00",
      FOOTER,
    ];
    expect(parsePageLines(lines)).toEqual([
      { dateRaw: "01.09.2026", payeeRaw: "Testfiliale", amountRaw: "-10.00",
        purposeLines: ["IBAN DE00 0000 0000 0000 0000 00"] },
    ]);
  });

  it("sammelt mehrere Fortsetzungszeilen (IBAN + mehrzeiliger Zweck)", () => {
    const lines = [
      HEADER,
      "05.09.2026             Beispielshop GmbH                                   -41.49",
      "IBAN DE11 2222 3333 4444 5555 66",
      "1052888679967/PP.0000.PP/. Beispiel Deutschland SE . Co.KG,",
      "Ihr Einkauf bei Beispiel Deutschland SE . Co.KG",
      FOOTER,
    ];
    const [row] = parsePageLines(lines);
    expect(row.purposeLines).toHaveLength(3);
  });

  it("erkennt eine ueber zwei Zeilen umbrechende Empfaenger-Zeile vor der IBAN-Zeile", () => {
    // Nachgestellt: reale Faelle, in denen der Empfaenger-Name selbst schon
    // so lang ist, dass er auf der Datumszeile abgeschnitten wird und in der
    // ersten Fortsetzungszeile weitergeht, bevor die IBAN-Zeile kommt.
    const lines = [
      HEADER,
      "01.09.2026             Verkehrsbetriebe Anstalt des oeffentlichen                -63.00",
      "Rechts",
      "IBAN DE02 1005 0000 0990 0047 16",
      "Abo Sollstellung",
      FOOTER,
    ];
    const [row] = parsePageLines(lines);
    expect(row.payeeRaw).toBe("Verkehrsbetriebe Anstalt des oeffentlichen");
    expect(row.purposeLines).toEqual([
      "Rechts", "IBAN DE02 1005 0000 0990 0047 16", "Abo Sollstellung",
    ]);
  });

  it("liefert keine Transaktionen fuer eine reine Kopf-/Fusszeilen-Seite", () => {
    const lines = ["Seite 3 von 5", HEADER, FOOTER];
    expect(parsePageLines(lines)).toEqual([]);
  });

  it("schliesst den letzten Block auch ohne Fusszeile ab (defensiv)", () => {
    const lines = [HEADER, "01.09.2026             Testfiliale                     -10.00"];
    expect(parsePageLines(lines)).toHaveLength(1);
  });
});

describe("extractTransactions", () => {
  it("haengt Bloecke mehrerer Seiten aneinander, ohne dass eine Seite in die naechste greift", () => {
    const HEADER = "Datum Erläuterung Betrag EUR";
    const FOOTER = "Deutsche Kreditbank";
    const page1 = [HEADER, "01.09.2026             A                    -1.00", FOOTER];
    const page2 = [
      "Seite 2 von 2", HEADER, "02.09.2026             B                    -2.00", FOOTER,
    ];
    const rows = extractTransactions([page1, page2]);
    expect(rows.map((r) => r.payeeRaw)).toEqual(["A", "B"]);
  });
});

describe("buildRows", () => {
  const block = (over = {}) => ({
    dateRaw: "05.09.2026", payeeRaw: "Testfiliale", amountRaw: "-41.49", purposeLines: [], ...over,
  });

  it("baut dieselbe Vertragsform wie csv.buildRows()", () => {
    const [row] = buildRows([block({ purposeLines: ["Verwendungszweck hier"] })]);
    expect(row).toMatchObject({
      ok: true, date: "2026-09-05", cents: -4149, payee: "Testfiliale", purpose: "Verwendungszweck hier",
    });
    expect(row.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("erkennt ein unlesbares Datum", () => {
    const [row] = buildRows([block({ dateRaw: "keinDatum" })]);
    expect(row).toEqual({ ok: false, raw: expect.anything(), reason: "Datum unlesbar" });
  });

  it("erkennt einen unlesbaren Betrag", () => {
    const [row] = buildRows([block({ amountRaw: "???" })]);
    expect(row.ok).toBe(false);
    expect(row.reason).toBe("Betrag unlesbar");
  });

  it("parst den Betrag mit Punkt als Dezimaltrennzeichen (Kontoauszug-Format, kein Komma)", () => {
    const [row] = buildRows([block({ amountRaw: "-1230.96" })]);
    expect(row.cents).toBe(-123096);
  });

  it("laesst ein Ligatur-Luecken-Wort unveraendert durch, statt es zu reparieren", () => {
    const [row] = buildRows([block({ payeeRaw: "Bei spielhof" })]);
    expect(row.payee).toBe("Bei spielhof");
  });

  it("markiert Zeilen mit gleichem Hash im selben Batch (#n-Suffix + batchDupeCount)", () => {
    const rows = buildRows([block(), block()]);
    expect(rows[0].batchDupeCount).toBe(2);
    expect(rows[1].hash).toMatch(/#2$/);
  });
});

describe("parseDeclaredCount", () => {
  it("liest die vom PDF-Kopf genannte Buchungsanzahl (nur auf Seite 1 vorhanden)", () => {
    const page1 = ["Auszug", "DE00 0000 0000 0000 0000 00             Anzahl der Transaktionen: 3", "Zeitraum: ..."];
    const page2 = ["Seite 2 von 2"];
    expect(parseDeclaredCount([page1, page2])).toBe(3);
  });

  it("liefert null, wenn keine Zeile passt", () => {
    expect(parseDeclaredCount([["Auszug"], ["Seite 2 von 2"]])).toBeNull();
  });
});
