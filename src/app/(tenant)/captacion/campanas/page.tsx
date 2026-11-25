import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { listarCampanas } from "@/modules/captacion/campanas-actions";
import { NuevaCampana } from "@/modules/captacion/campanas-ui";
import { describirZona } from "@/modules/captacion/busqueda-logica";

export const dynamic = "force-dynamic";

export default async function CampanasPage() {
  await assertCaptacionActiva();
  const datos = await listarCampanas();
  if (!datos) redirect("/captacion");
  const nombreTipo = new Map(datos.tipologias.map((t) => [t.clave, t.nombre]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Campañas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada campaña es un tipo de negocio en una zona. Buscar negocios no escribe a nadie: solo
          prepara la lista para revisarla.
        </p>
      </div>

      <NuevaCampana tipologias={datos.tipologias} />

      {datos.campanas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay campañas.</p>
      ) : (
        <ul className="space-y-3">
          {datos.campanas.map((c) => {
            const r = datos.recuento[c.id] ?? {};
            return (
              <li key={c.id}>
                <Link
                  href={`/captacion/campanas/${c.id}` as never}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border p-4 transition-colors hover:border-primary"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.nombre}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {nombreTipo.get(c.tipologia_clave ?? "") ?? "—"} · {c.zonas.map(describirZona).join(", ")}
                    </div>
                    <div className="mt-1 text-xs tabular-nums">
                      {r.nuevo ?? 0} nuevos · {r.revisar ?? 0} para revisar
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
