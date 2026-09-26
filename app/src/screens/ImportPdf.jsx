import { useState, useEffect } from "react";
import { ChevronLeft, FileUp, AlertTriangle, Check, Undo2 } from "lucide-react";
import * as api from "../pb.js";
import * as csv from "../csv.js";
import * as pdf from "../pdf.js";
import {
  eur, byId, inputCls, Field, Button, ErrorNote, UNKNOWN_CAT, UNKNOWN_TAG,
} from "../ui.jsx";

const STEPS = ["Datei", "Vorschau"];

// pdfjs-dist wird bewusst nur hier per dynamischem import() geladen (nicht in
// App.jsx/main.jsx) - die ~1-2 MB landen dadurch nicht im Haupt-Bundle,
// sondern erst wenn dieser Screen tatsaechlich geoeffnet wird. Der Worker
// wird einmalig gesetzt und fuer die restliche Sitzung wiederverwendet.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

// Ein PDF hat anders als CSV ein festes Layout - nichts an Kodierung/
// Trennzeichen/Spalten zuzuordnen. Deshalb nur zwei statt drei Schritte:
// Datei (inkl. Zielkonto) -> Vorschau, direkt gefolgt von der Extraktion.
export default function ImportPdf({ accounts, categories, tags, onBack, flash }) {
  const realAccounts = accounts.filter((a) => !a.parent_account);

  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");

  const [file, setFile] = useState(null);
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [account, setAccount] = useState(realAccounts[0]?.id ?? "");

  const [rows, setRows] = useState([]);
  const [known, setKnown] = useState(new Set());
  const [possibleDupes, setPossibleDupes] = useState(new Set());
  const [excluded, setExcluded] = useState(new Set());
  const [progress, setProgress] = useState(null);
  const [manualCats, setManualCats] = useState({});
  // Zwei Sanity-Checks als Ersatz fuer den CSV-Kontostand-Check, der hier
  // nicht moeglich ist (der DKB-Auszug nennt selbst keinen Kontostand):
  // declaredCount vergleicht die vom PDF-Kopf genannte Buchungsanzahl gegen
  // die tatsaechlich erkannten Bloecke (automatisch); knownBalanceInput laesst
  // den Nutzer den ihm bekannten, tatsaechlich GEBUCHTEN Kontostand eintragen
  // (freiwillig, da wir ihn nirgends automatisch herbekommen).
  const [declaredCount, setDeclaredCount] = useState(null);
  const [lastDate, setLastDate] = useState(null);
  const [balanceBefore, setBalanceBefore] = useState(null);
  const [knownBalanceInput, setKnownBalanceInput] = useState("");
  // Freie Notiz zu diesem Import (z. B. "3 vorgemerkte Umsaetze, 34,07 EUR")
  // - hilft beim spaeteren Nachvollziehen einer Kontostand-Abweichung, gleiches
  // Feld wie in Import.jsx.
  const [note, setNote] = useState("");

  useEffect(() => {
    Promise.all([api.listRules(), api.listImportRuns()])
      .then(([r, u]) => { setRules(r); setRuns(u); })
      .catch(setError);
  }, []);

  // ------------------------------------------------------------- Schritt 1

  const pickFile = async (f) => {
    if (!f) return;
    setError(null); setFile(f);
    setBusy(true); setBusyLabel("Lese PDF …");
    try {
      const buf = await f.arrayBuffer();
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const items = tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }));
        pages.push(pdf.reconstructLines(items));
      }
      const blocks = pdf.extractTransactions(pages);
      const built = pdf.buildRows(blocks);
      const good = built.filter((r) => r.ok);
      if (good.length === 0) {
        setError("0 Buchungen erkannt — ist das ein DKB-Kontoauszug im bekannten Format?");
        return;
      }
      setDeclaredCount(pdf.parseDeclaredCount(pages));

      setKnown(await api.existingHashes(good.map((r) => r.hash)));
      // Gleicher weicher Zusatz-Check wie beim CSV-Import (pb.js) - hier
      // sogar noch wichtiger: die Font-Ligatur-Luecken beim PDF-Text (s.
      // CLAUDE.md) veraendern den Empfaenger-/Zwecktext oft genug, dass der
      // exakte Hash zwischen einem CSV- und einem PDF-Import desselben
      // Umsatzes nicht matcht - Datum+Betrag allein fangen das trotzdem ab.
      const dates = good.map((r) => r.date).sort();
      const asOf = dates[dates.length - 1];
      setLastDate(asOf);
      setPossibleDupes(await api.existingByDateAmount(account, dates[0], asOf));
      // Kein automatischer Kontostand-Sanity-Check wie bei CSV moeglich - der
      // DKB-Auszug nennt selbst keinen Kontostand. Stattdessen den Saldo VOR
      // diesem Import schon mal laden (gleiche Rechnung wie bei CSV, inkl.
      // virtueller Toepfe), damit die Vorschau den Abgleich anbieten kann,
      // sobald der Nutzer optional den ihm bekannten, tatsaechlich gebuchten
      // Kontostand eintraegt.
      const children = await api.listChildAccounts(account);
      const ownAndChildren = [account, ...children.map((c) => c.id)];
      const balances = await Promise.all(ownAndChildren.map((id) => api.accountBalanceAsOf(id, asOf)));
      setBalanceBefore(balances.reduce((s, b) => s + b, 0));
      setKnownBalanceInput("");

      setRows(built.map((r) => {
        if (!r.ok) return r;
        const matched = csv.applyRules(r, rules);
        return { ...r, category: matched?.category ?? "", tags: matched?.tags ?? [] };
      }));
      setManualCats({});
      setExcluded(new Set());
      setNote("");
      setStep(1);
    } catch (e) {
      setError(e?.name === "PasswordException" ? "PDF ist passwortgeschützt oder beschädigt." : e);
    } finally {
      setBusy(false); setBusyLabel("");
    }
  };

  // ------------------------------------------------------------- Schritt 2

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
  // Frei eingetragener, tatsaechlich GEBUCHTER Kontostand (ohne vorgemerkte
  // Umsaetze) - dasselbe Feld, ueber das schon der falsche Anfangssaldo im
  // Konto "Christian" gefunden wurde. csv.parseAmountCents mit
  // decimalComma=true, weil das Eintippen hier wie ueberall sonst in der App
  // im deutschen Format erwartet wird, anders als die Betraege im PDF selbst.
  const knownBalanceCents = knownBalanceInput.trim()
    ? csv.parseAmountCents(knownBalanceInput, true) : null;
  const balanceDiff = knownBalanceCents !== null && balanceAfter !== null
    ? knownBalanceCents - balanceAfter : null;

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
          tags: r.tags ?? [],
          amount_cents: r.cents,
          payee: r.payee || r.purpose.slice(0, 60),
          note: r.purpose,
          import_hash: r.hash,
          import_batch: run.id,
        })),
        (done, total) => setProgress({ done, total })
      );

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
  // erstellen") eine eigene, im Layout verankerte Ja/Abbrechen-Bestaetigung -
  // gleiches Muster wie in Import.jsx.
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
          <Field label="Auf welches Konto?">
            <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
              {realAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <label className="block border border-dashed border-stone-300 dark:border-stone-600 rounded-xl px-4 py-10 text-center cursor-pointer active:bg-stone-100 dark:active:bg-stone-800">
            <FileUp size={22} className="mx-auto text-stone-400 dark:text-stone-500 mb-2" />
            <span className="block text-sm">{busy ? busyLabel || "Lese …" : "PDF-Kontoauszug auswählen"}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400 mt-1">DKB-Kontoauszug als PDF</span>
            <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>

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

          {declaredCount !== null && declaredCount !== rows.length && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Laut PDF-Kopf sollten {declaredCount} Buchungen im Zeitraum stehen, erkannt wurden {rows.length}.
              Evtl. hat das Layout eine Zeile falsch zugeordnet — einen Blick in die Datei wert.
            </p>
          )}

          <Field label="Notiz zu diesem Import (optional)">
            <input type="text" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. 3 vorgemerkte Umsätze, 34,07 €" maxLength={500} />
          </Field>

          <Field label={`Gebuchter Kontostand laut Bank${lastDate ? " am " + new Date(lastDate + "T12:00:00").toLocaleDateString("de-DE") : ""} (optional, ohne vorgemerkte Umsätze)`}>
            <input type="text" inputMode="decimal" className={inputCls} placeholder="z. B. 943,97"
              value={knownBalanceInput} onChange={(e) => setKnownBalanceInput(e.target.value)} />
          </Field>
          {knownBalanceCents !== null && balanceDiff !== null && (
            balanceDiff === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3 flex items-start gap-1.5">
                <Check size={13} className="mt-0.5 shrink-0" />
                Kontostand stimmt mit dem Kontostand nach diesem Import überein.
              </p>
            ) : (
              <p className="text-xs text-red-600 dark:text-red-400 mb-3 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Nach diesem Import voraussichtlich: {eur(balanceAfter)} · Differenz: {eur(balanceDiff)}.
                Zeigt deine Banking-App den Stand inklusive vorgemerkter, noch nicht gebuchter Umsätze
                an, addiere deren Summe zu der Zahl oben dazu — sonst kann's an fehlenden, doppelten
                oder noch nicht exportierten Buchungen liegen.
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
              {bad.length} Zeilen konnten nicht gelesen werden — vermutlich ein PDF-Layout,
              das vom bekannten DKB-Format abweicht.
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
                bereits vorhandene Buchung auf diesem Konto, aber anderen Empfänger-/Zwecktext — z. B.
                derselbe Umsatz, schon per CSV importiert. Unten mit „evtl. schon vorhanden" markiert,
                einzeln oder{" "}
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
          <Button variant="ghost" onClick={() => setStep(0)} disabled={busy} className="w-full mt-2">
            Zurück zur Dateiauswahl
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
