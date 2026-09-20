// Rücklagen-Berechnung für unregelmäßige (quartalsweise/jährliche)
// Daueraufträge im Budget-Screen. Reine Funktionen, kein PocketBase-Zugriff
// (gleiche Trennung wie csv.js) - der Saldo wird bei jedem Aufruf frisch aus
// recurring_rules + den daraus bereits gebuchten Transaktionen abgeleitet,
// es gibt keinen eigenen gespeicherten Zustand. Details/Rationale siehe
// screens/CLAUDE.md, Abschnitt "Rücklagen für unregelmäßige Buchungen".

const MONTHS_PER = { quarterly: 3, yearly: 12 };

// Monatsdifferenz zweier "JJJJ-MM"-Strings, inklusive beider Enden -
// monthsBetweenInclusive("2026-01", "2026-01") ist 1, nicht 0.
export function monthsBetweenInclusive(fromYM, toYM) {
  const [fy, fm] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// Rücklagen-Status einer Regel für einen bestimmten Monat.
// rule: { amount_cents, frequency, created } aus recurring_rules.
// txs: alle bisher aus dieser Regel gebuchten Transaktionen
//      ({ date, amount_cents }, aufsteigend nach Datum sortiert).
// monthKey: "JJJJ-MM" des betrachteten Monats.
export function reserveStatus(rule, txs, monthKey) {
  // rule.amount_cents ist wie bei Buchungen bei einer Ausgabe negativ - hier
  // wird durchgehend mit dem positiven Zielbetrag gerechnet.
  const target = Math.abs(rule.amount_cents);
  const monthly = Math.round(target / MONTHS_PER[rule.frequency]);
  const inMonth = txs.filter((t) => t.date.slice(0, 7) === monthKey);
  const before = txs.filter((t) => t.date.slice(0, 7) < monthKey);

  // Der Zyklus beginnt neu direkt nach der letzten tatsächlichen Abbuchung,
  // nicht ab Regel-Erstellung - macht die Berechnung robust gegenüber
  // späteren Betragsänderungen und braucht keine Jahreswechsel-Sonderregel.
  let cycleStart;
  if (before.length > 0) {
    const lastYM = before[before.length - 1].date.slice(0, 7);
    const [ly, lm] = lastYM.split("-").map(Number);
    const ny = lm === 12 ? ly + 1 : ly;
    const nm = lm === 12 ? 1 : lm + 1;
    cycleStart = `${ny}-${String(nm).padStart(2, "0")}`;
  } else {
    cycleStart = rule.created.slice(0, 7);
  }

  const monthsAccrued = Math.max(0, monthsBetweenInclusive(cycleStart, monthKey));
  const saved = monthly * monthsAccrued;
  const withdrawn = inMonth.reduce((s, t) => s - t.amount_cents, 0);

  return {
    monthly,
    target,
    saved: Math.max(0, saved - withdrawn),
    withdrawn,
    dueInMonth: inMonth.length > 0,
    deficit: Math.max(0, withdrawn - saved),
  };
}
