import { useState } from "react";

const KEY = "haushaltsbuch-depot";

// Reines Client-Feature ohne Server-Feld, exakt nach dem Muster von
// theme.js - eine Anzeige-Praeferenz, kein Datenverlust beim Ausschalten.
export function useDepotEnabled() {
  const [depotEnabled, setDepotEnabledState] = useState(() => (localStorage.getItem(KEY) ?? "on") === "on");

  const setDepotEnabled = (on) => {
    localStorage.setItem(KEY, on ? "on" : "off");
    setDepotEnabledState(on);
  };

  return { depotEnabled, setDepotEnabled };
}
