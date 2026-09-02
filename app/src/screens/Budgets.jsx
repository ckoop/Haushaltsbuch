import { useState } from "react";
import * as api from "../pb.js";
import { eur, catIcon, colorOf, inputCls, ErrorNote } from "../ui.jsx";

export default function BudgetScreen({ categories, budgets, spentByCat, monthKey, reload, flash }) {
  const [error, setError] = useState(null);
  const [dauer, setDauer] = useState(true);
  const limitOf = (cid) => budgets.find((b) => b.category === cid)?.amount_cents ?? 0;

  const save = async (cid, euros) => {
    const cents = Math.max(0, Math.round(Number(euros) || 0) * 100);
    try {
      await api.setBudget(cid, dauer ? "*" : monthKey, cents);
      flash(cents ? "Budget gesichert" : "Budget entfernt");
      reload();
    } catch (e) { setError(e); }
  };

  return (
    <div className="px-5 py-4">
      <p className="text-sm text-stone-600 dark:text-stone-300 mb-3">
        Monatslimit pro Kategorie, kontoübergreifend. 0 entfernt das Budget.
      </p>

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
              <span className="flex items-center gap-1">
                <input type="number" min="0" step="10" placeholder="—"
                  defaultValue={limitOf(c.id) ? limitOf(c.id) / 100 : ""}
                  onBlur={(e) => save(c.id, e.target.value)}
                  className={`${inputCls} w-20 text-right tabular-nums`} />
                <span className="text-sm text-stone-400 dark:text-stone-500">€</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-stone-400 dark:text-stone-500 mt-3">
        Ein Budget für einen einzelnen Monat schlägt das Dauerbudget derselben Kategorie.
      </p>
    </div>
  );
}
