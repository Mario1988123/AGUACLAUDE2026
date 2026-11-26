import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileText, Pencil, Share2 } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { CollapsibleCard } from "@/modules/products/collapsible-card";
import { canSeeProductCost, isProductEditor } from "@/modules/products/permissions";
import { leerFichaEmpresa } from "@/modules/products/productos-lectura";
import { formatearEuros, repartirFotos } from "@/modules/products/productos-vista";
import { getProductStockSummary } from "@/modules/products/stock-actions";
import { listPriceHistory } from "@/modules/products/bulk-actions";
import { getProductCatalogStatus } from "@/modules/products/catalog-update-actions";
import { CatalogUpdateBanner } from "@/modules/products/catalog-update-banner";
import { getCriticalAttributesState } from "@/modules/products/critical-attrs-actions";
import { CriticalAttributesBanner } from "@/modules/products/critical-attrs-banner";
import { InterruptorPruebaGratuita } from "@/modules/products/interruptor-prueba-gratuita-servidor";
import { KIND_LABEL } from "@/modules/products/schemas";
import { formatearNumero } from "@/modules/superadmin/catalogo/catalogo-etiquetas";
import { FichaGaleria } from "@/modules/superadmin/catalogo/ficha-galeria";
import {
  TablaCaracteristicas,
  agruparCaracteristicas,
  type FilaCaracteristica,
} from "@/modules/superadmin/catalogo/ficha-caracteristicas";
import { FichaTecnica } from "@/modules/superadmin/catalogo/ficha-tecnica";
import { FichaVariantes } from "@/modules/superadmin/catalogo/ficha-variantes";
import { FichaRecambios } from "@/modules/superadmin/catalogo/ficha-recambios";
import { FichaDocumentos } from "@/modules/superadmin/catalogo/ficha-documentos";

export const dynamic = "force-dynamic";

/**
 * Ficha de LECTURA de un producto de la empresa, con la misma estructura que la
 * del catálogo maestro (cabecera, galería, ficha técnica por grupos con el
 * dibujo de medidas junto a Físicas, variantes, recambios y documentos), más el
 * precio y el stock. Sin un solo control de formulario: editar está en
 * /productos/[id]/editar.
 */

function Contador({ n }: { n: number }) {
  return <span className="text-sm font-normal text-muted-foreground tabular-nums">{n}</span>;
}

const TAB_TRIGGER = "h-11 px-3 text-sm";
const TITULO_SECCION = "mb-3 text-sm font-bold uppercase tracking-wide text-primary";
const hrefVariante = (vid: string) => `/productos/${vid}`;

