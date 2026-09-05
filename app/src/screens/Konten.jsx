import { useState, useEffect } from "react";
import { Plus, ChevronRight, Trash2, AlertTriangle, Upload, LogOut, Check, Repeat, ArrowLeftRight, X } from "lucide-react";
import * as api from "../pb.js";
import {
  eur, eurAbs, typeIcon, ACCOUNT_TYPES, shortName, catIcon, colorOf, CAT_ICON_KEYS, COLOR_KEYS,
  inputCls, Field, Sheet, Button, ErrorNote, AccountPicker, byId, UNKNOWN_CAT, UNKNOWN_TAG,
  RECURRING, recurringLabel, todayISO,
} from "../ui.jsx";
import { useTheme } from "../theme.js";
import Import from "./Import.jsx";

const CAT_LIST_COLLAPSED = 5;
const RULE_FREQUENCIES = RECURRING.filter(([v]) => v);

export default function Konten({ accounts, categories, tags, balances, reload, flash }) {
  const [editing, setEditing] = useState(null);
  const [editingCat, setEditingCat] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [editingAutoRule, setEditingAutoRule] = useState(null);
  const [rules, setRules] = useState([]);
  const [autoRules, setAutoRules] = useState([]);
  const [catsExpanded, setCatsExpanded] = useState(false);
  const [view, setView] = useState("liste");
  const [error, setError] = useState(null);
  const { theme, setTheme } = useTheme();

  const loadRules = () => api.listRecurringRules().then(setRules).catch(setError);
  const loadAutoRules = () => api.listRules().then(setAutoRules).catch(setError);
  useEffect(() => { loadRules(); loadAutoRules(); }, []);

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

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Daueraufträge</p>
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
        {rules.map((r) => {
          const isTransfer = r.type === "transfer";
          const cat = isTransfer ? null : byId(categories, r.category, UNKNOWN_CAT);
          const Icon = isTransfer ? ArrowLeftRight : catIcon(cat.icon);
          const [bg, fg] = isTransfer ? ["bg-stone-100 dark:bg-stone-700", "text-stone-500 dark:text-stone-400"] : colorOf(cat.color);
          const from = byId(accounts, r.account, { name: "?" });
          const sub = (isTransfer ? `${from.name} → ${byId(accounts, r.to_account, { name: "?" }).name}` : `${cat.name} · ${from.name}`)
            + ` · ${recurringLabel(r.frequency)}`
            + (r.active ? ` · ab ${new Date(api.dateOnly(r.next_due) + "T12:00:00").toLocaleDateString("de-DE")}` : " · pausiert");
          return (
            <button key={r.id} onClick={() => setEditingRule(r)}
              className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
              <span className={`w-9 h-9 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0 ${!r.active ? "opacity-40" : ""}`}>
                <Icon size={17} />
              </span>
              <span className={`flex-1 min-w-0 ${!r.active ? "opacity-40" : ""}`}>
                <span className="flex items-center gap-1 text-sm truncate">
                  <Repeat size={11} className="text-stone-400 dark:text-stone-500 shrink-0" />
                  <span className="truncate">{r.payee || (isTransfer ? "Umbuchung" : cat.name)}</span>
                </span>
                <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{sub}</span>
              </span>
              <span className={`text-sm font-medium tabular-nums ${!r.active ? "opacity-40" : ""} ${
                isTransfer ? "text-stone-400 dark:text-stone-500" : r.amount_cents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                {isTransfer ? "" : r.amount_cents > 0 ? "+" : "−"}{eurAbs(r.amount_cents)}
              </span>
            </button>
          );
        })}
        {rules.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-stone-500 dark:text-stone-400">Noch keine Daueraufträge.</p>
        )}
      </div>

      <Button variant="ghost"
        onClick={() => setEditingRule({
          id: "", type: "tx", account: accounts[0]?.id ?? "", to_account: "", category: "",
          amount_cents: 0, payee: "", note: "", frequency: "monthly", next_due: todayISO(), active: true,
        })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Dauerauftrag hinzufügen
      </Button>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Automatische Zuordnung</p>
      <p className="text-xs text-stone-400 dark:text-stone-500 -mt-1.5 mb-2.5">
        Setzt beim CSV-Import die Kategorie, wenn Empfänger oder Verwendungszweck den Text enthalten.
      </p>
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
        {autoRules.map((r) => {
          const cat = byId(categories, r.category, UNKNOWN_CAT);
          const Icon = catIcon(cat.icon);
          const [bg, fg] = colorOf(cat.color);
          return (
            <button key={r.id} onClick={() => setEditingAutoRule(r)}
              className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
              <span className={`w-9 h-9 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
                <Icon size={17} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">„{r.pattern}"</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{cat.name}</span>
              </span>
              <ChevronRight size={16} className="text-stone-300 dark:text-stone-600 shrink-0" />
            </button>
          );
        })}
        {autoRules.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-stone-500 dark:text-stone-400">Noch keine Regeln.</p>
        )}
      </div>

      <Button variant="ghost"
        onClick={() => setEditingAutoRule({ id: "", pattern: "", category: categories[0]?.id ?? "", priority: 0 })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Regel hinzufügen
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

      {editingRule && (
        <RuleEditor draft={editingRule} accounts={accounts} categories={categories} tags={tags}
          onClose={() => setEditingRule(null)}
          onSaved={(m) => { setEditingRule(null); flash(m); loadRules(); }}
          onError={setError} onTagsChanged={reload} />
      )}

      {editingAutoRule && (
        <AutoRuleEditor draft={editingAutoRule} categories={categories}
          onClose={() => setEditingAutoRule(null)}
          onSaved={(m) => { setEditingAutoRule(null); flash(m); loadAutoRules(); }}
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
    if (!isNew) Promise.all([api.countByAccount(draft.id), api.countRecurringRulesByAccount(draft.id)])
      .then(([tx, rules]) => setUsage({ tx, rules }))
      .catch(() => setUsage(null));
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
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && usage && (usage.tx + usage.rules > 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 flex items-start gap-1.5 px-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Löschen geht erst, wenn {[
            usage.tx > 0 && `${usage.tx} Buchung${usage.tx === 1 ? "" : "en"}`,
            usage.rules > 0 && `${usage.rules} ${usage.rules === 1 ? "Dauerauftrag" : "Daueraufträge"}`,
          ].filter(Boolean).join(" und ")} auf diesem Konto weg, umgebucht oder gelöscht sind.
        </p>
      ) : (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Konto löschen
        </Button>
      ))}
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
    if (!isNew) Promise.all([api.countByCategory(draft.id), api.countRecurringRulesByCategory(draft.id)])
      .then(([tx, rules]) => setUsage({ tx, rules }))
      .catch(() => setUsage(null));
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
      <div className="flex flex-wrap gap-2 mb-4">
        {CAT_ICON_KEYS.map((k) => {
          const Icon = catIcon(k);
          const on = icon === k;
          return (
            <button key={k} onClick={() => setIcon(k)}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                on ? "bg-stone-900 border-stone-900 dark:bg-emerald-600 dark:border-emerald-600 text-white"
                  : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"}`}>
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Farbe</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {COLOR_KEYS.map((k) => {
          const bar = colorOf(k)[2];
          const on = color === k;
          return (
            <button key={k} onClick={() => setColor(k)}
              className={`w-9 h-9 rounded-lg shrink-0 ${bar} flex items-center justify-center ${
                on ? "ring-2 ring-offset-2 ring-stone-900 dark:ring-emerald-400 dark:ring-offset-stone-900" : ""}`}>
              {on && <Check size={14} className="text-white" />}
            </button>
          );
        })}
      </div>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && usage && (usage.tx + usage.rules > 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 flex items-start gap-1.5 px-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Löschen geht erst, wenn {[
            usage.tx > 0 && `${usage.tx} Buchung${usage.tx === 1 ? "" : "en"}`,
            usage.rules > 0 && `${usage.rules} ${usage.rules === 1 ? "Dauerauftrag" : "Daueraufträge"}`,
          ].filter(Boolean).join(" und ")} eine andere Kategorie bekommen oder weg sind.
        </p>
      ) : (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Kategorie löschen
        </Button>
      ))}
    </Sheet>
  );
}

function RuleEditor({ draft, accounts, categories, tags, onClose, onSaved, onError, onTagsChanged }) {
  const isNew = !draft.id;
  const expenses = categories.filter((c) => c.kind === "expense" && !c.archived);
  const incomeCat = categories.find((c) => c.kind === "income");

  const [kind, setKind] = useState(() => draft.type === "transfer" ? "um"
    : byId(categories, draft.category, {}).kind === "income" ? "ein" : "aus");
  const [account, setAccount] = useState(draft.account || accounts[0]?.id);
  const [toAccount, setToAccount] = useState(() => draft.to_account || (accounts.find((a) => a.id !== draft.account) ?? accounts[0])?.id);
  // Bei einem neuen Dauerauftrag ist draft.category "" (leer) - ohne die
  // Pruefung auf einen tatsaechlichen Wert bliebe cat leer, waehrend das
  // Dropdown optisch trotzdem die erste Kategorie zeigt (Browser-Standard bei
  // <select> ohne passende Option) und beim Speichern keine Kategorie gesetzt
  // wuerde, obwohl eine ausgewaehlt aussah.
  const [cat, setCat] = useState((draft.type === "tx" && kind === "aus" && draft.category) ? draft.category : (expenses[0]?.id ?? ""));
  const [amount, setAmount] = useState(draft.amount_cents ? Math.abs(draft.amount_cents) / 100 : "");
  const [payee, setPayee] = useState(draft.payee ?? "");
  const [tagIds, setTagIds] = useState(draft.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [frequency, setFrequency] = useState(draft.frequency || "monthly");
  const [nextDue, setNextDue] = useState(draft.next_due ? api.dateOnly(draft.next_due) : todayISO());
  const [active, setActive] = useState(draft.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Tags werden hier nur lokal gesammelt und erst beim Speichern des ganzen
  // Dauerauftrags mit uebernommen - anders als im Buchungen-Detail, wo jede
  // Aenderung sofort geschrieben wird. Ein neu getippter Name, den es noch
  // nicht gibt, wird sofort angelegt (case-insensitiv abgeglichen), damit er
  // beim naechsten Dauerauftrag schon in der Vorschlagsliste steht.
  const addTag = async () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    let id = existing?.id;
    if (!id) {
      try { id = (await api.createTag(trimmed)).id; onTagsChanged(); }
      catch (e) { onError(e); return; }
    }
    if (!tagIds.includes(id)) setTagIds((v) => [...v, id]);
    setTagInput("");
  };
  const removeTag = (id) => setTagIds((v) => v.filter((x) => x !== id));

  const submit = async () => {
    const cents = Math.round((Number(amount) || 0) * 100);
    if (cents <= 0) return setError("Betrag eingeben");
    if (kind === "um" && account === toAccount) return setError("Quelle und Ziel müssen sich unterscheiden");
    setBusy(true); setError(null);
    try {
      const base = kind === "um"
        ? { type: "transfer", account, to_account: toAccount, category: "", amount_cents: cents }
        : { type: "tx", account, to_account: "", category: kind === "ein" ? incomeCat?.id : cat,
            amount_cents: kind === "ein" ? cents : -cents };
      await api.saveRecurringRule({
        id: draft.id || undefined, ...base,
        payee: payee.trim(), note: "", tags: tagIds, frequency, next_due: nextDue, active,
      });
      onSaved("Dauerauftrag gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteRecurringRule(draft.id); onSaved("Dauerauftrag gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neuer Dauerauftrag" : "Dauerauftrag bearbeiten"} onClose={onClose}>
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Art</p>
      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[["aus", "Ausgabe"], ["ein", "Einnahme"], ["um", "Umbuchung"]].map(([v, label], i) => (
          <button key={v} onClick={() => setKind(v)}
            className={`px-3 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              kind === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">{kind === "um" ? "Von Konto" : "Konto"}</p>
      <div className="mb-4"><AccountPicker accounts={accounts} value={account} onChange={setAccount} /></div>

      {kind === "um" && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Auf Konto</p>
          <div className="mb-4"><AccountPicker accounts={accounts} value={toAccount} onChange={setToAccount} disabledId={account} /></div>
        </>
      )}

      {kind === "aus" && (
        <Field label="Kategorie">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
            {expenses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Betrag">
        <div className="flex items-center gap-2">
          <input type="number" min="0" step="10" value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500">€</span>
        </div>
      </Field>

      <Field label="Empfänger/Bezeichnung (optional)">
        <input value={payee} onChange={(e) => setPayee(e.target.value)}
          placeholder="Sparrate, Miete …" className={inputCls} />
      </Field>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Tags</p>
      <div className="mb-4">
        {tagIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tagIds.map((id) => {
              const t = byId(tags, id, UNKNOWN_TAG);
              return (
                <span key={id}
                  className="inline-flex items-center gap-1 text-xs bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 rounded-full pl-2.5 pr-1.5 py-1">
                  {t.name}
                  <button onClick={() => removeTag(id)} className="text-stone-400 dark:text-stone-500">
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Tag hinzufügen …" list="rule-tag-suggestions" className={inputCls} />
          <datalist id="rule-tag-suggestions">
            {tags.filter((t) => !tagIds.includes(t.id)).map((t) => <option key={t.id} value={t.name} />)}
          </datalist>
          <Button variant="ghost" onClick={addTag} className="px-4 shrink-0">+</Button>
        </div>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Häufigkeit</p>
      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {RULE_FREQUENCIES.map(([v, label], i) => (
          <button key={v} onClick={() => setFrequency(v)}
            className={`px-3 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              frequency === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <Field label="Nächste Buchung">
        <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={inputCls} />
      </Field>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Status</p>
      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[[true, "Aktiv"], [false, "Pausiert"]].map(([v, label], i) => (
          <button key={String(v)} onClick={() => setActive(v)}
            className={`px-3 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              active === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Dauerauftrag löschen
        </Button>
      )}
    </Sheet>
  );
}

function AutoRuleEditor({ draft, categories, onClose, onSaved, onError }) {
  const isNew = !draft.id;
  const [pattern, setPattern] = useState(draft.pattern);
  const [category, setCategory] = useState(draft.category);
  const [priority, setPriority] = useState(draft.priority ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!pattern.trim()) return setError("Textmuster eingeben");
    if (!category) return setError("Kategorie wählen");
    setBusy(true);
    try {
      await api.saveRule({
        id: draft.id || undefined,
        pattern: pattern.trim(), category, priority: Number(priority) || 0,
      });
      onSaved("Regel gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteRule(draft.id); onSaved("Regel gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neue Regel" : "Regel bearbeiten"} onClose={onClose}>
      <Field label="Textmuster">
        <input value={pattern} onChange={(e) => { setPattern(e.target.value); setError(null); }}
          placeholder="REWE, Netflix …" className={inputCls} />
      </Field>
      <p className="text-xs text-stone-400 dark:text-stone-500 -mt-2 mb-4">
        Greift, wenn Empfänger oder Verwendungszweck diesen Text enthalten (Groß-/Kleinschreibung egal).
      </p>

      <Field label="Kategorie">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label="Priorität (höher = zuerst geprüft)">
        <input type="number" step="1" value={priority} onChange={(e) => setPriority(e.target.value)}
          className={`${inputCls} tabular-nums`} />
      </Field>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Regel löschen
        </Button>
      )}
    </Sheet>
  );
}
