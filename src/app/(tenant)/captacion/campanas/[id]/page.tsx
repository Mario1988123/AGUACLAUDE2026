import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { obtenerCampana } from "@/modules/captacion/campanas-actions";
import { AccionesBusqueda, TarjetaProspecto } from "@/modules/captacion/campanas-ui";
import { describirZona } from "@/modules/captacion/busqueda-logica";
import { StatusPill } from "@/shared/components/status-pill";
import { cn } from "@/shared/lib/utils";

export const dynamic = "force-dynamic";
// «Procesar ahora» lee webs durante ~45 s.
export const maxDuration = 60;

const ETAPAS = [
  { clave: "nuevo", label: "Nuevos" },
  { clave: "revisar", label: "Revisar" },
  { clave: "descartado", label: "Descartados" },
] as const;

const ESTADO_BUSQUEDA: Record<string, { label: string; tone: "info" | "processing" | "success" | "rejected" }> = {
  pendiente: { label: "En cola", tone: "info" },
  en_curso: { label: "A medias", tone: "processing" },
  hecha: { label: "Hecha", tone: "success" },
  fallida: { label: "Falló", tone: "rejected" },
};

export default async function CampanaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ etapa?: string }>;
}) {
  await assertCaptacionActiva();
  const { id } = await params;
  const { etapa: e } = await searchParams;
  const etapa = ETAPAS.some((x) => x.clave === e) ? (e as string) : "nuevo";
  const datos = await obtenerCampana(id, etapa);
  if (!datos) notFound();
  const { campana, busquedas, prospectos, recuento } = datos;
  const hayPendientes = busquedas.some((b) => b.estado === "pendiente" || b.estado === "en_curso");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={"/captacion/campanas" as never} className="inline-flex items-center text-sm text-muted-foreground">
          <ChevronLeft className="h-4 w-4" /> Campañas
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{campana.nombre}</h1>
        <p className="text-sm text-muted-foreground">{campana.zonas.map(describirZona).join(", ")}</p>
      </div>

      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
        <h2 className="text-base font-bold">Búsqueda de negocios</h2>
        <p className="text-sm text-muted-foreground">
          Se buscan en OpenStreetMap y se lee la web de cada uno para sacar el teléfono que publica.
          Los que ya son clientes o leads van a «Revisar»; nunca a «Nuevos».
        </p>
        <AccionesBusqueda campanaId={campana.id} hayPendientes={hayPendientes} places={datos.places} />
        {busquedas.length > 0 ? (
          <ul className="divide-y divide-border">
            {busquedas.map((b) => (
              <li key={b.id} className="space-y-1 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">
                    {describirZona(b.zona)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {b.fuente === "places" ? "Google" : "Mapa"}
                    </span>
                  </span>
                  <StatusPill {...(ESTADO_BUSQUEDA[b.estado] ?? { label: b.estado, tone: "info" as const })} className="shrink-0" />
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  {b.encontrados} en el mapa
                  {b.progreso ? ` · mirados ${b.progreso.i} de ${b.progreso.total}` : ""} · {b.nuevos} nuevos ·{" "}
                  {b.revisar} para revisar
                  {b.descartados ? ` · ${b.descartados} descartados` : ""}
                </div>
                {b.error ? <div className="text-xs text-muted-foreground">{b.error}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Etapas">
          {ETAPAS.map((x) => (
            <Link
              key={x.clave}
              href={`/captacion/campanas/${campana.id}?etapa=${x.clave}` as never}
              scroll={false}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium",
                etapa === x.clave ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {x.label}
              <span className="tabular-nums opacity-80">{recuento[x.clave] ?? 0}</span>
            </Link>
          ))}
        </nav>

        {prospectos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nada en esta etapa.</p>
        ) : (
          <ul className="space-y-3">
            {prospectos.map((p) => (
              <TarjetaProspecto key={p.id} p={p} />
            ))}
          </ul>
        )}
        {prospectos.length >= 200 ? (
          <p className="text-center text-xs text-muted-foreground">Se enseñan los 200 primeros, ordenados por prioridad.</p>
        ) : null}
      </section>
    </div>
  );
}
