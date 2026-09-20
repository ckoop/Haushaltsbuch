// Einmalig: patcht die bereits bestehende income_targets-Sammlung um das
// neue Pflichtfeld "account" und den neuen Index. setup/schema.mjs patcht
// keine Felder auf existierenden Sammlungen (nur echte Neuanlagen), deshalb
// dieses separate Skript statt manueller Admin-UI-Klickerei.
//
//   PB_URL=... PB_EMAIL=... PB_PASSWORD=... node setup/migrate_income_account.mjs
//
// Bereits bestehende Einnahmenziele ohne Konto werden dadurch verwaist
// (nicht geloescht, aber in keiner Konto-Ansicht mehr sichtbar) - danach
// einmalig pro gewuenschtem Konto neu setzen, gleiches Vorgehen wie bei der
// budgets.account-Migration.

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

const accounts = await pb.collections.getOne("accounts");
const incomeTargets = await pb.collections.getOne("income_targets");

const hasAccountField = incomeTargets.fields.some((f) => f.name === "account");
if (hasAccountField) {
  console.log("= income_targets.account existiert bereits, Feld uebersprungen");
} else {
  incomeTargets.fields.push({
    type: "relation",
    name: "account",
    collectionId: accounts.id,
    maxSelect: 1,
    cascadeDelete: false,
    required: true,
  });
  console.log("+ income_targets.account Feld vorbereitet");
}

incomeTargets.indexes = [
  "CREATE INDEX idx_income_targets_acc_month ON income_targets (account, month)",
];

await pb.collections.update(incomeTargets.id, incomeTargets);
console.log("Fertig - income_targets aktualisiert.");
