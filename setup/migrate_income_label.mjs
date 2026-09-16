// Einmalig: patcht die bereits bestehende income_targets-Sammlung um das
// neue Feld "label" und ersetzt den alten Unique-Index (month allein) durch
// einen normalen Index - mehrere Einnahmen-Posten pro Monat/Dauer-Eintrag
// sind jetzt erlaubt. setup/schema.mjs patcht keine Felder auf existierenden
// Sammlungen (nur echte Neuanlagen), deshalb dieses separate Skript statt
// manueller Admin-UI-Klickerei.
//
//   PB_URL=... PB_EMAIL=... PB_PASSWORD=... node setup/migrate_income_label.mjs

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

const incomeTargets = await pb.collections.getOne("income_targets");

const hasLabelField = incomeTargets.fields.some((f) => f.name === "label");
if (hasLabelField) {
  console.log("= income_targets.label existiert bereits, Feld uebersprungen");
} else {
  incomeTargets.fields.push({ type: "text", name: "label", max: 60 });
  console.log("+ income_targets.label Feld vorbereitet");
}

incomeTargets.indexes = [
  "CREATE INDEX idx_income_targets_month ON income_targets (month)",
];

await pb.collections.update(incomeTargets.id, incomeTargets);
console.log("Fertig - income_targets aktualisiert.");
