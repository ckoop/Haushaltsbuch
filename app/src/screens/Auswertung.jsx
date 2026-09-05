import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, MONTHS, byId, colorOf, inputCls,
  UNKNOWN_CAT, UNKNOWN_TAG, UNKNOWN_ACC, TxRow, Sheet, ErrorNote, Spinner,
} from "../ui.jsx";

const monthIdx = (dateStr) => Number(dateStr.slice(5, 7)) - 1;

export default function Auswertung({
  categories, tags, accounts, transactions, real, spentByCat, spentByTag, acc, monthKey, openDetail,
}) {
  const [mode, setMode] = useState("monat");
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

      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        <button onClick={() => setMode("monat")}
          className={`px-3.5 py-1.5 ${mode === "monat" ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
          Monat
        </button>
        <button onClick={() => setMode("jahr")}
          className={`px-3.5 py-1.5 border-l border-stone-300 dark:border-stone-600 ${
            mode === "jahr" ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
          Jahr
        </button>
      </div>

      {mode === "monat" && (
        <>
          <SummaryCard income={income} expense={expense} net={net} />

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
                  <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount onClick={() => openDetail(t)} />
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
                    <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount onClick={() => openDetail(t)} />
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
                    <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount onClick={() => openDetail(t)} />
                  ))}
                </div>
              </Sheet>
            );
          })()}
        </>
      )}

      {mode === "jahr" && (
        <JahresAnsicht categories={categories} accounts={accounts} acc={acc} monthKey={monthKey} openDetail={openDetail} />
      )}
    </div>
  );
}

