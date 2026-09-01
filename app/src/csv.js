// Alles rund um den Import deutscher Bank-Exporte.

// --------------------------------------------------------------------- Hash
// Bewusst kein crypto.subtle: das steht nur im sicheren Kontext zur Verfuegung,
// und die App laeuft im Heimnetz ueber http. FNV-1a reicht hier voellig -- der
// Hash muss Doppel-Importe erkennen, nicht Angriffe abwehren.
export function hashRow(...parts) {
  const s = parts.join("\u0000");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ----------------------------------------------------------------- Kodierung

export const ENCODINGS = [
  { id: "windows-1252", label: "Windows-1252 (übliche Bank-Exporte)" },
  { id: "utf-8", label: "UTF-8" },
];

export function decodeFile(buffer, encoding) {
  let text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  return text;
}

// Umlaute falsch dekodiert? "MÃ¼ller" statt "Müller" ist das typische Muster.
export const looksMisdecoded = (text) => /Ã.|Â./.test(text.slice(0, 4000));

// ------------------------------------------------------------------- Parser

export const DELIMITERS = [
  { id: "semicolon", char: ";", label: "Semikolon ;" },
  { id: "comma", char: ",", label: "Komma ," },
  { id: "tab", char: "\t", label: "Tabulator" },
];
export const delimChar = (id) => DELIMITERS.find((d) => d.id === id)?.char ?? ";";

// Kleiner Parser nach RFC 4180: Anfuehrungszeichen, doppelte Anfuehrungszeichen
// als Escape, Zeilenumbrueche innerhalb von Feldern.
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Sparkassen-Exporte haben oft Vorspann-Zeilen. Die echte Kopfzeile ist die
// erste mit mehreren Spalten, in der ein Datums- und ein Betragsbegriff steht.
export function findHeaderRow(rows) {
  const dateWords = /datum|buchung|valuta|date/i;
  const amountWords = /betrag|umsatz|soll|haben|amount|wert/i;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i];
    if (r.length >= 3 && r.some((c) => dateWords.test(c)) && r.some((c) => amountWords.test(c)))
      return i;
  }
  return 0;
}

export function guessDelimiter(text) {
  const first = text.split("\n").slice(0, 20).join("\n");
  const counts = DELIMITERS.map((d) => [d.id, (first.split(d.char).length - 1)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : "semicolon";
}

// --------------------------------------------------------- Spaltenzuordnung

const PATTERNS = {
  date: [/^buchungstag$/i, /^buchungsdatum$/i, /^datum$/i, /buchung/i, /valuta/i, /date/i],
  amount: [/^betrag$/i, /betrag/i, /^umsatz$/i, /amount/i, /wert/i],
  payee: [/beguenstigter/i, /begünstigter/i, /zahlungspflichtiger/i, /auftraggeber/i,
          /empfaenger/i, /empfänger/i, /name/i, /payee/i],
  purpose: [/verwendungszweck/i, /buchungstext/i, /vorgang/i, /zweck/i, /description/i, /referenz/i],
};

export function guessMapping(header) {
  const pick = (patterns) => {
    for (const p of patterns) {
      const hit = header.find((h) => p.test(h.trim()));
      if (hit) return hit;
    }
    return "";
  };
  return {
    col_date: pick(PATTERNS.date),
    col_amount: pick(PATTERNS.amount),
    col_payee: pick(PATTERNS.payee),
    col_purpose: pick(PATTERNS.purpose),
  };
}

// --------------------------------------------------------- Werte umwandeln

export const DATE_FORMATS = [
  { id: "dd.MM.yyyy", label: "31.08.2026" },
  { id: "yyyy-MM-dd", label: "2026-08-31" },
  { id: "dd/MM/yyyy", label: "31/08/2026" },
];

export function parseDate(value, format) {
  const s = (value ?? "").trim();
  if (!s) return null;
  let d, m, y;
  if (format === "yyyy-MM-dd") {
    const p = s.slice(0, 10).split("-");
    [y, m, d] = p;
  } else {
    const p = s.split(format === "dd/MM/yyyy" ? "/" : ".");
    [d, m, y] = p;
  }
  if (!d || !m || !y) return null;
  if (y.length === 2) y = String(2000 + Number(y)); // manche Exporte kuerzen das Jahr
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

// "-1.234,56" -> -123456 ; "1234.56" -> 123456
export function parseAmountCents(value, decimalComma) {
  let s = (value ?? "").replace(/[\s\u00a0€]/g, "").trim();
  if (!s) return null;
  let negative = s.startsWith("-");
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); } // nachgestelltes Minus
  s = s.replace(/^[+-]/, "");
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

// ------------------------------------------------------------ Zeilen bauen

export function buildRows(rows, headerIndex, mapping, opts) {
  const header = rows[headerIndex].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iDate = idx(mapping.col_date);
  const iAmount = idx(mapping.col_amount);
  const iPayee = idx(mapping.col_payee);
  const iPurpose = idx(mapping.col_purpose);

  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[iDate], opts.date_format);
    const cents = parseAmountCents(r[iAmount], opts.decimal_comma);
    if (date === null || cents === null || cents === 0) {
      out.push({ ok: false, raw: r, reason: date === null ? "Datum unlesbar" : "Betrag unlesbar" });
      continue;
    }
    const payee = (iPayee >= 0 ? r[iPayee] : "")?.trim() ?? "";
    const purpose = (iPurpose >= 0 ? r[iPurpose] : "")?.trim() ?? "";
    out.push({
      ok: true,
      date, cents, payee, purpose,
      hash: hashRow(date, String(cents), payee, purpose),
    });
  }
  return out;
}

// Textmuster aus der Sammlung "rules" auf Zahlungsempfaenger und Zweck anwenden.
export function applyRules(row, rules) {
  const haystack = `${row.payee} ${row.purpose}`.toLowerCase();
  for (const r of rules) {
    if (haystack.includes(r.pattern.toLowerCase())) return r.category;
  }
  return "";
}
