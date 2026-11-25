import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { BackButton } from "@/shared/components/back-button";
import { CollapsibleCard } from "@/modules/products/collapsible-card";
import { leerFichaMaestro } from "@/modules/superadmin/catalogo/catalogo-lectura";
import {
  KIND_ETIQUETA,
  esRecambio,
  formatearNumero,
} from "@/modules/superadmin/catalogo/catalogo-etiquetas";
import { FichaGaleria } from "@/modules/superadmin/catalogo/ficha-galeria";
import { FichaVentajas } from "@/modules/superadmin/catalogo/ficha-ventajas";
import {
  TablaCaracteristicas,
  agruparCaracteristicas,
  type FilaCaracteristica,
} from "@/modules/superadmin/catalogo/ficha-caracteristicas";
import { FichaVariantes } from "@/modules/superadmin/catalogo/ficha-variantes";
import { FichaRecambios, FichaUsadoEn } from "@/modules/superadmin/catalogo/ficha-recambios";
import { FichaDocumentos } from "@/modules/superadmin/catalogo/ficha-documentos";
import { FichaEmpresas } from "@/modules/superadmin/catalogo/ficha-empresas";
import { FichaTecnica } from "@/modules/superadmin/catalogo/ficha-tecnica";

export const dynamic = "force-dynamic";

function Contador({ n }: { n: number }) {
  return <span className="text-sm font-normal text-muted-foreground tabular-nums">{n}</span>;
}

const TAB_TRIGGER = "h-11 px-3 text-sm";
const TITULO_SECCION = "mb-3 text-sm font-bold uppercase tracking-wide text-primary";