function SummaryCard({ income, expense, net, extra }) {
  const rows = [
    ["Einnahmen", income, "text-emerald-700 dark:text-emerald-400"],
    ["Ausgaben", -expense, ""],
    ["Saldo", net, net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"],
  ];
  if (extra) rows.push(extra);
  return (
    <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-5">
      {rows.map(([label, val, cls]) => (
        <div key={label} className="flex justify-between px-4 py-3 text-sm">
          <span className="text-stone-600 dark:text-stone-300">{label}</span>
          <span className={`font-medium tabular-nums ${cls}`}>{typeof val === "string" ? val : eur(val)}</span>
        </div>
      ))}
    </div>
  );
}

// Zwoelf-Monats-Balkendiagramm, wiederverwendet fuer Jahresvergleich,
// Sparquote und Kategorie-Trend - nur Werte, Farbwahl und Klick-Handler
// unterscheiden sich. avgLine zeichnet optional eine gestrichelte
// Referenzlinie (Ø) auf derselben Skala ein.
function YearBars({ values, barClass, avgLine, onBarClick, highlight }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)), avgLine ?? 0);
  return (
    <div>
      <div className="relative h-24 flex items-end gap-1.5">
        {avgLine > 0 && (
          <div className="absolute inset-x-0 border-t border-dashed border-stone-400 dark:border-stone-500"
            style={{ bottom: `${Math.round((avgLine / max) * 100)}%` }} />
        )}
        {values.map((v, i) => (
          <button key={i} onClick={() => onBarClick?.(i)} title={MONTHS[i]}
            className="relative flex-1 h-full flex items-end">
            <div
              className={`w-full rounded-t-sm ${barClass(v, i)} ${highlight === i ? "ring-2 ring-offset-1 ring-stone-400 dark:ring-offset-stone-800 dark:ring-stone-500" : ""}`}
              style={{ height: `${Math.max(2, Math.round((Math.abs(v) / max) * 100))}%` }} />
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {values.map((_, i) => (
          <span key={i} className={`flex-1 text-center text-[9px] ${
            highlight === i ? "text-stone-700 dark:text-stone-300 font-medium" : "text-stone-400 dark:text-stone-500"}`}>
            {MONTHS[i].slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Zwoelf Monatssaeulen, Einnahmen und Ausgaben nebeneinander statt als ein
// Saldo-Balken - direkter Vergleich beider Groessen, nicht nur ihrer Differenz.
function ComparisonBars({ monthly, onBarClick, highlight }) {
  const max = Math.max(1, ...monthly.flatMap((m) => [m.income, m.expense]));
  const ring = (i) => (highlight === i ? "ring-2 ring-offset-1 ring-stone-400 dark:ring-offset-stone-800 dark:ring-stone-500" : "");
  return (
    <div>
      <div className="h-24 flex items-end gap-1.5">
        {monthly.map((m, i) => (
          <button key={i} onClick={() => onBarClick?.(i)} title={MONTHS[i]}
            className="flex-1 h-full flex items-end justify-center gap-0.5">
            <div className={`w-1/2 rounded-t-sm bg-emerald-600 dark:bg-emerald-500 ${ring(i)}`}
              style={{ height: `${Math.max(2, Math.round((m.income / max) * 100))}%` }} />
            <div className={`w-1/2 rounded-t-sm bg-red-400 dark:bg-red-500/80 ${ring(i)}`}
              style={{ height: `${Math.max(2, Math.round((m.expense / max) * 100))}%` }} />
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {monthly.map((_, i) => (
          <span key={i} className={`flex-1 text-center text-[9px] ${
            highlight === i ? "text-stone-700 dark:text-stone-300 font-medium" : "text-stone-400 dark:text-stone-500"}`}>
            {MONTHS[i].slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function JahresAnsicht({ categories, accounts, acc, monthKey, openDetail }) {
  const [year, setYear] = useState(() => Number(monthKey.slice(0, 4)));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trendCat, setTrendCat] = useState("");
  const [showSparquote, setShowSparquote] = useState(false);
  const [openMonthIdx, setOpenMonthIdx] = useState(null);
  const [openTrendMonthIdx, setOpenTrendMonthIdx] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.listTransactionsForYear(year)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  const scoped = useMemo(
    () => rows.filter((t) => acc === "alle" || t.account === acc || t.to_account === acc),
    [rows, acc]
  );
  const real = useMemo(() => scoped.filter((t) => t.type !== "transfer"), [scoped]);
  const transfers = scoped.length - real.length;

  const monthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    for (const t of real) {
      const mi = monthIdx(t.date);
      if (t.amount_cents > 0) arr[mi].income += t.amount_cents;
      else arr[mi].expense -= t.amount_cents;
    }
    return arr;
  }, [real]);

  const yearIncome = monthly.reduce((s, m) => s + m.income, 0);
  const yearExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const yearNet = yearIncome - yearExpense;
  const sparquote = yearIncome > 0 ? Math.round((yearNet / yearIncome) * 100) : null;

  const sparquoteMonthly = monthly.map((m) => (m.income > 0 ? Math.round(((m.income - m.expense) / m.income) * 100) : 0));

  const today = new Date();
  const highlight = year === today.getFullYear() ? today.getMonth() : null;
  const monthsElapsed = year < today.getFullYear() ? 12 : year === today.getFullYear() ? today.getMonth() + 1 : 0;

  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.archived);
  const trendValues = useMemo(() => {
    if (!trendCat) return null;
    const arr = Array(12).fill(0);
    for (const t of real) {
      if (t.amount_cents < 0 && t.category === trendCat) arr[monthIdx(t.date)] += -t.amount_cents;
    }
    return arr;
  }, [real, trendCat]);
  const trendAvg = trendValues && monthsElapsed > 0
    ? Math.round(trendValues.slice(0, monthsElapsed).reduce((s, v) => s + v, 0) / monthsElapsed)
    : 0;

  const monthTx = (mi) => real.filter((t) => monthIdx(t.date) === mi).sort((a, b) => b.date.localeCompare(a.date));
  const trendMonthTx = (mi) => real
    .filter((t) => t.amount_cents < 0 && t.category === trendCat && monthIdx(t.date) === mi)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setYear((y) => y - 1)} className="p-1.5 -ml-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-medium">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} className="p-1.5 -mr-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800">
          <ChevronRight size={18} />
        </button>
      </div>

      <ErrorNote error={error} />
      {loading && <Spinner />}

      {!loading && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">Jahresvergleich · Einnahmen & Ausgaben</p>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500" /> Einnahmen
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400 dark:bg-red-500/80" /> Ausgaben
            </span>
          </div>
          <ComparisonBars monthly={monthly} highlight={highlight} onBarClick={setOpenMonthIdx} />

          <div className="mt-5">
            <SummaryCard income={yearIncome} expense={yearExpense} net={yearNet}
              extra={sparquote === null ? null : ["Sparquote", `${sparquote} %`, sparquote < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"]} />
          </div>

          {transfers > 0 && (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-5 flex items-start gap-1.5">
              <ArrowLeftRight size={13} className="mt-0.5 shrink-0" />
              {transfers} {transfers === 1 ? "Umbuchung ist" : "Umbuchungen sind"} nicht enthalten.
            </p>
          )}

          <button onClick={() => setShowSparquote((v) => !v)}
            className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 mb-3">
            <ChevronRight size={13} className={`transition-transform ${showSparquote ? "rotate-90" : ""}`} />
            Sparquote pro Monat {showSparquote ? "ausblenden" : "anzeigen"}
          </button>
          {showSparquote && (
            <>
              <YearBars values={sparquoteMonthly} highlight={highlight}
                barClass={(v) => (v < 0 ? "bg-red-500 dark:bg-red-500/80" : "bg-emerald-600 dark:bg-emerald-500")}
                onBarClick={setOpenMonthIdx} />
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-3">
                (Einnahmen − Ausgaben) / Einnahmen. Monate ohne Einnahmen zeigen 0 %.
              </p>
            </>
          )}

          <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-3">Kategorie-Trend</p>
          <select value={trendCat} onChange={(e) => setTrendCat(e.target.value)} className={`${inputCls} mb-3`}>
            <option value="">— Kategorie wählen —</option>
            {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {trendCat && trendValues && (
            <>
              <YearBars values={trendValues} highlight={highlight} avgLine={trendAvg}
                barClass={() => colorOf(byId(categories, trendCat, UNKNOWN_CAT).color)[2]}
                onBarClick={setOpenTrendMonthIdx} />
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-3">
                Ø {eur(trendAvg)} pro Monat ({monthsElapsed} {monthsElapsed === 1 ? "Monat" : "Monate"} berücksichtigt),
                gestrichelt eingezeichnet.
              </p>
            </>
          )}

          {openMonthIdx !== null && (() => {
            const m = monthly[openMonthIdx];
            const tx = monthTx(openMonthIdx);
            return (
              <Sheet title={`${MONTHS[openMonthIdx]} ${year}`} onClose={() => setOpenMonthIdx(null)}>
                <SummaryCard income={m.income} expense={m.expense} net={m.income - m.expense} />
                <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                  {tx.length === 0
                    ? <p className="text-sm text-stone-500 dark:text-stone-400 px-4 py-6 text-center">Keine Buchungen.</p>
                    : tx.map((t) => (
                        <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount onClick={() => openDetail(t)} />
                      ))}
                </div>
              </Sheet>
            );
          })()}

          {openTrendMonthIdx !== null && (() => {
            const cat = byId(categories, trendCat, UNKNOWN_CAT);
            const tx = trendMonthTx(openTrendMonthIdx);
            return (
              <Sheet title={`${cat.name} · ${MONTHS[openTrendMonthIdx]} ${year}`} onClose={() => setOpenTrendMonthIdx(null)}>
                <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                  {tx.length === 0
                    ? <p className="text-sm text-stone-500 dark:text-stone-400 px-4 py-6 text-center">Keine Buchungen.</p>
                    : tx.map((t) => (
                        <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount onClick={() => openDetail(t)} />
                      ))}
                </div>
              </Sheet>
            );
          })()}
        </>
      )}
    </div>
  );
}
