import { useEffect, useState } from "react";
import { Plus, ChevronRight, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import * as api from "../pb.js";
import { money, ErrorNote, Spinner, Sheet, Button, Field, inputCls, todayISO } from "../ui.jsx";

const fmtQty = (q) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 }).format(q ?? 0);

// Bestand und Ø-Einstandspreis nach der Durchschnittsmethode: jeder Kauf
// erhoeht Stueckzahl und Einstand, jeder Verkauf reduziert beides im
// Verhaeltnis zum bisherigen Durchschnittspreis (nicht nach FIFO/LIFO -
// fuer ein privates Depot reicht das, und es bleibt nachvollziehbar).
//
// fxRate rechnet Wert und Einstand zusaetzlich in Euro um (1 Einheit der
// Positionswaehrung -> X Euro, vom selben Yahoo-Kurs-Proxy geholt wie die
// Kurse selbst, z. B. Ticker "USDEUR=X"). Bewusst eine einzige, aktuelle
// Umrechnung fuer Wert UND Einstand statt historischer Kurse zum jeweiligen
// Kaufzeitpunkt - eine Momentaufnahme, kein separates Fremdwaehrungs-
// Gewinn/Verlust-Tracking. Ohne (noch nicht geholten) Kurs bleiben die
// Euro-Felder null, nie 0 - sonst wuerde eine fehlende Umrechnung wie ein
// echter Nullwert aussehen.
function positionStats(positionId, trades, quote, fallbackCurrency, fxRate) {
  const own = [...trades].filter((t) => t.position === positionId).sort((a, b) => a.date.localeCompare(b.date));
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
  const currency = quote?.currency ?? fallbackCurrency;
  const priceCents = quote?.price_cents ?? null;
  const valueCents = priceCents != null ? qty * priceCents : null;
  const gainCents = valueCents != null ? valueCents - costCents : null;
  const gainPct = valueCents != null && costCents > 0 ? (gainCents / costCents) * 100 : null;

  const rate = currency === "EUR" ? 1 : fxRate;
  const valueEurCents = valueCents != null && rate != null ? valueCents * rate : null;
  const costEurCents = rate != null ? costCents * rate : null;
  const gainEurCents = valueEurCents != null && costEurCents != null ? valueEurCents - costEurCents : null;

  return {
    qty, costCents, priceCents, valueCents, gainCents, gainPct, currency,
    valueEurCents, costEurCents, gainEurCents,
  };
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

  // Nur Positionen mit bekannter Euro-Umrechnung fliessen in die Summe ein -
  // waehrend ein Fremdwaehrungs-Kurs noch unterwegs ist, zaehlt sie kurz
  // nicht mit, statt mit einem falschen Zwischenwert die Summe zu verfaelschen.
  const convertible = active.filter((p) => statsOf(p).valueEurCents != null || statsOf(p).qty === 0);
  const totalValue = convertible.reduce((s, p) => s + (statsOf(p).valueEurCents ?? 0), 0);
  const totalCost = convertible.reduce((s, p) => s + (statsOf(p).costEurCents ?? 0), 0);
  const totalGain = totalValue - totalCost;
  const pendingCount = active.length - convertible.length;

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
                      {s.valueCents != null ? money(s.valueCents, s.currency) : "–"}
                    </span>
                    {s.currency !== "EUR" && (
                      <span className="block text-xs text-stone-400 dark:text-stone-500 tabular-nums">
                        {s.valueEurCents != null ? `≈ ${money(s.valueEurCents)}` : "Kurs folgt …"}
                      </span>
                    )}
                    {s.gainCents != null && (
                      <span className={`block text-xs tabular-nums ${
                        s.gainCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {s.gainCents < 0 ? "−" : "+"}{money(Math.abs(s.gainCents), s.currency)}
                        {s.gainPct != null && ` · ${s.gainPct >= 0 ? "+" : ""}${s.gainPct.toFixed(1)}%`}
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

      <Field label="Handelswährung">
        <input value={currency} onChange={(e) => setCurrency(e.target.value)}
          placeholder="EUR" className={`${inputCls} uppercase w-24!`} />
      </Field>

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

function PositionDetail({ position, trades, quote, fxRate, quoting, onClose, onEdit, onRefreshQuote, onReload, flash, setError }) {
  const [editingTrade, setEditingTrade] = useState(null);
  const s = positionStats(position.id, trades, quote, position.currency, fxRate);
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));
  const foreign = s.currency !== "EUR";

  const rows = [
    ["Bestand", `${fmtQty(s.qty)} Stk.`, ""],
    ["Kurs", s.priceCents != null ? money(s.priceCents, s.currency) : "–", ""],
    ["Aktueller Wert", s.valueCents != null ? money(s.valueCents, s.currency) : "–", ""],
  ];
  if (foreign) rows.push(["… in Euro", s.valueEurCents != null ? `≈ ${money(s.valueEurCents)}` : "Kurs folgt …", "text-stone-500 dark:text-stone-400"]);
  rows.push(["Einstand", money(s.costCents, s.currency), ""]);
  if (foreign && s.costEurCents != null) rows.push(["… in Euro", `≈ ${money(s.costEurCents)}`, "text-stone-500 dark:text-stone-400"]);
  const gainVal = foreign ? s.gainEurCents : s.gainCents;
  rows.push(["Gewinn/Verlust", s.gainCents != null
    ? `${s.gainCents < 0 ? "−" : "+"}${money(Math.abs(s.gainCents), s.currency)}${s.gainPct != null ? ` · ${s.gainPct >= 0 ? "+" : ""}${s.gainPct.toFixed(1)}%` : ""}`
    : "–",
    s.gainCents == null ? "" : s.gainCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"]);
  if (foreign) rows.push(["… in Euro", gainVal != null ? `${gainVal < 0 ? "−" : "+"}${money(Math.abs(gainVal))}` : "Kurs folgt …",
    gainVal == null ? "text-stone-500 dark:text-stone-400" : gainVal < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"]);

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
                {new Date(api.dateOnly(t.date) + "T12:00:00").toLocaleDateString("de-DE")} · {money(t.price_cents, position.currency)}/Stk.
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
        <TradeEditor draft={editingTrade} currency={position.currency || "EUR"} onClose={() => setEditingTrade(null)}
          onSaved={(m) => { setEditingTrade(null); flash(m); onReload(); }}
          onError={setError} />
      )}
    </Sheet>
  );
}

function TradeEditor({ draft, currency, onClose, onSaved, onError }) {
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

      <Field label="Kurs pro Stück">
        <div className="flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">{currency}</span>
        </div>
      </Field>

      <Field label="Gebühren (optional)">
        <div className="flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)}
            className={`${inputCls} tabular-nums`} />
          <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">{currency}</span>
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
