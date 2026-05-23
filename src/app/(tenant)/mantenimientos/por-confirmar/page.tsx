import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { listInstallers } from "@/modules/agenda/actions";
import { listMaintenanceToConfirm } from "@/modules/maintenance/to-confirm-actions";
import { ToConfirmList } from "@/modules/maintenance/to-confirm-list";

export const dynamic = "force-dynamic";

export default async function MantenimientosPorConfirmarPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  // window=year → todos los del año (default); window=30 → solo próximos 30 días.
  const win = sp.window === "30" ? 30 : sp.window === "90" ? 90 : null;

  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  if (!allowed) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Solo el administrador, dirección técnica o TMK pueden gestionar la cola
        de confirmación de mantenimientos.
      </div>
    );
  }

  const [rows, installers] = await Promise.all([
    listMaintenanceToConfirm(win ?? undefined),
    listInstallers().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/mantenimientos"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3 w-3" /> Mantenimientos
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Mantenimientos por confirmar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visitas preprogramadas: llama al cliente, confirma fecha+hora y
            asigna al técnico que va a ir. Cuando lo confirmes, la visita pasa
            a la agenda real.
          </p>
        </div>
        <div className="inline-flex rounded-xl border bg-card p-0.5 text-xs font-semibold">
          <Link
            href="/mantenimientos/por-confirmar"
            className={`rounded-lg px-3 py-1.5 ${
              !win
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Año completo
          </Link>
          <Link
            href="/mantenimientos/por-confirmar?window=90"
            className={`rounded-lg px-3 py-1.5 ${
              win === 90
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Próximos 90 días
          </Link>
          <Link
            href="/mantenimientos/por-confirmar?window=30"
            className={`rounded-lg px-3 py-1.5 ${
              win === 30
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Próximos 30 días
          </Link>
        </div>
      </div>

      <ToConfirmList rows={rows} installers={installers} />
    </div>
  );
}
