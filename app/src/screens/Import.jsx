import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, FileUp, AlertTriangle, Check, Undo2 } from "lucide-react";
import * as api from "../pb.js";
import * as csv from "../csv.js";
import {
  eur, byId, typeIcon, inputCls, Field, Button, ErrorNote, Spinner, UNKNOWN_CAT,
} from "../ui.jsx";

const STEPS = ["Datei", "Zuordnung", "Vorschau"];

export default function Import({ accounts, categories, onBack, flash }) {
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
  const [mapping, setMapping] = useState({ col_date: "", col_amount: "", col_payee: "", col_purpose: "" });
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [rows, setRows] = useState([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [known, setKnown] = useState(new Set());
  const [progress, setProgress] = useState(null);

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
      setRows(built.map((r) => r.ok
        ? { ...r, category: csv.applyRules(r, rules) || "" }
        : r));
      setStep(2);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  // ------------------------------------------------------------- Schritt 3

  const good = rows.filter((r) => r.ok);
  const bad = rows.filter((r) => !r.ok);
  const dupes = good.filter((r) => known.has(r.hash));
  const fresh = good.filter((r) => !known.has(r.hash));

  const runImport = async () => {
    setBusy(true); setError(null);
    try {
      const run = await api.createImportRun({
        account, filename: file?.name ?? "", row_count: fresh.length,
        skipped_count: dupes.length + bad.length,
      });
      await api.batchCreateTransactions(
        fresh.map((r) => ({
          date: r.date, type: "tx", account,
          category: r.category || undefined,
          amount_cents: r.cents,
          payee: r.payee || r.purpose.slice(0, 60),
          note: r.purpose,
          import_hash: r.hash,
          import_batch: run.id,
        })),
        (done, total) => setProgress({ done, total })
      );
      flash(`${fresh.length} Buchungen importiert`);
      onBack();
    } catch (e) { setError(e); setProgress(null); }
    finally { setBusy(false); }
  };

  const undo = async (runId) => {
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
                    </span>
                    <button onClick={() => undo(r.id)} disabled={busy}
                      className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 disabled:opacity-50">
                      <Undo2 size={13} /> zurücknehmen
                    </button>
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
          ].map(([k, label, req]) => (
            <Field key={k} label={`${label}${req ? " *" : ""}`}>
              <select className={inputCls} value={mapping[k]}
                onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}>
                <option value="">— nicht vorhanden —</option>
                {header.map((h, i) => <option key={i} value={h}>{h}</option>)}
              </select>
            </Field>
          ))}

          <Field label="Auf welches Konto?">
            <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <Button onClick={toPreview} disabled={busy} className="w-full">
            {busy ? "Prüfe …" : "Weiter zur Vorschau"}
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <Stat n={fresh.length} label="neu" tone="text-emerald-700 dark:text-emerald-400" />
            <Stat n={dupes.length} label="schon da" tone="text-stone-500 dark:text-stone-400" />
            <Stat n={bad.length} label="unlesbar" tone={bad.length ? "text-red-600 dark:text-red-400" : "text-stone-400 dark:text-stone-500"} />
          </div>

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

          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-4 max-h-80 overflow-y-auto">
            {fresh.slice(0, 40).map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{r.payee || r.purpose || "—"}</span>
                  <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">
                    {new Date(r.date + "T12:00:00").toLocaleDateString("de-DE")}
                    {r.category && ` · ${byId(categories, r.category, UNKNOWN_CAT).name}`}
                  </span>
                </span>
                <span className={`text-sm font-medium tabular-nums ${
                  r.cents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{eur(r.cents)}</span>
              </div>
            ))}
            {fresh.length > 40 && (
              <p className="px-3.5 py-2.5 text-xs text-stone-500 dark:text-stone-400">
                … und {fresh.length - 40} weitere
              </p>
            )}
          </div>

          {progress && (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2 tabular-nums">
              {progress.done} von {progress.total} geschrieben …
            </p>
          )}

          <Button onClick={runImport} disabled={busy || fresh.length === 0} className="w-full">
            {busy ? "Importiere …" : `${fresh.length} Buchungen importieren`}
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
