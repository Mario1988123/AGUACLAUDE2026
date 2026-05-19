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

export function LeadsTemperaturePanel({ leads }: { leads: Lead[] }) {
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

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.key}
            className={`rounded-xl border-2 p-3 ${c.cls}`}
          >
            <div className="flex items-center justify-between">
              <Icon className={`h-5 w-5 ${c.iconCls}`} />
              <span className="text-2xl font-extrabold tabular-nums">
                {c.count}
              </span>
            </div>
            <div className="mt-1 text-sm font-bold">{c.label}</div>
            <div className="text-[11px] opacity-80">{c.hint}</div>
          </div>
        );
      })}
    </div>
  );
}