export default async function ProductoFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ abrir?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Enlaces antiguos («Necesitamos tu ayuda», lápiz de la tabla): ahora se edita en /editar.
  if (sp?.abrir === "filtros") redirect(`/productos/${id}/editar?seccion=filtros#filtros` as never);
  if (sp?.edit === "1") redirect(`/productos/${id}/editar` as never);

  const session = await requireSession();
  const p = await leerFichaEmpresa(id);
  if (!p) notFound();

  const canEdit = isProductEditor(session);
  const canSeeCost = canSeeProductCost(session);
  const hrefEditar = `/productos/${p.id}/editar`;

  const [stock, catalogStatus, criticalState, historial] = await Promise.all([
    getProductStockSummary(p.id).catch(() => ({ total: 0, by_warehouse: [] })),
    canEdit
      ? getProductCatalogStatus(p.id).catch(() => null)
      : Promise.resolve(null),
    canEdit
      ? getCriticalAttributesState(p.id).catch(() => ({ isDismissed: true, missing: [] }))
      : Promise.resolve({ isDismissed: true, missing: [] }),
    canSeeCost ? listPriceHistory(p.id).catch(() => []) : Promise.resolve([]),
  ]);

  // Físicas que viven en columnas del producto (cotas a/b/c y peso), como en el maestro.
  const fisicasExtra: FilaCaracteristica[] = [];
  if (p.anchoMm) fisicasExtra.push({ etiqueta: "Ancho (a)", valor: `${formatearNumero(p.anchoMm)} mm` });
  if (p.altoMm) fisicasExtra.push({ etiqueta: "Alto (b)", valor: `${formatearNumero(p.altoMm)} mm` });
  if (p.fondoMm) fisicasExtra.push({ etiqueta: "Fondo (c)", valor: `${formatearNumero(p.fondoMm)} mm` });
  if (p.pesoG) fisicasExtra.push({ etiqueta: "Peso", valor: `${formatearNumero(p.pesoG / 1000)} kg` });
  const visibles = p.caracteristicas.filter((c) => c.visible);
  const bloques = agruparCaracteristicas(visibles, fisicasExtra);
  const nCaract = bloques.reduce((s, b) => s + b.filas.length, 0);

  // Galería repartida igual que en el maestro.
  const reparto = repartirFotos(p.fotos);
  const fotosImagenes = reparto.imagenes;
  const imagenes = fotosImagenes.length > 0 && <FichaGaleria fotos={fotosImagenes} nombre={p.nombre} />;
  const imagenMedidas = reparto.medidas;
  const proyecciones = reparto.proyecciones.map((f) => ({
    id: f.id,
    etiqueta: f.etiqueta,
    url: f.url,
    miniatura: f.miniatura,
  }));
  const nRecambios = p.recambios.length;

  const categoria = p.categoria
    ? p.categoriaPadre
      ? `${p.categoriaPadre} · ${p.categoria.nombre}`
      : p.categoria.nombre
    : null;
  const volver = p.categoria
    ? { href: `/productos?cat=${p.categoria.id}`, label: p.categoria.nombre }
    : { href: "/productos", label: "Productos" };

  // Precio y stock
  const { contadoCents, desdeMesCents } = p.precio;
  const hayStock = stock.total > 0;
  const stockBajo = p.stockGestionado && p.stockMin > 0 && stock.total <= p.stockMin;
  const insigniaStock = hayStock ? (
    <Badge variant={stockBajo ? "warning" : "success"}>
      {stockBajo ? "Stock bajo" : "Hay stock"}
      {canSeeCost ? ` · ${stock.total.toLocaleString("es-ES")} ud` : ""}
    </Badge>
  ) : p.stockGestionado ? (
    <Badge variant="secondary">Sin stock</Badge>
  ) : null;

  // Qué le falta a la ficha (solo editor, una sola vez).
  const falta: Array<{ texto: string; seccion: string }> = [];
  if (p.fotos.length === 0) falta.push({ texto: "foto", seccion: "fotos" });
  if (visibles.length === 0) falta.push({ texto: "características", seccion: "caracteristicas" });
  if (!p.anchoMm || !p.altoMm || !p.fondoMm) falta.push({ texto: "medidas", seccion: "datos" });
  if (contadoCents == null) falta.push({ texto: "precio", seccion: "precio" });
  if (!p.descCorta && !p.descLarga) falta.push({ texto: "descripción", seccion: "datos" });

  const garantia = [
    p.garantia.general ? `General ${p.garantia.general} meses` : null,
    p.garantia.electronica ? `Electrónica ${p.garantia.electronica} meses` : null,
    p.garantia.carcasa ? `Carcasa ${p.garantia.carcasa} meses` : null,
  ].filter(Boolean);

  const ultimoPrecio = (historial as Array<{ changed_at?: string; created_at?: string }>)[0];
  const fechaUltimoPrecio = ultimoPrecio?.changed_at ?? ultimoPrecio?.created_at ?? null;

  // ---------------------------------------------------------------- bloques
  const variantes = <FichaVariantes variantes={p.variantes} actualId={p.id} hrefDe={hrefVariante} />;
  const recambios = <FichaRecambios recambios={p.recambios} proyecciones={proyecciones} hrefBase={null} />;
  const documentos = <FichaDocumentos documentos={p.documentos} />;
  const descripcion = (p.descCorta || p.descLarga) && (
    <div className="space-y-2 text-sm">
      {p.descCorta && <p>{p.descCorta}</p>}
      {p.descLarga && <p className="whitespace-pre-line text-muted-foreground">{p.descLarga}</p>}
    </div>
  );
  const notaRecambios = p.recambiosDeGama && (
    <p className="mb-2 text-xs text-muted-foreground">Son los de su gama: esta variante no tiene filtros propios.</p>
  );
  const gestion = canSeeCost && (
    <dl className="divide-y text-sm">
      <div className="grid grid-cols-2 gap-3 py-2">
        <dt className="text-muted-foreground">Stock</dt>
        <dd className="text-right font-medium tabular-nums">
          {stock.total.toLocaleString("es-ES")} ud
          {p.stockGestionado && p.stockMin > 0 ? ` · mínimo ${p.stockMin}` : ""}
          {stock.by_warehouse.length > 0
            ? ` · ${stock.by_warehouse.length} ${stock.by_warehouse.length === 1 ? "almacén" : "almacenes"}`
            : ""}
        </dd>
      </div>
      {p.costeCents != null && (
        <div className="grid grid-cols-2 gap-3 py-2">
          <dt className="text-muted-foreground">Coste (CMP)</dt>
          <dd className="text-right font-medium tabular-nums">{formatearEuros(p.costeCents)}</dd>
        </div>
      )}
      {fechaUltimoPrecio && (
        <div className="grid grid-cols-2 gap-3 py-2">
          <dt className="text-muted-foreground">Último cambio de precio</dt>
          <dd className="text-right font-medium">
            {new Date(fechaUltimoPrecio).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
          </dd>
        </div>
      )}
      {canEdit && (
        <div className="pt-3">
          <Link href={`${hrefEditar}?seccion=stock#stock` as never} className="text-sm font-semibold text-primary hover:underline">
            Ver stock, coste e historial
          </Link>
        </div>
      )}
    </dl>
  );

  const acciones = (
    <>
      <a
        href={`/api/pdf/product-datasheet/${p.id}`}
        target="_blank"
        rel="noopener"
        className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 lg:flex-none"
      >
        <FileText className="h-4 w-4" /> Ficha técnica
      </a>
      {canEdit && (
        <>
          <Link
            href={`${hrefEditar}?seccion=compartir#compartir` as never}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border bg-card text-sm font-semibold hover:bg-muted lg:w-auto lg:px-4"
            aria-label="Compartir ficha técnica"
          >
            <Share2 className="h-4 w-4" /> <span className="hidden lg:inline">Compartir</span>
          </Link>
          <Link
            href={hrefEditar as never}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border bg-card text-sm font-semibold hover:bg-muted lg:w-auto lg:px-4"
            aria-label="Editar"
          >
            <Pencil className="h-4 w-4" /> <span className="hidden lg:inline">Editar</span>
          </Link>
        </>
      )}
    </>
  );

  return (
    <div className="min-w-0">
      {canEdit && (
        <div className="mb-4 space-y-3">
          {catalogStatus && <CatalogUpdateBanner productId={p.id} status={catalogStatus} />}
          {!criticalState.isDismissed && criticalState.missing.length > 0 && (
            <CriticalAttributesBanner productId={p.id} missing={criticalState.missing} />
          )}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        {/* Columna izquierda: cabecera + galería (fija en escritorio) */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
          <BackButton href={volver.href} label={volver.label} />

          <header className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              {categoria ?? KIND_LABEL[p.kind as keyof typeof KIND_LABEL] ?? null}
            </div>
            <h1 className="text-2xl font-bold leading-tight break-words">{p.nombre}</h1>
            {p.rasgos && <p className="text-base font-medium text-foreground/80">{p.rasgos}</p>}
            {(p.ref || insigniaStock || !p.activo) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                {p.ref && (
                  <span>
                    Ref. <span className="font-mono font-semibold text-foreground">{p.ref}</span>
                  </span>
                )}
                {!p.activo && <Badge variant="secondary">Inactivo</Badge>}
                {insigniaStock}
              </div>
            )}
            {(contadoCents != null || desdeMesCents != null) && (
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {contadoCents != null && (
                  <span className="text-lg font-bold tabular-nums">Contado {formatearEuros(contadoCents)}</span>
                )}
                {desdeMesCents != null && (
                  <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                    desde {formatearEuros(desdeMesCents)}/mes
                  </span>
                )}
              </p>
            )}
          </header>

          {/* Un clic, sin entrar en Editar (Mario 2026-11-26). */}
          {canEdit && <InterruptorPruebaGratuita productId={p.id} />}

          {p.fotos.length > 0 ? (
            <FichaGaleria fotos={reparto.portada} nombre={p.nombre} />
          ) : (
            canEdit && (
              <Link
                href={`${hrefEditar}?seccion=fotos#fotos` as never}
                className="flex h-24 items-center justify-center rounded-xl border border-dashed text-sm font-semibold text-primary hover:bg-muted"
              >
                Añadir foto
              </Link>
            )
          )}

          {descripcion && <div className="hidden lg:block">{descripcion}</div>}
          {garantia.length > 0 && (
            <p className="hidden text-sm text-muted-foreground lg:block">Garantía: {garantia.join(" · ")}</p>
          )}
          <div className="hidden flex-wrap gap-2 lg:flex">{acciones}</div>
        </div>

        {/* Móvil: bloques plegables de lectura */}
        <div className="min-w-0 space-y-3 lg:hidden">
          {descripcion}
          {garantia.length > 0 && (
            <p className="text-sm text-muted-foreground">Garantía: {garantia.join(" · ")}</p>
          )}
          {canEdit && falta.length > 0 && <TarjetaFalta falta={falta} hrefEditar={hrefEditar} />}
          {imagenes && (
            <CollapsibleCard title="Imágenes del producto" badge={<Contador n={fotosImagenes.length} />} defaultOpen>
              {imagenes}
            </CollapsibleCard>
          )}
          {bloques.map((b) => (
            <CollapsibleCard
              key={b.clave}
              title={b.titulo}
              badge={<Contador n={b.filas.length} />}
              defaultOpen={b.clave === "fisicas"}
            >
              <TablaCaracteristicas bloque={b} imagenMedidas={imagenMedidas} />
            </CollapsibleCard>
          ))}
          {p.variantes.length > 0 && (
            <CollapsibleCard title="Variantes de la gama" badge={<Contador n={p.variantes.length} />} defaultOpen={false}>
              {variantes}
            </CollapsibleCard>
          )}
          {(nRecambios > 0 || proyecciones.length > 0) && (
            <CollapsibleCard title="Filtros y recambios" badge={<Contador n={nRecambios} />} defaultOpen={false}>
              {notaRecambios}
              {recambios}
            </CollapsibleCard>
          )}
          {p.documentos.length > 0 && (
            <CollapsibleCard title="Documentos" badge={<Contador n={p.documentos.length} />} defaultOpen={false}>
              {documentos}
            </CollapsibleCard>
          )}
          {gestion && (
            <CollapsibleCard title="Gestión" defaultOpen={false}>
              {gestion}
            </CollapsibleCard>
          )}
        </div>

        {/* Escritorio: pestañas */}
        <div className="hidden min-w-0 space-y-4 lg:block">
          {canEdit && falta.length > 0 && <TarjetaFalta falta={falta} hrefEditar={hrefEditar} />}
          <Tabs defaultValue="ficha">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="ficha" className={TAB_TRIGGER}>
                Ficha <Contador n={nCaract} />
              </TabsTrigger>
              <TabsTrigger value="variantes" className={TAB_TRIGGER} disabled={p.variantes.length === 0}>
                Variantes <Contador n={p.variantes.length} />
              </TabsTrigger>
              <TabsTrigger value="recambios" className={TAB_TRIGGER} disabled={nRecambios === 0 && proyecciones.length === 0}>
                Recambios <Contador n={nRecambios} />
              </TabsTrigger>
              <TabsTrigger value="documentos" className={TAB_TRIGGER} disabled={p.documentos.length === 0}>
                Documentos <Contador n={p.documentos.length} />
              </TabsTrigger>
              {gestion && (
                <TabsTrigger value="gestion" className={TAB_TRIGGER}>
                  Gestión
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="ficha">
              <Card>
                <CardContent className="space-y-8 pt-6">
                  {imagenes && (
                    <section aria-labelledby="ficha-imagenes">
                      <h2 id="ficha-imagenes" className={TITULO_SECCION}>
                        Imágenes del producto
                      </h2>
                      {imagenes}
                    </section>
                  )}
                  {bloques.length > 0 && (
                    <section aria-labelledby="ficha-caract">
                      <h2 id="ficha-caract" className={TITULO_SECCION}>
                        Ficha técnica
                      </h2>
                      <FichaTecnica bloques={bloques} imagenMedidas={imagenMedidas} />
                    </section>
                  )}
                  {!imagenes && bloques.length === 0 && (
                    <p className="text-sm text-muted-foreground">Este producto aún no tiene ficha técnica.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="variantes">
              <Card>
                <CardContent className="pt-6">{variantes}</CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="recambios">
              <Card>
                <CardContent className="pt-6">
                  {notaRecambios}
                  {recambios}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="documentos">
              <Card>
                <CardContent className="pt-6">{documentos}</CardContent>
              </Card>
            </TabsContent>
            {gestion && (
              <TabsContent value="gestion">
                <Card>
                  <CardContent className="pt-6">{gestion}</CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      {/* Móvil: barra inferior fija con las acciones */}
      <div className="sticky bottom-0 z-10 -mx-[var(--marco-pad)] mt-4 flex gap-2 border-t bg-card px-[var(--marco-pad)] pt-2 pb-[calc(0.5rem+var(--safe-bottom))] lg:hidden">
        {acciones}
      </div>
    </div>
  );
}

function TarjetaFalta({
  falta,
  hrefEditar,
}: {
  falta: Array<{ texto: string; seccion: string }>;
  hrefEditar: string;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-sm">
      <span className="font-semibold">A esta ficha le falta: </span>
      {falta.map((f, i) => (
        <span key={f.texto}>
          {i > 0 && " · "}
          <Link href={`${hrefEditar}?seccion=${f.seccion}#${f.seccion}` as never} className="text-primary hover:underline">
            {f.texto}
          </Link>
        </span>
      ))}
    </div>
  );
}
