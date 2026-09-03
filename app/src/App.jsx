import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus, List, PieChart, Target, Settings } from "lucide-react";
import * as api from "./pb.js";
import { pb } from "./pb.js";
import { MONTHS, Spinner, Toast, ErrorNote, Button, Field, inputCls, byId, UNKNOWN_ACC, Sheet, TxRow } from "./ui.jsx";
import Buchungen from "./screens/Buchungen.jsx";
import Auswertung from "./screens/Auswertung.jsx";
import BudgetScreen from "./screens/Budgets.jsx";
import Konten from "./screens/Konten.jsx";
import NewEntry from "./screens/NewEntry.jsx";

export default function App() {
  const [authed, setAuthed] = useState(pb.authStore.isValid);
  useEffect(() => pb.authStore.onChange(() => setAuthed(pb.authStore.isValid)), []);
  return authed ? <Shell /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.login(email, password); }
    catch { setError("Anmeldung fehlgeschlagen. E-Mail oder Passwort stimmt nicht."); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-full bg-stone-100 dark:bg-stone-950 flex justify-center">
      <div className="w-full max-w-md bg-[#FAFAF8] dark:bg-stone-900 min-h-full px-6 pt-24">
        <h1 className="text-2xl font-medium mb-1">Haushaltsbuch</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-8">Melde dich an, um weiterzumachen.</p>
        <form onSubmit={submit}>
          <Field label="E-Mail">
            <input type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Passwort">
            <input type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy} className="w-full mt-2">
            {busy ? "Moment …" : "Anmelden"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Shell() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState("buchungen");
  const [acc, setAcc] = useState("alle");
  const [sheet, setSheet] = useState(false);
  const [autoBooked, setAutoBooked] = useState(null); // gerade automatisch erzeugte Buchungen
  const [toast, setToast] = useState("");
  const [error, setError] = useState(null);

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [running, setRunning] = useState([]);   // alles bis Monatsende, fuer Salden
  const [budgets, setBudgets] = useState([]);

  const { key } = api.monthRange(ym.y, ym.m);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [a, c, t, r, b] = await Promise.all([
        api.listAccounts(), api.listCategories(),
        api.listTransactions(ym.y, ym.m), api.listTransactionsUntil(ym.y, ym.m),
        api.listBudgets(key),
      ]);
      setAccounts(a); setCategories(c); setTransactions(t); setRunning(r); setBudgets(b);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [ym.y, ym.m, key]);

  useEffect(() => { load(); }, [load]);

  // Faellige Daueraufträge einmal pro Sitzung nachbuchen - nicht Teil von
  // load(), das feuert bei jedem Monatswechsel neu. Zeigt danach, welche
  // Buchungen konkret automatisch entstanden sind (nicht nur die Anzahl im
  // Toast, der laengst wieder verschwunden waere, wenn man's verpasst).
  useEffect(() => {
    api.runDueRecurringRules()
      .then(async (rows) => {
        if (rows.length === 0) return;
        await load();
        setAutoBooked(rows);
      })
      .catch(console.error);
  }, []);

  const balances = useMemo(() => {
    const b = {};
    for (const a of accounts) {
      b[a.id] = (a.start_cents ?? 0) + running.reduce((s, t) => {
        if (t.type === "transfer") {
          if (t.account === a.id) return s - t.amount_cents;
          if (t.to_account === a.id) return s + t.amount_cents;
          return s;
        }
        return t.account === a.id ? s + t.amount_cents : s;
      }, 0);
    }
    b.alle = accounts.reduce((s, a) => s + b[a.id], 0);
    return b;
  }, [accounts, running]);

  const visible = useMemo(
    () => transactions.filter((t) => acc === "alle" || t.account === acc || t.to_account === acc),
    [transactions, acc]
  );
  const real = visible.filter((t) => t.type !== "transfer");
  const spentByCat = useMemo(() => {
    const o = {};
    for (const t of real) if (t.amount_cents < 0) o[t.category] = (o[t.category] ?? 0) - t.amount_cents;
    return o;
  }, [real]);

  const shift = (d) => {
    let m = ym.m + d, y = ym.y;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setYm({ y, m });
  };

  const needsSetup = !loading && !error && accounts.length === 0 && categories.length === 0;

  const shared = {
    accounts, categories, transactions: visible, real, spentByCat, budgets,
    balances, acc, setAcc, monthKey: key, reload: load, flash, setError,
  };

  const navItems = [
    { id: "buchungen", label: "Buchungen", Icon: List },
    { id: "auswertung", label: "Auswertung", Icon: PieChart },
    { id: "budgets", label: "Budgets", Icon: Target },
    { id: "konten", label: "Konten", Icon: Settings },
  ];

  // Kontextinfo je Tab, analog zu den Sidebar-/Bottom-Nav-Badges im epoch-Projekt.
  const navBadges = accounts.length > 0 ? {
    buchungen: acc === "alle" ? "Alle Konten" : byId(accounts, acc, UNKNOWN_ACC).name,
    konten: `${accounts.length} ${accounts.length === 1 ? "Konto" : "Konten"}`,
  } : {};
  const iconStroke = (active) => (active ? 2.1 : 1.6);

  return (
    <div className="h-full bg-stone-100 dark:bg-stone-950 flex justify-center">
      <div className="w-full max-w-md sidebar:max-w-5xl bg-[#FAFAF8] dark:bg-stone-900 h-full flex flex-col sidebar:flex-row relative overflow-hidden">

        <aside className="hidden sidebar:flex sidebar:w-60 sidebar:shrink-0 sidebar:flex-col sidebar:border-r sidebar:border-stone-200 dark:sidebar:border-stone-700 sidebar:py-6 sidebar:px-3">
          <h1 className="text-base font-medium px-2.5 mb-0.5">Haushaltsbuch</h1>
          <p className="px-2.5 mb-6 text-xs text-emerald-700/70 dark:text-emerald-400/70 font-mono">v{__APP_VERSION__}</p>
          <nav className="flex flex-col gap-1">
            {navItems.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left ${
                    active ? "bg-emerald-700/10 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-400 font-medium"
                      : "text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"}`}>
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border ${
                    active ? "bg-emerald-50 dark:bg-emerald-400/10 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                      : "bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"}`}>
                    <Icon size={15} strokeWidth={iconStroke(active)} />
                  </span>
                  <span className="shrink-0">{label}</span>
                  {navBadges[id] && (
                    <span className="flex-1 min-w-0 text-xs text-stone-400 dark:text-stone-500 truncate text-right font-mono">{navBadges[id]}</span>
                  )}
                </button>
              );
            })}
          </nav>
          {!needsSetup && accounts.length > 0 && (
            <button onClick={() => setSheet(true)}
              className="mt-6 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-700 dark:bg-emerald-600 text-white text-sm font-medium active:scale-[0.98] transition-transform">
              <Plus size={17} /> Neue Buchung
            </button>
          )}
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden">
          <header className="pt-5 pb-3 border-b border-stone-200 dark:border-stone-700 px-5">
            <div className="flex items-center justify-between">
              <button onClick={() => shift(-1)} className="p-1.5 -ml-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800">
                <ChevronLeft size={20} />
              </button>
              <h1 className="text-base font-medium">{MONTHS[ym.m]} {ym.y}</h1>
              <button onClick={() => shift(1)} className="p-1.5 -mr-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800">
                <ChevronRight size={20} />
              </button>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-y-auto pb-28 sidebar:pb-8">
            {error && <div className="px-5 pt-4"><ErrorNote error={error} /></div>}
            {loading && <Spinner />}

            {needsSetup && <FirstRun onDone={load} setError={setError} />}

            {!loading && !needsSetup && (
              <>
                {tab === "buchungen" && <Buchungen {...shared} />}
                {tab === "auswertung" && <Auswertung {...shared} />}
                {tab === "budgets" && <BudgetScreen {...shared} />}
                {tab === "konten" && <Konten {...shared} />}
              </>
            )}
          </main>

          {!needsSetup && accounts.length > 0 && (
            <button onClick={() => setSheet(true)}
              className="sidebar:hidden absolute bottom-[calc(var(--nav-h)+12px)] right-5 w-14 h-14 rounded-full bg-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-900/20 active:scale-95 transition-transform"
              aria-label="Neue Buchung">
              <Plus size={26} />
            </button>
          )}

          <nav className="sidebar:hidden absolute bottom-0 inset-x-0 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-t border-stone-200 dark:border-stone-700 grid grid-cols-4">
            {navItems.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)}
                  className={`py-2.5 flex flex-col items-center gap-0.5 ${
                    active ? "text-stone-900 dark:text-stone-50" : "text-stone-400 dark:text-stone-500"}`}>
                  <Icon size={21} strokeWidth={iconStroke(active)} />
                  <span className="text-[11px]">{label}</span>
                  {navBadges[id] && (
                    <span className="text-[9px] text-stone-400 dark:text-stone-500 truncate max-w-[68px] font-mono">{navBadges[id]}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <Toast text={toast} />

          {sheet && (
            <NewEntry accounts={accounts} categories={categories}
              defaultAcc={acc === "alle" ? accounts[0]?.id : acc}
              onClose={() => setSheet(false)}
              onSaved={(msg) => { flash(msg); load(); }} />
          )}

          {autoBooked && (
            <Sheet title="Automatisch gebucht" onClose={() => setAutoBooked(null)}>
              <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
                {autoBooked.length} {autoBooked.length === 1 ? "wiederkehrende Buchung wurde" : "wiederkehrende Buchungen wurden"} beim Öffnen aus fälligen Daueraufträgen nachgebucht:
              </p>
              <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                {autoBooked.map((t) => (
                  <TxRow key={t.id} tx={t} accounts={accounts} categories={categories} showAccount />
                ))}
              </div>
            </Sheet>
          )}
        </div>
      </div>
    </div>
  );
}

function FirstRun({ onDone, setError }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api.seedDefaults(); await onDone(); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  };
  return (
    <div className="px-6 py-16 text-center">
      <h2 className="text-lg font-medium mb-2">Noch nichts da</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
        Ich lege dir elf übliche Kategorien und ein Girokonto an. Beides kannst du danach ändern.
      </p>
      <Button onClick={go} disabled={busy} className="w-full">
        {busy ? "Moment …" : "Loslegen"}
      </Button>
    </div>
  );
}
