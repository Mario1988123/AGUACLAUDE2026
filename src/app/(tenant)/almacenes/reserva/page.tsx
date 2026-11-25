import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { esGestorStock } from "@/shared/lib/auth/role-scope";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { BackButton } from "@/shared/components/back-button";
import { leerReservaFurgonetas } from "@/modules/warehouses/reserva-furgoneta-actions";
import { ReservaFurgonetaEditor } from "@/modules/warehouses/reserva-furgoneta-editor";

export const dynamic = "force-dynamic";

/**
 * Carga de reserva de las furgonetas (2026-11-25): lo que cada furgoneta debe
 * llevar siempre. La sugerencia de carga del técnico la repone.
 */
export default async function ReservaFurgonetaPage() {
  await assertModuleActive("warehouses");
  const session = await requireSession();
  if (!esGestorStock(session)) redirect("/almacenes" as never);
  const r = await leerReservaFurgonetas();

  return (
    <div className="space-y-4">
      <BackButton href="/almacenes" />
      <div>
        <h1 className="text-2xl font-bold">Carga de reserva</h1>
        <p className="text-sm text-muted-foreground">
          Lo que una furgoneta lleva siempre, además de lo de sus trabajos. Cada técnico elige la de su furgoneta en
          «Mi furgoneta»; aquí la puedes ver y cambiar. La de la empresa es la plantilla: vale para las furgonetas que
          aún no tienen reserva propia.
        </p>
      </div>
      {!r.ok ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">{r.error}</div>
      ) : !r.datos.disponible ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          Falta aplicar la migración de la carga de reserva (20261128130000). Hasta entonces la sugerencia de carga
          solo cuenta los trabajos.
        </div>
      ) : (
        <ReservaFurgonetaEditor datos={r.datos} />
      )}
    </div>
  );
}
