import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Plus, X } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, catIcon, colorOf, inputCls, ErrorNote, TxRow, Sheet, BudgetBar, AccChipRow, byId, UNKNOWN_ACC, Metric,
} from "../ui.jsx";

const toRow = (e) => ({ key: e.id, id: e.id, label: e.label ?? "", amount_cents: e.amount_cents });
let newRowSeq = 0;

// Ein Einnahmen-Posten (z. B. "Gehalt", "Nebenmieteinnahmen") - Label und
// Betrag sitzen in einer eigenen Zeile statt einem einzelnen Gesamtfeld,
// damit sich Einnahmen aus mehreren Quellen einzeln nachvollziehen lassen.
// Beide Eingaben speichern wie ueberall sonst im Screen erst beim Verlassen
// des Feldes (onBlur), nicht bei jedem Tastendruck.
function IncomeRow({ row, dauer, monthKey, acc, onCreated, onRemoved, flash, setError, reload }) {
  const labelRef = useRef(null);
  const amountRef = useRef(null);

  const persist = async () => {
    const label = labelRef.current.value.trim();
    const cents = Math.max(0, Math.round((Number(amountRef.current.value) || 0) * 100));
    if (!row.id && cents <= 0) return; // leere neue Zeile ohne Betrag nicht anlegen
    try {
      if (row.id) {
        await api.updateIncomeEntry(row.id, label, cents);
      } else {
        const created = await api.createIncomeEntry(acc, dauer ? "*" : monthKey, label, cents);
        onCreated(row.key, created);
      }
      flash("Einnahmen gesichert");
      reload();
    } catch (e) { setError(e); }
  };

  const remove = async () => {
    if (!row.id) { onRemoved(row.key); return; }
    try {
      await api.deleteIncomeEntry(row.id);
      flash("Einnahmen entfernt");
      onRemoved(row.key);
      reload();
    } catch (e) { setError(e); }
  };

  return (
    <div className="flex items-center gap-2 px-3.5 py-1.5">
      <input ref={labelRef} type="text" maxLength={60} placeholder="z. B. Gehalt" defaultValue={row.label}
        onBlur={persist} className={`${inputCls} flex-1 min-w-0 text-[13px]! px-2.5! py-1.5!`} />
      <span className="flex items-center gap-1 shrink-0">
        {/* Breite bewusst wie bei den Kategorie-Budgets bei w-28 belassen -
            vierstellige Betraege mit Cent-Anteil (z. B. "1234,56") passen
            sonst nicht mehr, siehe 0.25.1-0.25.3. Nur Schriftgroesse/Padding
            verkleinert. */}
        <input ref={amountRef} type="number" min="0" step="10" placeholder="—"
          defaultValue={row.amount_cents ? row.amount_cents / 100 : ""}
          onBlur={persist}
          className={`${inputCls} w-28! shrink-0 text-right tabular-nums text-[13px]! px-2.5! py-1.5!`} />
        <span className="text-xs text-stone-400 dark:text-stone-500">€</span>
      </span>
      <button type="button" onClick={remove} aria-label="Einnahme entfernen"
        className="shrink-0 text-stone-400 dark:text-stone-500 hover:text-red-600 dark:hover:text-red-400 p-1">
        <X size={14} />
      </button>
    </div>
  );
}

