import {
  ShoppingCart, UtensilsCrossed, Bus, Home, Zap, Film, HeartPulse, Shirt,
  Smartphone, MoreHorizontal, ArrowDownLeft, Landmark, Wallet, PiggyBank,
  CreditCard, ArrowLeftRight, Check, X, Loader2,
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

export const ACCOUNT_TYPES = [
  { id: "giro", label: "Girokonto", icon: Landmark },
  { id: "bar", label: "Bargeld", icon: Wallet },
  { id: "spar", label: "Sparen", icon: PiggyBank },
  { id: "kk", label: "Kreditkarte", icon: CreditCard },
];
export const typeIcon = (t) => (ACCOUNT_TYPES.find((x) => x.id === t) ?? ACCOUNT_TYPES[0]).icon;

const COLORS = {
  emerald: ["bg-emerald-50", "text-emerald-700", "bg-emerald-600"],
  orange:  ["bg-orange-50", "text-orange-700", "bg-orange-500"],
  violet:  ["bg-violet-50", "text-violet-700", "bg-violet-500"],
  sky:     ["bg-sky-50", "text-sky-700", "bg-sky-600"],
  yellow:  ["bg-yellow-50", "text-yellow-700", "bg-yellow-500"],
  pink:    ["bg-pink-50", "text-pink-700", "bg-pink-500"],
  rose:    ["bg-rose-50", "text-rose-700", "bg-rose-500"],
  amber:   ["bg-amber-50", "text-amber-700", "bg-amber-500"],
  teal:    ["bg-teal-50", "text-teal-700", "bg-teal-600"],
  lime:    ["bg-lime-50", "text-lime-700", "bg-lime-600"],
  stone:   ["bg-stone-100", "text-stone-600", "bg-stone-400"],
};
export const colorOf = (name) => COLORS[name] ?? COLORS.stone;

export const UNKNOWN_ACC = { id: "?", name: "Gelöschtes Konto", short: "?", type: "giro" };
export const UNKNOWN_CAT = { id: "?", name: "Ohne Kategorie", icon: "dots", color: "stone" };
export const byId = (list, id, fallback) => list.find((x) => x.id === id) ?? fallback;
export const shortName = (n) => (n ?? "").trim().split(/\s+/)[0].slice(0, 8) || "Konto";

// ------------------------------------------------------------------ Bausteine

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-stone-500 text-sm">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Lädt …"}
    </div>
  );
}

export function Button({ variant = "primary", className = "", ...props }) {
  const base = "py-3 rounded-xl text-sm active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100";
  const styles = {
    primary: "bg-emerald-700 text-white font-medium",
    ghost: "border border-stone-300",
    danger: "border border-red-200 text-red-600",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs text-stone-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full text-sm bg-white border border-stone-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-600";

export function Sheet({ title, onClose, children }) {
  return (
    <div className="absolute inset-0 z-30 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/40" />
      <div className="relative w-full max-h-[88%] overflow-y-auto bg-[#FAFAF8] rounded-t-2xl p-5"
        onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-[15px] font-medium">{title}</span>
            <button onClick={onClose} className="text-stone-500"><X size={20} /></button>
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
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-sm px-4 py-2 rounded-full flex items-center gap-2 z-40">
      <Check size={15} /> {text}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 my-2">
      {typeof error === "string" ? error : error.message || "Etwas ist schiefgelaufen."}
    </p>
  );
}

export function BudgetBar({ name, limit, spent }) {
  const pct = Math.min(100, Math.round((spent / limit) * 100));
  const over = spent > limit;
  const color = over ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div>
      <div className="flex justify-between text-[13px] mb-1.5">
        <span>{name}</span>
        <span className={`tabular-nums ${over ? "text-red-600" : "text-stone-500"}`}>
          {eur(spent)} / {eur(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
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
  const [bg, fg] = isTransfer ? ["bg-stone-100", "text-stone-500"] : colorOf(cat.color);

  const sub = isTransfer
    ? `${from.short || shortName(from.name)} → ${byId(accounts, tx.to_account, UNKNOWN_ACC).short}`
    : showAccount ? `${cat.name} · ${from.short || shortName(from.name)}` : cat.name;

  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-stone-50">
      <span className={`w-9 h-9 rounded-full ${bg} ${fg} flex items-center justify-center shrink-0`}>
        <Icon size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm truncate">{tx.payee || (isTransfer ? "Umbuchung" : cat.name)}</span>
        <span className="block text-xs text-stone-500 truncate">{sub}</span>
      </span>
      <span className={`text-sm font-medium tabular-nums ${
        isTransfer ? "text-stone-400" : tx.amount_cents > 0 ? "text-emerald-700" : ""}`}>
        {isTransfer ? "" : tx.amount_cents > 0 ? "+" : "−"}{eurAbs(tx.amount_cents)}
      </span>
    </button>
  );
}
