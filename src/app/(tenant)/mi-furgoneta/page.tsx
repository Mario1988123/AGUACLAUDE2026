import { Truck } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { listarMiFurgonetaSemaforo } from "@/modules/warehouses/furgoneta-actions";
import { MiFurgonetaVista } from "@/modules/warehouses/mi-furgoneta-vista";
import { resumenRutaPorModelo } from "@/modules/equipos-modelo/ruta";
import { ResumenRutaCard } from "@/modules/equipos-modelo/resumen-ruta-card";

export const dynamic = "force-dynamic";

/**
 * Mi furgoneta (técnico, 2026-11-12): un punto de color por producto, sin
 * cifras. Verde = hay; ámbar = queda poco; gris = no queda.
 */
export default async function MiFurgonetaPage() {
  const session = await requireSession();
  const { furgoneta, productos } = await listarMiFurgonetaSemaforo();
  // Fuentes y ósmosis que le tocan hoy y mañana (plan modelo de equipo).
  // Null si la migración no está aplicada → no se pinta.
  const ahora = new Date();
  const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  const [rutaHoy, rutaManana] = session.company_id
    ? await Promise.all([
        resumenRutaPorModelo(session.company_id, session.user_id, ahora).catch(() => null),
        resumenRutaPorModelo(session.company_id, session.user_id, manana).catch(() => null),
      ])
    : [null, null];
  const resumenRuta =
    rutaHoy || rutaManana ? (
      <div className="grid gap-3 sm:grid-cols-2">
        {rutaHoy && <ResumenRutaCard titulo="Hoy" r={rutaHoy} />}
        {rutaManana && <ResumenRutaCard titulo="Mañana" r={rutaManana} />}
      </div>
    ) : null;

  if (!furgoneta) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Mi furgoneta</h1>
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <Truck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">No tienes furgoneta asignada</p>
          <p className="text-sm text-muted-foreground">Habla con la oficina para que te asignen una.</p>
        </div>
        {resumenRuta}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MiFurgonetaVista
        nombre={furgoneta.nombre}
        matricula={furgoneta.matricula}
        productos={productos}
      />
      {resumenRuta}
    </div>
  );
}
