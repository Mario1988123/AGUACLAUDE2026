import Link from "next/link";
import { Map, CalendarCheck, Users, Sparkles } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";

export const dynamic = "force-dynamic";

/**
 * Landing del módulo "Rutas con IA". Hub que enlaza a:
 *  · /mi-dia            — la ruta personal del usuario (todos los roles)
 *  · /rutas/equipo      — vista por equipo (solo admin/director)
 *  · /rutas/sugerencias — visitas cercanas a planificar (comercial)
 */
export default async function RutasHubPage() {
  await assertModuleActive("routes");
  const session = await requireSession();

  const isLeader =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  const isCommercial =
    isLeader ||
    session.roles.includes("sales_rep") ||
    session.roles.includes("telemarketer");

  const cards: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    desc: string;
    show: boolean;
  }> = [
    {
      href: "/mi-dia",
      label: "Mi día",
      icon: CalendarCheck,
      desc: "Tu ruta personal optimizada de hoy. Reordena con un clic.",
      show: true,
    },
    {
      href: "/rutas/equipo",
      label: "Vista equipo",
      icon: Users,
      desc: "Genera y reordena rutas para los técnicos / comerciales de tu equipo. Solo admin/director.",
      show: isLeader,
    },
    {
      href: "/rutas/sugerencias",
      label: "Sugerencias cercanas",
      icon: Sparkles,
      desc: "Leads y clientes próximos a tu posición — empaca el día sin gastar tiempo entre paradas.",
      show: isCommercial,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Map className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-extrabold tracking-tight">Rutas con IA</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Optimización de rutas diarias. La calidad depende de si tienes
          activo «Smart routes» en Google Maps Tools (tráfico real) o no
          (algoritmo Haversine local, gratis).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards
          .filter((c) => c.show)
          .map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.href}
                href={c.href as never}
                prefetch={false}
                className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md hover:shadow-primary/10"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-bold">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.desc}</div>
                </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
