import * as api from "../pb.js";
import {
  eur, relDay, byId, typeIcon,
  UNKNOWN_ACC, UNKNOWN_CAT, BudgetBar, TxRow,
} from "../ui.jsx";

export default function Buchungen({
  accounts, categories, transactions, real, spentByCat, budgets,
  balances, acc, setAcc, openDetail,
}) {
  const expense = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);

  const groups = [];
  for (const t of transactions) {
    const d = api.dateOnly(t.date);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.items.push(t);
    else groups.push({ date: d, items: [t] });
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto px-5 pt-3.5 pb-1">
        <AccChip label="Alle Konten" value={balances.alle} on={acc === "alle"} onClick={() => setAcc("alle")} />
        {accounts.map((a) => {
          const Icon = typeIcon(a.type);
          return (
            <AccChip key={a.id} label={a.name} Icon={Icon} value={balances[a.id]}
              on={acc === a.id} onClick={() => setAcc(a.id)} />
          );
        })}
      </div>

      <section className="px-5 py-4 grid grid-cols-2 gap-3">
        <Metric label={acc === "alle" ? "Summe aller Konten" : byId(accounts, acc, UNKNOWN_ACC).name}
          value={balances[acc] ?? 0} signed />
        <Metric label="Ausgaben" value={-expense} />
      </section>

      {budgets.length > 0 && acc === "alle" && (
        <section className="px-5 pb-4">
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">Budgets · kontoübergreifend</p>
          <div className="space-y-3">
            {budgets.map((b) => (
              <BudgetBar key={b.id} name={byId(categories, b.category, UNKNOWN_CAT).name}
                limit={b.amount_cents} spent={spentByCat[b.category] ?? 0} />
            ))}
          </div>
        </section>
      )}

      <section className="px-5">
        {groups.length === 0 && (
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-16">
            Keine Buchungen in diesem Zeitraum.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.date} className="mb-1">
            <p className="text-xs text-stone-400 dark:text-stone-500 pt-3 pb-1">{relDay(g.date)}</p>
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
              {g.items.map((t) => (
                <TxRow key={t.id} tx={t} accounts={accounts} categories={categories}
                  showAccount={acc === "alle"} onClick={() => openDetail(t)} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function AccChip({ label, value, on, Icon, onClick }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 rounded-xl border px-3 py-2 text-left ${
        on ? "bg-stone-900 border-stone-900 dark:bg-emerald-600 dark:border-emerald-600 text-white"
          : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700"}`}>
      <span className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className={on ? "text-stone-300" : "text-stone-400 dark:text-stone-500"} />}
        <span className={`text-[11px] ${on ? "text-stone-300" : "text-stone-500 dark:text-stone-400"}`}>{label}</span>
      </span>
      <span className={`block text-[13px] font-medium tabular-nums mt-0.5 ${
        !on && value < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{eur(value)}</span>
    </button>
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
