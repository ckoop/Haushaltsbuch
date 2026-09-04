import { useState } from "react";
import { Trash2, ArrowLeftRight, X } from "lucide-react";
import * as api from "../pb.js";
import {
  eurAbs, byId, catIcon, colorOf, inputCls,
  UNKNOWN_ACC, UNKNOWN_CAT, UNKNOWN_TAG, Sheet, Button, RECURRING,
} from "../ui.jsx";

// Eigenes Modul statt Teil von Buchungen.jsx, weil auch Auswertung.jsx (und
// potenziell weitere Screens) eine Buchung zum Bearbeiten oeffnen koennen
// sollen - State und Handler dafuer leben deshalb in App.jsx/Shell, hier nur
// die Darstellung.
export default function TxDetail({
  tx, accounts, categories, tags, onClose, onDelete,
  onUpdateRecurring, onUpdateCategory, onAddTag, onRemoveTag,
}) {
  const isTransfer = tx.type === "transfer";
  const cat = isTransfer ? null : byId(categories, tx.category, UNKNOWN_CAT);
  const Icon = isTransfer ? ArrowLeftRight : catIcon(cat.icon);
  const [bg, fg] = isTransfer ? ["bg-stone-100 dark:bg-stone-700", "text-stone-500 dark:text-stone-400"] : colorOf(cat.color);
  // Einnahme/Ausgabe steht mit dem Vorzeichen schon fest (nicht nachtraeglich
  // aenderbar hier) - die Kategorie-Auswahl zeigt deshalb nur die passende Art,
  // genau wie beim Anlegen in NewEntry.jsx.
  const catOptions = categories.filter((c) => !c.archived && c.kind === (tx.amount_cents > 0 ? "income" : "expense"));

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

      {!isTransfer && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Kategorie</p>
          <select className={`${inputCls} mb-4`} value={tx.category}
            onChange={(e) => onUpdateCategory(tx.id, e.target.value)}>
            {!tx.category && <option value="">{UNKNOWN_CAT.name}</option>}
            {catOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}

      <TagEditor tx={tx} tags={tags} onAdd={onAddTag} onRemove={onRemoveTag} />

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

// Freie, mehrfache Zusatz-Kennzeichnung quer zur einen Pflicht-Kategorie
// (z. B. "Nebenkosten" auf einer Abo-Buchung). Tags entstehen hier direkt
// beim Zuweisen, kein eigenes Verwaltungs-Screen.
function TagEditor({ tx, tags, onAdd, onRemove }) {
  const [value, setValue] = useState("");
  const current = (tx.tags ?? []).map((id) => byId(tags, id, UNKNOWN_TAG));

  const submit = () => { onAdd(tx, value); setValue(""); };

  return (
    <div className="mb-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Tags</p>
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {current.map((t) => (
            <span key={t.id}
              className="inline-flex items-center gap-1 text-xs bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 rounded-full pl-2.5 pr-1.5 py-1">
              {t.name}
              <button onClick={() => onRemove(tx, t.id)} className="text-stone-400 dark:text-stone-500">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Tag hinzufügen …" className={inputCls} />
        <Button variant="ghost" onClick={submit} className="px-4 shrink-0">+</Button>
      </div>
    </div>
  );
}
