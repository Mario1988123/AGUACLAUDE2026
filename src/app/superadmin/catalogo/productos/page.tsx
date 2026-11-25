import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { BackButton } from "@/shared/components/back-button";
import { Pagination } from "@/shared/components/pagination";
import {
  TAMANO_PAGINA,
  leerFiltros,
  leerListaMaestro,
} from "@/modules/superadmin/catalogo/catalogo-lectura";
import {
  agruparEfectivo,
  esKiosco,
  filtrosAParams,
  vistaEfectiva,
} from "@/modules/superadmin/catalogo/catalogo-etiquetas";
import { BuscadorCatalogo, ListaFiltros } from "@/modules/superadmin/catalogo/lista-filtros";
import { KioscoCategorias } from "@/modules/superadmin/catalogo/kiosco-categorias";
import { TarjetaCarpeta, TarjetaRejilla } from "@/modules/superadmin/catalogo/tarjeta-producto";
import { FilaProducto } from "@/modules/superadmin/catalogo/fila-producto";

export const dynamic = "force-dynamic";

const BASE = "/superadmin/catalogo/productos";

function hrefCon(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const q = sp.toString();
  return q ? `${BASE}?${q}` : BASE;
}

function BotonNuevo() {
  return (
    <Button asChild className="h-11">
      <Link href={`${BASE}/nuevo` as never}>
        <Plus className="h-4 w-4" /> Nuevo producto
      </Link>
    </Button>
  );
}

export default async function ProductosMaestrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltros(await searchParams);
  const kiosco = esKiosco(filtros);
  const res = await leerListaMaestro(filtros, { kiosco });

  // ------------------------------------------------------------- kiosco
  if (kiosco) {
    return (
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl font-bold">Catálogo maestro</h1>
          <BotonNuevo />
        </div>
        <BuscadorCatalogo />
        {res.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            No se ha podido leer el catálogo: {res.error}
          </div>
        ) : (
          <KioscoCategorias categorias={res.categorias} totalRecambios={res.totalRecambios} />
        )}
      </div>
    );
  }

  // ------------------------------------------------------- lista / rejilla
  const vista = vistaEfectiva(filtros);
  const agrupado = agruparEfectivo(filtros);
  const params = filtrosAParams(filtros);
  const cat = res.categorias.find((c) => c.key === filtros.cat);
  const gama = res.gamas.find((g) => g.id === filtros.gama);
  const titulo = gama
    ? gama.nombre
    : filtros.q
      ? `Resultados de «${filtros.q}»`
      : filtros.tipo === "recambios"
        ? filtros.fam || "Recambios y consumibles"
        : cat?.nombre ?? (filtros.tipo === "todos" ? "Todo el catálogo" : "Equipos");
  const volver = gama
    ? { href: hrefCon({ ...params, gama: undefined }), label: cat?.nombre ?? "Volver" }
    : { href: BASE, label: "Categorías" };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <BackButton href={volver.href} label={volver.label} />
          <h1 className="break-words text-2xl font-bold">{titulo}</h1>
          {gama && <p className="text-sm text-muted-foreground">{gama.total} artículos en esta gama</p>}
        </div>
        <BotonNuevo />
      </div>

      <ListaFiltros
        filtros={filtros}
        categorias={res.categorias}
        familias={res.familias}
        fabricantes={res.fabricantes}
        gamas={res.gamas}
        total={res.total}
        unidad={agrupado ? "modelos" : "productos"}
      />

      {res.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          No se ha podido leer el catálogo: {res.error}
        </div>
      ) : res.items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Ningún producto cumple estos filtros.
        </div>
      ) : vista === "lista" ? (
        <ul className="space-y-2">
          {res.items.map((p) => (
            <li key={p.id}>
              <FilaProducto item={p} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {res.items.map((p) => (
            <li key={p.id} className="flex">
              {agrupado && p.variantes > 0 && !p.esVariante ? (
                <TarjetaCarpeta item={p} href={hrefCon({ ...params, gama: p.id })} />
              ) : (
                <TarjetaRejilla item={p} nombreCompleto={!!filtros.gama} />
              )}
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath={BASE}
        page={filtros.page}
        pageSize={TAMANO_PAGINA}
        totalCount={res.total}
        preserveParams={params}
        grande
      />
    </div>
  );
}
