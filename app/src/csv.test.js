import { describe, it, expect } from "vitest";
import {
  hashRow, decodeFile, looksMisdecoded, parseCsv, findHeaderRow, guessDelimiter,
  guessMapping, parseDate, parseAmountCents, buildRows, applyRules, delimChar,
  findStatementBalance,
} from "./csv.js";

describe("hashRow", () => {
  it("ist deterministisch für gleiche Eingaben", () => {
    expect(hashRow("2026-09-05", "-500", "Rewe", "Einkauf"))
      .toBe(hashRow("2026-09-05", "-500", "Rewe", "Einkauf"));
  });

  it("unterscheidet verschiedene Eingaben", () => {
    expect(hashRow("2026-09-05", "-500", "Rewe", "Einkauf"))
      .not.toBe(hashRow("2026-09-06", "-500", "Rewe", "Einkauf"));
  });
});

describe("decodeFile", () => {
  it("dekodiert UTF-8 und entfernt ein führendes BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Müller")]);
    expect(decodeFile(withBom.buffer, "utf-8")).toBe("Müller");
  });

  it("dekodiert Windows-1252 (ü = 0xFC)", () => {
    const bytes = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // "Müller"
    expect(decodeFile(bytes.buffer, "windows-1252")).toBe("Müller");
  });
});

describe("looksMisdecoded", () => {
  it("erkennt das Ã¼-Muster falsch dekodierter Umlaute", () => {
    expect(looksMisdecoded("MÃ¼ller kauft ein")).toBe(true);
  });

  it("erkennt sauberen Text nicht als falsch dekodiert", () => {
    expect(looksMisdecoded("Müller kauft ein")).toBe(false);
  });
});

