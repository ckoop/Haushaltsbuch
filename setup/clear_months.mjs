// Loescht alle Buchungen eines oder mehrerer Kalendermonate (und die
// Import-Protokolle, die dadurch keine Buchung mehr referenzieren).
//
// Erst ansehen, dann erst wirklich loeschen - standardmaessig ein
// Trockenlauf, der nur zaehlt und auflistet:
//
//   npm i pocketbase
//   PB_URL=http://192.168.178.55:8090 PB_EMAIL=... PB_PASSWORD=... \
//     MONTHS=2026-09,2026-04 node setup/clear_months.mjs
//
// Erst wenn die Ausgabe stimmt, mit CONFIRM=1 wirklich loeschen:
//
//   PB_URL=http://192.168.178.55:8090 PB_EMAIL=... PB_PASSWORD=... \
//     MONTHS=2026-09,2026-04 CONFIRM=1 node setup/clear_months.mjs
//
// Vorher in der Admin-Oberflaeche (Settings -> Backups -> "Backup jetzt")
// ein frisches Backup ziehen - dieses Skript fragt das nicht selbst ab.

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

const months = (process.env.MONTHS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
if (months.length === 0) {
  console.error("MONTHS fehlt, z. B. MONTHS=2026-09,2026-04");
  process.exit(1);
}
for (const m of months) {
  if (!/^\d{4}-\d{2}$/.test(m)) {
    console.error(`Ungueltiger Monat "${m}", erwartet Format JJJJ-MM`);
    process.exit(1);
  }
}

const dryRun = process.env.CONFIRM !== "1";
console.log(dryRun ? "-- Trockenlauf (nichts wird geloescht) --" : "-- CONFIRM=1: es wird wirklich geloescht --");

function monthRange(m) {
  const [y, mo] = m.split("-").map(Number);
  const start = `${m}-01 00:00:00`;
  const endDate = new Date(Date.UTC(y, mo, 1)); // erster Tag des Folgemonats
  const end = endDate.toISOString().slice(0, 10) + " 00:00:00";
  return { start, end };
}

let allTx = [];
for (const m of months) {
  const { start, end } = monthRange(m);
  const rows = await pb.collection("transactions").getFullList({
    filter: pb.filter("date >= {:start} && date < {:end}", { start, end }),
  });
  console.log(`${m}: ${rows.length} Buchungen`);
  allTx = allTx.concat(rows);
}

if (allTx.length === 0) {
  console.log("Keine Buchungen in den angegebenen Monaten. Nichts zu tun.");
  process.exit(0);
}

const sum = allTx.reduce((s, t) => s + t.amount_cents, 0);
console.log(`Gesamt: ${allTx.length} Buchungen, Summe ${(sum / 100).toFixed(2)} EUR`);

const batchIds = [...new Set(allTx.map((t) => t.import_batch).filter(Boolean))];
console.log(`Betroffene Import-Protokolle: ${batchIds.length}`);

if (dryRun) {
  console.log("\nBeispielzeilen (max. 10):");
  for (const t of allTx.slice(0, 10)) {
    console.log(`  ${t.date.slice(0, 10)}  ${(t.amount_cents / 100).toFixed(2).padStart(10)} EUR  ${t.payee ?? ""}`);
  }
  console.log("\nKein Loeschen ohne CONFIRM=1.");
  process.exit(0);
}

const txIds = new Set(allTx.map((t) => t.id));
for (const t of allTx) {
  await pb.collection("transactions").delete(t.id);
}
console.log(`${allTx.length} Buchungen geloescht.`);

let deletedImports = 0;
for (const batchId of batchIds) {
  const remaining = await pb.collection("transactions").getList(1, 1, {
    filter: pb.filter("import_batch = {:id}", { id: batchId }),
  });
  if (remaining.totalItems === 0) {
    await pb.collection("imports").delete(batchId);
    deletedImports++;
  }
}
console.log(`${deletedImports} von ${batchIds.length} Import-Protokollen geloescht (Rest hat noch Buchungen ausserhalb der gewaehlten Monate).`);
