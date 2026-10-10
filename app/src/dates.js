// Reine Datumshelfer, von beiden Backends (backend/pocketbase.js,
// backend/sqlite.js) und über pb.js auch von den Screens genutzt - ohne
// Datenzugriff, damit sie nur einmal existieren.

// Monatsgrenzen als ISO-Datum: [start, end) plus Schlüssel "JJJJ-MM".
// m ist 0-basiert (wie Date#getMonth).
export const monthRange = (y, m) => {
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  const end = `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
  return { start, end, key: start.slice(0, 7) };
};

// Datumsfelder liegen als "2026-08-31 00:00:00.000Z" vor (PocketBase-Format,
// die SQLite-Fassung schreibt dasselbe) - hier nur der Tag.
export const dateOnly = (v) => (v ?? "").slice(0, 10);

// ISO-Datum um n Monate verschieben; ein zu kurzer Zielmonat klemmt auf den
// letzten Tag (31.01. + 1 Monat = 28./29.02.).
export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  // `%` liefert bei negativen Zahlen negative Reste (-1 % 12 = -1) - erst auf
  // 0..11 normalisieren, sonst kommt bei "Januar minus n Monate" Monat 0 oder
  // ein negativer Monat heraus.
  const nm = ((total % 12) + 12) % 12 + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}
