// Einziger Zugang der Screens zu den Daten. Welches Backend dahinter steckt,
// entscheidet der Build (vite.config.js, Umgebungsvariable HB_TARGET):
//   server  -> backend/pocketbase.js  (Docker-Container, Standard)
//   android -> backend/sqlite.js      (lokale SQLite-Datenbank, Capacitor-App)
// Beide Dateien exportieren dieselben Namen mit denselben Rueckgabeformen.
export * from "@backend";
