import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Plus, List, PieChart, Target, Settings, TrendingUp, Landmark } from "lucide-react";
import * as api from "./pb.js";
import { pb } from "./pb.js";
import { reserveStatus } from "./ruecklagen.js";
import { MONTHS, Spinner, Toast, ErrorNote, Button, Field, inputCls, byId, UNKNOWN_ACC, Sheet, TxRow } from "./ui.jsx";
import Buchungen from "./screens/Buchungen.jsx";
import Auswertung from "./screens/Auswertung.jsx";
import BudgetScreen from "./screens/Budgets.jsx";
import Konten from "./screens/Konten.jsx";
import Depot from "./screens/Depot.jsx";
import Einstellungen from "./screens/Einstellungen.jsx";
import NewEntry from "./screens/NewEntry.jsx";
import TxDetail from "./screens/TxDetail.jsx";
import { useDepotEnabled } from "./depotPref.js";
import { useDefaultAccountPref } from "./defaultAccountPref.js";

// Wie viele volle Vormonate die Einkommens-Hochrechnung in Buchungen.jsx
// fuer den Ausgaben-Durchschnitt heranzieht (s. avgExpense in Shell()).
const AVG_MONTHS_BACK = 3;

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
  const { depotEnabled, setDepotEnabled } = useDepotEnabled();
  const { defaultAccount, setDefaultAccount } = useDefaultAccountPref();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState("buchungen");
  // Start-Konto kommt aus der Praeferenz (Einstellungen, Default "alle") -
  // nur der Anfangswert, ein spaeterer Chip-Klick aendert nicht rueckwirkend
  // die hinterlegte Praeferenz. setDefaultAccountAndApply (siehe unten) wendet
  // eine neu gewaehlte Praeferenz zusaetzlich sofort auf die laufende Sitzung an.
  const [acc, setAcc] = useState(defaultAccount);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = keine aktive Suche
  const [searching, setSearching] = useState(false);
  // Erweiterte Suchfilter (ab 0.50.0) - leben aus demselben Grund wie query
  // hier statt screen-lokal in Buchungen.jsx (ueberleben das kurze
  // loading=true beim Monatswechsel).
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [onlyUnbudgeted, setOnlyUnbudgeted] = useState(false);
  // Vorauswahl fuer den Datumsbereich (ab 0.51.0): "month"/"30d" befuellen
  // dateFrom/dateTo automatisch (s. Effekt unten), "custom" laesst sie wie
  // bisher frei editierbar. Default "custom" aendert am bestehenden Verhalten
  // nichts, solange niemand eine Vorauswahl anklickt.
  const [datePreset, setDatePreset] = useState("custom");
  const [sheet, setSheet] = useState(false);
  const [detail, setDetail] = useState(null); // per Klick geoeffnete Buchung, egal aus welchem Screen
  const [autoBooked, setAutoBooked] = useState(null); // gerade automatisch erzeugte Buchungen
  const [toast, setToast] = useState("");
  const [error, setError] = useState(null);

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [people, setPeople] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [running, setRunning] = useState([]);   // alles bis Monatsende, fuer Salden
  const [budgets, setBudgets] = useState([]);
  const [incomeEntries, setIncomeEntries] = useState([]);
  const [avgTx, setAvgTx] = useState([]);   // vorherige Monate, fuer die Einkommens-Hochrechnung
  const [reserves, setReserves] = useState([]);

  const { key } = api.monthRange(ym.y, ym.m);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  // pb.autoCancellation ist bewusst aus (siehe pb.js) - bei schnellem
  // Monatswechsel koennen mehrere load()-Aufrufe parallel unterwegs sein und
  // in beliebiger Reihenfolge zurueckkommen. loadSeq sorgt dafuer, dass nur
  // die Antwort des zuletzt gestarteten Aufrufs den State setzt, nicht die
  // zuletzt eingetroffene.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true); setError(null);
    try {
      const [a, c, g, p, t, r, b, ie, at] = await Promise.all([
        api.listAccounts(), api.listCategories(), api.listTags(), api.listPeople(),
        api.listTransactions(ym.y, ym.m), api.listTransactionsUntil(ym.y, ym.m),
        api.listBudgets(key, acc), api.listIncomeEntries(key, acc),
        api.listTransactionsForAverage(ym.y, ym.m, AVG_MONTHS_BACK),
      ]);
      if (seq !== loadSeq.current) return;
      setAccounts(a); setCategories(c); setTags(g); setPeople(p); setTransactions(t); setRunning(r); setBudgets(b);
      setIncomeEntries(ie); setAvgTx(at);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [ym.y, ym.m, key, acc]);

  useEffect(() => { load(); }, [load]);

  // Ruecklagen fuer unregelmaessige (quartals-/jahresweise) Dauerauftraege -
  // bis 0.41.x screen-lokal nur in Budgets.jsx geladen, jetzt zentral hier
  // (ab 0.42.0), weil auch die Budget-Leiste in Buchungen.jsx sonst im
  // Faelligkeitsmonat faelschlich weit ueber Budget zeigt (der volle
  // Abbuchungsbetrag gegen das nicht um die Ruecklage erhoehte Grundbudget).
  // Haengt bewusst nur an "acc", nicht am Monat - reserveStatus() rechnet den
  // Saldo je sichtbarem Monat live aus der vollen Buchungshistorie je Regel.
  // loadReserves() ist als eigene Funktion (statt reinem Effekt-Body)
  // exportiert, damit ein frisch angelegter Dauerauftrag (TxDetail.jsx-
  // Haekchen, NewEntry.jsx, RuleEditor in Konten.jsx) die Ruecklage sofort
  // nachlaedt, statt erst nach einem Kontowechsel oder Neuladen der Seite
  // sichtbar zu werden - bis 0.47.x fehlte das, ein frisch angelegter
  // Quartals-/Jahres-Dauerauftrag tauchte im Budgets-Tab deshalb erst nach
  // einem Umweg ueber einen Kontowechsel auf.
  const reservesSeq = useRef(0);
  const loadReserves = useCallback(async () => {
    const seq = ++reservesSeq.current;
    if (!acc || acc === "alle") { setReserves([]); return; }
    try {
      const rules = await api.listReserveRules(acc);
      const withTxs = await Promise.all(
        rules.map(async (rule) => ({ rule, txs: await api.listRuleTransactions(rule.id) }))
      );
      if (seq === reservesSeq.current) setReserves(withTxs);
    } catch (e) { if (seq === reservesSeq.current) setError(e); }
  }, [acc]);
  useEffect(() => { loadReserves(); }, [loadReserves]);

  // Effektives Limit = manuell gesetztes Budget + monatliche Ruecklagen-Rate
  // (status.monthly) aus allen quartals-/jahresweisen Regeln einer Kategorie.
  // Bewusst nicht in budgets.amount_cents geschrieben, sondern hier bei jeder
  // Verwendung live dazugerechnet (kein neuer gespeicherter Zustand) - sonst
  // wuerde ein manueller Edit die automatische Komponente ueberschreiben und
  // umgekehrt. spentByCat wird fuer den Soll/Ist-Vergleich um die in diesem
  // Monat tatsaechlich entnommenen Ruecklagen-Betraege bereinigt, sonst
  // sprengt die volle Abbuchung im Faelligkeitsmonat jede Vergleichsleiste.
  const reservesFor = (cid) => reserves
    .filter((r) => r.rule.category === cid)
    .map((r) => ({ rule: r.rule, status: reserveStatus(r.rule, r.txs, key) }));
  const reserveMonthlyOf = (cid) => reservesFor(cid).reduce((s, r) => s + r.status.monthly, 0);
  const withdrawnThisMonthOf = (cid) => reservesFor(cid).reduce((s, r) => s + r.status.withdrawn, 0);
  const effectiveLimitOf = (cid) =>
    (budgets.find((b) => b.category === cid)?.amount_cents ?? 0) + reserveMonthlyOf(cid);

  // Faengt ein als Standard hinterlegtes, zwischenzeitlich geloeschtes Konto
  // ab (z. B. nach dem Loeschen in Konten.jsx) - ohne diesen Check bliebe
  // "acc" auf einer toten ID stehen und keine Kachel/kein Chip waere mehr
  // markiert. Greift erst, sobald Konten tatsaechlich geladen sind.
  useEffect(() => {
    if (accounts.length > 0 && acc !== "alle" && !accounts.some((a) => a.id === acc)) setAcc("alle");
  }, [accounts, acc]);

  // Eine neu in den Einstellungen gewaehlte Standardkonto-Praeferenz greift
  // sofort auch fuer die laufende Sitzung, nicht erst beim naechsten
  // App-Start - sonst waere der Effekt der Auswahl nicht sichtbar.
  const setDefaultAccountAndApply = (id) => { setDefaultAccount(id); setAcc(id); };

  // Vorauswahl fuer den Datumsbereich (ab 0.51.0): "month" bindet an den
  // gerade sichtbaren Monat (ym), nicht an den echten Kalendermonat - folgt
  // dadurch der Monatsnavigation, wenn man waehrenddessen weiterblaettert.
  // "30d" ist ein rollierendes Fenster bis heute, wird bei jeder Auswahl neu
  // berechnet (kein Hintergrund-Update waehrend die App offen bleibt - passt
  // zum Rest der App, das laeuft auch sonst nirgends "live" mit). "custom"
  // fasst dateFrom/dateTo bewusst nicht an, das bleibt die freie Eingabe von
  // vorher.
  useEffect(() => {
    if (datePreset === "month") {
      const { start, end } = api.monthRange(ym.y, ym.m);
      const last = new Date(`${end}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() - 1);
      setDateFrom(start);
      setDateTo(last.toISOString().slice(0, 10));
    } else if (datePreset === "30d") {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      setDateTo(to.toISOString().slice(0, 10));
      setDateFrom(from.toISOString().slice(0, 10));
    }
  }, [datePreset, ym.y, ym.m]);

  // Suche (Buchungen.jsx) lebt bewusst hier statt als lokaler State im
  // Screen: load() setzt bei jedem Monatswechsel kurz loading=true, was
  // jeden Tab-Screen unmountet (s. u., {!loading && ...}) - ein Suchbegriff
  // im Screen-lokalen State ginge dabei verloren, obwohl die Suche selbst
  // absichtlich monatsunabhaengig ist (siehe searchTransactions() in
  // pb.js). Gleiches Prinzip wie beim bereits hier lebenden acc-Zustand.
  // Betrags-/Datumsbereich und "nur ohne Budget" (ab 0.50.0) koennen die
  // Suche zusaetzlich zum Text oder ganz ohne ihn ausloesen (z. B. "alle
  // Ausgaben zwischen 40 und 60 Euro" ohne ein einziges Zeichen im Suchfeld).
  // Kategorie-/Tag-Namensabgleich bleibt an die bisherige Zwei-Zeichen-
  // Schwelle gekoppelt - bei leerem/kurzem q wuerde "".includes() sonst jede
  // Kategorie treffen.
  useEffect(() => {
    const q = query.trim();
    const minCents = minAmount !== "" ? Math.round(Number(minAmount) * 100) : undefined;
    const maxCents = maxAmount !== "" ? Math.round(Number(maxAmount) * 100) : undefined;
    const hasFilters = minCents !== undefined || maxCents !== undefined || !!dateFrom || !!dateTo || onlyUnbudgeted;
    if (q.length < 2 && !hasFilters) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const lower = q.toLowerCase();
    const categoryIds = q.length >= 2 ? categories.filter((c) => c.name.toLowerCase().includes(lower)).map((c) => c.id) : [];
    const tagIds = q.length >= 2 ? tags.filter((t) => t.name.toLowerCase().includes(lower)).map((t) => t.id) : [];
    const t = setTimeout(async () => {
      try {
        const [results, budgetRows, ruleRows] = await Promise.all([
          api.searchTransactions(q, { categoryIds, tagIds, minCents, maxCents, dateFrom, dateTo }),
          onlyUnbudgeted ? api.listAllBudgets() : null,
          onlyUnbudgeted ? api.listRecurringRules() : null,
        ]);
        if (!onlyUnbudgeted) { setSearchResults(results); return; }
        // "Ohne Budget" = Ausgabe (keine Umbuchung, kein Einnahme-Vorgang,
        // die haben ohnehin kein Kategorie-Budget) ohne Kategorie ODER mit
        // Kategorie, aber weder manuellem Budget fuer das jeweilige Konto/
        // den jeweiligen Monat noch aktiver Quartals-/Jahres-Ruecklagenregel
        // - dieselbe Definition wie "ohne Kategorie"/"uncoveredCats" in
        // Budgets.jsx, hier nur pro Treffer statt pro sichtbarem Monat.
        const monthOf = (iso) => api.dateOnly(iso).slice(0, 7);
        const hasBudget = (tx) => !!tx.category && (
          budgetRows.some((b) => b.account === tx.account && b.category === tx.category
            && (b.month === "*" || b.month === monthOf(tx.date)))
          || ruleRows.some((r) => r.active && r.type === "tx"
            && (r.frequency === "quarterly" || r.frequency === "yearly")
            && r.account === tx.account && r.category === tx.category)
        );
        setSearchResults(results.filter((tx) => tx.type !== "transfer" && tx.amount_cents < 0 && !hasBudget(tx)));
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, categories, tags, minAmount, maxAmount, dateFrom, dateTo, onlyUnbudgeted]);

  // Ohne eigenes Routing hat die App sonst keinerlei Browser-History-Eintraege
  // - der mobile Zurueck-Button wuerde die Seite verlassen statt innerhalb der
  // App zurueckzugehen. Tab-Wechsel und die drei hier zentral verwalteten
  // Sheets bekommen deshalb je einen History-Eintrag; popstate stellt den
  // vorherigen Zustand wieder her. Bildschirm-lokale Sheets (Editoren in
  // Konten.jsx/Depot.jsx, Drilldowns in Auswertung.jsx) sind bewusst
  // aussen vor - das waere praktisch echtes Routing.
  useEffect(() => {
    history.replaceState({ tab: "buchungen" }, "");
    const onPopState = (e) => {
      const state = e.state ?? { tab: "buchungen" };
      setTab(state.tab ?? "buchungen");
      if (state.overlay !== "sheet") setSheet(false);
      if (state.overlay !== "detail") setDetail(null);
      if (state.overlay !== "autoBooked") setAutoBooked(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Faellige Daueraufträge einmal pro Sitzung nachbuchen - nicht Teil von
  // load(), das feuert bei jedem Monatswechsel neu. Zeigt danach, welche
  // Buchungen konkret automatisch entstanden sind (nicht nur die Anzahl im
  // Toast, der laengst wieder verschwunden waere, wenn man's verpasst).
  useEffect(() => {
    api.runDueRecurringRules()
      .then(async (rows) => {
        if (rows.length === 0) return;
        await load();
        history.pushState({ tab, overlay: "autoBooked" }, "");
        setAutoBooked({ rows, checkedAt: new Date() });
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

  // Virtuelle Unterkonten (Toepfe, s. accounts.parent_account) sind seit
  // 0.34.0 in Buchungen/Auswertung/Budgets nicht mehr eigenstaendig
  // waehlbar (AccChipRow zeigt sie nicht mehr) - waehlt man ihr Konto
  // (den "Master"), zaehlt deren Saldo/Buchungen aber automatisch mit, statt
  // dass man extra auf den Topf klicken muesste. "alle" bleibt unveraendert
  // (zaehlt ohnehin schon jedes Konto einzeln mit).
  const combinedBalances = useMemo(() => {
    const map = {};
    for (const a of accounts.filter((a) => !a.parent_account)) {
      const kids = accounts.filter((c) => c.parent_account === a.id);
      map[a.id] = (balances[a.id] ?? 0) + kids.reduce((s, c) => s + (balances[c.id] ?? 0), 0);
    }
    map.alle = balances.alle;
    return map;
  }, [accounts, balances]);

  // Set aus dem gewaehlten Konto plus seinen Toepfen (oder null bei "alle") -
  // gemeinsame Grundlage fuer jede Buchungsfilterung nach "acc" unten, damit
  // ein ausgewaehltes Master-Konto seine Toepfe automatisch mit einschliesst.
  const accGroup = useMemo(() => {
    if (acc === "alle") return null;
    return new Set([acc, ...accounts.filter((a) => a.parent_account === acc).map((a) => a.id)]);
  }, [acc, accounts]);

  const visible = useMemo(
    () => transactions.filter((t) => !accGroup || accGroup.has(t.account) || accGroup.has(t.to_account)),
    [transactions, accGroup]
  );
  const real = visible.filter((t) => t.type !== "transfer");

  // Durchschnittliche Ausgaben der letzten AVG_MONTHS_BACK vollen Monate,
  // gleiche Konto-/Umbuchungsfilterung wie bei "real" - Grundlage fuer die
  // Einkommens-Hochrechnung in Buchungen.jsx. Durch ganze Monate zu teilen
  // (nicht Tage) macht das unempfindlich dagegen, an welchem Tag einzelne
  // grosse Buchungen (Miete, Versicherungen) landen.
  const avgExpense = useMemo(() => {
    const visibleAvg = avgTx.filter((t) => !accGroup || accGroup.has(t.account) || accGroup.has(t.to_account));
    const total = visibleAvg
      .filter((t) => t.type !== "transfer" && t.amount_cents < 0)
      .reduce((s, t) => s - t.amount_cents, 0);
    return Math.round(total / AVG_MONTHS_BACK);
  }, [avgTx, accGroup]);

  const spentByCat = useMemo(() => {
    const o = {};
    for (const t of real) if (t.amount_cents < 0) o[t.category] = (o[t.category] ?? 0) - t.amount_cents;
    return o;
  }, [real]);
  // Tags sind quer zur Kategorie, eine Buchung kann mehrere haben - bewusst
  // keine Partition wie bei Kategorien, Mehrfachzaehlung ist hier gewollt.
  const spentByTag = useMemo(() => {
    const o = {};
    for (const t of real) if (t.amount_cents < 0) for (const tg of t.tags ?? []) o[tg] = (o[tg] ?? 0) - t.amount_cents;
    return o;
  }, [real]);

  // Handler fuer das Buchungs-Detail-Sheet - hier statt in Buchungen.jsx, damit
  // auch andere Screens (Auswertung.jsx) eine Buchung per openDetail() oeffnen
  // koennen, nicht nur die Buchungsliste selbst.
  const removeTx = async (id) => {
    try { await api.deleteTransaction(id); history.back(); flash("Buchung gelöscht"); load(); }
    catch (e) { setError(e); }
  };

  const updateRecurring = async (id, value) => {
    try {
      const updated = await api.updateTransaction(id, { recurring: value });
      setDetail(updated); flash("Aktualisiert"); load();
    } catch (e) { setError(e); }
  };

  const updateCategory = async (id, category) => {
    try {
      const updated = await api.updateTransaction(id, { category });
      setDetail(updated); flash("Kategorie geändert"); load();
    } catch (e) { setError(e); }
  };

  const ruleBaseFor = (tx) => tx.type === "transfer"
    ? { type: "transfer", account: tx.account, to_account: tx.to_account, amount_cents: tx.amount_cents }
    : { type: "tx", account: tx.account, category: tx.category, amount_cents: tx.amount_cents };

  // Dauerauftrag nachtraeglich aus einer bereits als wiederkehrend markierten
  // Buchung anlegen - gleiche Berechnung wie beim "Automatisch weiterbuchen"-
  // Haekchen in NewEntry.jsx (die gebuchte Periode deckt sich selbst ab, die
  // Regel greift erst ab der naechsten).
  const createRecurringRule = async (tx) => {
    try {
      await api.saveRecurringRule({
        ...ruleBaseFor(tx), payee: tx.payee, note: tx.note, frequency: tx.recurring,
        next_due: api.addMonths(api.dateOnly(tx.date), { monthly: 1, quarterly: 3, yearly: 12 }[tx.recurring]),
        active: true,
      });
      flash("Dauerauftrag angelegt");
      loadReserves();
    } catch (e) { setError(e); }
  };

  // Ob fuer eine Buchung schon ein passender Dauerauftrag existiert - fuer das
  // "Automatisch weiterbuchen"-Haekchen in TxDetail.jsx, damit es den echten
  // Datenstand zeigt statt nur eine in der aktuellen Sitzung selbst angelegte
  // Regel zu erkennen (s. screens/CLAUDE.md, Abschnitt "Daueraufträge").
  const checkRuleExists = async (tx) => {
    if (!tx.recurring) return false;
    const rule = await api.findRecurringRuleFor({ ...ruleBaseFor(tx), payee: tx.payee, frequency: tx.recurring });
    return rule !== null;
  };

  // Freies Tag-Feld: Name gegen die geladene Liste abgleichen (case-insensitiv),
  // sonst neu anlegen. load() danach zieht auch einen frisch angelegten Tag in
  // die App-weite Liste nach, ohne das hier gesondert behandeln zu muessen.
  const addTag = async (tx, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
      const tagId = existing?.id ?? (await api.createTag(trimmed)).id;
      if ((tx.tags ?? []).includes(tagId)) return;
      const updated = await api.updateTransaction(tx.id, { tags: [...(tx.tags ?? []), tagId] });
      setDetail(updated); load();
    } catch (e) { setError(e); }
  };

  const removeTag = async (tx, tagId) => {
    try {
      const updated = await api.updateTransaction(tx.id, { tags: (tx.tags ?? []).filter((id) => id !== tagId) });
      setDetail(updated); load();
    } catch (e) { setError(e); }
  };

  // Nachtraegliches Umwandeln einer importierten Einzelbuchung in eine
  // Umbuchung (TxDetail.jsx) - der CSV-Import sieht immer nur ein Konto pro
  // Datei und kann eine Umbuchung zwischen zwei eigenen Konten deshalb nicht
  // selbst erkennen. Die Richtung ergibt sich aus dem Vorzeichen der
  // bestehenden Buchung: eine Ausgabe wird zur Quelle (account bleibt, neues
  // to_account), eine Einnahme zum Ziel (neues account, to_account bleibt).
  // counterpartId ist optional gesetzt, wenn TxDetail.jsx auf dem Gegenkonto
  // schon eine passende Spiegelbuchung gefunden hat (beide Konten importiert)
  // - die wird mitgeloescht, sonst waere die Umbuchung doppelt gezaehlt.
  const convertToTransfer = async (tx, otherAccountId, counterpartId) => {
    try {
      if (counterpartId) await api.deleteTransaction(counterpartId);
      const patch = tx.amount_cents < 0
        ? { type: "transfer", account: tx.account, to_account: otherAccountId, amount_cents: -tx.amount_cents, category: "" }
        : { type: "transfer", account: otherAccountId, to_account: tx.account, amount_cents: tx.amount_cents, category: "" };
      const updated = await api.updateTransaction(tx.id, patch);
      setDetail(updated);
      flash(counterpartId ? "In Umbuchung umgewandelt, Duplikat gelöscht" : "In Umbuchung umgewandelt");
      load();
    } catch (e) { setError(e); }
  };

  // Nur die Tag-Liste nachladen statt eines vollen reload(): load() setzt
  // kurzzeitig loading=true, was jeden Tab-Screen unmountet (siehe unten,
  // {!loading && ... <Konten/>}) - ein gerade offenes Sheet mit rein lokalem
  // State (z. B. RuleEditor/AutoRuleEditor in Konten.jsx) wuerde dabei
  // schliessen, nur weil man nebenbei einen neuen Tag angelegt hat.
  const reloadTags = () => api.listTags().then(setTags).catch(setError);

  // Diese drei pushen einen History-Eintrag, damit der Zurueck-Button sie
  // wieder schliesst statt die Seite zu verlassen (siehe popstate-Handler
  // oben). Interne Aktualisierungen eines schon offenen Sheets (z. B.
  // setDetail(updated) nach einem Tag-Update) laufen bewusst NICHT darueber,
  // sonst wuerde jede Aenderung einen weiteren Eintrag aufhaeufen.
  const goToTab = (id) => {
    if (id === tab) return;
    history.pushState({ tab: id }, "");
    setTab(id);
  };
  const openSheet = () => { history.pushState({ tab, overlay: "sheet" }, ""); setSheet(true); };
  const openDetail = (tx) => { history.pushState({ tab, overlay: "detail" }, ""); setDetail(tx); };

  const shift = (d) => {
    let m = ym.m + d, y = ym.y;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setYm({ y, m });
  };

  const needsSetup = !loading && !error && accounts.length === 0 && categories.length === 0;

  const shared = {
    accounts, categories, tags, people, transactions: visible, real, spentByCat, spentByTag, budgets,
    incomeEntries, avgExpense, balances, combinedBalances, acc, setAcc, monthKey: key, reload: load, flash, setError, openDetail,
    reservesFor, reserveMonthlyOf, withdrawnThisMonthOf, effectiveLimitOf, reloadReserves: loadReserves,
    depotEnabled, setDepotEnabled, reloadTags,
    defaultAccount, setDefaultAccount: setDefaultAccountAndApply,
    query, setQuery, searchResults, searching,
    minAmount, setMinAmount, maxAmount, setMaxAmount, dateFrom, setDateFrom, dateTo, setDateTo,
    onlyUnbudgeted, setOnlyUnbudgeted, datePreset, setDatePreset,
  };

  // Nur diese drei Screens werten den Monat/Jahr-Zustand (ym) ueberhaupt aus -
  // der Rest (Konten/Depot/Einstellungen) zeigt in der Kopfzeile sonst Pfeile
  // ohne jede Wirkung.
  const MONTH_NAV_TABS = ["buchungen", "auswertung", "budgets"];

  const navItems = [
    { id: "buchungen", label: "Buchungen", Icon: List },
    { id: "auswertung", label: "Auswertung", Icon: PieChart },
    { id: "budgets", label: "Budgets", Icon: Target },
    ...(depotEnabled ? [{ id: "depot", label: "Depot", Icon: TrendingUp }] : []),
    { id: "konten", label: "Konten", Icon: Landmark },
    { id: "einstellungen", label: "Einstellungen", Icon: Settings },
  ];
  // Auf dem Handy hat die Bottom-Nav bei sechs Eintraegen zu wenig Platz
  // ("Einstellungen" als laengstes Label sprengt die Spalte) - Einstellungen
  // zieht dort stattdessen in ein Zahnrad-Icon in der Kopfzeile um (siehe
  // unten), auf dem Desktop bleibt die Sidebar unveraendert vollstaendig.
  const mobileNavItems = navItems.filter((i) => i.id !== "einstellungen");

  // Wer das Depot gerade offen hat und es dann in den Einstellungen
  // ausschaltet, landet sonst auf einem Tab, der aus der Navigation
  // verschwunden ist.
  useEffect(() => {
    if (!depotEnabled && tab === "depot") {
      // Programmierte Korrektur, keine Nutzer-Navigation - den aktuellen
      // History-Eintrag ersetzen statt einen neuen zu pushen, sonst zeigt
      // der oberste Eintrag weiter auf "depot", obwohl schon umgeschaltet ist.
      history.replaceState({ tab: "buchungen" }, "");
      setTab("buchungen");
    }
  }, [depotEnabled, tab]);

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
                <button key={id} onClick={() => goToTab(id)}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left ${
                    active ? "bg-emerald-700/10 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-400 font-medium"
                      : "text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"}`}>
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border ${
                    active ? "bg-emerald-50 dark:bg-emerald-400/10 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                      : "bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400"}`}>
                    <Icon size={15} strokeWidth={iconStroke(active)} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{label}</span>
                    {navBadges[id] && (
                      <span className="block text-xs text-stone-400 dark:text-stone-500 truncate font-mono">{navBadges[id]}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
          {!needsSetup && accounts.length > 0 && (
            <button onClick={openSheet}
              className="mt-6 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-700 dark:bg-emerald-600 text-white text-sm font-medium active:scale-[0.98] transition-transform">
              <Plus size={17} /> Neue Buchung
            </button>
          )}
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden">
          <header className="pt-5 pb-3 border-b border-stone-200 dark:border-stone-700 px-5 relative">
            {/* Mobil: Monatsnavigation ruecken eng an den Titel, damit rechts
                Platz fuers Einstellungen-Zahnrad frei bleibt - vorher sass
                der Pfeil "Monat vor" an derselben Ecke wie das Zahnrad und
                wurde von ihm verdeckt. Ab der Sidebar-Breite (Desktop, kein
                Zahnrad im Header) wieder exakt wie zuvor auf die volle
                Breite gespreizt. */}
            {MONTH_NAV_TABS.includes(tab) ? (
              <div className="flex items-center justify-center gap-1 sidebar:justify-between sidebar:gap-0">
                <button onClick={() => shift(-1)} className="p-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800 sidebar:-ml-1.5">
                  <ChevronLeft size={20} />
                </button>
                <h1 className="text-base font-medium">{MONTHS[ym.m]} {ym.y}</h1>
                <button onClick={() => shift(1)} className="p-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-200/70 dark:hover:bg-stone-800 sidebar:-mr-1.5">
                  <ChevronRight size={20} />
                </button>
              </div>
            ) : (
              // Konten/Depot/Einstellungen haengen an keinem Monat - eine
              // klickbare Monatsnavigation waere hier Attrappe ohne Wirkung.
              <div className="flex items-center justify-center">
                <h1 className="text-base font-medium">{navItems.find((i) => i.id === tab)?.label}</h1>
              </div>
            )}
            {/* Nur mobil - auf dem Desktop ist Einstellungen schon in der
                Sidebar erreichbar, ein zweiter Zugang waere redundant. */}
            <button onClick={() => goToTab("einstellungen")} aria-label="Einstellungen"
              className={`sidebar:hidden absolute right-5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${
                tab === "einstellungen" ? "text-stone-900 dark:text-stone-50" : "text-stone-400 dark:text-stone-500"}`}>
              <Settings size={19} />
            </button>
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
                {tab === "depot" && <Depot {...shared} />}
                {tab === "konten" && <Konten {...shared} />}
                {tab === "einstellungen" && <Einstellungen {...shared} />}
              </>
            )}
          </main>

          {!needsSetup && accounts.length > 0 && (
            <button onClick={openSheet}
              className="sidebar:hidden absolute bottom-[calc(var(--nav-h)+12px)] right-5 w-14 h-14 rounded-full bg-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-900/20 active:scale-95 transition-transform"
              aria-label="Neue Buchung">
              <Plus size={26} />
            </button>
          )}

          <nav className={`sidebar:hidden absolute bottom-0 inset-x-0 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-t border-stone-200 dark:border-stone-700 grid ${
            mobileNavItems.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
            {mobileNavItems.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button key={id} onClick={() => goToTab(id)}
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
              onClose={() => history.back()}
              onSaved={(msg) => { flash(msg); load(); loadReserves(); }} />
          )}

          {detail && (
            <TxDetail key={detail.id} tx={detail} accounts={accounts} categories={categories} tags={tags}
              onClose={() => history.back()} onDelete={removeTx}
              onUpdateRecurring={updateRecurring} onCreateRecurringRule={createRecurringRule} onCheckRuleExists={checkRuleExists}
              onUpdateCategory={updateCategory} onAddTag={addTag} onRemoveTag={removeTag}
              onConvertToTransfer={convertToTransfer} />
          )}

          {autoBooked && (
            <Sheet title="Automatisch gebucht" onClose={() => history.back()}>
              <p className="text-sm text-stone-600 dark:text-stone-300 mb-1">
                {autoBooked.rows.length} {autoBooked.rows.length === 1 ? "wiederkehrende Buchung wurde" : "wiederkehrende Buchungen wurden"} beim Öffnen aus fälligen Daueraufträgen nachgebucht:
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500 mb-4">
                Geprüft: {autoBooked.checkedAt.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
              </p>
              <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                {autoBooked.rows.map((t) => (
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
