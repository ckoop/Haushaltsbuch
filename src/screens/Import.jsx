import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, FileUp, AlertTriangle, Check, Undo2 } from "lucide-react";
import * as api from "../pb.js";
import * as csv from "../csv.js";
import {
  eur, byId, typeIcon, inputCls, Field, Button, ErrorNote, Spinner, UNKNOWN_CAT, UNKNOWN_TAG,
} from "../ui.jsx";

const STEPS = ["Datei", "Zuordnung", "Vorschau"];

export default function Import({ accounts, categories, tags, onBack, flash }) {
  // Ein Bank-Export landet immer auf einem echten Konto, nie auf einem
  // virtuellen Unterkonto (Sparziel) - das kennt die Bank gar nicht.
  const realAccounts = accounts.filter((a) => !a.parent_account);

  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState(null);
  const [buffer, setBuffer] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);

  const [opts, setOpts] = useState({
    encoding: "windows-1252", delimiter: "semicolon",
    date_format: "dd.MM.yyyy", decimal_comma: true,
  });
  const [mapping, setMapping] = useState({
    col_date: "", col_amount: "", col_payee: "", col_purpose: "", col_reference: "",
  });
  const [account, setAccount] = useState(realAccounts[0]?.id ?? "");
  const [rows, setRows] = useState([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [known, setKnown] = useState(new Set());
  const [possibleDupes, setPossibleDupes] = useState(new Set());
  const [excluded, setExcluded] = useState(new Set());
  const [statementBalance, setStatementBalance] = useState(null);
  const [balanceBefore, setBalanceBefore] = useState(null);
  const [progress, setProgress] = useState(null);
  // Manuelle Zuordnung fuer Zeilen ohne Regel-Treffer, je Zeilen-Hash:
  // { category, saveRule }. saveRule legt beim Import zusaetzlich eine
  // Regel an, damit derselbe Empfaenger kuenftig automatisch zugeordnet wird.
  const [manualCats, setManualCats] = useState({});
  // Freie Notiz zu diesem Import (z. B. "3 vorgemerkte Umsaetze, 34,07 EUR")
  // - hilft beim spaeteren Nachvollziehen einer Kontostand-Abweichung.
  const [note, setNote] = useState("");

  useEffect(() => {
    Promise.all([api.listProfiles(), api.listRules(), api.listImportRuns()])
      .then(([p, r, u]) => { setProfiles(p); setRules(r); setRuns(u); })
      .catch(setError);
  }, []);

  const text = useMemo(
    () => (buffer ? csv.decodeFile(buffer, opts.encoding) : ""),
    [buffer, opts.encoding]
  );
  const parsed = useMemo(
    () => (text ? csv.parseCsv(text, csv.delimChar(opts.delimiter)) : []),
    [text, opts.delimiter]
  );
  const header = parsed[headerIndex]?.map((h) => h.trim()) ?? [];

  // ------------------------------------------------------------- Schritt 1

  const pickFile = async (f) => {
    if (!f) return;
    setError(null);
    const buf = await f.arrayBuffer();
    setFile(f); setBuffer(buf);

    // Kodierung und Trennzeichen raten, damit der Nutzer meist nichts tun muss.
    const utf = csv.decodeFile(buf, "utf-8");
    const enc = csv.looksMisdecoded(utf) || utf.includes("\ufffd") ? "windows-1252" : "utf-8";
    const decoded = csv.decodeFile(buf, enc);
    const delim = csv.guessDelimiter(decoded);
    const table = csv.parseCsv(decoded, csv.delimChar(delim));
    const hi = csv.findHeaderRow(table);

    setOpts((o) => ({ ...o, encoding: enc, delimiter: delim }));
    setHeaderIndex(hi);
    setMapping(csv.guessMapping(table[hi]?.map((h) => h.trim()) ?? []));
    setStep(1);
  };

  const applyProfile = (p) => {
    setOpts({
      encoding: p.encoding, delimiter: p.delimiter,
      date_format: p.date_format, decimal_comma: p.decimal_comma,
    });
    setMapping({
      col_date: p.col_date, col_amount: p.col_amount,
      col_payee: p.col_payee, col_purpose: p.col_purpose,
      col_reference: p.col_reference ?? "",
    });
    if (p.default_account) setAccount(p.default_account);
  };

  // ------------------------------------------------------------- Schritt 2

  const toPreview = async () => {
    if (!mapping.col_date || !mapping.col_amount)
      return setError("Datum und Betrag müssen zugeordnet sein.");
    setBusy(true); setError(null);
    try {
      const built = csv.buildRows(parsed, headerIndex, mapping, opts);
      const good = built.filter((r) => r.ok);
      setKnown(await api.existingHashes(good.map((r) => r.hash)));
      // Weicher Zusatz-Check zum exakten Hash-Vergleich oben: derselbe
      // Bank-Umsatz kann je nach Export-Format unterschiedlichen
      // Empfaenger-/Zwecktext haben, dann greift der Hash-Vergleich nicht
      // (siehe CLAUDE.md/pb.js). Datum+Betrag allein sind stabiler, deshalb
      // hier nur als Warnhinweis, nicht als automatischer Ausschluss.
      if (good.length > 0) {
        const dates = good.map((r) => r.date).sort();
        setPossibleDupes(await api.existingByDateAmount(account, dates[0], dates[dates.length - 1]));

        // Kontostand-Sanity-Check: manche Bank-Exporte nennen im Vorspann den
        // aktuellen Kontostand. Falls gefunden, wird er hier schon mit dem
        // App-Saldo *vor* dem Import verglichen (der Saldo *nach* Import
        // haengt von den Nutzer-Abwahlen in der Vorschau ab und wird deshalb
        // erst dort beim Rendern dazugerechnet, s. `toImport`).
        const stmt = csv.findStatementBalance(parsed, headerIndex, opts.decimal_comma);
        if (stmt !== null) {
          setStatementBalance(stmt);
          // Hat das Zielkonto virtuelle Unterkonten (Sparziele, s.
          // accounts.parent_account), zaehlt fuer den Abgleich mit dem
          // Bank-Kontostand deren Saldo mit - der Bank ist die interne
          // Aufteilung in Toepfe egal, sie sieht nur den einen Kontostand.
          const asOf = dates[dates.length - 1];
          const children = await api.listChildAccounts(account);
          const ownAndChildren = [account, ...children.map((c) => c.id)];
          const balances = await Promise.all(
            ownAndChildren.map((id) => api.accountBalanceAsOf(id, asOf))
          );
          setBalanceBefore(balances.reduce((s, b) => s + b, 0));
        } else {
          setStatementBalance(null);
          setBalanceBefore(null);
        }
      } else {
        setPossibleDupes(new Set());
        setStatementBalance(null);
        setBalanceBefore(null);
      }
      setRows(built.map((r) => {
        if (!r.ok) return r;
        const matched = csv.applyRules(r, rules);
        return { ...r, category: matched?.category ?? "", tags: matched?.tags ?? [] };
      }));
      setManualCats({});
      setExcluded(new Set());
      setNote("");
      setStep(2);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  // ------------------------------------------------------------- Schritt 3

  const good = rows.filter((r) => r.ok);
  const bad = rows.filter((r) => !r.ok);
  const dupes = good.filter((r) => known.has(r.hash));
  const fresh = good.filter((r) => !known.has(r.hash)).map((r) => ({
    ...r, possibleDupe: possibleDupes.has(`${r.date}|${r.cents}`),
  }));
  const toImport = fresh.filter((r) => !excluded.has(r.hash));

  // Sammel-Abwahl fuer "evtl. schon vorhanden"-Zeilen - vorher liess sich nur
  // jede Zeile einzeln abwaehlen, bei vielen Treffern (z. B. nach einem
  // Formatwechsel des Bank-Exports) unpraktisch muehsam. Ein Klick betrifft
  // alle aktuell markierten Zeilen auf einmal, der Toggle-Text spiegelt den
  // Sammelzustand wider (alle abgewaehlt -> "wieder auswaehlen").
  const possibleDupeHashes = fresh.filter((r) => r.possibleDupe).map((r) => r.hash);
  const allPossibleDupesExcluded = possibleDupeHashes.length > 0
    && possibleDupeHashes.every((h) => excluded.has(h));
  const toggleAllPossibleDupes = () => setExcluded((s) => {
    const next = new Set(s);
    for (const h of possibleDupeHashes) {
      if (allPossibleDupesExcluded) next.delete(h); else next.add(h);
    }
    return next;
  });

  // Summe der tatsaechlich zu importierenden Zeilen (nach Abwahl evtl.
  // doppelter Zeilen) - eigenes Widget in der Vorschau, damit sich der
  // Gesamtbetrag schon vor dem Import mit dem erwarteten Kontoauszug
  // abgleichen laesst, nicht erst anhand einzelner Zeilen.
  const totalImportCents = toImport.reduce((s, r) => s + r.cents, 0);
  const balanceAfter = balanceBefore !== null
    ? balanceBefore + totalImportCents
    : null;
  const balanceDiff = statementBalance !== null && balanceAfter !== null
    ? statementBalance - balanceAfter
    : null;

  const catOf = (r) => r.category || manualCats[r.hash]?.category || "";

  const runImport = async () => {
    setBusy(true); setError(null);
    try {
      const run = await api.createImportRun({
        account, filename: file?.name ?? "", row_count: toImport.length,
        skipped_count: dupes.length + bad.length + excluded.size,
        note: note.trim(),
      });
      await api.batchCreateTransactions(
        toImport.map((r) => ({
          date: r.date, type: "tx", account,
          category: catOf(r) || undefined,
          // Tags kommen ausschliesslich aus einer automatisch getroffenen
          // Regel - fuer manuell zugeordnete Zeilen gibt's (noch) keinen
          // eigenen Tag-Picker in der Vorschau.
          tags: r.tags ?? [],
          amount_cents: r.cents,
          payee: r.payee || r.purpose.slice(0, 60),
          note: r.purpose,
          import_hash: r.hash,
          import_batch: run.id,
        })),
        (done, total) => setProgress({ done, total })
      );

      // Fuer manuell zugeordnete Zeilen mit gesetztem Haekchen je Empfaenger
      // hoechstens eine Regel anlegen, auch wenn mehrere Zeilen denselben
      // Empfaenger haben.
      const newRules = new Map();
      for (const r of toImport) {
        const m = manualCats[r.hash];
        const pattern = r.payee?.trim();
        if (m?.saveRule && m.category && pattern) newRules.set(pattern.toLowerCase(), { pattern, category: m.category });
      }
      for (const rule of newRules.values()) await api.saveRule(rule);

      flash(`${toImport.length} Buchungen importiert`
        + (newRules.size > 0 ? `, ${newRules.size} ${newRules.size === 1 ? "Regel" : "Regeln"} angelegt` : ""));
      onBack();
    } catch (e) { setError(e); setProgress(null); }
    finally { setBusy(false); }
  };

  // Statt window.confirm() (bricht auf manchen Browsern nach ein paar
  // Aufrufen wortlos ab, "Diese Seite daran hindern, weitere Dialoge zu
  // erstellen") eine eigene, im Layout verankerte Ja/Abbrechen-Bestaetigung.
  const [confirmUndo, setConfirmUndo] = useState(null);

  const undo = async (runId) => {
    setConfirmUndo(null);
    setBusy(true);
    try {
      const n = await api.deleteImportRun(runId);
      flash(`${n} Buchungen zurückgenommen`);
      setRuns(await api.listImportRuns());
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  // ------------------------------------------------------------------ UI

  return (
    <div className="px-5 py-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400 mb-4">
        <ChevronLeft size={16} /> Zurück
      </button>

      <div className="flex gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1 rounded-full ${i <= step ? "bg-emerald-600 dark:bg-emerald-500" : "bg-stone-200 dark:bg-stone-700"}`} />
            <p className={`text-[11px] mt-1 ${i === step ? "text-stone-900 dark:text-stone-50" : "text-stone-400 dark:text-stone-500"}`}>{s}</p>
          </div>
        ))}
      </div>

      <ErrorNote error={error} />

      {step === 0 && (
        <>
          <label className="block border border-dashed border-stone-300 dark:border-stone-600 rounded-xl px-4 py-10 text-center cursor-pointer active:bg-stone-100 dark:active:bg-stone-800">
            <FileUp size={22} className="mx-auto text-stone-400 dark:text-stone-500 mb-2" />
            <span className="block text-sm">CSV-Datei auswählen</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400 mt-1">Export aus dem Online-Banking</span>
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>

          {profiles.length > 0 && (
            <>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-6 mb-2">Gespeicherte Profile</p>
              <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                {profiles.map((p) => (
                  <div key={p.id} className="px-4 py-2.5 text-sm">{p.name}</div>
                ))}
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">
                Wird nach dem Auswählen der Datei angewendet.
              </p>
            </>
          )}

          {runs.length > 0 && (
            <>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2">Frühere Importe</p>
              <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700">
                {runs.slice(0, 6).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{r.filename || "Import"}</span>
                      <span className="block text-xs text-stone-500 dark:text-stone-400">
                        {new Date(r.created).toLocaleDateString("de-DE")} · {r.row_count} Buchungen
                      </span>
                      {r.note && (
                        <span className="block text-xs text-amber-700 dark:text-amber-400 truncate">{r.note}</span>
                      )}
                    </span>
                    {confirmUndo === r.id ? (
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-stone-500 dark:text-stone-400">Wirklich?</span>
                        <button onClick={() => undo(r.id)} disabled={busy}
                          className="text-xs text-red-600 dark:text-red-400 font-medium disabled:opacity-50">
                          Ja, löschen
                        </button>
                        <button onClick={() => setConfirmUndo(null)} disabled={busy}
                          className="text-xs text-stone-500 dark:text-stone-400 disabled:opacity-50">
                          Abbrechen
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmUndo(r.id)} disabled={busy}
                        className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 disabled:opacity-50 shrink-0">
                        <Undo2 size={13} /> zurücknehmen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-4">
            {file?.name} · {parsed.length} Zeilen erkannt
          </p>

          {profiles.length > 0 && (
            <Field label="Profil anwenden">
              <select className={inputCls} defaultValue=""
                onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value); if (p) applyProfile(p); }}>
                <option value="">— keins —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}

          <Field label="Kodierung">
            <select className={inputCls} value={opts.encoding}
              onChange={(e) => setOpts({ ...opts, encoding: e.target.value })}>
              {csv.ENCODINGS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>
          {csv.looksMisdecoded(text) && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5 -mt-2 mb-4">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Umlaute sehen falsch aus. Wechsle die Kodierung.
            </p>
          )}

          <Field label="Trennzeichen">
            <select className={inputCls} value={opts.delimiter}
              onChange={(e) => setOpts({ ...opts, delimiter: e.target.value })}>
              {csv.DELIMITERS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Field>

          <Field label="Kopfzeile">
            <select className={inputCls} value={headerIndex}
              onChange={(e) => {
                const i = Number(e.target.value);
                setHeaderIndex(i);
                setMapping(csv.guessMapping(parsed[i]?.map((h) => h.trim()) ?? []));
              }}>
              {parsed.slice(0, 25).map((r, i) => (
                <option key={i} value={i}>Zeile {i + 1}: {r.slice(0, 4).join(" | ").slice(0, 50)}</option>
              ))}
            </select>
          </Field>

          <Field label="Datumsformat">
            <select className={inputCls} value={opts.date_format}
              onChange={(e) => setOpts({ ...opts, date_format: e.target.value })}>
              {csv.DATE_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>

          <label className="flex items-center gap-2 mb-5 text-sm">
            <input type="checkbox" checked={opts.decimal_comma}
              onChange={(e) => setOpts({ ...opts, decimal_comma: e.target.checked })} />
            Komma als Dezimaltrennzeichen (−1.234,56)
          </label>

          <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">Spalten zuordnen</p>
          {[
            ["col_date", "Datum", true],
            ["col_amount", "Betrag", true],
            ["col_payee", "Empfänger", false],
            ["col_purpose", "Verwendungszweck", false],
            ["col_reference", "Referenznummer", false],
          ].map(([k, label, req]) => (
            <Field key={k} label={`${label}${req ? " *" : ""}`}>
              <select className={inputCls} value={mapping[k]}
                onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}>
                <option value="">— nicht vorhanden —</option>
                {header.map((h, i) => <option key={i} value={h}>{h}</option>)}
              </select>
              {k === "col_reference" && (
                <span className="block text-xs text-stone-400 dark:text-stone-500 mt-1.5">
                  Falls vorhanden (z. B. Kundenreferenz): macht Buchungen mit gleichem Datum, Betrag,
                  Empfänger und Zweck trotzdem unterscheidbar.
                </span>
              )}
            </Field>
          ))}

          <Field label="Auf welches Konto?">
            <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
              {realAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <Button onClick={toPreview} disabled={busy} className="w-full">
            {busy ? "Prüfe …" : "Weiter zur Vorschau"}
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2 text-center">
            <Stat n={toImport.length} label="neu" tone="text-emerald-700 dark:text-emerald-400" />
            <Stat n={dupes.length} label="schon da" tone="text-stone-500 dark:text-stone-400" />
            <Stat n={bad.length} label="unlesbar" tone={bad.length ? "text-red-600 dark:text-red-400" : "text-stone-400 dark:text-stone-500"} />
          </div>

          <div className="flex items-center justify-between bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-3 mb-4">
            <span className="text-sm text-stone-600 dark:text-stone-300">
              {toImport.length} {toImport.length === 1 ? "Buchung" : "Buchungen"} zum Importieren
            </span>
            <span className={`text-sm font-medium tabular-nums ${totalImportCents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
              {eur(totalImportCents)}
            </span>
          </div>

          <Field label="Notiz zu diesem Import (optional)">
            <input type="text" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. 3 vorgemerkte Umsätze, 34,07 €" maxLength={500} />
          </Field>

          {statementBalance !== null && (
            balanceDiff === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3 flex items-start gap-1.5">
                <Check size={13} className="mt-0.5 shrink-0" />
                Kontostand laut Bank-Export ({eur(statementBalance)}) stimmt mit dem Kontostand nach
                diesem Import überein.
              </p>
            ) : (
              <p className="text-xs text-red-600 dark:text-red-400 mb-3 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Kontostand laut Bank-Export: {eur(statementBalance)} · nach diesem Import voraussichtlich:{" "}
                {eur(balanceAfter)} · Differenz: {eur(balanceDiff)}. Kann an fehlenden, doppelten oder noch
                nicht exportierten Buchungen liegen — oder daran, dass die Bank hier schon vorgemerkte, noch
                nicht gebuchte Umsätze mit einrechnet, die im Export selbst nie auftauchen. Kein
                automatischer Abbruch, aber einen Blick wert.
              </p>
            )
          )}

          {dupes.length > 0 && (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
              Doppelte Zeilen werden übersprungen — erkannt an Datum, Betrag und Zweck.
            </p>
          )}
          {bad.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {bad.length} Zeilen konnten nicht gelesen werden. Meist stimmt das Datumsformat
              oder das Dezimaltrennzeichen nicht — geh einen Schritt zurück.
            </p>
          )}
          {fresh.some((r) => r.batchDupeCount > 1) && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {fresh.filter((r) => r.batchDupeCount > 1).length} Buchungen sehen wie Mehrfachbuchungen
              aus — gleiches Datum, Betrag, Empfänger und Zweck innerhalb dieser Datei. Werden trotzdem
              einzeln angelegt, unten mit „evtl. doppelt" markiert. Prüf sie kurz, falls das nicht stimmen kann.
            </p>
          )}
          {fresh.some((r) => r.possibleDupe) && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {possibleDupeHashes.length} Buchungen haben Datum und Betrag wie eine
                bereits vorhandene Buchung auf diesem Konto, aber anderen Empfänger-/Zwecktext — evtl.
                derselbe Umsatz aus einem anders formatierten Export (z. B. gekürzter Empfängername).
                Unten mit „evtl. schon vorhanden" markiert, einzeln oder{" "}
                <button onClick={toggleAllPossibleDupes} className="underline font-medium">
                  {allPossibleDupesExcluded ? "alle wieder auswählen" : "alle auf einmal abwählen"}
                </button>.
              </span>
            </p>
          )}

          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-4 max-h-96 overflow-y-auto">
            {fresh.map((r, i) => {
              const manual = manualCats[r.hash];
              const skip = excluded.has(r.hash);
              return (
                <div key={i} className={`px-3.5 py-2.5 ${skip ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-3">
                    {r.possibleDupe && (
                      <input type="checkbox" checked={!skip} title="Diese Buchung importieren"
                        onChange={(e) => setExcluded((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.delete(r.hash); else next.add(r.hash);
                          return next;
                        })} />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{r.payee || r.purpose || "—"}</span>
                      <span className={`block text-xs truncate ${
                        r.batchDupeCount > 1 || r.possibleDupe ? "text-amber-700 dark:text-amber-400" : "text-stone-500 dark:text-stone-400"}`}>
                        {new Date(r.date + "T12:00:00").toLocaleDateString("de-DE")}
                        {r.category && ` · ${byId(categories, r.category, UNKNOWN_CAT).name}`}
                        {r.tags?.length > 0 && ` · ${r.tags.map((id) => byId(tags, id, UNKNOWN_TAG).name).join(", ")}`}
                        {r.batchDupeCount > 1 && " · evtl. doppelt"}
                        {r.possibleDupe && " · evtl. schon vorhanden"}
                      </span>
                    </span>
                    <span className={`text-sm font-medium tabular-nums ${
                      r.cents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{eur(r.cents)}</span>
                  </div>

                  {!r.category && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <select
                        className="text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 dark:text-stone-100 rounded-md px-2 py-1"
                        value={manual?.category ?? ""}
                        onChange={(e) => setManualCats((m) => ({
                          ...m, [r.hash]: { category: e.target.value, saveRule: m[r.hash]?.saveRule ?? true },
                        }))}>
                        <option value="">Kategorie wählen</option>
                        {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {manual?.category && r.payee?.trim() && (
                        <label className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 min-w-0">
                          <input type="checkbox" checked={manual.saveRule}
                            onChange={(e) => setManualCats((m) => ({
                              ...m, [r.hash]: { ...m[r.hash], saveRule: e.target.checked },
                            }))} />
                          <span className="truncate">Regel merken: „{r.payee.trim()}"</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {progress && (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2 tabular-nums">
              {progress.done} von {progress.total} geschrieben …
            </p>
          )}

          <Button onClick={runImport} disabled={busy || toImport.length === 0} className="w-full">
            {busy ? "Importiere …" : `${toImport.length} Buchungen importieren`}
          </Button>
          <Button variant="ghost" onClick={() => setStep(1)} disabled={busy} className="w-full mt-2">
            Zurück zur Zuordnung
          </Button>
        </>
      )}
    </div>
  );
}

function Stat({ n, label, tone }) {
  return (
    <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 py-3">
      <p className={`text-xl font-medium tabular-nums ${tone}`}>{n}</p>
      <p className="text-xs text-stone-500 dark:text-stone-400">{label}</p>
    </div>
  );
}
