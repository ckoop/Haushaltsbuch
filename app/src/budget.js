// Ausgaben je Kategorie für Budgets/Auswertung - reine Funktion ohne
// PocketBase-Zugriff (wie csv.js/ruecklagen.js), damit sie ohne Browser
// testbar bleibt.
//
// Ab 0.56.0: Eine Umbuchung kann eine Kategorie tragen (z. B. "Sparen") und
// zählt dann im Budget wie eine Ausgabe dieser Kategorie - und zwar nur aus
// Sicht des QUELLkontos (account), das Zielkonto bekommt keine Ausgabe. Das ist
// bewusst eine Ausnahme von "Umbuchungen fallen aus Budgets heraus" (CLAUDE.md),
// auf ausdrücklichen Wunsch: eine Sparrate soll im Budget stehen, aber das
// Sparkonto soll sein Plus über eine einzige Umbuchung bekommen statt über
// eine Ausgabe plus Einnahme. Umbuchungen OHNE Kategorie bleiben wie bisher
// ganz draußen. Einnahmen/Ausgaben-Summen, Saldo und Sparquote bleiben davon
// unberührt, sie rechnen weiter nur mit echten Buchungen (type "tx").
//
// txs: alle sichtbaren Buchungen des Monats; accGroup: Set der Konto-IDs der
// gewählten Ansicht (Konto + seine Töpfe) oder null für "alle Konten".
export function spentByCategory(txs, accGroup = null) {
  const o = {};
  for (const t of txs) {
    if (t.type === "transfer") {
      if (!t.category) continue;
      if (accGroup && !accGroup.has(t.account)) continue;
      o[t.category] = (o[t.category] ?? 0) + t.amount_cents;
    } else if (t.amount_cents < 0) {
      o[t.category] = (o[t.category] ?? 0) - t.amount_cents;
    }
  }
  return o;
}