describe("parseCsv", () => {
  it("parst einfache Semikolon-Zeilen", () => {
    const rows = parseCsv("a;b;c\n1;2;3\n", ";");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("behandelt Anführungszeichen inkl. Escape und eingebettetem Trennzeichen", () => {
    const rows = parseCsv('a;"b;with ""quote"" and delim"\n', ";");
    expect(rows).toEqual([["a", 'b;with "quote" and delim']]);
  });

  it("behandelt Zeilenumbrüche innerhalb eines Feldes", () => {
    const rows = parseCsv('a;"line1\nline2"\n', ";");
    expect(rows).toEqual([["a", "line1\nline2"]]);
  });

  it("filtert komplett leere Zeilen heraus", () => {
    const rows = parseCsv("a;b\n\n1;2\n", ";");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("ignoriert Carriage-Return vor Zeilenumbruch (CRLF)", () => {
    const rows = parseCsv("a;b\r\n1;2\r\n", ";");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("findHeaderRow", () => {
  it("findet die erste Zeile mit Datums- und Betragsbegriff, auch nach Vorspann", () => {
    const rows = [
      ["Kontoauszug", "", ""],
      ["Erstellt am 01.09.2026", "", ""],
      ["Buchungstag", "Verwendungszweck", "Betrag"],
      ["05.09.2026", "Einkauf", "-5,55"],
    ];
    expect(findHeaderRow(rows)).toBe(2);
  });

  it("liefert 0, wenn keine passende Zeile gefunden wird", () => {
    expect(findHeaderRow([["a", "b"], ["c", "d"]])).toBe(0);
  });
});

describe("guessDelimiter", () => {
  it("erkennt Semikolon als häufigstes Trennzeichen", () => {
    expect(guessDelimiter("a;b;c\n1;2;3\n")).toBe("semicolon");
  });

  it("erkennt Komma, wenn es häufiger vorkommt als andere Trennzeichen", () => {
    expect(guessDelimiter("a,b,c\n1,2,3\n")).toBe("comma");
  });

  it("fällt auf Semikolon zurück, wenn nichts erkannt wird", () => {
    expect(guessDelimiter("abc\ndef\n")).toBe("semicolon");
  });
});

describe("delimChar", () => {
  it("löst bekannte IDs auf echte Zeichen auf", () => {
    expect(delimChar("semicolon")).toBe(";");
    expect(delimChar("comma")).toBe(",");
    expect(delimChar("tab")).toBe("\t");
  });
});

describe("guessMapping", () => {
  it("ordnet typische deutsche Bank-Spaltennamen korrekt zu", () => {
    const header = ["Buchungstag", "Valutadatum", "Begünstigter/Zahlungspflichtiger", "Verwendungszweck", "Betrag"];
    const mapping = guessMapping(header);
    expect(mapping.col_date).toBe("Buchungstag");
    expect(mapping.col_amount).toBe("Betrag");
    expect(mapping.col_payee).toBe("Begünstigter/Zahlungspflichtiger");
    expect(mapping.col_purpose).toBe("Verwendungszweck");
  });

  it("findet eine optionale Referenzspalte, wenn vorhanden", () => {
    const header = ["Datum", "Betrag", "Kundenreferenz"];
    expect(guessMapping(header).col_reference).toBe("Kundenreferenz");
  });

  it("lässt Felder leer, wenn keine passende Spalte existiert", () => {
    const header = ["Foo", "Bar"];
    const mapping = guessMapping(header);
    expect(mapping.col_date).toBe("");
    expect(mapping.col_amount).toBe("");
  });
});

describe("parseDate", () => {
  it("parst dd.MM.yyyy", () => {
    expect(parseDate("31.08.2026", "dd.MM.yyyy")).toBe("2026-08-31");
  });

  it("parst einstellige Tag/Monat-Angaben", () => {
    expect(parseDate("1.9.2026", "dd.MM.yyyy")).toBe("2026-09-01");
  });

  it("parst yyyy-MM-dd", () => {
    expect(parseDate("2026-08-31", "yyyy-MM-dd")).toBe("2026-08-31");
  });

  it("parst dd/MM/yyyy", () => {
    expect(parseDate("31/08/2026", "dd/MM/yyyy")).toBe("2026-08-31");
  });

  it("ergänzt zweistellige Jahreszahlen auf 20xx", () => {
    expect(parseDate("31.08.26", "dd.MM.yyyy")).toBe("2026-08-31");
  });

  it("gibt null für leere oder kaputte Werte zurück", () => {
    expect(parseDate("", "dd.MM.yyyy")).toBeNull();
    expect(parseDate("keinDatum", "dd.MM.yyyy")).toBeNull();
    expect(parseDate(undefined, "dd.MM.yyyy")).toBeNull();
  });
});

describe("parseAmountCents", () => {
  it("parst deutsches Format mit Tausenderpunkt", () => {
    expect(parseAmountCents("-1.234,56", true)).toBe(-123456);
  });

  it("parst einfaches deutsches Format", () => {
    expect(parseAmountCents("1234,56", true)).toBe(123456);
  });

  it("erkennt nachgestelltes Minus", () => {
    expect(parseAmountCents("123,45-", true)).toBe(-12345);
  });

  it("erkennt führendes Plus", () => {
    expect(parseAmountCents("+50,00", true)).toBe(5000);
  });

  it("ignoriert Euro-Zeichen und Leerzeichen", () => {
    expect(parseAmountCents(" 12,50 € ", true)).toBe(1250);
  });

  it("parst englisches Format ohne Dezimalkomma", () => {
    expect(parseAmountCents("1234.56", false)).toBe(123456);
  });

  it("gibt 0 für einen Nullbetrag zurück", () => {
    expect(parseAmountCents("0,00", true)).toBe(0);
  });

  it("gibt null für leere oder unlesbare Werte zurück", () => {
    expect(parseAmountCents("", true)).toBeNull();
    expect(parseAmountCents("abc", true)).toBeNull();
    expect(parseAmountCents(undefined, true)).toBeNull();
  });
});

describe("buildRows", () => {
  const header = ["Buchungstag", "Verwendungszweck", "Empfaenger", "Betrag"];
  const mapping = { col_date: "Buchungstag", col_amount: "Betrag", col_payee: "Empfaenger", col_purpose: "Verwendungszweck", col_reference: "" };
  const opts = { date_format: "dd.MM.yyyy", decimal_comma: true };

  it("baut eine gültige Zeile mit Hash", () => {
    const rows = [header, ["05.09.2026", "Einkauf", "Rewe", "-5,55"]];
    const out = buildRows(rows, 0, mapping, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ok: true, date: "2026-09-05", cents: -555, payee: "Rewe", purpose: "Einkauf" });
    expect(out[0].hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("markiert Zeilen mit unlesbarem Datum oder Betrag", () => {
    const rows = [header, ["keinDatum", "x", "y", "-5,55"], ["05.09.2026", "x", "y", "kaputt"]];
    const out = buildRows(rows, 0, mapping, opts);
    expect(out[0]).toMatchObject({ ok: false, reason: "Datum unlesbar" });
    expect(out[1]).toMatchObject({ ok: false, reason: "Betrag unlesbar" });
  });

  it("markiert einen Nullbetrag ebenfalls als unlesbar", () => {
    const rows = [header, ["05.09.2026", "x", "y", "0,00"]];
    expect(buildRows(rows, 0, mapping, opts)[0]).toMatchObject({ ok: false, reason: "Betrag unlesbar" });
  });

  it("erkennt echte Mehrfachbuchungen innerhalb derselben Datei und vergibt #n-Suffixe", () => {
    const rows = [header,
      ["05.09.2026", "Parken", "Parkhaus", "-2,00"],
      ["05.09.2026", "Parken", "Parkhaus", "-2,00"],
      ["05.09.2026", "Parken", "Parkhaus", "-2,00"],
    ];
    const out = buildRows(rows, 0, mapping, opts);
    expect(out.every((r) => r.batchDupeCount === 3)).toBe(true);
    const hashes = out.map((r) => r.hash);
    expect(hashes[0]).not.toMatch(/#/);
    expect(hashes[1]).toBe(`${hashes[0]}#2`);
    expect(hashes[2]).toBe(`${hashes[0]}#3`);
    expect(new Set(hashes).size).toBe(3); // trotz gleicher Ausgangsdaten alle eindeutig
  });

  it("markiert normale, unterschiedliche Zeilen nicht als Mehrfachbuchung", () => {
    const rows = [header,
      ["05.09.2026", "Einkauf", "Rewe", "-5,55"],
      ["06.09.2026", "Einkauf", "Aldi", "-3,10"],
    ];
    const out = buildRows(rows, 0, mapping, opts);
    expect(out.every((r) => r.batchDupeCount === undefined)).toBe(true);
  });

  it("bezieht eine zugeordnete Referenzspalte in den Hash ein und vermeidet dadurch Kollisionen", () => {
    const headerWithRef = [...header, "Kundenreferenz"];
    const mappingWithRef = { ...mapping, col_reference: "Kundenreferenz" };
    const rows = [headerWithRef,
      ["05.09.2026", "Parken", "Parkhaus", "-2,00", "REF1"],
      ["05.09.2026", "Parken", "Parkhaus", "-2,00", "REF2"],
    ];
    const out = buildRows(rows, 0, mappingWithRef, opts);
    expect(out[0].hash).not.toBe(out[1].hash);
    expect(out.every((r) => r.batchDupeCount === undefined)).toBe(true);
  });
});

describe("applyRules", () => {
  const rules = [
    { pattern: "rewe", category: "cat-lebensmittel", tags: ["tag-food"] },
    { pattern: "spotify", category: "cat-abos", tags: [] },
  ];

  it("trifft case-insensitiv auf Empfänger oder Verwendungszweck", () => {
    expect(applyRules({ payee: "REWE Filiale 123", purpose: "" }, rules))
      .toEqual({ category: "cat-lebensmittel", tags: ["tag-food"] });
  });

  it("gibt eine leere Tags-Liste zurück, wenn die Regel keine Tags hat", () => {
    expect(applyRules({ payee: "Spotify AB", purpose: "" }, rules))
      .toEqual({ category: "cat-abos", tags: [] });
  });

  it("gibt null zurück, wenn keine Regel trifft", () => {
    expect(applyRules({ payee: "Unbekannt", purpose: "" }, rules)).toBeNull();
  });

  it("behandelt eine fehlende tags-Eigenschaft an der Regel wie eine leere Liste", () => {
    const rulesOhneTags = [{ pattern: "rewe", category: "cat-lebensmittel" }];
    expect(applyRules({ payee: "Rewe", purpose: "" }, rulesOhneTags))
      .toEqual({ category: "cat-lebensmittel", tags: [] });
  });
});

describe("findStatementBalance", () => {
  it("findet den Kontostand in einer Vorspann-Zeile (Label und Betrag getrennt)", () => {
    const rows = [
      ["Kontostand am 15.03.2026", "2.345,67 EUR"],
      ["Buchungstag", "Betrag", "Empfänger"],
      ["15.03.2026", "-10,00", "Test"],
    ];
    expect(findStatementBalance(rows, 1, true)).toBe(234567);
  });

  it("erkennt auch 'Saldo' als Label und einen negativen Betrag", () => {
    const rows = [
      ["Saldo", "-88,12 €"],
      ["Datum", "Betrag"],
    ];
    expect(findStatementBalance(rows, 1, true)).toBe(-8812);
  });

  it("verwechselt ein Datum in derselben Zeile nicht mit dem Betrag", () => {
    const rows = [
      ["Kontostand am 15.03.2026", "2.345,67 EUR"],
      ["Datum", "Betrag"],
    ];
    expect(findStatementBalance(rows, 1, true)).toBe(234567);
  });

  it("gibt null zurück, wenn keine Kontostand-Zeile im Vorspann vorkommt", () => {
    const rows = [
      ["Buchungstag", "Betrag", "Empfänger"],
      ["15.03.2026", "-10,00", "Test"],
    ];
    expect(findStatementBalance(rows, 0, true)).toBeNull();
  });

  it("berücksichtigt nur Zeilen vor der Kopfzeile", () => {
    const rows = [
      ["Buchungstag", "Betrag", "Empfänger"],
      ["15.03.2026", "-10,00", "Kontostand-Auszug"],
    ];
    expect(findStatementBalance(rows, 1, true)).toBeNull();
  });

  it("respektiert das Dezimaltrennzeichen (Punkt statt Komma)", () => {
    const rows = [
      ["Kontostand", "2345.67"],
      ["Date", "Amount"],
    ];
    expect(findStatementBalance(rows, 1, false)).toBe(234567);
  });
});
