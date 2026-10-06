import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useTheme } from "../theme.js";
import { inputCls, todayISO, Button, Sheet, ErrorNote } from "../ui.jsx";
import { validateBackup } from "../backup.js";
import * as api from "../pb.js";

const COLLECTION_LABELS = {
  accounts: "Konten", categories: "Kategorien", transactions: "Buchungen",
  budgets: "Budgets", recurring_rules: "Daueraufträge", depot_positions: "Depot-Positionen",
  depot_trades: "Depot-Trades",
};

export default function Einstellungen({ depotEnabled, setDepotEnabled, accounts, defaultAccount, setDefaultAccount }) {
  const { theme, setTheme } = useTheme();
  // Virtuelle Unterkonten (Toepfe) sind auch als Startkonto nicht waehlbar -
  // gleiche Einschraenkung wie bei den Konto-Chips in Buchungen/Budgets,
  // ein Topf hat keinen eigenen kombinierten Saldo.
  const realAccounts = accounts.filter((a) => !a.parent_account);

  const fileInputRef = useRef(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null); // { backup, counts }
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(null); // { done, total }
  const [restoreError, setRestoreError] = useState(null);

  // Download über einen Blob-Link statt Server-Route: die Daten kommen ohnehin
  // schon über die angemeldete API, ein eigener Endpunkt wäre nur ein zweiter
  // Zugriffsweg. Funktioniert auch ohne sicheren Kontext (http://192.168.x.x).
  const handleExport = async () => {
    setExportBusy(true); setExportError(null);
    try {
      const backup = await api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `haushaltsbuch-sicherung-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message || String(e));
    } finally {
      setExportBusy(false);
    }
  };

  // Datei wird erst komplett geprüft (Format, Ids), bevor die Bestätigung
  // erscheint — eine kaputte Datei soll gar nicht erst bis zum Löschen kommen.
  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreError(null);
    try {
      const backup = JSON.parse(await file.text());
      setPendingRestore({ backup, counts: validateBackup(backup) });
    } catch (err) {
      setRestoreError(err instanceof SyntaxError
        ? "Die Datei ist kein gültiges JSON."
        : err.message || "Datei konnte nicht gelesen werden.");
    }
  };

  const confirmRestore = async () => {
    setRestoreBusy(true); setRestoreError(null);
    try {
      await api.restoreBackup(pendingRestore.backup, (done, total) => setRestoreProgress({ done, total }));
      // Einfachster robuster Weg, den gesamten App-State (Konten, Monatsauswahl,
      // Budgets, ...) auf den neuen Stand zu bringen, statt jeden Hook einzeln
      // neu zu laden.
      window.location.reload();
    } catch (err) {
      setRestoreError(err.message || "Wiederherstellung fehlgeschlagen.");
      setRestoreBusy(false);
    }
  };

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">Einstellungen</p>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 mb-2.5">Funktionen</p>
      <div className="inline-flex mb-1 rounded-lg border border-stone-300 dark:border-stone-600 overflow-hidden text-[13px]">
        {[[true, "Depot an"], [false, "Depot aus"]].map(([v, label], i) => (
          <button key={String(v)} onClick={() => setDepotEnabled(v)}
            className={`px-3.5 py-1.5 ${i ? "border-l border-stone-300 dark:border-stone-600" : ""} ${
              depotEnabled === v ? "bg-stone-900 dark:bg-emerald-600 text-white" : "text-stone-600 dark:text-stone-300"}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-400 dark:text-stone-500 mb-4">
        Ausgeschaltet verschwindet nur der Reiter — Positionen und Trades bleiben erhalten.
      </p>

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

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Startkonto</p>
      <select value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}
        className={`${inputCls} max-w-xs`}>
        <option value="alle">Alle Konten</option>
        {realAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">
        Beim Öffnen der App vorausgewählt, statt immer bei "Alle Konten" zu starten.
      </p>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-8 mb-2.5">Sicherung</p>
      <div className="flex flex-col gap-2 max-w-xs">
        <Button variant="ghost" onClick={handleExport} disabled={exportBusy}
          className="w-full flex items-center justify-center gap-2">
          <Download size={16} /> {exportBusy ? "Wird erstellt …" : "Sichern (exportieren)"}
        </Button>
        <Button variant="ghost" onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2">
          <Upload size={16} /> Wiederherstellen (importieren)
        </Button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden"
          onChange={handleFileChosen} />
      </div>
      <ErrorNote error={exportError} />
      {!pendingRestore && <ErrorNote error={restoreError} />}
      <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 max-w-xs">
        Eine einzelne JSON-Datei mit allen Konten, Kategorien, Buchungen, Budgets und dem Depot.
        Dasselbe Format wie die Android-App — Sicherungen lassen sich zwischen beiden einspielen.
      </p>

      {pendingRestore && (
        <Sheet title="Wirklich wiederherstellen?" onClose={() => !restoreBusy && setPendingRestore(null)}>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-2">
            Sicherung vom{" "}
            {new Date(pendingRestore.backup.exportedAt?.replace(" ", "T") ?? Date.now())
              .toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
            . Enthält: {Object.entries(COLLECTION_LABELS)
              .filter(([k]) => pendingRestore.counts[k] !== undefined)
              .map(([k, label]) => `${label} ${pendingRestore.counts[k]}`)
              .join(", ")}.
          </p>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-1">
            Das ersetzt den aktuellen Datenbestand unwiderruflich. Im Zweifel vorher
            den jetzigen Stand sichern.
          </p>
          {Object.keys(COLLECTION_LABELS).some((k) => pendingRestore.counts[k] === undefined) && (
            <p className="text-xs text-stone-400 dark:text-stone-500 mb-1">
              Nicht in der Datei enthaltene Bereiche (z. B. das Depot einer Android-Sicherung)
              bleiben unverändert.
            </p>
          )}
          <ErrorNote error={restoreError} />
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" onClick={() => setPendingRestore(null)} disabled={restoreBusy} className="flex-1">
              Abbrechen
            </Button>
            <Button variant="danger" onClick={confirmRestore} disabled={restoreBusy} className="flex-1">
              {restoreBusy
                ? `Moment …${restoreProgress ? ` ${restoreProgress.done}/${restoreProgress.total}` : ""}`
                : "Ja, ersetzen"}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
