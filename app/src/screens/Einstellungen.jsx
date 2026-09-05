import { useTheme } from "../theme.js";

export default function Einstellungen({ depotEnabled, setDepotEnabled }) {
  const { theme, setTheme } = useTheme();

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
    </div>
  );
}
