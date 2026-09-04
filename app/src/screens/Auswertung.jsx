import { useState } from "react";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { eur, byId, colorOf, UNKNOWN_CAT, UNKNOWN_TAG, UNKNOWN_ACC, TxRow, Sheet } from "../ui.jsx";

export default function Auswertung({ categories, tags, accounts, transactions, real, spentByCat, spentByTag, acc }) {
  const [openCat, setOpenCat] = useState(null);
  const [openTag, setOpenTag] = useState(null);
  const income = real.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const expense = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  const transfers = transactions.length - real.length;
  const net = income - expense;

  const rows = Object.entries(spentByCat).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const tagRows = Object.entries(spentByTag).sort((a, b) => b[1] - a[1]);
  const maxTag = tagRows.length ? tagRows[0][1] : 1;
  const scope = acc === "alle" ? "Alle Konten" : byId(accounts, acc, UNKNOWN_ACC).name;
  const recurring = transactions.filter((t) => t.recurring);

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">{scope}</p>
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-3">
        {[
          ["Einnahmen", income, "text-emerald-700 dark:text-emerald-400"],
          ["Ausgaben", -expense, ""],
          ["Saldo", net, net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"],
        ].map(([label, val, cls]) => (
          <div key={label} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-stone-600 dark:text-stone-300">{label}</span>
            <span className={`font-medium tabular-nums ${cls}`}>{eur(val)}</span>
          </div>
        ))}
      </div>

      {transfers > 0 && (
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-5 flex items-start gap-1.5">
          <ArrowLeftRight size={13} className="mt-0.5 shrink-0" />
          {transfers} {transfers === 1 ? "Umbuchung ist" : "Umbuchungen sind"} nicht enthalten —
          Geld zwischen eigenen Konten ist weder Einnahme noch Ausgabe.
        </p>
      )}

      {recurring.length > 0 && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Wiederkehrende Buchungen</p>
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-5">
            {recurring.map((t) => (
              <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount />
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Ausgaben nach Kategorie</p>
      {rows.length === 0 && <p className="text-sm text-stone-500 dark:text-stone-400">Keine Ausgaben in diesem Zeitraum.</p>}
      <div className="space-y-3.5">
        {rows.map(([cid, val]) => {
          const cat = byId(categories, cid, UNKNOWN_CAT);
          const bar = colorOf(cat.color)[2];
          return (
            <button key={cid} onClick={() => setOpenCat(cid)} className="block w-full text-left">
              <div className="flex justify-between items-center text-[13px] mb-1.5">
                <span className="flex items-center gap-1">
                  {cat.name}
                  <ChevronRight size={13} className="text-stone-300 dark:text-stone-600" />
                </span>
                <span className="tabular-nums text-stone-500 dark:text-stone-400">
                  {eur(val)} <span className="text-stone-400 dark:text-stone-500">· {Math.round((val / expense) * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                <div className={`h-full ${bar}`} style={{ width: `${(val / max) * 100}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {openCat && (() => {
        const cat = byId(categories, openCat, UNKNOWN_CAT);
        const catTx = real
          .filter((t) => t.category === openCat && t.amount_cents < 0)
          .sort((a, b) => b.date.localeCompare(a.date));
        return (
          <Sheet title={cat.name} onClose={() => setOpenCat(null)}>
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
              {catTx.map((t) => (
                <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount />
              ))}
            </div>
          </Sheet>
        );
      })()}

      {tagRows.length > 0 && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-3">Ausgaben nach Tag</p>
          <div className="space-y-3.5">
            {tagRows.map(([tid, val]) => {
              const tag = byId(tags, tid, UNKNOWN_TAG);
              return (
                <button key={tid} onClick={() => setOpenTag(tid)} className="block w-full text-left">
                  <div className="flex justify-between items-center text-[13px] mb-1.5">
                    <span className="flex items-center gap-1">
                      {tag.name}
                      <ChevronRight size={13} className="text-stone-300 dark:text-stone-600" />
                    </span>
                    <span className="tabular-nums text-stone-500 dark:text-stone-400">{eur(val)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                    <div className="h-full bg-stone-400 dark:bg-stone-500" style={{ width: `${(val / maxTag) * 100}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-3">
            Tags sind unabhängig von der Kategorie und können mehrfach vorkommen — die Summe hier
            addiert sich deshalb nicht zwangsläufig zu "Ausgaben" oben.
          </p>
        </>
      )}

      {openTag && (() => {
        const tag = byId(tags, openTag, UNKNOWN_TAG);
        const tagTx = real
          .filter((t) => (t.tags ?? []).includes(openTag) && t.amount_cents < 0)
          .sort((a, b) => b.date.localeCompare(a.date));
        return (
          <Sheet title={tag.name} onClose={() => setOpenTag(null)}>
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
              {tagTx.map((t) => (
                <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount />
              ))}
            </div>
          </Sheet>
        );
      })()}
    </div>
  );
}
