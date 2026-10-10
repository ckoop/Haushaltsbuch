// Einziger Zugang der Screens zu den Daten. Welches Backend dahinter steckt,
// entscheidet der Build (vite.config.js, Umgebungsvariable HB_TARGET):
//   server  -> backend/pocketbase.js  (Docker-Container, Standard)
//   android -> backend/sqlite.js      (lokale SQLite-Datenbank, Capacitor-App)
// Beide Dateien exportieren dieselben Namen mit denselben Rueckgabeformen.
export * from "@backend";

// Reine Helfer, die beide Backends brauchen und die Screens ueber api.* nutzen -
// einmal in dates.js/dauerauftraege.js statt je Backend.
export { monthRange, dateOnly, addMonths } from "./dates.js";
export { MONTHS_PER } from "./dauerauftraege.js";
