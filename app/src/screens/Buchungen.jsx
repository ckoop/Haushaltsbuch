import { useState } from "react";
import { ChevronRight, Search, TrendingDown, TrendingUp, X } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, eurAbs, relDay, todayISO, byId,
  UNKNOWN_ACC, UNKNOWN_CAT, BudgetBar, TxRow, AccChipRow,
} from "../ui.jsx";

// Eigenes Datumslabel fuer Suchtreffer statt relDay: Treffer koennen ueber
// mehrere Jahre streuen, relDay zeigt aber nie ein Jahr (im normalen
// Monats-Kontext ist das eindeutig genug, hier nicht mehr).
const searchDayLabel = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

export default function Buchungen({
  accounts, categories, transactions, real, spentByCat, budgets, incomeEntries,
  balances, acc, setAcc, openDetail, monthKey,
  query, setQuery, searchResults, searching,
}) {
  const [showBudgets, setShowBudgets] = useState(false);
  const isSearching = searchResults !== null;
  const expense = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  // Einnahmen minus Ausgaben fuer den sichtbaren Zeitraum - anders als die
  // "Ausgaben"-Kachel vorher (nur negative Betraege) rechnet das Einnahmen
  // mit gegen, damit die Zahl mit einer eigenen Kontrollsumme aus der
  // Bank-CSV uebereinstimmt. Gleiche Rechnung wie "Netto" in Auswertung.jsx.
  const income = real.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const net = income - expense;

  // Hochrechnung "reicht das Geld diesen Monat": rechnet die bisherigen
  // Ausgaben (Tagesdurchschnitt mal Tage im Monat) gegen das im Budgets-Tab
  // hinterlegte Einnahmenziel (income_targets, kontouebergreifend, s.
  // screens/CLAUDE.md) statt gegen die tatsaechlich schon gebuchten
  // Einnahmen - das Gehalt kommt oft erst spaet im Monat, ohne Ziel waere
  // die Hochrechnung fast immer faelschlich negativ. Ohne eingetragenes Ziel
  // (totalIncomeTarget === 0) gibt es nichts, wogegen sich rechnen liesse -
  // dann bleibt der Hinweis ganz weg. Bewusst nur der laufende Kalendermonat
  // - bei einem bereits abgeschlossenen Monat steht das tatsaechliche
  // Ergebnis schon fest, bei einem zukuenftigen liegen noch keine Buchungen
  // vor.
  //
  // Als "wiederkehrend" markierte Ausgaben (transactions.recurring, z. B.
  // die Miete am 1.) fliessen mit ihrem vollen Betrag ein, nicht in die
  // Tagesdurchschnitt-Hochrechnung - sie fallen im laufenden Monat nicht
  // nochmal an, wuerden den Tagesschnitt sonst aber genau so verzerren, als
  // kaeme im Rest des Monats taeglich ein Bruchteil der Miete oben drauf.
  // Nur die uebrigen, tatsaechlich unregelmaessigen Ausgaben (Lebensmittel,
  // Freizeit etc.) werden hochgerechnet. Bleibt trotzdem ein grober
  // Fingerzeig, kein Budget-Ersatz: eine einzelne fruehe, nicht als
  // wiederkehrend markierte Grossbuchung kann die Hochrechnung fuer den
  // Rest des Monats weiterhin sichtbar verzerren.
  const today = todayISO();
  const isCurrentMonth = monthKey === today.slice(0, 7);
  const daysElapsed = isCurrentMonth ? Number(today.slice(8, 10)) : 0;
  const totalIncomeTarget = incomeEntries.reduce((s, e) => s + e.amount_cents, 0);
  const forecast = isCurrentMonth && daysElapsed > 0 && totalIncomeTarget > 0 ? (() => {
    const [fy, fm] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(fy, fm, 0).getDate();
    const recurringExpense = real
      .filter((t) => t.amount_cents < 0 && t.recurring)
      .reduce((s, t) => s - t.amount_cents, 0);
    const variableExpense = expense - recurringExpense;
    const projectedExpense = recurringExpense + Math.round((variableExpense / daysElapsed) * daysInMonth);
    return totalIncomeTarget - projectedExpense;
  })() : null;

  // Waehrend einer aktiven Suche ersetzt die flache Trefferliste (ueber die
  // komplette Historie, kontouebergreifend) die normale Monats-/Konto-Sicht
  // komplett - Kontostand/Saldo/Budgets beziehen sich sonst auf den sichtbaren
  // Monat und waeren fuer Treffer aus anderen Monaten irrefuehrend.
  const list = isSearching ? searchResults : transactions;
  const groups = [];
  for (const t of list) {
    const d = api.dateOnly(t.date);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.items.push(t);
    else groups.push({ date: d, items: [t] });
  }

  return (
    <>
      <div className="px-5 pt-3.5 pb-1">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Empfänger, Verwendungszweck, Kategorie oder Tag suchen …"
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500" />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Suche löschen"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {!isSearching && <AccChipRow accounts={accounts} balances={balances} acc={acc} setAcc={setAcc} />}

      {!isSearching && (
        <section className="px-5 py-4 grid grid-cols-2 gap-3">
          <Metric label={acc === "alle" ? "Summe aller Konten" : byId(accounts, acc, UNKNOWN_ACC).name}
            value={balances[acc] ?? 0} signed />
          <Metric label="Saldo" value={net} signed />
        </section>
      )}

      {!isSearching && forecast !== null && (
        <section className="px-5 pb-4">
          <div className={`rounded-xl px-4 py-3 border flex items-start gap-2 text-[13px] ${
            forecast >= 0
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
            {forecast >= 0
              ? <TrendingUp size={15} className="mt-0.5 shrink-0" />
              : <TrendingDown size={15} className="mt-0.5 shrink-0" />}
            <span>
              Beim aktuellen Tempo {forecast >= 0
                ? <>reicht das Einkommen voraussichtlich, mit <strong>{eurAbs(forecast)}</strong> übrig.</>
                : <>reicht das Einkommen voraussichtlich nicht — es fehlen etwa <strong>{eurAbs(forecast)}</strong>.</>}
            </span>
          </div>
        </section>
      )}

      {!isSearching && budgets.length > 0 && acc !== "alle" && (
        <section className="px-5 pb-4">
          <button onClick={() => setShowBudgets((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 mb-2.5">
            <ChevronRight size={12} className={`transition-transform ${showBudgets ? "rotate-90" : ""}`} />
            Budgets {showBudgets ? "ausblenden" : `anzeigen (${budgets.length})`}
          </button>
          {showBudgets && (
            <div className="space-y-3">
              {budgets.map((b) => (
                <BudgetBar key={b.id} name={byId(categories, b.category, UNKNOWN_CAT).name}
                  limit={b.amount_cents} spent={spentByCat[b.category] ?? 0} />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="px-5 pt-1">
        {isSearching && (
          <p className="text-xs text-stone-400 dark:text-stone-500 pb-1">
            {searching ? "Suche …" : `${searchResults.length} Treffer`}
          </p>
        )}
        {groups.length === 0 && !searching && (
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-16">
            {isSearching ? "Keine Buchungen gefunden." : "Keine Buchungen in diesem Zeitraum."}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.date} className="mb-1">
            <p className="text-xs text-stone-400 dark:text-stone-500 pt-3 pb-1">
              {isSearching ? searchDayLabel(g.date) : relDay(g.date)}
            </p>
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
              {g.items.map((t) => (
                <TxRow key={t.id} tx={t} accounts={accounts} categories={categories}
                  showAccount={isSearching || acc === "alle"} onClick={() => openDetail(t)} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function Metric({ label, value, signed }) {
  return (
    <div className="bg-white dark:bg-stone-800 rounded-xl px-4 py-3 border border-stone-200 dark:border-stone-700">
      <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{label}</p>
      <p className={`text-xl font-medium tabular-nums mt-0.5 ${
        signed && value < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
        {eur(value)}
      </p>
    </div>
  );
}
