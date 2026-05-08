import {
  Banknote,
  CreditCard,
  Smartphone,
  ArrowLeftRight,
  Repeat,
  Landmark,
  Coins,
} from "lucide-react";
import fs from "node:fs";
import path from "node:path";

const METHOD_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    bg: string;
    text: string;
    border: string;
  }
> = {
  cash: {
    label: "Efectivo",
    icon: Coins,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  card: {
    label: "Tarjeta",
    icon: CreditCard,
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  bizum: {
    label: "Bizum",
    icon: Smartphone,
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    border: "border-cyan-200",
  },
  transfer: {
    label: "Transferencia",
    icon: ArrowLeftRight,
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
  },
  direct_debit: {
    label: "SEPA · Domiciliación",
    icon: Repeat,
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  financing: {
    label: "Financiación",
    icon: Landmark,
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
};

const FALLBACK = {
  label: "—",
  icon: Banknote,
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-border",
};

/**
 * Cache server-side: ¿existe `/public/payment-icons/{method}.{svg|png}`?
 * Se calcula la primera vez y se reutiliza (las imágenes nuevas requieren
 * redeploy de todos modos).
 */
const ICONS_DIR = path.join(process.cwd(), "public", "payment-icons");
const customIconCache = new Map<string, string | null>();

function resolveCustomIcon(method: string): string | null {
  if (customIconCache.has(method)) return customIconCache.get(method) ?? null;
  for (const ext of ["svg", "png"]) {
    const file = path.join(ICONS_DIR, `${method}.${ext}`);
    try {
      if (fs.existsSync(file)) {
        const url = `/payment-icons/${method}.${ext}`;
        customIconCache.set(method, url);
        return url;
      }
    } catch {
      /* no-op */
    }
  }
  customIconCache.set(method, null);
  return null;
}

export function PaymentMethodBadge({ method }: { method: string }) {
  const cfg = METHOD_CONFIG[method] ?? { ...FALLBACK, label: method };
  const customUrl = resolveCustomIcon(method);
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {customUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={customUrl} alt="" className="h-4 w-4 object-contain" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      <span className="whitespace-nowrap">{cfg.label}</span>
    </span>
  );
}
