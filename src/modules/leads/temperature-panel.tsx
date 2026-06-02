import Link from "next/link";
import { Flame, ThermometerSun, Snowflake, XCircle } from "lucide-react";

type Status =
  | "new"
  | "contacted"
  | "proposal_created"
  | "proposal_sent"
  | "free_trial_proposed"
  | "converted"
  | "lost"
  | "expired";

interface Lead {
  status: Status;
  created_at: string;
}

/**
 * Clasificación de temperatura (decisión 2026-05-20):
 *  - 🔥 Caliente: proposal_created / proposal_sent / free_trial_proposed
 *  - 🌡 Templado: contacted, o new < 24h
 *  - ❄ Frío: new > 24h sin contactar
 *  - 🚫 Perdido: lost / expired (info en card colapsada)
 *
 * converted no cuenta — ya es cliente.
 */
function classify(l: Lead): "hot" | "warm" | "cold" | "lost" | null {
  if (l.status === "converted") return null;
  if (l.status === "lost" || l.status === "expired") return "lost";
  if (
    l.status === "proposal_created" ||
    l.status === "proposal_sent" ||
    l.status === "free_trial_proposed"
  ) {
    return "hot";
  }
  if (l.status === "contacted") return "warm";
  // status === "new"
  const ageH = (Date.now() - new Date(l.created_at).getTime()) / 3600000;
  return ageH < 24 ? "warm" : "cold";
}

export function LeadsTemperaturePanel({
  leads,
  activeTemp,
  baseQuery,
}: {
  leads: Lead[];
  /** Temperatura activa para resaltar el card seleccionado. */
  activeTemp?: "hot" | "warm" | "cold" | "lost";
  /** Otros query params actuales (scope, q, kind…) para mantener al
   *  navegar entre temperaturas. Sin temp seleccionada → quitar el param. */
  baseQuery?: string;
}) {
  const counts = { hot: 0, warm: 0, cold: 0, lost: 0 };
  for (const l of leads) {
    const t = classify(l);
    if (t) counts[t] += 1;
  }

  const cards = [
    {
      key: "hot",
      label: "Calientes",
      hint: "Con propuesta",
      count: counts.hot,
      icon: Flame,
      cls: "border-red-300 bg-red-50 text-red-900",
      iconCls: "text-red-600",
    },
    {
      key: "warm",
      label: "Templados",
      hint: "Contactados / nuevos <24h",
      count: counts.warm,
      icon: ThermometerSun,
      cls: "border-amber-300 bg-amber-50 text-amber-900",
      iconCls: "text-amber-600",
    },
    {
      key: "cold",
      label: "Fríos",
      hint: "Nuevos sin tocar >24h",
      count: counts.cold,
      icon: Snowflake,
      cls: "border-blue-300 bg-blue-50 text-blue-900",
      iconCls: "text-blue-600",
    },
    {
      key: "lost",
      label: "Perdidos",
      hint: "Cerrados / caducados",
      count: counts.lost,
      icon: XCircle,
      cls: "border-zinc-300 bg-zinc-50 text-zinc-700",
      iconCls: "text-zinc-500",
    },
  ];

  // Versión compacta 2026-06-02: una sola fila de chips clicables en lugar
  // de 4 cards 2x2 (ocupaba 25% de la pantalla en móvil). Mantiene la
  // funcionalidad de filtro al hacer click y el estado activo (anillo).
  const base = baseQuery ? `${baseQuery}&` : "";
  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((c) => {
        const Icon = c.icon;
        const active = activeTemp === c.key;
        const href =
          activeTemp === c.key
            ? `/leads${baseQuery ? `?${baseQuery}` : ""}`
            : `/leads?${base}temp=${c.key}`;
        return (
          <Link
            key={c.key}
            href={href as never}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${c.cls} ${
              active ? "ring-2 ring-primary ring-offset-1" : "hover:opacity-90"
            }`}
          >
            <Icon className={`h-4 w-4 ${c.iconCls}`} aria-hidden="true" />
            <span>{c.label}</span>
            <span className="rounded-full bg-white/60 px-1.5 text-xs font-extrabold tabular-nums">
              {c.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
