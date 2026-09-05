import { useEffect, useState } from "react";
import { Plus, ChevronRight, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import * as api from "../pb.js";
import { money, ErrorNote, Spinner, Sheet, Button, Field, inputCls, todayISO } from "../ui.jsx";

const fmtQty = (q) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 }).format(q ?? 0);

// 3 Monate taeglich (fein genug fuer kurzfristige Bewegung), 3/5 Jahre
// woechentlich (taeglich waere ueber Jahre unnoetig viele Punkte).
const CHART_RANGES = {
  "3mo": { label: "3M", span: "3mo", interval: "1d" },
  "3y": { label: "3J", span: "3y", interval: "1wk" },
  "5y": { label: "5J", span: "5y", interval: "1wk" },
};

// Bestand und Ø-Einstandspreis nach der Durchschnittsmethode: jeder Kauf
// erhoeht Stueckzahl und Einstand, jeder Verkauf reduziert beides im
// Verhaeltnis zum bisherigen Durchschnittspreis (nicht nach FIFO/LIFO -
// fuer ein privates Depot reicht das, und es bleibt nachvollziehbar).
//
// Trade-Preise (price_cents) sind IMMER Euro - genau wie ueberall sonst
// in der App ("Beträge sind ganzzahlige Cent", CLAUDE.md), das ist der
// Preis, den man tatsaechlich gezahlt hat, unabhaengig davon, an welcher
// Boerse und in welcher Waehrung das Wertpapier notiert. Costcents ist
// deshalb immer EUR-nativ, ohne jede Umrechnung.
//
// Der LIVE-Kurs dagegen kommt von Yahoo in dessen eigener Handelswaehrung
// (z. B. USD, wenn die Suche eine Londoner statt eine Xetra-Notierung
// trifft) - fuer einen fairen Vergleich mit dem Euro-Einstand wird nur
// dieser eine Wert per fxRate nach Euro umgerechnet (1 Einheit der
// Kurswaehrung -> X Euro, vom selben Yahoo-Kurs-Proxy geholt, z. B. Ticker
// "USDEUR=X"). Frueher wurden Einstand UND Kurs an derselben Waehrung
// aufgehaengt - das mischte "was ich bezahlt habe" mit "wo das Papier
// notiert" und ergab falsche Gewinne, sobald beide auseinanderfielen.
//
// Ohne (noch nicht geholten) Kurs oder Wechselkurs bleiben die
// Euro-Wert-Felder null, nie 0 - sonst wuerde eine fehlende Umrechnung wie
// ein echter Nullwert aussehen.
// Wiederverwendet fuer den Verlaufs-Chart: Bestand/Einstand nicht zum
// aktuellen Zeitpunkt, sondern zu einem beliebigen Stichtag (nur Trades
// bis einschliesslich asOfDate zaehlen mit). Ohne asOfDate = heutiger Stand.
function quantityAndCostAsOf(trades, positionId, asOfDate) {
  const own = trades
    .filter((t) => t.position === positionId && (!asOfDate || api.dateOnly(t.date) <= asOfDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  let qty = 0, costCents = 0;
  for (const t of own) {
    if (t.type === "buy") {
      qty += t.quantity;
      costCents += t.quantity * t.price_cents + (t.fees_cents ?? 0);
    } else {
      const avg = qty > 0 ? costCents / qty : 0;
      qty -= t.quantity;
      costCents -= avg * t.quantity;
    }
  }
  return { qty, costCents };
}

function positionStats(positionId, trades, quote, fallbackCurrency, fxRate) {
  const { qty, costCents } = quantityAndCostAsOf(trades, positionId, null);
  const priceCurrency = quote?.currency ?? fallbackCurrency ?? "EUR";
  const priceCents = quote?.price_cents ?? null; // in priceCurrency
  const priceNativeValueCents = priceCents != null ? qty * priceCents : null; // in priceCurrency

  const rate = priceCurrency === "EUR" ? 1 : fxRate;
  const valueEurCents = priceNativeValueCents != null && rate != null ? priceNativeValueCents * rate : null;
  const gainEurCents = valueEurCents != null ? valueEurCents - costCents : null;
  const gainEurPct = valueEurCents != null && costCents > 0 ? (gainEurCents / costCents) * 100 : null;

  return {
    qty, costCents, priceCents, priceCurrency, priceNativeValueCents,
    valueEurCents, gainEurCents, gainEurPct,
  };
}

const fmtChartDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

// Historische Kursreihen fuer eine beliebige Liste von Positionen laden und
// zu Wert-/Einstands-Reihen zusammenfassen - dieselbe Funktion bedient
// sowohl den Portfolio-Chart (alle aktiven Positionen) als auch den
// Positions-Chart (eine einzelne Position). enabled=false (Chart
// eingeklappt) laesst Yahoo in Ruhe, kein Request ohne Bedarf.
function useDepotChart({ positions, trades, fxRates, setFxRates, enabled }) {
  const [range, setRange] = useState("3mo");
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const withTicker = positions.filter((p) => !p.archived && p.ticker);
  const tickerKey = withTicker.map((p) => p.id).join(",");

  useEffect(() => {
    if (!enabled) return;
    if (withTicker.length === 0) { setSeries({ dates: [], values: [], costs: [] }); return; }
    let cancelled = false;

    (async () => {
      setLoading(true); setError(null);
      try {
        const { span, interval } = CHART_RANGES[range];
        const histories = await Promise.all(withTicker.map(async (p) => {
          const h = await api.fetchHistory(p.ticker, span, interval);
          return {
            position: p, currency: h.currency,
            points: h.points.map((pt) => ({ date: new Date(pt.t * 1000).toISOString().slice(0, 10), price: pt.price })),
          };
        }));

        const neededCurrencies = [...new Set(histories.map((h) => h.currency).filter((c) => c && c !== "EUR"))];
        const missing = neededCurrencies.filter((c) => fxRates[c] == null);
        let rates = fxRates;
        if (missing.length) {
          const updates = {};
          for (const cur of missing) {
            try { updates[cur] = (await api.fetchQuote({ ticker: `${cur}EUR=X` })).price; }
            catch { /* fehlender Wechselkurs blockiert nur diese eine Waehrung im Chart */ }
          }
          rates = { ...fxRates, ...updates };
          setFxRates((prev) => ({ ...prev, ...updates }));
        }

        const allDates = [...new Set(histories.flatMap((h) => h.points.map((pt) => pt.date)))].sort();
        const values = [];
        const costs = [];
        for (const date of allDates) {
          let totalV = 0, totalC = 0;
          for (const h of histories) {
            const { qty, costCents } = quantityAndCostAsOf(trades, h.position.id, date);
            if (qty === 0 && costCents === 0) continue;
            totalC += costCents;
            // Letzten bekannten Kurs bei oder vor "date" nehmen (forward-fill) -
            // nicht jede Boerse hat an jedem Tag einen Datenpunkt.
            let price = null;
            for (let i = h.points.length - 1; i >= 0; i--) {
              if (h.points[i].date <= date) { price = h.points[i].price; break; }
            }
            const rate = h.currency === "EUR" ? 1 : rates[h.currency];
            if (price != null && rate != null) totalV += qty * price * rate * 100;
          }
          values.push(totalV);
          costs.push(totalC);
        }
        if (!cancelled) setSeries({ dates: allDates, values, costs });
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, range, tickerKey, trades.length]);

  return { range, setRange, series, loading, error };
}

// Wert- und Einstands-Verlauf als einfacher SVG-Linienchart, kein
// Diagramm-Paket - passt zum Rest der App (YearBars in Auswertung.jsx ist
// dasselbe Prinzip: reines SVG/CSS statt einer neuen Abhaengigkeit).
// Eingeklappt per Default (Chevron-Muster wie "Sparquote" in
// Auswertung.jsx) - laedt seine Daten deshalb erst beim Aufklappen, nicht
// beim Rendern. positions bestimmt den Umfang: alle aktiven Positionen fuer
// den Portfolio-Chart, eine einzelne fuer den Positions-Chart.
function DepotChart({ positions, trades, fxRates, setFxRates }) {
  const [expanded, setExpanded] = useState(false);
  const { range, setRange, series, loading, error } = useDepotChart({ positions, trades, fxRates, setFxRates, enabled: expanded });
  const hasData = series && series.dates.length > 1;
  const empty = series && series.dates.length <= 1;

  return (
    <div className="mb-5">
      <button onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 mb-3">
        <ChevronRight size={13} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        Verlauf {expanded ? "ausblenden" : "anzeigen"}
      </button>

      {expanded && (
        <>
          <div className="flex justify-end mb-3">
            <div className="inline-flex rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
              {Object.entries(CHART_RANGES).map(([key, { label }], i) => (
                <button key={key} onClick={() => setRange(key)}
                  className={`px-3 py-1 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
                    range === key ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ErrorNote error={error} />
          {loading && <p className="text-xs text-stone-400 dark:text-stone-500 py-8 text-center">Verlauf wird geladen …</p>}
          {!loading && empty && (
            <p className="text-xs text-stone-400 dark:text-stone-500 py-8 text-center">
              Noch keine Verlaufsdaten — brauchst mindestens einen Trade mit Ticker.
            </p>
          )}

          {!loading && hasData && (() => {
            const all = [...series.values, ...series.costs];
            const min = Math.min(...all), max = Math.max(...all);
            const span = max - min || 1;
            const toY = (v) => 96 - ((v - min) / span) * 92; // 2..96, etwas Rand oben/unten
            const toX = (i) => (i / (series.dates.length - 1)) * 300;
            const valuePts = series.values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
            const costPts = series.costs.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
            return (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="w-3 h-[3px] rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" /> Wert
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="w-3 h-[3px] rounded-full bg-stone-400 dark:bg-stone-500 inline-block" /> Einstand
                  </span>
                </div>
                <svg viewBox="0 0 300 100" preserveAspectRatio="none"
                  className="w-full h-32 bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
                  <polyline points={costPts} fill="none" strokeDasharray="5 4" strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke" className="stroke-stone-400 dark:stroke-stone-500" />
                  <polyline points={valuePts} fill="none" strokeWidth="2"
                    vectorEffect="non-scaling-stroke" className="stroke-emerald-600 dark:stroke-emerald-500" />
                </svg>
                <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 mt-1">
                  <span>{fmtChartDate(series.dates[0])}</span>
                  <span>{fmtChartDate(series.dates[series.dates.length - 1])}</span>
                </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}

export default function Depot({ flash }) {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [fxRates, setFxRates] = useState({}); // { USD: 0.86, ... } - 1 Einheit -> Euro
  const [quoting, setQuoting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingPosition, setEditingPosition] = useState(null);
  const [viewingPositionId, setViewingPositionId] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    return Promise.all([api.listDepotPositions(), api.listDepotTrades()])
      .then(([p, t]) => { setPositions(p); setTrades(t); return p; })
      .catch((e) => { setError(e); return []; })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Kurse einmal beim Oeffnen automatisch ziehen, kein Hintergrund-Polling
  // danach - derselbe "client-getriggert statt Cron"-Ansatz wie bei den
  // Daueraufträgen. "Aktualisieren" holt bei Bedarf erneut.
  const refreshQuotes = async (list) => {
    const withTicker = list.filter((p) => p.ticker);
    if (withTicker.length === 0) return;
    setQuoting(true);
    const updates = {};
    for (const p of withTicker) {
      try { updates[p.id] = await api.fetchQuote({ ticker: p.ticker }); }
      catch { /* eine nicht erreichbare Position blockiert die anderen nicht */ }
    }
    setQuotes((prev) => ({ ...prev, ...updates }));

    // Fuer jede fremde Handelswaehrung einmal den Euro-Kurs holen (derselbe
    // Kurs-Proxy, Yahoo fuehrt Waehrungspaare als ganz normale Ticker, z. B.
    // "USDEUR=X") - nicht pro Position, mehrere Positionen teilen sich oft
    // dieselbe Waehrung.
    const currencies = [...new Set(Object.values(updates).map((q) => q.currency).filter((c) => c && c !== "EUR"))];
    if (currencies.length) {
      const fxUpdates = {};
      for (const cur of currencies) {
        try { fxUpdates[cur] = (await api.fetchQuote({ ticker: `${cur}EUR=X` })).price; }
        catch { /* fehlender Wechselkurs blockiert nur die Umrechnung dieser einen Waehrung */ }
      }
      setFxRates((prev) => ({ ...prev, ...fxUpdates }));
    }
    setQuoting(false);
  };
  useEffect(() => { if (positions.length) refreshQuotes(positions); }, [positions.length]);

  const active = positions.filter((p) => !p.archived);
  const statsOf = (p) => positionStats(p.id, trades, quotes[p.id], p.currency, fxRates[quotes[p.id]?.currency ?? p.currency]);

  // Einstand ist immer Euro-nativ (siehe positionStats), zaehlt also sofort
  // vollstaendig. Beim aktuellen Wert zaehlt eine Position erst mit, sobald
  // ihr Kurs (und bei Fremdwaehrung: der Wechselkurs) tatsaechlich da ist -
  // sonst wuerde ein kurzzeitig fehlender Kurs wie ein echter Nullwert
  // aussehen und die Summe verfaelschen.
  const totalCost = active.reduce((s, p) => s + statsOf(p).costCents, 0);
  const pendingCount = active.filter((p) => statsOf(p).qty > 0 && statsOf(p).valueEurCents == null).length;
  const totalValue = active.reduce((s, p) => s + (statsOf(p).valueEurCents ?? 0), 0);
  const totalGain = totalValue - totalCost;

  const viewingPosition = positions.find((p) => p.id === viewingPositionId) ?? null;

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">Depot</p>
      <ErrorNote error={error} />
      {loading && <Spinner />}

      {!loading && (
        <>
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-3">
            {[
              ["Aktueller Wert", money(totalValue), ""],
              ["Einstand", money(totalCost), ""],
              ["Gewinn/Verlust", `${totalGain < 0 ? "−" : "+"}${money(Math.abs(totalGain))}`,
                totalGain < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"],
            ].map(([label, val, cls]) => (
              <div key={label} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-stone-600 dark:text-stone-300">{label}</span>
                <span className={`font-medium tabular-nums ${cls}`}>{val}</span>
              </div>
            ))}
          </div>

          {pendingCount > 0 && (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-4 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {pendingCount} {pendingCount === 1 ? "Position" : "Positionen"} in Fremdwährung noch nicht
              im Gesamtwert enthalten — Wechselkurs wird noch geholt.
            </p>
          )}

          <DepotChart positions={active} trades={trades} fxRates={fxRates} setFxRates={setFxRates} />

          <button onClick={() => refreshQuotes(positions)} disabled={quoting}
            className="w-full flex items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-400 mb-4 py-1 disabled:opacity-50">
            <RefreshCw size={13} className={quoting ? "animate-spin" : ""} />
            {quoting ? "Kurse werden geholt …" : "Kurse aktualisieren"}
          </button>

          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
            {active.map((p) => {
              const s = statsOf(p);
              return (
                <button key={p.id} onClick={() => setViewingPositionId(p.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">{p.name}</span>
                    <span className="block text-xs text-stone-500 dark:text-stone-400 tabular-nums">
                      {p.isin} · {fmtQty(s.qty)} Stk.
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-medium tabular-nums">
                      {s.valueEurCents != null ? money(s.valueEurCents) : "–"}
                    </span>
                    {s.priceCurrency !== "EUR" && (
                      <span className="block text-xs text-stone-400 dark:text-stone-500 tabular-nums">
                        {s.priceNativeValueCents != null ? money(s.priceNativeValueCents, s.priceCurrency) : "Kurs folgt …"}
                      </span>
                    )}
                    {s.gainEurCents != null && (
                      <span className={`block text-xs tabular-nums ${
                        s.gainEurCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {s.gainEurCents < 0 ? "−" : "+"}{money(Math.abs(s.gainEurCents))}
                        {s.gainEurPct != null && ` · ${s.gainEurPct >= 0 ? "+" : ""}${s.gainEurPct.toFixed(1)}%`}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="text-stone-300 dark:text-stone-600 shrink-0" />
                </button>
              );
            })}
            {active.length === 0 && (
              <p className="px-3.5 py-3 text-sm text-stone-500 dark:text-stone-400">Noch keine Depot-Positionen.</p>
            )}
          </div>

          <Button variant="ghost"
            onClick={() => setEditingPosition({ id: "", isin: "", name: "", ticker: "", currency: "", archived: false })}
            className="w-full mt-3 flex items-center justify-center gap-2">
            <Plus size={16} /> Position hinzufügen
          </Button>
        </>
      )}

      {viewingPosition && (
        <PositionDetail position={viewingPosition} trades={trades.filter((t) => t.position === viewingPosition.id)}
          quote={quotes[viewingPosition.id]}
          fxRate={fxRates[quotes[viewingPosition.id]?.currency ?? viewingPosition.currency]}
          fxRates={fxRates} setFxRates={setFxRates}
          quoting={quoting}
          onClose={() => setViewingPositionId(null)}
          onEdit={() => setEditingPosition(viewingPosition)}
          onRefreshQuote={() => refreshQuotes([viewingPosition])}
          onReload={load} flash={flash} setError={setError} />
      )}

      {editingPosition && (
        // Nach viewingPosition gerendert, damit der Editor sich beim
        // Bearbeiten aus dem Detail-Sheet sichtbar davor stapelt statt
        // dahinter zu verschwinden (DOM-Reihenfolge = Stapel-Reihenfolge,
        // beide Sheets teilen sich dieselbe absolute Positionierung).
        <PositionEditor draft={editingPosition} onClose={() => setEditingPosition(null)}
          onSaved={(m) => { setEditingPosition(null); setViewingPositionId(null); flash(m); load(); }}
          onError={setError} />
      )}
    </div>
  );
}

function PositionEditor({ draft, onClose, onSaved, onError }) {
  const isNew = !draft.id;
  const [isin, setIsin] = useState(draft.isin);
  const [name, setName] = useState(draft.name);
  const [ticker, setTicker] = useState(draft.ticker ?? "");
  const [currency, setCurrency] = useState(draft.currency ?? "");
  const [archived, setArchived] = useState(draft.archived ?? false);
  const [resolving, setResolving] = useState(false);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isNew) api.countDepotTradesByPosition(draft.id).then(setUsage).catch(() => setUsage(null));
  }, [draft.id, isNew]);

  const resolveTicker = async () => {
    if (!isin.trim()) return setError("ISIN eingeben");
    setResolving(true); setError(null);
    try {
      const q = await api.fetchQuote({ isin: isin.trim().toUpperCase() });
      setTicker(q.symbol);
      setCurrency(q.currency);
      if (!name.trim() && q.name) setName(q.name);
    } catch {
      setError("Kein Ticker gefunden — trag ihn unten manuell ein, falls bekannt.");
    } finally { setResolving(false); }
  };

  const submit = async () => {
    if (!isin.trim()) return setError("ISIN eingeben");
    if (!name.trim()) return setError("Name eingeben");
    setBusy(true);
    try {
      await api.saveDepotPosition({
        id: draft.id || undefined,
        isin: isin.trim().toUpperCase(), name: name.trim(),
        ticker: ticker.trim(), currency: currency.trim().toUpperCase(), archived,
      });
      onSaved(isNew ? "Position angelegt" : "Position gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteDepotPosition(draft.id); onSaved("Position gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neue Position" : "Position bearbeiten"} onClose={onClose}>
      <Field label="ISIN">
        <div className="flex gap-2">
          <input value={isin} onChange={(e) => { setIsin(e.target.value); setError(null); }}
            placeholder="IE00B4L5Y983" className={`${inputCls} uppercase`} />
          <Button variant="ghost" onClick={resolveTicker} disabled={resolving} className="px-3 shrink-0 text-xs">
            {resolving ? "Sucht …" : "Ticker suchen"}
          </Button>
        </div>
      </Field>

      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="iShares Core MSCI World …" className={inputCls} />
      </Field>

      <Field label="Ticker (Yahoo Finance)">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)}
          placeholder="z. B. EUNL.DE" className={inputCls} />
      </Field>
      <p className="text-xs text-stone-400 dark:text-stone-500 -mt-3 mb-4">
        "Ticker suchen" trifft nicht immer die Börse mit Euro-Notierung (z. B. London statt Xetra) —
        bei Bedarf hier von Hand auf den Xetra-Ticker (Endung ".DE") ändern.
      </p>

      <Field label="Handelswährung (Anzeige des Live-Kurses)">
        <input value={currency} onChange={(e) => setCurrency(e.target.value)}
          placeholder="EUR" className={`${inputCls} uppercase w-24!`} />
      </Field>
      <p className="text-xs text-stone-400 dark:text-stone-500 -mt-3 mb-4">
        Nur für die Anzeige des Live-Kurses, bevor er zum ersten Mal geholt wurde — der wird danach
        ohnehin live überschrieben. Trades erfasst du immer in Euro, unabhängig davon.
      </p>

      {!isNew && (
        <>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Status</p>
          <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
            {[[false, "Aktiv"], [true, "Archiviert"]].map(([v, label], i) => (
              <button key={String(v)} onClick={() => setArchived(v)}
                className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
                  archived === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && usage != null && (usage > 0 ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 flex items-start gap-1.5 px-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Löschen geht erst, wenn {usage === 1 ? "der 1 Trade" : `alle ${usage} Trades`} dieser Position
          gelöscht {usage === 1 ? "ist" : "sind"} — archivieren geht jederzeit.
        </p>
      ) : (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Position löschen
        </Button>
      ))}
    </Sheet>
  );
}

function PositionDetail({ position, trades, quote, fxRate, fxRates, setFxRates, quoting, onClose, onEdit, onRefreshQuote, onReload, flash, setError }) {
  const [editingTrade, setEditingTrade] = useState(null);
  const s = positionStats(position.id, trades, quote, position.currency, fxRate);
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));
  const foreign = s.priceCurrency !== "EUR";

  const rows = [
    ["Bestand", `${fmtQty(s.qty)} Stk.`, ""],
    ["Kurs", s.priceCents != null ? money(s.priceCents, s.priceCurrency) : "–", ""],
  ];
  if (foreign) rows.push(["Aktueller Wert (" + s.priceCurrency + ")",
    s.priceNativeValueCents != null ? money(s.priceNativeValueCents, s.priceCurrency) : "–", "text-stone-500 dark:text-stone-400"]);
  rows.push(["Aktueller Wert", s.valueEurCents != null ? money(s.valueEurCents) : "Kurs folgt …", ""]);
  rows.push(["Einstand", money(s.costCents), ""]);
  rows.push(["Gewinn/Verlust", s.gainEurCents != null
    ? `${s.gainEurCents < 0 ? "−" : "+"}${money(Math.abs(s.gainEurCents))}${s.gainEurPct != null ? ` · ${s.gainEurPct >= 0 ? "+" : ""}${s.gainEurPct.toFixed(1)}%` : ""}`
    : "Kurs folgt …",
    s.gainEurCents == null ? "" : s.gainEurCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"]);

  return (
    <Sheet title={position.name} onClose={onClose}>
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
        {position.isin}{position.ticker && ` · ${position.ticker}`}
      </p>

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-4">
        {rows.map(([label, val, cls], i) => (
          <div key={i} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-stone-600 dark:text-stone-300">{label}</span>
            <span className={`font-medium tabular-nums ${cls}`}>{val}</span>
          </div>
        ))}
      </div>

      <DepotChart positions={[position]} trades={trades} fxRates={fxRates} setFxRates={setFxRates} />

      <div className="flex gap-2 mb-5">
        <Button variant="ghost" onClick={onEdit} className="flex-1">Bearbeiten</Button>
        <Button variant="ghost" onClick={onRefreshQuote} disabled={quoting} className="flex-1 flex items-center justify-center gap-1.5">
          <RefreshCw size={14} className={quoting ? "animate-spin" : ""} /> Kurs
        </Button>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">Trades</p>
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
        {sorted.map((t) => (
          <button key={t.id} onClick={() => setEditingTrade(t)}
            className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
            <span className="flex-1 min-w-0">
              <span className="block text-sm">{t.type === "buy" ? "Kauf" : "Verkauf"} · {fmtQty(t.quantity)} Stk.</span>
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                {new Date(api.dateOnly(t.date) + "T12:00:00").toLocaleDateString("de-DE")} · {money(t.price_cents)}/Stk.
              </span>
            </span>
            <ChevronRight size={16} className="text-stone-300 dark:text-stone-600 shrink-0" />
          </button>
        ))}
        {sorted.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-stone-500 dark:text-stone-400">Noch keine Trades.</p>
        )}
      </div>

      <Button variant="ghost"
        onClick={() => setEditingTrade({ id: "", position: position.id, date: todayISO(), type: "buy", quantity: "", price_cents: 0, fees_cents: 0, note: "" })}
        className="w-full mt-3 flex items-center justify-center gap-2">
        <Plus size={16} /> Trade hinzufügen
      </Button>

      {editingTrade && (
        <TradeEditor draft={editingTrade} onClose={() => setEditingTrade(null)}
          onSaved={(m) => { setEditingTrade(null); flash(m); onReload(); }}
          onError={setError} />
      )}
    </Sheet>
  );
}

function TradeEditor({ draft, onClose, onSaved, onError }) {
  const isNew = !draft.id;
  const [type, setType] = useState(draft.type);
  const [date, setDate] = useState(draft.date ? api.dateOnly(draft.date) : todayISO());
  const [quantity, setQuantity] = useState(draft.quantity || "");
  const [price, setPrice] = useState(draft.price_cents ? draft.price_cents / 100 : "");
  const [fees, setFees] = useState(draft.fees_cents ? draft.fees_cents / 100 : "");
  const [note, setNote] = useState(draft.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const qty = Number(quantity);
    const priceCents = Math.round((Number(price) || 0) * 100);
    if (!qty || qty <= 0) return setError("Stückzahl eingeben");
    if (priceCents <= 0) return setError("Kurs eingeben");
    setBusy(true);
    try {
      await api.saveDepotTrade({
        id: draft.id || undefined, position: draft.position, date, type, quantity: qty,
        price_cents: priceCents, fees_cents: Math.round((Number(fees) || 0) * 100), note: note.trim(),
      });
      onSaved(isNew ? "Trade erfasst" : "Trade gesichert");
    } catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteDepotTrade(draft.id); onSaved("Trade gelöscht"); }
    catch (e) { onError(e); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={isNew ? "Neuer Trade" : "Trade bearbeiten"} onClose={onClose}>
      <div className="inline-flex mb-4 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[["buy", "Kauf"], ["sell", "Verkauf"]].map(([v, label], i) => (
          <button key={v} onClick={() => setType(v)}
            className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              type === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <Field label="Datum">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
      </Field>

      <Field label="Stückzahl">
        <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)}
          className={`${inputCls} tabular-nums`} />
      </Field>

      <Field label="Kurs pro Stück (in Euro)">
        <div className="flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">€</span>
        </div>
      </Field>
      <p className="text-xs text-stone-400 dark:text-stone-500 -mt-3 mb-4">
        Der Preis, den du tatsächlich bezahlt hast, in Euro — unabhängig davon, in welcher Währung
        das Wertpapier an seiner Börse notiert.
      </p>

      <Field label="Gebühren (optional, in Euro)">
        <div className="flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">€</span>
        </div>
      </Field>

      <Field label="Notiz (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </Field>

      <ErrorNote error={error} />
      <Button onClick={submit} disabled={busy} className="w-full">Speichern</Button>

      {!isNew && (
        <Button variant="danger" onClick={remove} disabled={busy}
          className="w-full mt-3 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Trade löschen
        </Button>
      )}
    </Sheet>
  );
}
