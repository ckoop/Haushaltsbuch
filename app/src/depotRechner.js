// Reine Hilfsfunktionen fuer die Stueckzahl-Schaetzung im Trade-Dialog
// (Depot.jsx): aus einem Sparbetrag und dem Schlusskurs eines Tages die
// ungefaehre Anteilszahl ableiten. Kein PocketBase-Zugriff, gleiche
// Trennung wie csv.js/ruecklagen.js - dadurch ohne Browser testbar.

const DAY_MS = 86400000;
const dayNumber = (iso) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY_MS);

// Kleinste Yahoo-"range", die das Datum noch sicher einschliesst - mit
// Puffer, damit auch ein Wochenend-/Feiertagsdatum noch einen vorherigen
// Handelstag in der Reihe findet. Tagesintervall, kein Wochenraster.
export function historyRangeFor(dateISO, todayISO) {
  const days = dayNumber(todayISO) - dayNumber(dateISO);
  if (days <= 25) return "1mo";
  if (days <= 80) return "3mo";
  if (days <= 170) return "6mo";
  if (days <= 350) return "1y";
  if (days <= 1750) return "5y";
  return "10y";
}

// Letzter Kurs am oder vor dem Datum (Wochenende/Feiertag -> Freitag bzw.
// letzter Handelstag). points: [{ date: "YYYY-MM-DD", price }], beliebige
// Reihenfolge. Gibt null zurueck, wenn die Reihe erst nach dem Datum beginnt.
export function closeOnOrBefore(points, dateISO) {
  let best = null;
  for (const p of points) {
    if (p.date <= dateISO && (!best || p.date > best.date)) best = p;
  }
  return best;
}

// Stueckzahl aus Betrag und Preis, jeweils in Cent. Auf 4 Nachkommastellen
// gerundet (so viel zeigt die Depot-Ansicht an; bei 350 EUR liegt der
// Rundungsfehler bei einem Bruchteil eines Cents). null bei ungueltigem Preis.
export function estimateQuantity(amountCents, priceCents) {
  if (!(amountCents > 0) || !(priceCents > 0)) return null;
  return Math.round((amountCents / priceCents) * 10000) / 10000;
}
