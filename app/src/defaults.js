// Vorbelegung fuer eine leere Datenbank (seedDefaults() in beiden Backends).

export const DEFAULT_CATEGORIES = [
  { name: "Lebensmittel", icon: "cart",      kind: "expense", color: "emerald" },
  { name: "Restaurant",   icon: "utensils",  kind: "expense", color: "orange" },
  { name: "Mobilität",    icon: "bus",       kind: "expense", color: "violet" },
  { name: "Wohnen",       icon: "home",      kind: "expense", color: "sky" },
  { name: "Energie",      icon: "zap",       kind: "expense", color: "yellow" },
  { name: "Freizeit",     icon: "film",      kind: "expense", color: "pink" },
  { name: "Gesundheit",   icon: "heart",     kind: "expense", color: "rose" },
  { name: "Kleidung",     icon: "shirt",     kind: "expense", color: "amber" },
  { name: "Abos",         icon: "phone",     kind: "expense", color: "teal" },
  { name: "Sonstiges",    icon: "dots",      kind: "expense", color: "stone" },
  { name: "Einkommen",    icon: "income",    kind: "income",  color: "lime" },
];
