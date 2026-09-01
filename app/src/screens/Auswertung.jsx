import { ArrowLeftRight } from "lucide-react";
import { eur, byId, colorOf, UNKNOWN_CAT, UNKNOWN_ACC } from "../ui.jsx";

export default function Auswertung({ categories, accounts, transactions, real, spentByCat, acc }) {
  const income = real.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const expense = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  const transfers = transactions.length - real.length;
  const net = income - expense;

  const rows = Object.entries(spentByCat).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const scope = acc === "alle" ? "Alle Konten" : byId(accounts, acc, UNKNOWN_ACC).name;

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 mb-2.5">{scope}</p>
      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100 mb-3">
        {[
          ["Einnahmen", income, "text-emerald-700"],
          ["Ausgaben", -expense, ""],
          ["Saldo", net, net < 0 ? "text-red-600" : "text-emerald-700"],
        ].map(([label, val, cls]) => (
          <div key={label} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-stone-600">{label}</span>
            <span className={`font-medium tabular-nums ${cls}`}>{eur(val)}</span>
          </div>
        ))}
      </div>

      {transfers > 0 && (
        <p className="text-xs text-stone-500 mb-5 flex items-start gap-1.5">
          <ArrowLeftRight size={13} className="mt-0.5 shrink-0" />
          {transfers} {transfers === 1 ? "Umbuchung ist" : "Umbuchungen sind"} nicht enthalten —
          Geld zwischen eigenen Konten ist weder Einnahme noch Ausgabe.
        </p>
      )}

      <p className="text-xs text-stone-500 mb-3">Ausgaben nach Kategorie</p>
      {rows.length === 0 && <p className="text-sm text-stone-500">Keine Ausgaben in diesem Zeitraum.</p>}
      <div className="space-y-3.5">
        {rows.map(([cid, val]) => {
          const cat = byId(categories, cid, UNKNOWN_CAT);
          const bar = colorOf(cat.color)[2];
          return (
            <div key={cid}>
              <div className="flex justify-between text-[13px] mb-1.5">
                <span>{cat.name}</span>
                <span className="tabular-nums text-stone-500">
                  {eur(val)} <span className="text-stone-400">· {Math.round((val / expense) * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
                <div className={`h-full ${bar}`} style={{ width: `${(val / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
