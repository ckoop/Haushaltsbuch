import { useRef, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import * as api from "../pb.js";
import { eur, catIcon, colorOf, inputCls, ErrorNote, TxRow, Sheet, BudgetBar, byId, UNKNOWN_ACC } from "../ui.jsx";

export default function BudgetScreen({
  categories, accounts, budgets, incomeTarget, real, spentByCat, monthKey, acc, reload, flash, openDetail,
}) {
  const [error, setError] = useState(null);
  const [dauer, setDauer] = useState(true);
  const [showUncat, setShowUncat] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const incomeInputRef = useRef(null);
  const limitOf = (cid) => budgets.find((b) => b.category === cid)?.amount_cents ?? 0;
  const totalBudgeted = budgets.reduce((s, b) => s + b.amount_cents, 0);
  const remaining = incomeTarget - totalBudgeted;

  // Buchungen ohne Kategorie tauchen in keiner Budget-Zeile auf, weil Budgets
  // pro Kategorie laufen - ohne diesen Hinweis sieht die Ansicht faelschlich
  // nach "im Rahmen" aus, obwohl ein Teil der Ausgaben gar nicht mitgezaehlt
  // wird. Reagiert von selbst: reload() nach dem Setzen einer Kategorie in
  // TxDetail aktualisiert real, die Liste hier schrumpft dadurch automatisch.
  const uncategorized = real.filter((t) => t.amount_cents < 0 && !t.category);
  const uncategorizedSum = uncategorized.reduce((s, t) => s - t.amount_cents, 0);

  const save = async (cid, euros) => {
    const cents = Math.max(0, Math.round((Number(euros) || 0) * 100));
    try {
      await api.setBudget(acc, cid, dauer ? "*" : monthKey, cents);
      flash(cents ? "Budget gesichert" : "Budget entfernt");
      reload();
    } catch (e) { setError(e); }
  };

  const saveIncome = async (euros) => {
    const cents = Math.max(0, Math.round((Number(euros) || 0) * 100));
    try {
      await api.setIncomeTarget(dauer ? "*" : monthKey, cents);
      flash(cents ? "Einnahmen gesichert" : "Einnahmen entfernt");
      reload();
    } catch (e) { setError(e); }
  };

  // Fuellt das Einnahmen-Feld mit der Summe der tatsaechlich gebuchten
  // Einnahmen des Vormonats - nur auf Klick geladen (eigener Request), damit
  // das nicht bei jedem Tab-Aufruf mitgeholt werden muss. Speichert noch
  // nicht selbst, der Wert muss wie ueberall sonst per Blur bestaetigt werden.
  const applySuggestion = async () => {
    setSuggesting(true);
    try {
      const prevDate = api.addMonths(`${monthKey}-01`, -1);
      const [py, pm] = prevDate.split("-").map(Number);
      const cents = await api.actualIncomeForMonth(py, pm - 1);
      if (incomeInputRef.current) incomeInputRef.current.value = cents ? cents / 100 : "";
    } catch (e) { setError(e); }
    finally { setSuggesting(false); }
  };

  return (
    <div className="px-5 py-4">
      <p className="text-sm text-stone-600 dark:text-stone-300 mb-3">
        {acc === "alle"
          ? "Budgets gelten pro Konto. Wähle oben in der Buchungsliste ein einzelnes Konto, um dessen Budgets zu sehen oder zu setzen."
          : `Monatslimit pro Kategorie für ${byId(accounts, acc, UNKNOWN_ACC).name}. 0 entfernt das Budget.`}
      </p>

      {uncategorized.length > 0 && (
        <button onClick={() => setShowUncat(true)}
          className="w-full flex items-center gap-2 text-left text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-lg px-3 py-2.5 mb-4">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            {uncategorized.length} {uncategorized.length === 1 ? "Buchung" : "Buchungen"} ohne Kategorie
            ({eur(uncategorizedSum)}) — zählen in keinem Budget mit.
          </span>
          <ChevronRight size={14} className="shrink-0" />
        </button>
      )}

      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        <button onClick={() => setDauer(true)}
          className={`px-3.5 py-1.5 ${dauer ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
          Jeden Monat
        </button>
        <button onClick={() => setDauer(false)}
          className={`px-3.5 py-1.5 border-l border-stone-300 dark:border-stone-600 ${
            !dauer ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
          Nur {monthKey}
        </button>
      </div>

      <ErrorNote error={error} />

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 px-3.5 py-2.5 mb-4 flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <span className="block text-sm">Einnahmen {dauer ? "jeden Monat" : `nur ${monthKey}`}</span>
          {incomeTarget === 0 && (
            <button type="button" onClick={applySuggestion} disabled={suggesting}
              className="block text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              {suggesting ? "Lädt …" : "Vorschlag aus Vormonat übernehmen"}
            </button>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <input ref={incomeInputRef} type="number" min="0" step="10" placeholder="—"
            defaultValue={incomeTarget ? incomeTarget / 100 : ""}
            onBlur={(e) => saveIncome(e.target.value)}
            className={`${inputCls} w-24! shrink-0 text-right tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500">€</span>
        </span>
      </div>

      {acc !== "alle" && incomeTarget > 0 && (
        <div className="mb-5">
          <BudgetBar name="Insgesamt verplant" limit={incomeTarget} spent={totalBudgeted} />
          <p className={`text-xs mt-1.5 ${
            remaining < 0 ? "text-red-600 dark:text-red-400" : "text-stone-500 dark:text-stone-400"}`}>
            {remaining < 0
              ? `${eur(-remaining)} mehr verplant als Einnahmen`
              : `${eur(remaining)} noch nicht verplant`}
          </p>
        </div>
      )}

      {acc !== "alle" && (
        <>
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
            {categories.filter((c) => c.kind === "expense" && !c.archived).map((c) => {
              const Icon = catIcon(c.icon);
              const [bg, fg] = colorOf(c.color);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={`w-8 h-8 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
                    <Icon size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm">{c.name}</span>
                    <span className="block text-xs text-stone-400 dark:text-stone-500 tabular-nums">
                      bisher {eur(spentByCat[c.id] ?? 0)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <input type="number" min="0" step="10" placeholder="—"
                      defaultValue={limitOf(c.id) ? limitOf(c.id) / 100 : ""}
                      onBlur={(e) => save(c.id, e.target.value)}
                      className={`${inputCls} w-24! shrink-0 text-right tabular-nums`} />
                    <span className="text-sm text-stone-400 dark:text-stone-500">€</span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-3">
            Ein Budget für einen einzelnen Monat schlägt das Dauerbudget derselben Kategorie.
          </p>
        </>
      )}

      {showUncat && (
        <Sheet title="Ohne Kategorie" onClose={() => setShowUncat(false)}>
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
            {uncategorized.map((t) => (
              <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount
                onClick={() => openDetail(t)} />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
