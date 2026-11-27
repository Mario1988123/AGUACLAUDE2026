import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { listarBloqueos } from "@/modules/captacion/bloqueos-actions";
import { AnadirBloqueo, ListaBloqueos } from "@/modules/captacion/bloqueos-ui";

export const dynamic = "force-dynamic";

/**
 * Lista de bloqueo de captación (fase 3). La ven y la amplían gestores y
 * comerciales; quitar un bloqueo, solo el administrador de la empresa.
 */
export default async function BloqueosPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await assertCaptacionActiva();
  const { q } = await searchParams;
  const busqueda = (q ?? "").slice(0, 30);
  const datos = await listarBloqueos(busqueda);
  if (!datos) redirect("/captacion");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={"/captacion" as never} className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
          <ChevronLeft className="h-4 w-4" /> Captación
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Lista de bloqueo</h1>
        <p className="text-sm text-muted-foreground">
          A estos teléfonos no se les escribe nunca desde captación, aunque aparezcan en otra campaña.
          No afecta a las llamadas ni al correo.
        </p>
      </div>

      <AnadirBloqueo />

      <section className="space-y-3">
        <form className="flex gap-2" action="/captacion/bloqueos">
          <input
            name="q"
            type="search"
            inputMode="tel"
            defaultValue={busqueda}
            placeholder="Buscar un teléfono"
            aria-label="Buscar un teléfono"
            className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Buscar
          </button>
        </form>
        <ListaBloqueos bloqueos={datos.bloqueos} puedeQuitar={datos.puedeQuitar} />
        {datos.bloqueos.length >= 200 ? (
          <p className="text-center text-xs text-muted-foreground">Se enseñan los 200 últimos. Busca para ver otros.</p>
        ) : null}
      </section>
    </div>
  );
}
