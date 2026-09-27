import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { useTheme } from "../theme.js";
import { inputCls, todayISO, Button, Sheet, ErrorNote } from "../ui.jsx";
import * as api from "../pb.js";

export default function Einstellungen({ accounts, defaultAccount, setDefaultAccount }) {
  const { theme, setTheme } = useTheme();
  // Virtuelle Unterkonten (Toepfe) sind auch als Startkonto nicht waehlbar -
  // gleiche Einschraenkung wie bei den Konto-Chips in Buchungen/Budgets,
  // ein Topf hat keinen eigenen kombinierten Saldo.
  const realAccounts = accounts.filter((a) => !a.parent_account);

  const fileInputRef = useRef(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState(null);

  // Export als eine Datei ueber den Android-"Teilen"-Dialog (Mail, Dateien,
  // Nextcloud, ...) - kein eigener Upload, die Wahl des Speicherorts bleibt
  // beim Nutzer. Bewusst nicht der Live-Datenbankpfad selbst: eine offene
  // SQLite-Datei in einen Sync-Ordner zu legen wuerde bei gleichzeitigem
  // Schreibzugriff Korruption riskieren (siehe Besprechung in Phase 3).
  const handleExport = async () => {
    setExportBusy(true); setExportError(null);
    try {
      const backup = await api.exportBackup();
      const filename = `haushaltsbuch-sicherung-${todayISO()}.json`;
      await Filesystem.writeFile({
        path: filename, directory: Directory.Cache,
        data: JSON.stringify(backup, null, 2), encoding: Encoding.UTF8,
      });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ title: "Haushaltsbuch-Sicherung", url: uri, dialogTitle: "Sicherung speichern oder teilen" });
    } catch (e) {
      // Ein abgebrochener Teilen-Dialog (Nutzer draengt "Zurueck") wirft bei
      // manchen Android-Versionen ebenfalls eine Exception - kein echter Fehler.
      if (!/cancel/i.test(e?.message ?? "")) setExportError(e.message || String(e));
    } finally {
      setExportBusy(false);
    }
  };

  // Datei-Auswahl statt eigenem Storage-Zugriff: <input type="file"> oeffnet
  // in der Capacitor-WebView den nativen Android-Dateiauswahldialog, ganz
  // ohne zusaetzliche Berechtigungen oder Plugins.
  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreError(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.data || typeof parsed.data !== "object") {
        throw new Error("Das ist keine gültige Haushaltsbuch-Sicherungsdatei.");
      }
      setPendingRestore(parsed);
    } catch (err) {
      setRestoreError(err.message || "Datei konnte nicht gelesen werden.");
    }
  };

  const confirmRestore = async () => {
    setRestoreBusy(true); setRestoreError(null);
    try {
      await api.restoreBackup(pendingRestore);
      // Einfachster robuster Weg, den kompletten App-State (Konten, Kategorien,
      // gerade offene Monatsauswahl, ...) auf den wiederhergestellten Stand
      // zu bringen, statt jeden einzelnen State-Hook manuell neu zu laden.
      window.location.reload();
    } catch (err) {
      setRestoreError(err.message || "Wiederherstellung fehlgeschlagen.");
      setRestoreBusy(false);
    }
  };

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2.5">Einstellungen</p>

      <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 mb-2.5">Darstellung</p>
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
        <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChosen} />
      </div>
      <ErrorNote error={exportError} />
      <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 max-w-xs">
        Die Sicherung ist eine einzelne JSON-Datei mit allen Konten, Kategorien
        und Buchungen. Über "Teilen" landet sie z. B. in Nextcloud, per Mail
        oder im Dateien-Ordner – nur die App selbst läuft ohne Server.
      </p>

      {!pendingRestore && <ErrorNote error={restoreError} />}

      {pendingRestore && (
        <Sheet title="Wirklich wiederherstellen?" onClose={() => !restoreBusy && setPendingRestore(null)}>
          <p className="text-sm text-stone-600 dark:text-stone-300 mb-1">
            Sicherung vom{" "}
            {new Date(pendingRestore.exportedAt?.replace(" ", "T") ?? Date.now()).toLocaleString("de-DE", {
              dateStyle: "medium", timeStyle: "short",
            })}. Das ersetzt deinen gesamten aktuellen Datenbestand unwiderruflich.
          </p>
          <ErrorNote error={restoreError} />
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" onClick={() => setPendingRestore(null)} disabled={restoreBusy} className="flex-1">
              Abbrechen
            </Button>
            <Button variant="danger" onClick={confirmRestore} disabled={restoreBusy} className="flex-1">
              {restoreBusy ? "Moment …" : "Ja, ersetzen"}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
