import { useState } from "react";
import { Trash2, ArrowLeftRight } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, eurAbs, relDay, byId, typeIcon, catIcon, colorOf, shortName,
  UNKNOWN_ACC, UNKNOWN_CAT, BudgetBar, TxRow, Sheet, Button, RECURRING,
} from "../ui.jsx";

export default function Buchungen({
  accounts, categories, transactions, real, spentByCat, budgets,
  balances, acc, setAcc, reload, flash, setError,
}) {
  const [detail, setDetail] = useState(null);
  const expense = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);

  const groups = [];
  for (const t of transactions) {
    const d = api.dateOnly(t.date);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.items.push(t);
    else groups.push({ date: d, items: [t] });
  }

  const remove = async (id) => {
    try { await api.deleteTransaction(id); setDetail(null); flash("Buchung gelöscht"); reload(); }
    catch (e) { setError(e); }
  };

  const updateRecurring = async (id, value) => {
    try {
      const updated = await api.updateTransaction(id, { recurring: value });
      setDetail(updated); flash("Aktualisiert"); reload();
    } catch (e) { setError(e); }
  };

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
                  showAccount={acc === "alle"} onClick={() => setDetail(t)} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {detail && (
        <Detail tx={detail} accounts={accounts} categories={categories}
          onClose={() => setDetail(null)} onDelete={remove} onUpdateRecurring={updateRecurring} />
      )}
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

function Detail({ tx, accounts, categories, onClose, onDelete, onUpdateRecurring }) {
  const isTransfer = tx.type === "transfer";
  const cat = isTransfer ? null : byId(categories, tx.category, UNKNOWN_CAT);
  const Icon = isTransfer ? ArrowLeftRight : catIcon(cat.icon);
  const [bg, fg] = isTransfer ? ["bg-stone-100 dark:bg-stone-700", "text-stone-500 dark:text-stone-400"] : colorOf(cat.color);

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <span className={`w-11 h-11 rounded-full ${bg} ${fg} flex items-center justify-center`}>
          <Icon size={20} />
        </span>
        <div className="flex-1">
          <p className="text-[15px] font-medium">{tx.payee || (isTransfer ? "Umbuchung" : cat.name)}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">{isTransfer ? "Umbuchung" : cat.name}</p>
        </div>
        <p className={`text-lg font-medium tabular-nums ${
          isTransfer ? "text-stone-400 dark:text-stone-500" : tx.amount_cents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
          {isTransfer ? "" : tx.amount_cents > 0 ? "+" : "−"}{eurAbs(tx.amount_cents)}
        </p>
      </div>

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 text-sm mb-4">
        <DetailRow label={isTransfer ? "Von" : "Konto"}
          value={byId(accounts, tx.account, UNKNOWN_ACC).name} />
        {isTransfer && <DetailRow label="Auf" value={byId(accounts, tx.to_account, UNKNOWN_ACC).name} />}
        <DetailRow label="Datum"
          value={new Date(api.dateOnly(tx.date) + "T12:00:00").toLocaleDateString("de-DE")} />
        <DetailRow label="Notiz" value={tx.note || "keine"} muted={!tx.note} />
        {tx.import_batch && <DetailRow label="Herkunft" value="CSV-Import" />}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Wiederkehrend</p>
      <div className="inline-flex rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px] mb-4">
        {RECURRING.map(([v, label], i) => (
          <button key={v || "none"} onClick={() => onUpdateRecurring(tx.id, v)}
            className={`px-3 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              (tx.recurring || "") === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <Button variant="danger" onClick={() => onDelete(tx.id)}
        className="w-full flex items-center justify-center gap-2">
        <Trash2 size={16} /> Buchung löschen
      </Button>
    </Sheet>
  );
}

function DetailRow({ label, value, muted }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <span className={muted ? "text-stone-400 dark:text-stone-500" : ""}>{value}</span>
    </div>
  );
}
