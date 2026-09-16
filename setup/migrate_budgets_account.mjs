// Einmalig: patcht die bereits bestehende budgets-Sammlung um das neue
// Pflichtfeld "account" und den erweiterten Unique-Index. setup/schema.mjs
// patcht keine Felder auf existierenden Sammlungen (nur echte Neuanlagen),
// deshalb dieses separate Skript statt manueller Admin-UI-Klickerei.
//
//   PB_URL=... PB_EMAIL=... PB_PASSWORD=... node setup/migrate_budgets_account.mjs

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

const accounts = await pb.collections.getOne("accounts");
const budgets = await pb.collections.getOne("budgets");

const hasAccountField = budgets.fields.some((f) => f.name === "account");
if (hasAccountField) {
  console.log("= budgets.account existiert bereits, Feld uebersprungen");
} else {
  budgets.fields.push({
    type: "relation",
    name: "account",
    collectionId: accounts.id,
    maxSelect: 1,
    cascadeDelete: false,
    required: true,
  });
  console.log("+ budgets.account Feld vorbereitet");
}

budgets.indexes = [
  "CREATE UNIQUE INDEX idx_budget_acc_cat_month ON budgets (account, category, month)",
];

await pb.collections.update(budgets.id, budgets);
console.log("Fertig - budgets aktualisiert.");
