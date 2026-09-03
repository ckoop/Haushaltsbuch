import { useState, useEffect } from "react";
import { X, Delete } from "lucide-react";
import * as api from "../pb.js";
import { catIcon, colorOf, todayISO, inputCls, ErrorNote, Button, Sheet, RECURRING, AccountPicker } from "../ui.jsx";

const TEXT_FIELDS = ["INPUT", "TEXTAREA", "SELECT"];

export default function NewEntry({ accounts, categories, defaultAcc, onClose, onSaved }) {
  const expenses = categories.filter((c) => c.kind === "expense" && !c.archived);
  const incomeCat = categories.find((c) => c.kind === "income");

  const [digits, setDigits] = useState("");
  const [kind, setKind] = useState("aus");
  const [cat, setCat] = useState(expenses[0]?.id ?? "");
  const [from, setFrom] = useState(defaultAcc ?? accounts[0]?.id);
  const [to, setTo] = useState(() => (accounts.find((a) => a.id !== defaultAcc) ?? accounts[0])?.id);
  const [payee, setPayee] = useState("");
  const [date, setDate] = useState(todayISO());
  const [recurring, setRecurring] = useState("");
  const [autoRepeat, setAutoRepeat] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const cents = Number(digits || "0");
  const display = (cents / 100).toLocaleString("de-DE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const press = (d) => { setError(null); setDigits((s) => (s.length > 8 ? s : (s + d).replace(/^0+/, ""))); };

  // Betrag oder Empfänger eingetragen, aber noch nicht gesichert — beim
  // Schließen erst nachfragen, statt die Eingabe stillschweigend zu verwerfen.
  const hasDraft = cents > 0 || payee.trim() !== "";
  const attemptClose = () => (hasDraft ? setConfirmClose(true) : onClose());

  // Betrag ist auch per echter Tastatur eingebbar (Desktop) — nur wenn kein
  // Text-/Datumsfeld fokussiert ist, sonst würde z. B. Tippen im Empfänger-Feld
  // Ziffern ins Numpad mitreißen. Escape schließt immer, unabhängig vom Fokus.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") return attemptClose();
      if (TEXT_FIELDS.includes(document.activeElement?.tagName)) return;
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") setDigits((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasDraft]);

  const commit = async (keepOpen) => {
    if (cents === 0) return setError("Betrag eingeben");
    if (kind === "um" && from === to) return setError("Quelle und Ziel müssen sich unterscheiden");
    setBusy(true); setError(null);
    try {
      const base = kind === "um"
        ? { type: "transfer", account: from, to_account: to, amount_cents: cents }
        : { type: "tx", account: from, category: kind === "ein" ? incomeCat?.id : cat,
            amount_cents: kind === "ein" ? cents : -cents };
      await api.createTransaction({ ...base, date, payee: payee.trim(), note: "", import_hash: "", recurring });
      if (recurring && autoRepeat) {
        // Die gerade gesicherte Buchung deckt die aktuelle Periode ab, der
        // Dauerauftrag greift erst ab der naechsten.
        await api.saveRecurringRule({
          ...base, payee: payee.trim(), note: "", frequency: recurring,
          next_due: api.addMonths(date, { monthly: 1, quarterly: 3, yearly: 12 }[recurring]),
          active: true,
        });
      }
      onSaved(kind === "um" ? "Umbuchung gesichert" : "Buchung gesichert");
      if (keepOpen) { setDigits(""); setPayee(""); }
      else onClose();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  const visible = showAll ? expenses : expenses.slice(0, 4);

  return (
    <div className="absolute inset-0 bg-[#FAFAF8] dark:bg-stone-900 flex flex-col z-20">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-stone-200 dark:border-stone-700">
        <button onClick={attemptClose} className="p-1 -ml-1 text-stone-500 dark:text-stone-400"><X size={20} /></button>
        <span className="text-[15px] font-medium">Neue Buchung</span>
        <span className="w-6" />
      </div>

      <div className="px-5 py-5 text-center border-b border-stone-200 dark:border-stone-700">
        <p className="text-4xl font-medium tabular-nums tracking-tight">
          {display} <span className="text-stone-400 dark:text-stone-500">€</span>
        </p>
        <div className="inline-flex mt-3.5 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
          {[["aus","Ausgabe","bg-stone-900 dark:bg-stone-700"],["ein","Einnahme","bg-emerald-700 dark:bg-emerald-600"],["um","Umbuchung","bg-stone-600 dark:bg-stone-500"]]
            .map(([k, label, bg], i) => (
            <button key={k} onClick={() => { setKind(k); setError(null); }}
              className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
                kind === k ? `${bg} text-white` : "text-stone-600 dark:text-stone-300"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ErrorNote error={error} />

        <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">{kind === "um" ? "Von Konto" : "Konto"}</p>
        <AccountPicker accounts={accounts} value={from} onChange={setFrom} />

        {kind === "um" && (
          <>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-4 mb-2">Auf Konto</p>
            <AccountPicker accounts={accounts} value={to} onChange={setTo} disabledId={from} />
          </>
        )}

        {kind === "aus" && (
          <>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-4 mb-2">Kategorie</p>
            <div className="grid grid-cols-2 gap-2">
              {visible.map((c) => {
                const Icon = catIcon(c.icon);
                const [bg, fg] = colorOf(c.color);
                const on = cat === c.id;
                return (
                  <button key={c.id} onClick={() => setCat(c.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
                      on ? `${bg} border-stone-400 dark:border-stone-500` : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700"}`}>
                    <Icon size={17} className={on ? fg : "text-stone-400 dark:text-stone-500"} />
                    <span className="text-[13px] truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
            {expenses.length > 4 && (
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-emerald-700 dark:text-emerald-400 mt-2.5">
                {showAll ? "Weniger zeigen" : `Alle ${expenses.length} Kategorien zeigen`}
              </button>
            )}
          </>
        )}

        <input value={payee} onChange={(e) => setPayee(e.target.value)}
          placeholder={kind === "um" ? "Sparrate, Geld abgehoben …"
            : kind === "ein" ? "Gehalt, Erstattung …" : "Rewe, Tankstelle …"}
          className={`${inputCls} mt-4`} />

        <div className="mt-4 flex items-center justify-between border-t border-stone-200 dark:border-stone-700 pt-3">
          <span className="text-[13px] text-stone-500 dark:text-stone-400">Datum</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="text-sm bg-transparent text-right" />
        </div>

        <div className="mt-4 border-t border-stone-200 dark:border-stone-700 pt-3">
          <p className="text-[13px] text-stone-500 dark:text-stone-400 mb-2">Wiederholt sich</p>
          <div className="inline-flex rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
            {RECURRING.map(([v, label], i) => (
              <button key={v || "none"} onClick={() => { setRecurring(v); if (!v) setAutoRepeat(false); }}
                className={`px-3 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
                  recurring === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
                {label}
              </button>
            ))}
          </div>
          {recurring && (
            <label className="flex items-center gap-2 mt-3 text-[13px] text-stone-600 dark:text-stone-300">
              <input type="checkbox" checked={autoRepeat} onChange={(e) => setAutoRepeat(e.target.checked)} />
              Automatisch weiterbuchen (Dauerauftrag)
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-stone-200 dark:bg-stone-700 border-t border-stone-200 dark:border-stone-700">
        {["1","2","3","4","5","6","7","8","9","00","0"].map((d) => (
          <button key={d} onClick={() => press(d)}
            className="bg-[#FAFAF8] dark:bg-stone-900 py-3.5 text-xl tabular-nums active:bg-stone-200 dark:active:bg-stone-800">{d}</button>
        ))}
        <button onClick={() => setDigits((s) => s.slice(0, -1))}
          className="bg-[#FAFAF8] dark:bg-stone-900 py-3.5 flex items-center justify-center text-stone-500 dark:text-stone-400 active:bg-stone-200 dark:active:bg-stone-800">
          <Delete size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 border-t border-stone-200 dark:border-stone-700">
        <Button onClick={() => commit(false)} disabled={busy}>Sichern</Button>
        <Button variant="ghost" onClick={() => commit(true)} disabled={busy}>Sichern und weiter</Button>
      </div>

      {confirmClose && (
        <Sheet title="Buchung verwerfen?" onClose={() => setConfirmClose(false)}>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
            Die Buchung ist noch nicht gespeichert. Wenn du jetzt schließt, gehen die Eingaben verloren.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>Weiter bearbeiten</Button>
            <Button variant="danger" onClick={onClose}>Verwerfen</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
