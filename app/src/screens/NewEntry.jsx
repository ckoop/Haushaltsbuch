import { useState } from "react";
import { X, Delete } from "lucide-react";
import * as api from "../pb.js";
import { catIcon, colorOf, typeIcon, todayISO, inputCls, ErrorNote, Button } from "../ui.jsx";

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
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cents = Number(digits || "0");
  const display = (cents / 100).toLocaleString("de-DE",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const press = (d) => { setError(null); setDigits((s) => (s.length > 8 ? s : (s + d).replace(/^0+/, ""))); };

  const commit = async (keepOpen) => {
    if (cents === 0) return setError("Betrag eingeben");
    if (kind === "um" && from === to) return setError("Quelle und Ziel müssen sich unterscheiden");
    setBusy(true); setError(null);
    try {
      await api.createTransaction(kind === "um"
        ? { date, type: "transfer", account: from, to_account: to,
            amount_cents: cents, payee: payee.trim(), note: "", import_hash: "" }
        : { date, type: "tx", account: from,
            category: kind === "ein" ? incomeCat?.id : cat,
            amount_cents: kind === "ein" ? cents : -cents,
            payee: payee.trim(), note: "", import_hash: "" });
      onSaved(kind === "um" ? "Umbuchung gesichert" : "Buchung gesichert");
      if (keepOpen) { setDigits(""); setPayee(""); }
      else onClose();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  const visible = showAll ? expenses : expenses.slice(0, 4);

  return (
    <div className="absolute inset-0 bg-[#FAFAF8] flex flex-col z-20">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-stone-200">
        <button onClick={onClose} className="p-1 -ml-1 text-stone-500"><X size={20} /></button>
        <span className="text-[15px] font-medium">Neue Buchung</span>
        <span className="w-6" />
      </div>

      <div className="px-5 py-5 text-center border-b border-stone-200">
        <p className="text-4xl font-medium tabular-nums tracking-tight">
          {display} <span className="text-stone-400">€</span>
        </p>
        <div className="inline-flex mt-3.5 rounded-lg border border-stone-300 overflow-hidden text-[13px]">
          {[["aus","Ausgabe","bg-stone-900"],["ein","Einnahme","bg-emerald-700"],["um","Umbuchung","bg-stone-600"]]
            .map(([k, label, bg], i) => (
            <button key={k} onClick={() => { setKind(k); setError(null); }}
              className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300" : ""} ${
                kind === k ? `${bg} text-white` : "text-stone-600"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ErrorNote error={error} />

        <p className="text-xs text-stone-500 mb-2">{kind === "um" ? "Von Konto" : "Konto"}</p>
        <AccPicker accounts={accounts} value={from} onChange={setFrom} />

        {kind === "um" && (
          <>
            <p className="text-xs text-stone-500 mt-4 mb-2">Auf Konto</p>
            <AccPicker accounts={accounts} value={to} onChange={setTo} disabledId={from} />
          </>
        )}

        {kind === "aus" && (
          <>
            <p className="text-xs text-stone-500 mt-4 mb-2">Kategorie</p>
            <div className="grid grid-cols-2 gap-2">
              {visible.map((c) => {
                const Icon = catIcon(c.icon);
                const [bg, fg] = colorOf(c.color);
                const on = cat === c.id;
                return (
                  <button key={c.id} onClick={() => setCat(c.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
                      on ? `${bg} border-stone-400` : "bg-white border-stone-200"}`}>
                    <Icon size={17} className={on ? fg : "text-stone-400"} />
                    <span className="text-[13px] truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
            {expenses.length > 4 && (
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-emerald-700 mt-2.5">
                {showAll ? "Weniger zeigen" : `Alle ${expenses.length} Kategorien zeigen`}
              </button>
            )}
          </>
        )}

        <input value={payee} onChange={(e) => setPayee(e.target.value)}
          placeholder={kind === "um" ? "Sparrate, Geld abgehoben …"
            : kind === "ein" ? "Gehalt, Erstattung …" : "Rewe, Tankstelle …"}
          className={`${inputCls} mt-4`} />

        <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-[13px] text-stone-500">Datum</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="text-sm bg-transparent text-right" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-stone-200 border-t border-stone-200">
        {["1","2","3","4","5","6","7","8","9","00","0"].map((d) => (
          <button key={d} onClick={() => press(d)}
            className="bg-[#FAFAF8] py-3.5 text-xl tabular-nums active:bg-stone-200">{d}</button>
        ))}
        <button onClick={() => setDigits((s) => s.slice(0, -1))}
          className="bg-[#FAFAF8] py-3.5 flex items-center justify-center text-stone-500 active:bg-stone-200">
          <Delete size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 border-t border-stone-200">
        <Button onClick={() => commit(false)} disabled={busy}>Sichern</Button>
        <Button variant="ghost" onClick={() => commit(true)} disabled={busy}>Sichern und weiter</Button>
      </div>
    </div>
  );
}

function AccPicker({ accounts, value, onChange, disabledId }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {accounts.map((a) => {
        const Icon = typeIcon(a.type);
        const on = value === a.id;
        const off = disabledId === a.id;
        return (
          <button key={a.id} disabled={off} onClick={() => onChange(a.id)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
              off ? "bg-stone-50 border-stone-200 opacity-40"
                : on ? "bg-stone-900 border-stone-900 text-white" : "bg-white border-stone-200"}`}>
            <Icon size={16} className={on ? "text-stone-300" : "text-stone-400"} />
            <span className="text-[13px] truncate">{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