export default async function FichaProductoMaestroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await leerFichaMaestro(id);
  if (!p) notFound();

  const recambio = esRecambio(p.kind);
  const hrefEditar = `/superadmin/catalogo/productos/${p.id}/editar`;
  const hrefLista = recambio
    ? "/superadmin/catalogo/productos?tipo=recambios"
    : "/superadmin/catalogo/productos";

  // Físicas que viven en columnas del producto (cotas a/b/c y peso).
  const fisicasExtra: FilaCaracteristica[] = [];
  if (p.anchoMm) fisicasExtra.push({ etiqueta: "Ancho (a)", valor: `${formatearNumero(p.anchoMm)} mm` });
  if (p.altoMm) fisicasExtra.push({ etiqueta: "Alto (b)", valor: `${formatearNumero(p.altoMm)} mm` });
  if (p.fondoMm) fisicasExtra.push({ etiqueta: "Fondo (c)", valor: `${formatearNumero(p.fondoMm)} mm` });
  if (p.pesoG) fisicasExtra.push({ etiqueta: "Peso", valor: `${formatearNumero(p.pesoG / 1000)} kg` });
  const bloques = agruparCaracteristicas(p.atributos, fisicasExtra);
  const nCaract = bloques.reduce((s, b) => s + b.filas.length, 0);

  // Foto principal arriba; el resto, en «Imágenes del producto».
  const esPortada = (t: string) => t === "principal" || t === "ficha";
  const fotosPortada = p.fotos.some((f) => esPortada(f.tipo))
    ? p.fotos.filter((f) => esPortada(f.tipo))
    : p.fotos.slice(0, 1);
  const fotosImagenes = p.fotos.filter(
    (f) => !fotosPortada.includes(f) && f.tipo !== "banner" && f.tipo !== "proyeccion",
  );
  const imagenes = fotosImagenes.length > 0 && (
    <FichaGaleria fotos={fotosImagenes} nombre={p.nombre} />
  );

  const imagenMedidas = p.fotos.find((f) => f.tipo === "medidas")?.url ?? null;
  const proyecciones = p.fotos
    .filter((f) => f.tipo === "proyeccion")
    .map((f) => ({ id: f.id, etiqueta: f.etiqueta, url: f.url, miniatura: f.miniatura }));
  const nRecambios = recambio ? p.usadoEn.length : p.recambios.length;

  const categoria = p.categoriaPadre && p.categoria ? `${p.categoriaPadre} · ${p.categoria}` : p.categoria;

  // ---------------------------------------------------------------- bloques
  const ventajas = <FichaVentajas ventajas={p.ventajas} />;
  const variantes = <FichaVariantes variantes={p.variantes} actualId={p.id} />;
  const recambios = recambio ? (
    <FichaUsadoEn equipos={p.usadoEn} />
  ) : (
    <FichaRecambios recambios={p.recambios} proyecciones={proyecciones} />
  );
  const documentos = <FichaDocumentos documentos={p.documentos} />;
  const empresas = <FichaEmpresas empresas={p.empresas} version={p.version} />;
  const tituloRecambios = recambio ? "Se usa en" : "Consumibles y repuestos";
  const descripcion = (p.descCorta || p.descLarga) && (
    <div className="space-y-2 text-sm">
      {p.descCorta && <p>{p.descCorta}</p>}
      {p.descLarga && <p className="whitespace-pre-line text-muted-foreground">{p.descLarga}</p>}
    </div>
  );

  return (
    <div className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        {/* Columna izquierda: cabecera + galería (fija en escritorio) */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <BackButton href={hrefLista} label={recambio ? "Recambios" : "Catálogo"} />
            <Link
              href={hrefEditar as never}
              className="hidden h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 lg:inline-flex"
            >
              <Pencil className="h-4 w-4" /> Editar
            </Link>
          </div>

          <header className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              {[p.fabricante, categoria ?? KIND_ETIQUETA[p.kind]].filter(Boolean).join(" · ")}
            </div>
            <h1 className="text-2xl font-bold leading-tight break-words">{p.nombre}</h1>
            {p.rasgos && <p className="text-base font-medium text-foreground/80">{p.rasgos}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                Ref. <span className="font-mono font-semibold text-foreground">{p.ref}</span>
              </span>
              {p.modelo && p.modelo !== p.nombre && <span>Modelo {p.modelo}</span>}
              {recambio && p.familia && <span>{p.familia}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.activo ? <Badge variant="success">Activo</Badge> : <Badge variant="secondary">Inactivo</Badge>}
              {p.descatalogado && <Badge variant="warning">Descatalogado</Badge>}
              {recambio && <Badge variant="outline">{KIND_ETIQUETA[p.kind]}</Badge>}
              <Badge variant="secondary">Versión {p.version}</Badge>
              {p.cambiosSinPublicar && <Badge variant="warning">Cambios sin publicar</Badge>}
              <Badge variant={p.empresas.length > 0 ? "default" : "secondary"}>
                {p.empresas.length === 1 ? "1 empresa" : `${p.empresas.length} empresas`}
              </Badge>
            </div>
          </header>

          <FichaGaleria fotos={fotosPortada} nombre={p.nombre} />

          {descripcion && <div className="hidden lg:block">{descripcion}</div>}
        </div>

        {/* Móvil: bloques plegables */}
        <div className="min-w-0 space-y-3 lg:hidden">
          {descripcion}
          {p.ventajas.length > 0 && (
            <CollapsibleCard title="Características clave" badge={<Contador n={p.ventajas.length} />} defaultOpen>
              {ventajas}
            </CollapsibleCard>
          )}
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
            <CollapsibleCard
              title="Variantes de la gama"
              badge={<Contador n={p.variantes.length} />}
              defaultOpen={false}
            >
              {variantes}
            </CollapsibleCard>
          )}
          {(nRecambios > 0 || proyecciones.length > 0 || !recambio) && (
            <CollapsibleCard title={tituloRecambios} badge={<Contador n={nRecambios} />} defaultOpen={false}>
              {recambios}
            </CollapsibleCard>
          )}
          <CollapsibleCard title="Documentos" badge={<Contador n={p.documentos.length} />} defaultOpen={false}>
            {documentos}
          </CollapsibleCard>
          <CollapsibleCard title="Empresas que lo tienen" badge={<Contador n={p.empresas.length} />} defaultOpen={false}>
            {empresas}
          </CollapsibleCard>
        </div>

        {/* Escritorio: pestañas */}
        <div className="hidden min-w-0 lg:block">
          <Tabs defaultValue="ficha">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="ficha" className={TAB_TRIGGER}>
                Ficha <Contador n={p.ventajas.length + nCaract} />
              </TabsTrigger>
              <TabsTrigger value="variantes" className={TAB_TRIGGER} disabled={p.variantes.length === 0}>
                Variantes <Contador n={p.variantes.length} />
              </TabsTrigger>
              <TabsTrigger value="recambios" className={TAB_TRIGGER}>
                {recambio ? "Se usa en" : "Recambios"} <Contador n={nRecambios} />
              </TabsTrigger>
              <TabsTrigger value="documentos" className={TAB_TRIGGER}>
                Documentos <Contador n={p.documentos.length} />
              </TabsTrigger>
              <TabsTrigger value="empresas" className={TAB_TRIGGER}>
                Empresas <Contador n={p.empresas.length} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ficha">
              <Card>
                <CardContent className="space-y-8 pt-6">
                  {p.ventajas.length > 0 && (
                    <section aria-labelledby="ficha-ventajas">
                      <h2 id="ficha-ventajas" className={TITULO_SECCION}>
                        Características clave
                      </h2>
                      {ventajas}
                    </section>
                  )}
                  {imagenes && (
                    <section aria-labelledby="ficha-imagenes">
                      <h2 id="ficha-imagenes" className={TITULO_SECCION}>
                        Imágenes del producto
                      </h2>
                      {imagenes}
                    </section>
                  )}
                  {bloques.length > 0 ? (
                    <section aria-labelledby="ficha-caract">
                      <h2 id="ficha-caract" className={TITULO_SECCION}>
                        Ficha técnica
                      </h2>
                      <FichaTecnica bloques={bloques} imagenMedidas={imagenMedidas} />
                    </section>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin características cargadas.</p>
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
                <CardContent className="pt-6">{recambios}</CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="documentos">
              <Card>
                <CardContent className="pt-6">{documentos}</CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="empresas">
              <Card>
                <CardContent className="pt-6">{empresas}</CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Móvil: barra inferior fija con la acción */}
      <div className="sticky bottom-0 z-10 -mx-[var(--marco-pad)] mt-4 border-t bg-card px-[var(--marco-pad)] pt-2 pb-[calc(0.5rem+var(--safe-bottom))] lg:hidden">
        <Link
          href={hrefEditar as never}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          <Pencil className="h-4 w-4" /> Editar
        </Link>
      </div>
    </div>
  );
}
