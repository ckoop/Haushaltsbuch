import { useState } from "react";

const KEY = "haushaltsbuch-theme";

export function useTheme() {
  const [theme, setThemeState] = useState(() => (localStorage.getItem(KEY) === "dark" ? "dark" : "light"));

  const setTheme = (t) => {
    localStorage.setItem(KEY, t);
    document.documentElement.classList.toggle("dark", t === "dark");
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", t === "dark" ? "#1c1917" : "#FAFAF8");
    setThemeState(t);
  };

  return { theme, setTheme };
}
