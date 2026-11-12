import { Truck } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { listarMiFurgonetaSemaforo } from "@/modules/warehouses/furgoneta-actions";
import { MiFurgonetaVista } from "@/modules/warehouses/mi-furgoneta-vista";

export const dynamic = "force-dynamic";

/**
 * Mi furgoneta (técnico, 2026-11-12): un punto de color por producto, sin
 * cifras. Verde = hay; ámbar = queda poco; gris = no queda.
 */
export default async function MiFurgonetaPage() {
  await requireSession();
  const { furgoneta, productos } = await listarMiFurgonetaSemaforo();

  if (!furgoneta) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Mi furgoneta</h1>
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <Truck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">No tienes furgoneta asignada</p>
          <p className="text-sm text-muted-foreground">Habla con la oficina para que te asignen una.</p>
        </div>
      </div>
    );
  }

  return (
    <MiFurgonetaVista
      nombre={furgoneta.nombre}
      matricula={furgoneta.matricula}
      productos={productos}
    />
  );
}
