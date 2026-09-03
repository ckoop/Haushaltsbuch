import { useState, useEffect } from "react";

const KEY = "haushaltsbuch-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

const isDark = (pref) => (pref === "system" ? media().matches : pref === "dark");

function applyDark(dark) {
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1c1917" : "#FAFAF8");
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem(KEY) ?? "system");

  // Bei "system" automatisch der Geräteeinstellung folgen, auch wenn sie sich
  // ändert, während die App offen ist.
  useEffect(() => {
    applyDark(isDark(theme));
    if (theme !== "system") return;
    const mq = media();
    const onChange = () => applyDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t) => {
    localStorage.setItem(KEY, t);
    setThemeState(t);
  };

  return { theme, setTheme };
}
