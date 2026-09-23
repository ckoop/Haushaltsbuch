// Einmalig: patcht die bereits bestehende imports-Sammlung um das neue Feld
// "note" (freie Notiz zu einem Import, z. B. "3 vorgemerkte Umsaetze,
// 34,07 EUR" - hilft beim spaeteren Nachvollziehen einer
// Kontostand-Abweichung). setup/schema.mjs patcht keine Felder auf
// existierenden Sammlungen (nur echte Neuanlagen), deshalb dieses separate
// Skript statt manueller Admin-UI-Klickerei.
//
//   PB_URL=... PB_EMAIL=... PB_PASSWORD=... node setup/migrate_imports_note.mjs

import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.PB_URL ?? "http://127.0.0.1:8090");
await pb.collection("_superusers").authWithPassword(
  process.env.PB_EMAIL,
  process.env.PB_PASSWORD,
);

const imports = await pb.collections.getOne("imports");

const hasNoteField = imports.fields.some((f) => f.name === "note");
if (hasNoteField) {
  console.log("= imports.note existiert bereits, Feld übersprungen");
} else {
  imports.fields.push({ type: "text", name: "note", max: 500 });
  await pb.collections.update(imports.id, imports);
  console.log("+ imports.note Feld angelegt");
}
