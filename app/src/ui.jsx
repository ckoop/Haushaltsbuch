import { useEffect } from "react";
import {
  ShoppingCart, UtensilsCrossed, Bus, Home, Zap, Film, HeartPulse, Shirt,
  Smartphone, MoreHorizontal, ArrowDownLeft, Landmark, Wallet, PiggyBank,
  CreditCard, ArrowLeftRight, Check, X, Loader2, Repeat,
} from "lucide-react";

export const eur = (cents) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);
export const eurAbs = (cents) => eur(Math.abs(cents ?? 0)).replace("-", "");

export const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli",
  "August","September","Oktober","November","Dezember"];

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function relDay(iso) {
  const t = todayISO();
  if (iso === t) return "Heute";
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === y) return "Gestern";
  return new Date(iso + "T12:00:00").toLocaleDateString("de-DE",
    { weekday: "short", day: "numeric", month: "long" });
}

const CAT_ICONS = {
  cart: ShoppingCart, utensils: UtensilsCrossed, bus: Bus, home: Home, zap: Zap,
  film: Film, heart: HeartPulse, shirt: Shirt, phone: Smartphone,
  dots: MoreHorizontal, income: ArrowDownLeft,
};
export const catIcon = (name) => CAT_ICONS[name] ?? MoreHorizontal;
export const CAT_ICON_KEYS = Object.keys(CAT_ICONS);

export const ACCOUNT_TYPES = [
  { id: "giro", label: "Girokonto", icon: Landmark },
  { id: "bar", label: "Bargeld", icon: Wallet },
  { id: "spar", label: "Sparen", icon: PiggyBank },
  { id: "kk", label: "Kreditkarte", icon: CreditCard },
];
export const typeIcon = (t) => (ACCOUNT_TYPES.find((x) => x.id === t) ?? ACCOUNT_TYPES[0]).icon;

const COLORS = {
  emerald: ["bg-emerald-50 dark:bg-emerald-500/15", "text-emerald-700 dark:text-emerald-400", "bg-emerald-600 dark:bg-emerald-500"],
  orange:  ["bg-orange-50 dark:bg-orange-500/15", "text-orange-700 dark:text-orange-400", "bg-orange-500 dark:bg-orange-500"],
  violet:  ["bg-violet-50 dark:bg-violet-500/15", "text-violet-700 dark:text-violet-400", "bg-violet-500 dark:bg-violet-500"],
  sky:     ["bg-sky-50 dark:bg-sky-500/15", "text-sky-700 dark:text-sky-400", "bg-sky-600 dark:bg-sky-500"],
  yellow:  ["bg-yellow-50 dark:bg-yellow-500/15", "text-yellow-700 dark:text-yellow-400", "bg-yellow-500 dark:bg-yellow-500"],
  pink:    ["bg-pink-50 dark:bg-pink-500/15", "text-pink-700 dark:text-pink-400", "bg-pink-500 dark:bg-pink-500"],
  rose:    ["bg-rose-50 dark:bg-rose-500/15", "text-rose-700 dark:text-rose-400", "bg-rose-500 dark:bg-rose-500"],
  amber:   ["bg-amber-50 dark:bg-amber-500/15", "text-amber-700 dark:text-amber-400", "bg-amber-500 dark:bg-amber-500"],
  teal:    ["bg-teal-50 dark:bg-teal-500/15", "text-teal-700 dark:text-teal-400", "bg-teal-600 dark:bg-teal-500"],
  lime:    ["bg-lime-50 dark:bg-lime-500/15", "text-lime-700 dark:text-lime-400", "bg-lime-600 dark:bg-lime-500"],
  stone:   ["bg-stone-100 dark:bg-stone-500/15", "text-stone-600 dark:text-stone-400", "bg-stone-400 dark:bg-stone-500"],
};
export const colorOf = (name) => COLORS[name] ?? COLORS.stone;
export const COLOR_KEYS = Object.keys(COLORS);

export const UNKNOWN_ACC = { id: "?", name: "Gelöschtes Konto", short: "?", type: "giro" };
export const UNKNOWN_CAT = { id: "?", name: "Ohne Kategorie", icon: "dots", color: "stone" };
export const UNKNOWN_TAG = { id: "?", name: "Gelöschter Tag" };
export const byId = (list, id, fallback) => list.find((x) => x.id === id) ?? fallback;
// 14 statt 8 Zeichen, sonst kappt das gängige Wörter wie "Girokonto" (9) oder
// "Kreditkarte" (11) mitten im Wort ab, ohne Auslassungspunkte anzuzeigen.
export const shortName = (n) => (n ?? "").trim().split(/\s+/)[0].slice(0, 14) || "Konto";

