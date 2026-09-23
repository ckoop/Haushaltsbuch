// Alles rund um den Import von DKB-Kontoauszuegen als PDF. Reine
// Parsing-Logik ohne pdfjs-dist - der Screen (ImportPdf.jsx) extrahiert die
// rohen Text-Items per pdfjs-dist und reicht sie hier rein, damit dieses
// Modul wie csv.js ohne Browser-/PDF-Bibliothek testbar bleibt.
import { parseDate, parseAmountCents, hashRow, markBatchDupes } from "./csv.js";

// ---------------------------------------------------- Zeilen rekonstruieren

// pdfjs' getTextContent() liefert Text-Items mit Position (transform[4]/[5]
// als x/y), aber keine Zeilen-/Spaltenrekonstruktion wie "pdftotext -layout".
// items: [{str, x, y, width}], von oben nach unten (PDF-Ursprung ist unten
// links, deshalb y absteigend sortieren). yTolerance bindet Items mit fast
// gleichem y (Baseline-Jitter durch Schriftschnitt-Wechsel mitten in einer
// Zeile) in dieselbe Zeile; xGap entscheidet, ob zwei Items durch ein
// Leerzeichen getrennt werden. Muss NICHT die Original-Spaltenbreite
// nachbilden - es reicht, dass die Wortreihenfolge stimmt (erstes Token =
// Datum, letztes = Betrag), das genuegt der Block-Erkennung unten.
export function reconstructLines(items, { yTolerance = 2, xGap = 1 } = {}) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let current = null;
  for (const it of sorted) {
    if (!it.str.trim()) continue;
    if (!current || Math.abs(it.y - current.y) > yTolerance) {
      current = { y: it.y, items: [] };
      lines.push(current);
    }
    current.items.push(it);
  }
  return lines.map((line) => {
    const its = line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prevRight = null;
    for (const it of its) {
      if (prevRight !== null && it.x - prevRight > xGap) text += " ";
      text += it.str;
      prevRight = it.x + (it.width ?? 0);
    }
    return text.trim();
  });
}

// ------------------------------------------------------ Transaktionsbloecke

// Erste Zeile eines Blocks: Datum, Empfaenger, Betrag - alles auf einer
// Zeile, durch die rechtsbuendige Betragsspalte am Ende erkennbar.
const DATE_LINE = /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(-?[\d.,]+)$/;
// Spaltenkopfzeile "Datum  Erlaeuterung  ...  Betrag EUR" - alles davor
// (Adressblock, "Auszug"-Titel, IBAN-/Zeitraum-Zeile auf Seite 1) wird damit
// transparent uebersprungen, ohne jede Vorspann-Zeile einzeln zu erkennen.
const COLUMN_HEADER = /^Datum\b/;
// DKB-Fusszeile jeder Seite - bewusst auf "Deutsche Kreditbank" gematcht,
// nicht auf "Aktiengesellschaft": Font-Ligaturen wie "ft" fallen beim
// Extrahieren manchmal weg ("Aktiengesellscha"), "Deutsche Kreditbank" ist
// davon nicht betroffen.
const FOOTER_START = /^Deutsche Kreditbank\b/;

// Eine Seite (string[] aus reconstructLines) -> rohe Transaktionsbloecke.
// Zustandsautomat: vor der Spaltenkopfzeile wird alles ignoriert, danach
// eroeffnet jede Datumszeile einen neuen Block, die Fusszeile schliesst den
// offenen Block und beendet die Seite, alles andere haengt als
// Fortsetzungszeile (IBAN, Verwendungszweck, ggf. umgebrochener Empfaenger)
// am zuletzt eroeffneten Block.
export function parsePageLines(lines) {
  const blocks = [];
  let inTable = false;
  let current = null;
  const closeCurrent = () => { if (current) blocks.push(current); current = null; };
  for (const line of lines) {
    if (!inTable) {
      if (COLUMN_HEADER.test(line)) inTable = true;
      continue;
    }
    if (FOOTER_START.test(line)) { closeCurrent(); inTable = false; continue; }
    const m = DATE_LINE.exec(line);
    if (m) {
      closeCurrent();
      current = { dateRaw: m[1], payeeRaw: m[2], amountRaw: m[3], purposeLines: [] };
      continue;
    }
    if (current) current.purposeLines.push(line);
  }
  closeCurrent(); // falls eine Seite ausnahmsweise ohne Fusszeile endet
  return blocks;
}

// Mehrere Seiten (Array<string[]>) -> flache Liste roher Bloecke.
export function extractTransactions(pagesOfLines) {
  return pagesOfLines.flatMap(parsePageLines);
}

// Rohe Bloecke -> exakt dieselbe Vertragsform wie csv.buildRows():
// Array<{ok:true,date,cents,payee,purpose,hash,batchDupeCount?}|{ok:false,raw,reason}>.
// Der Kontoauszug nennt Betraege durchgehend mit Punkt als Dezimaltrennzeichen
// (z. B. "-147.47"), deshalb parseAmountCents(..., false) statt des sonst
// ueblichen Komma-Formats.
export function buildRows(rawBlocks) {
  const out = rawBlocks.map((b) => {
    const date = parseDate(b.dateRaw, "dd.MM.yyyy");
    const cents = parseAmountCents(b.amountRaw, false);
    if (date === null || cents === null || cents === 0) {
      return { ok: false, raw: b, reason: date === null ? "Datum unlesbar" : "Betrag unlesbar" };
    }
    const payee = b.payeeRaw.trim();
    const purpose = b.purposeLines.join(" ").replace(/\s+/g, " ").trim();
    return { ok: true, date, cents, payee, purpose, hash: hashRow(date, String(cents), payee, purpose) };
  });
  markBatchDupes(out);
  return out;
}