export default function BudgetScreen({
  categories, accounts, budgets, incomeEntries, real, spentByCat, monthKey, acc, setAcc, combinedBalances,
  reservesFor, reserveMonthlyOf, effectiveLimitOf, reload, flash, openDetail,
}) {
  const [error, setError] = useState(null);
  const [dauer, setDauer] = useState(true);
  const [showUncat, setShowUncat] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [rows, setRows] = useState(() => incomeEntries.map(toRow));
  useEffect(() => { setRows(incomeEntries.map(toRow)); }, [incomeEntries]);

  const limitOf = (cid) => budgets.find((b) => b.category === cid)?.amount_cents ?? 0;
  const totalReserveMonthly = categories.reduce((s, c) => s + reserveMonthlyOf(c.id), 0);
  const totalBudgeted = budgets.reduce((s, b) => s + b.amount_cents, 0) + totalReserveMonthly;
  const incomeTotal = rows.reduce((s, r) => s + (r.amount_cents || 0), 0);
  const remaining = incomeTotal - totalBudgeted;

  // Ueberschuss = tatsaechliche Einnahmen minus tatsaechliche Ausgaben
  // insgesamt (alle Kategorien, auch unbudgetierte/ohne Kategorie) - bewusst
  // NICHT aus budgets abgeleitet ("Summe Budget minus Ist in budgetierten
  // Kategorien"), das waere falsch, sobald nicht jede Kategorie ein Budget
  // hat: unbudgetierte Ausgaben wuerden von keinem Budget "aufgefangen" und
  // gar nicht abgezogen, der Ueberschuss saehe faelschlich hoeher aus.
  // Gleiche Rechnung wie "Saldo" in Buchungen.jsx, hier nur dort platziert,
  // wo tatsaechlich ueber das Geld entschieden wird.
  const expenseTotal = real.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  const incomeActual = real.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const surplus = incomeActual - expenseTotal;
  const uncoveredCats = categories.filter((c) =>
    c.kind === "expense" && !c.archived && effectiveLimitOf(c.id) === 0 && (spentByCat[c.id] ?? 0) > 0);

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

  const addIncomeRow = () => {
    setRows((rs) => [...rs, { key: `new-${++newRowSeq}`, id: null, label: "", amount_cents: 0 }]);
  };

  // Fuellt einen neuen Einnahmen-Posten mit der Summe der tatsaechlich
  // gebuchten Einnahmen des Vormonats - nur auf Klick geladen (eigener
  // Request), damit das nicht bei jedem Tab-Aufruf mitgeholt werden muss.
  // Speichert noch nicht selbst, der Posten muss wie jede andere Zeile per
  // Blur bestaetigt werden.
  const applySuggestion = async () => {
    setSuggesting(true);
    try {
      const prevDate = api.addMonths(`${monthKey}-01`, -1);
      const [py, pm] = prevDate.split("-").map(Number);
      const cents = await api.actualIncomeForMonth(py, pm - 1, acc);
      setRows((rs) => [...rs, { key: `new-${++newRowSeq}`, id: null, label: "Gesamt", amount_cents: cents }]);
    } catch (e) { setError(e); }
    finally { setSuggesting(false); }
  };

  return (
    <>
      <AccChipRow accounts={accounts} balances={combinedBalances} acc={acc} setAcc={setAcc} />

      <div className="px-5 py-4">
      <p className="text-sm text-stone-600 dark:text-stone-300 mb-3">
        {acc === "alle"
          ? "Budgets und Einnahmenziel gelten pro Konto. Wähle oben ein einzelnes Konto, um sie zu sehen oder zu setzen."
          : `Monatslimit pro Kategorie für ${byId(accounts, acc, UNKNOWN_ACC).name}. 0 entfernt das Budget.`}
      </p>

      {acc !== "alle" && (
        <div className="mb-4">
          <Metric label="Überschuss" value={surplus} signed />
          {uncoveredCats.length > 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">
              {uncoveredCats.length} {uncoveredCats.length === 1 ? "Kategorie" : "Kategorien"} ohne eigenes Budget — die Ausgaben darin zählen trotzdem mit.
            </p>
          )}
        </div>
      )}

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

      {acc !== "alle" && (
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 mb-4">
          <div className="px-3.5 pt-2.5 pb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm">Einnahmen {dauer ? "jeden Monat" : `nur ${monthKey}`}</span>
            <span className="text-sm tabular-nums text-stone-500 dark:text-stone-400 shrink-0">{eur(incomeTotal)}</span>
          </div>
          {rows.length > 0 && (
            <div className="divide-y divide-stone-100 dark:divide-stone-700 border-t border-stone-100 dark:border-stone-700">
              {rows.map((row) => (
                <IncomeRow key={row.key} row={row} dauer={dauer} monthKey={monthKey} acc={acc}
                  onCreated={(key, created) => setRows((rs) => rs.map((r) =>
                    r.key === key ? { key: created.id, id: created.id, label: created.label, amount_cents: created.amount_cents } : r))}
                  onRemoved={(key) => setRows((rs) => rs.filter((r) => r.key !== key))}
                  flash={flash} setError={setError} reload={reload} />
              ))}
            </div>
          )}
          <div className="px-3.5 py-2 flex items-center gap-3 border-t border-stone-100 dark:border-stone-700">
            {rows.length === 0 && (
              <button type="button" onClick={applySuggestion} disabled={suggesting}
                className="text-xs text-emerald-700 dark:text-emerald-400">
                {suggesting ? "Lädt …" : "Vorschlag aus Vormonat übernehmen"}
              </button>
            )}
            <button type="button" onClick={addIncomeRow}
              className="ml-auto flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
              <Plus size={14} /> Einnahme hinzufügen
            </button>
          </div>
        </div>
      )}

      {acc !== "alle" && incomeTotal > 0 && (
        <div className="mb-5">
          <BudgetBar name="Insgesamt verplant" limit={incomeTotal} spent={totalBudgeted} />
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
              const catReserves = reservesFor(c.id);
              const withdrawnThisMonth = catReserves.reduce((s, r) => s + r.status.withdrawn, 0);
              const deficit = catReserves.reduce((s, r) => s + r.status.deficit, 0);
              const reserveMonthly = catReserves.reduce((s, r) => s + r.status.monthly, 0);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className={`w-8 h-8 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
                    <Icon size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm">{c.name}</span>
                    <span className="block text-xs text-stone-400 dark:text-stone-500 tabular-nums">
                      bisher {eur((spentByCat[c.id] ?? 0) - withdrawnThisMonth)}
                    </span>
                    {catReserves.length > 0 && (
                      <span className="block mt-1 space-y-0.5">
                        {catReserves.map(({ rule, status }) => (
                          <span key={rule.id} className="flex items-center justify-between gap-2 text-xs text-stone-400 dark:text-stone-500">
                            <span className="truncate">
                              Rücklage {rule.payee || "Dauerauftrag"} · {eur(status.monthly)}/Monat · {eur(status.saved)} / {eur(status.target)}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              ab {new Date(api.dateOnly(rule.next_due) + "T12:00:00").toLocaleDateString("de-DE")}
                            </span>
                          </span>
                        ))}
                        {deficit > 0 && (
                          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            {eur(deficit)} noch nicht gedeckt
                          </span>
                        )}
                        {reserveMonthly > 0 && (
                          <span className="block text-xs italic text-stone-500 dark:text-stone-400">
                            Effektiv {eur(effectiveLimitOf(c.id))} ({eur(limitOf(c.id))} Grundbudget + {eur(reserveMonthly)} Rücklage) — wird automatisch berücksichtigt
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {/* Breite bewusst bei w-28 belassen - vierstellige
                        Betraege mit Cent-Anteil (z. B. "1234,56") passen
                        sonst nicht mehr, siehe 0.25.1-0.25.3. Nur
                        Schriftgroesse/Padding verkleinert, gleiche Groesse
                        wie die Einnahmen-Zeilen darueber. */}
                    <input type="number" min="0" step="10" placeholder="—"
                      defaultValue={limitOf(c.id) ? limitOf(c.id) / 100 : ""}
                      onBlur={(e) => save(c.id, e.target.value)}
                      className={`${inputCls} w-28! shrink-0 text-right tabular-nums text-[13px]! px-2.5! py-1.5!`} />
                    <span className="text-xs text-stone-400 dark:text-stone-500">€</span>
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
    </>
  );
}
