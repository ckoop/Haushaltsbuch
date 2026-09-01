import { useState, useEffect } from "react";
import { Plus, ChevronRight, Trash2, AlertTriangle, Upload, LogOut } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, typeIcon, ACCOUNT_TYPES, shortName, inputCls, Field, Sheet, Button, ErrorNote,
} from "../ui.jsx";
import Import from "./Import.jsx";

export default function Konten({ accounts, categories, balances, reload, flash }) {
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState("liste");
  const [error, setError] = useState(null);

  if (view === "import") {
    return <Import accounts={accounts} categories={categories}
      onBack={() => { setView("liste"); reload(); }} flash={flash} />;
  }

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 mb-2.5">Konten</p>
      <ErrorNote error={error} />

      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
        {accounts.map((a) => {
          const Icon = typeIcon(a.type);
          return (
            <button key={a.id} onClick={() => setEditing(a)}
              className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50">
              <span className="w-9 h-9 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
                <Icon size={17} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{a.name}</span>
                <span className="block text-xs text-stone-500 tabular-nums">
                  Anfangssaldo {eur(a.start_cents ?? 0)}
                </span>
              </span>
              <span className={`text-sm font-medium tabular-nums ${
                (balances[a.id] ?? 0) < 0 ? "text-red-600" : ""}`}>{eur(balances[a.id] ?? 0)}</span>
              <ChevronRight size={16} className="text-stone-300 shrink-0" />
            </button>
          );
        })}
      </div>

      <Button variant="ghost"
        onClick={() => setEditing({ id: "", name: "", short: "", type: "giro", start_cents: 0 })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Konto hinzufügen
      </Button>

      <p className="text-xs text-stone-500 mt-8 mb-2.5">Daten</p>
      <Button variant="ghost" onClick={() => setView("import")}
        className="w-full flex items-center justify-center gap-2">
        <Upload size={16} /> CSV-Datei importieren
      </Button>

      <button onClick={api.logout}
        className="w-full mt-8 py-3 text-sm text-stone-500 flex items-center justify-center gap-2">
        <LogOut size={15} /> Abmelden
      </button>

      {editing && (
        <AccountEditor draft={editing} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); flash(m); reload(); }}
          onError={setError} />
      )}
    </div>
  );
}

function AccountEditor({ draft, onClose, onSaved, onError }) {
  const isNew = !draft.id;
  const [name, setName] = useState(draft.name);
  const [type, setType] = useState(draft.type);
  const [start, setStart] = useState((draft.start_cents ?? 0) / 100);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isNew) api.countByAccount(draft.id).then(setUsage).catch(() => setUsage(null));
  }, [draft.id, isNew]);

  const submit = async () => {
    if (!name.trim()) return setError("Name eingeben");
    setBusy(true);
    try {
      await api.saveAccount({
        id: draft.id || undefined,
        name: name.trim(), short: shortName(name), type,
        start_cents: Math.round((Number(start) || 0) * 100),
      });
      onSaved("Konto gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteAccount(draft.id); onSaved("Konto gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neues Konto" : "Konto bearbeiten"} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="Girokonto, Haushaltskasse …" className={inputCls} />
      </Field>

      <p className="text-xs text-stone-500 mb-1.5">Art</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {ACCOUNT_TYPES.map((t) => {
          const Icon = t.icon;
          const on = type === t.id;
          return (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
                on ? "bg-stone-900 border-stone-900 text-white" : "bg-white border-stone-200"}`}>
              <Icon size={16} className={on ? "text-stone-300" : "text-stone-400"} />
              <span className="text-[13px]">{t.label}</span>
            </button>
          );
        })}
      </div>

      <Field label="Anfangssaldo">
        <div className="flex items-center gap-2">
          <input type="number" step="10" value={start} onChange={(e) => setStart(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400">€</span>
        </div>
      </Field>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Sichern</Button>

      {!isNew && (usage > 0 ? (
        <p className="mt-3 text-xs text-stone-500 flex items-start gap-1.5 px-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Löschen geht erst, wenn die {usage} Buchungen auf diesem Konto weg oder umgebucht sind.
        </p>
      ) : usage === 0 ? (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Konto löschen
        </Button>
      ) : null)}
    </Sheet>
  );
}
