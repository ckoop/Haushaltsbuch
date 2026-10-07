import { AlertTriangle } from "lucide-react";
import { byId, eurAbs, Button, UNKNOWN_ACC, UNKNOWN_CAT } from "../ui.jsx";
import { originOf } from "../dauerauftraege.js";

const fmt = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("de-DE");

// Rückfrage zu fälligen Daueraufträgen, für die es schon eine möglicherweise
// gleiche Buchung gibt (runDueRecurringRules() in pb.js, ab 0.54.0). Die
// Wortwahl ist bewusst eindeutig: es wurde NOCH NICHTS gebucht, und ohne
// Entscheidung bleibt der Dauerauftrag fällig. Die App entscheidet das nicht
// selbst - zwei echte Zahlungen mit gleichem Betrag im gleichen Zeitraum sind
// möglich, eine stille Auto-Entscheidung könnte eine echte Buchung verschlucken.
export default function RuleConflicts({ conflicts, accounts, categories, busy, onResolve }) {
  return (
    <div className="mb-5">
      <div className="flex items-start gap-2 mb-3 text-amber-800 dark:text-amber-300">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <p className="text-sm font-medium">
          {conflicts.length === 1
            ? "Ein Dauerauftrag wartet auf deine Bestätigung"
            : `${conflicts.length} Daueraufträge warten auf deine Bestätigung`}
        </p>
      </div>
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
        Für diese fälligen Daueraufträge gibt es schon eine Buchung mit gleichem Betrag auf demselben Konto
        in der Nähe des Fälligkeitstags — vielleicht hat die Bank sie bereits ausgeführt und du hast sie
        importiert. <strong>Es wurde noch nichts gebucht.</strong> Ohne deine Entscheidung bleibt der
        Dauerauftrag fällig und fragt beim nächsten Öffnen erneut.
      </p>

      <div className="space-y-3">
        {conflicts.map((c) => {
          const { rule } = c;
          const isTransfer = rule.type === "transfer";
          const name = rule.payee || (isTransfer ? "Umbuchung" : byId(categories, rule.category, UNKNOWN_CAT).name);
          const acc = byId(accounts, rule.account, UNKNOWN_ACC);
          return (
            <div key={`${rule.id}:${c.due}`}
              className="bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-xl px-3.5 py-3">
              <p className="text-sm">
                Dauerauftrag <strong>„{name}“</strong> ist am <strong>{fmt(c.due)}</strong> fällig:{" "}
                {isTransfer ? "" : rule.amount_cents > 0 ? "+" : "−"}{eurAbs(rule.amount_cents)} auf {acc.name}.
              </p>
              <p className="text-xs text-stone-600 dark:text-stone-300 mt-2 mb-1">
                {c.candidates.length === 1 ? "Schon vorhandene Buchung:" : "Schon vorhandene Buchungen:"}
              </p>
              <div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-700 mb-3">
                {c.candidates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{t.payee || t.note || "—"}</span>
                      <span className="block text-stone-500 dark:text-stone-400">{fmt(t.date)} · {originOf(t)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-sm">
                      {isTransfer ? "" : t.amount_cents > 0 ? "+" : "−"}{eurAbs(t.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={() => onResolve(c, "skip")} disabled={busy} className="w-full">
                  Ja, dieselbe Zahlung — nicht noch einmal buchen
                </Button>
                <Button variant="ghost" onClick={() => onResolve(c, "book")} disabled={busy} className="w-full">
                  Nein, andere Zahlung — trotzdem buchen
                </Button>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-2">
                Beide Antworten schieben den Dauerauftrag auf die nächste Fälligkeit weiter.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
