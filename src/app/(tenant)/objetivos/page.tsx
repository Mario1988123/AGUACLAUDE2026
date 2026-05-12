import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { getObjectivesCascade } from "@/modules/sales/cascade-actions";
import { ObjectivesCascadeReadonly } from "@/modules/sales/cascade-view-readonly";

export const dynamic = "force-dynamic";

/**
 * Página global /objetivos: SOLO LECTURA.
 *
 * Muestra el resumen del mes (cascada nivel 1 → nivel 2 con % completado).
 * Cualquier edición redirige a /configuracion/objetivos para evitar tener
 * dos sitios donde modificar la misma tabla `monthly_objectives`.
 */
export default async function ObjectivesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const session = await requireSession();
  const isLevel1 = session.is_superadmin || session.roles.includes("company_admin");
  const isDirector =
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!isLevel1 && !isDirector) {
    // Niveles 3 ven sus objetivos personales en el dashboard, no aquí.
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const now = new Date();
  const year = sp.y ? Number(sp.y) : now.getFullYear();
  const month = sp.m ? Number(sp.m) : now.getMonth() + 1;

  const cascade = await getObjectivesCascade(year, month).catch(() => []);

  function monthHref(yearN: number, monthN: number) {
    return `/objetivos?y=${yearN}&m=${monthN}` as const;
  }

  function prev() {
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    return monthHref(y, m);
  }
  function next() {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    return monthHref(y, m);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Objetivos del mes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumen del cumplimiento (departamentos y miembros). Para crear o
            modificar targets ve a{" "}
            <Link
              href="/configuracion/objetivos"
              className="font-bold text-primary hover:underline"
            >
              /configuracion/objetivos
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={prev()}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ← Mes anterior
          </Link>
          <span className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
            {String(month).padStart(2, "0")}/{year}
          </span>
          <Link
            href={next()}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            Mes siguiente →
          </Link>
        </div>
      </div>

      <ObjectivesCascadeReadonly data={cascade} />
    </div>
  );
}