export const RECURRING = [
  ["", "Nie"], ["monthly", "Monatlich"], ["quarterly", "Quartalsweise"], ["yearly", "Jährlich"],
];
export const recurringLabel = (v) => RECURRING.find(([val]) => val === v)?.[1] ?? "";

// ------------------------------------------------------------------ Bausteine

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-stone-500 dark:text-stone-400 text-sm">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Lädt …"}
    </div>
  );
}

export function Button({ variant = "primary", className = "", ...props }) {
  const base = "py-3 rounded-xl text-sm active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100";
  const styles = {
    primary: "bg-emerald-700 dark:bg-emerald-600 text-white font-medium",
    ghost: "border border-stone-300 dark:border-stone-600 dark:text-stone-200",
    danger: "border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs text-stone-500 dark:text-stone-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 dark:text-stone-100 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-600 dark:focus:border-emerald-500 dark:placeholder:text-stone-500";

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // Endet auf Mobile exakt oberhalb der Bottom-Nav (--nav-h, siehe index.css),
    // statt sie zu verdecken. Auf dem Desktop-Sidebar-Layout gibt es keine
    // Bottom-Nav, dort wieder volle Höhe.
    <div className="absolute top-0 inset-x-0 bottom-[var(--nav-h)] sidebar:bottom-0 z-30 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/40 dark:bg-black/60" />
      <div className="relative w-full max-h-[88%] overflow-y-auto bg-[#FAFAF8] dark:bg-stone-900 rounded-t-2xl p-5"
        onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-[15px] font-medium">{title}</span>
            <button onClick={onClose} className="text-stone-500 dark:text-stone-400"><X size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-stone-900 dark:bg-stone-700 text-white text-sm px-4 py-2 rounded-full flex items-center gap-2 z-40">
      <Check size={15} /> {text}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2 my-2">
      {typeof error === "string" ? error : error.message || "Etwas ist schiefgelaufen."}
    </p>
  );
}

export function BudgetBar({ name, limit, spent }) {
  const pct = Math.min(100, Math.round((spent / limit) * 100));
  const over = spent > limit;
  const color = over ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-600 dark:bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-[13px] mb-1.5">
        <span>{name}</span>
        <span className={`tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-stone-500 dark:text-stone-400"}`}>
          {eur(spent)} / {eur(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

export function TxRow({ tx, accounts, categories, showAccount, onClick }) {
  const isTransfer = tx.type === "transfer";
  const cat = isTransfer ? null : byId(categories, tx.category, UNKNOWN_CAT);
  const from = byId(accounts, tx.account, UNKNOWN_ACC);
  const Icon = isTransfer ? ArrowLeftRight : catIcon(cat.icon);
  const [bg, fg] = isTransfer ? ["bg-stone-100 dark:bg-stone-700", "text-stone-500 dark:text-stone-400"] : colorOf(cat.color);

  const sub = (isTransfer
    ? `${from.short || shortName(from.name)} → ${byId(accounts, tx.to_account, UNKNOWN_ACC).short}`
    : showAccount ? `${cat.name} · ${from.short || shortName(from.name)}` : cat.name)
    + (tx.recurring ? ` · ${recurringLabel(tx.recurring)}` : "");

  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50 dark:active:bg-stone-700/50">
      <span className={`w-9 h-9 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
        <Icon size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1 text-sm truncate">
          {tx.recurring && <Repeat size={11} className="text-stone-400 dark:text-stone-500 shrink-0" />}
          <span className="truncate">{tx.payee || (isTransfer ? "Umbuchung" : cat.name)}</span>
        </span>
        <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{sub}</span>
      </span>
      <span className={`text-sm font-medium tabular-nums ${
        isTransfer ? "text-stone-400 dark:text-stone-500" : tx.amount_cents > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {isTransfer ? "" : tx.amount_cents > 0 ? "+" : "−"}{eurAbs(tx.amount_cents)}
      </span>
    </button>
  );
}

// Konto-Auswahlraster, geteilt zwischen NewEntry.jsx (Buchung erfassen) und
// Konten.jsx (Dauerauftrag-Editor).
export function AccountPicker({ accounts, value, onChange, disabledId }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {accounts.map((a) => {
        const Icon = typeIcon(a.type);
        const on = value === a.id;
        const off = disabledId === a.id;
        return (
          <button key={a.id} disabled={off} onClick={() => onChange(a.id)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left ${
              off ? "bg-stone-50 dark:bg-stone-800/50 border-stone-200 dark:border-stone-700 opacity-40"
                : on ? "bg-stone-900 border-stone-900 dark:bg-emerald-600 dark:border-emerald-600 text-white"
                  : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700"}`}>
            <Icon size={16} className={on ? "text-stone-300" : "text-stone-400 dark:text-stone-500"} />
            <span className="text-[13px] truncate">{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
