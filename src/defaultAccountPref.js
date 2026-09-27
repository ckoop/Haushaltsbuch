import { useState } from "react";

const KEY = "haushaltsbuch-default-account";

// Reines Client-Feature ohne Server-Feld, exakt nach dem Muster von
// depotPref.js/theme.js - welches Konto (oder "alle") beim App-Start
// vorausgewaehlt ist. "alle" ist der bisherige, unveraenderte Standard,
// deshalb dafuer kein eigener localStorage-Eintrag noetig.
export function useDefaultAccountPref() {
  const [defaultAccount, setDefaultAccountState] = useState(() => localStorage.getItem(KEY) ?? "alle");

  const setDefaultAccount = (id) => {
    if (id === "alle") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
    setDefaultAccountState(id);
  };

  return { defaultAccount, setDefaultAccount };
}
