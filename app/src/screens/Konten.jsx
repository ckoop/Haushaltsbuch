import { useState, useEffect } from "react";
import { Plus, ChevronRight, Trash2, AlertTriangle, Upload, LogOut, Check } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, typeIcon, ACCOUNT_TYPES, shortName, catIcon, colorOf, CAT_ICON_KEYS, COLOR_KEYS,
  inputCls, Field, Sheet, Button, ErrorNote,
} from "../ui.jsx";
import { useTheme } from "../theme.js";
import Import from "./Import.jsx";

const CAT_LIST_COLLAPSED = 5;

export default function Konten({ accounts, categories, balances, reload, flash }) {
  const [editing, setEditing] = useState(null);
  const [editingCat, setEditingCat] = useState(null);
  const [catsExpanded, setCatsExpanded] = useState(false);
  const [view, setView] = useState("liste");
  const [error, setError] = useState(null);
  const { theme, setTheme } = useTheme();

  if (view === "import") {
    return <Import accounts={accounts} categories={categories}
      onBack={() => { setView("liste"); reload(); }} flash={flash} />;
  }

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">Konten</p>
      <ErrorNote error={error} />

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
        {accounts.map((a) => {
          const Icon = typeIcon(a.type);
          return (
            <button key={a.id} onClick={() => setEditing(a)}
              className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
              <span className="w-9 h-9 rounded-full bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-400 flex items-center justify-center shrink-0">
                <Icon size={17} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{a.name}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400 tabular-nums">
                  Anfangssaldo {eur(a.start_cents ?? 0)}
                </span>
              </span>
              <span className={`text-sm font-medium tabular-nums ${
                (balances[a.id] ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{eur(balances[a.id] ?? 0)}</span>
              <ChevronRight size={16} className="text-stone-300 dark:text-stone-600 shrink-0" />
            </button>
          );
        })}
      </div>

      <Button variant="ghost"
        onClick={() => setEditing({ id: "", name: "", short: "", type: "giro", start_cents: 0 })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Konto hinzufügen
      </Button>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Kategorien</p>
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
        {(() => {
          const active = categories.filter((c) => !c.archived);
          const visible = catsExpanded ? active : active.slice(0, CAT_LIST_COLLAPSED);
          return (
            <>
              {visible.map((c) => {
                const Icon = catIcon(c.icon);
                const [bg, fg] = colorOf(c.color);
                return (
                  <button key={c.id} onClick={() => setEditingCat(c)}
                    className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
                    <span className={`w-9 h-9 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
                      <Icon size={17} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{c.name}</span>
                      <span className="block text-xs text-stone-500 dark:text-stone-400">
                        {c.kind === "income" ? "Einnahme" : "Ausgabe"}
                      </span>
                    </span>
                    <ChevronRight size={16} className="text-stone-300 dark:text-stone-600 shrink-0" />
                  </button>
                );
              })}
              {active.length === 0 && (
                <p className="px-3.5 py-3 text-sm text-stone-500 dark:text-stone-400">Noch keine Kategorien.</p>
              )}
              {active.length > CAT_LIST_COLLAPSED && (
                <button onClick={() => setCatsExpanded((v) => !v)}
                  className="w-full px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-400 text-center">
                  {catsExpanded ? "Weniger zeigen" : `Alle ${active.length} Kategorien zeigen`}
                </button>
              )}
            </>
          );
        })()}
      </div>

      <Button variant="ghost"
        onClick={() => setEditingCat({ id: "", name: "", kind: "expense", icon: "dots", color: "stone" })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Kategorie hinzufügen
      </Button>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Daten</p>
      <Button variant="ghost" onClick={() => setView("import")}
        className="w-full flex items-center justify-center gap-2">
        <Upload size={16} /> CSV-Datei importieren
      </Button>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Darstellung</p>
      <div className="inline-flex rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[["light", "Hell"], ["dark", "Dunkel"], ["system", "System"]].map(([v, label], i) => (
          <button key={v} onClick={() => setTheme(v)}
            className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              theme === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <button onClick={api.logout}
        className="w-full mt-8 py-3 text-sm text-stone-500 dark:text-stone-400 flex items-center justify-center gap-2">
        <LogOut size={15} /> Abmelden
      </button>

      {editing && (
        <AccountEditor draft={editing} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); flash(m); reload(); }}
          onError={setError} />
      )}

      {editingCat && (
        <CategoryEditor draft={editingCat} onClose={() => setEditingCat(null)}
          onSaved={(m) => { setEditingCat(null); flash(m); reload(); }}
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

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Art</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {ACCOUNT_TYPES.map((t) => {
          const Icon = t.icon;
          const on = type === t.id;
          return (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
                on ? "bg-stone-900 border-stone-900 dark:bg-emerald-600 dark:border-emerald-600 text-white"
                  : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700"}`}>
              <Icon size={16} className={on ? "text-stone-300" : "text-stone-400 dark:text-stone-500"} />
              <span className="text-[13px]">{t.label}</span>
            </button>
          );
        })}
      </div>

      <Field label="Anfangssaldo">
        <div className="flex items-center gap-2">
          <input type="number" step="10" value={start} onChange={(e) => setStart(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500">€</span>
        </div>
      </Field>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Sichern</Button>

      {!isNew && (usage > 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 flex items-start gap-1.5 px-1">
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

function CategoryEditor({ draft, onClose, onSaved, onError }) {
  const isNew = !draft.id;
  const [name, setName] = useState(draft.name);
  const [kind, setKind] = useState(draft.kind);
  const [icon, setIcon] = useState(draft.icon);
  const [color, setColor] = useState(draft.color);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isNew) api.countByCategory(draft.id).then(setUsage).catch(() => setUsage(null));
  }, [draft.id, isNew]);

  const submit = async () => {
    if (!name.trim()) return setError("Name eingeben");
    setBusy(true);
    try {
      await api.saveCategory({
        id: draft.id || undefined,
        name: name.trim(), kind, icon, color,
        sort: draft.sort ?? 0, archived: false,
      });
      onSaved("Kategorie gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteCategory(draft.id); onSaved("Kategorie gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neue Kategorie" : "Kategorie bearbeiten"} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder="Lebensmittel, Freizeit …" className={inputCls} />
      </Field>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Art</p>
      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[["expense", "Ausgabe"], ["income", "Einnahme"]].map(([v, label], i) => (
          <button key={v} onClick={() => setKind(v)}
            className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              kind === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Symbol</p>
      <div className="grid grid-cols-6 gap-2 mb-4">
        {CAT_ICON_KEYS.map((k) => {
          const Icon = catIcon(k);
          const on = icon === k;
          return (
            <button key={k} onClick={() => setIcon(k)}
              className={`aspect-square rounded-lg border flex items-center justify-center ${
                on ? "bg-stone-900 border-stone-900 dark:bg-emerald-600 dark:border-emerald-600 text-white"
                  : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"}`}>
              <Icon size={16} />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Farbe</p>
      <div className="grid grid-cols-6 gap-2 mb-4">
        {COLOR_KEYS.map((k) => {
          const bar = colorOf(k)[2];
          const on = color === k;
          return (
            <button key={k} onClick={() => setColor(k)}
              className={`aspect-square rounded-lg ${bar} flex items-center justify-center ${
                on ? "ring-2 ring-offset-2 ring-stone-900 dark:ring-emerald-400 dark:ring-offset-stone-900" : ""}`}>
              {on && <Check size={14} className="text-white" />}
            </button>
          );
        })}
      </div>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Sichern</Button>

      {!isNew && (usage > 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 flex items-start gap-1.5 px-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Löschen geht erst, wenn die {usage} Buchungen mit dieser Kategorie eine andere bekommen oder weg sind.
        </p>
      ) : usage === 0 ? (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Kategorie löschen
        </Button>
      ) : null)}
    </Sheet>
  );
}
