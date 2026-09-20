import { useTheme } from "../theme.js";
import { inputCls } from "../ui.jsx";

export default function Einstellungen({ depotEnabled, setDepotEnabled, accounts, defaultAccount, setDefaultAccount }) {
  const { theme, setTheme } = useTheme();
  // Virtuelle Unterkonten (Toepfe) sind auch als Startkonto nicht waehlbar -
  // gleiche Einschraenkung wie bei den Konto-Chips in Buchungen/Budgets,
  // ein Topf hat keinen eigenen kombinierten Saldo.
  const realAccounts = accounts.filter((a) => !a.parent_account);

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
    </div>
  );
}
