"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, Share2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { notify } from "@/shared/hooks/use-toast";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { cambiarVisibleCaracteristicaAction } from "./caracteristicas-actions";
import { valorLegible } from "./caracteristicas-editor";
import { guardarSeccionFichaAction } from "./ficha-producto-actions";
import type { SeccionFicha, SeccionesProducto } from "./ficha/modelo";
import { GRUPOS_ATRIBUTO, GRUPO_ETIQUETA, grupoEfectivo, type CaracteristicaEmpresa } from "./productos-vista";
import { ShareDatasheetPanel } from "./share-panel";
import type { ProductShareItem } from "./share-actions";

/**
 * Ficha técnica de un producto en una pantalla: a la izquierda (o arriba en
 * móvil) qué características y qué secciones salen en el PDF; a la derecha la
 * vista previa, que se vuelve a generar al poco de cambiar una casilla.
 *
 * Cada casilla guarda al momento (acciones existentes); la vista previa espera
 * a que no quede ningún guardado en marcha y a RETRASO_MS sin clics, para no
 * generar un PDF por clic.
 *
 * En móvil no hay iframe (iOS y Android no pintan bien un PDF dentro de un
 * iframe): «Ver ficha» abre el PDF a pantalla completa.
 */

const RETRASO_MS = 700;

const SECCIONES: Array<{ clave: SeccionFicha; titulo: string; ayuda: string }> = [
  { clave: "ventajas", titulo: "Ventajas", ayuda: "Las características clave con su icono." },
  { clave: "recambios", titulo: "Consumibles y recambios", ayuda: "Filtros y piezas con su periodo de cambio." },
  { clave: "medidas", titulo: "Dibujo de medidas", ayuda: "El plano acotado y las letras a, b, c de la tabla." },
];

interface Props {
  productId: string;
  nombre: string;
  caracteristicas: CaracteristicaEmpresa[];
  /** Lo que dice el producto (null = lo de la empresa). */
  seccionesProducto: SeccionesProducto;
  /** Lo que dice la empresa (Configuración → PDF). El dibujo, siempre sí. */
  seccionesEmpresa: Record<SeccionFicha, boolean>;
  /** Plantilla con la que se genera (tarifa, escaparate, placa). */
  plantilla: string;
  /** La empresa usa una plantilla anterior: la vista previa es de «Tarifa». */
  plantillaAnterior: boolean;
  shares: ProductShareItem[];
  publicBaseUrl: string;
}

export function FichaTaller(props: Props) {
  const { productId, plantilla } = props;
  const [visibles, setVisibles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.caracteristicas.map((c) => [c.valorId, c.visible])),
  );
  const [secciones, setSecciones] = useState<SeccionesProducto>(props.seccionesProducto);
  const [version, setVersion] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [esperando, setEsperando] = useState(false);
  const [compartir, setCompartir] = useState(false);
  const escritorio = useEsEscritorio();
  const enMarcha = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  const base = `/api/pdf/product-datasheet/${productId}?t=${encodeURIComponent(plantilla)}`;
  // `v` cambia en cada regeneración: el navegador no puede reutilizar el PDF anterior.
  const urlPdf = `${base}&v=${version}`;
  const urlDescarga = `${base}&descargar=1&v=${version}`;

  const programarVistaPrevia = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setEsperando(true);
    temporizador.current = setTimeout(() => {
      if (enMarcha.current > 0) return; // lo relanza el último guardado al acabar
      setEsperando(false);
      setCargando(true);
      setVersion((v) => v + 1);
    }, RETRASO_MS);
  }, []);

  const guardar = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, deshacer: () => void) => {
      enMarcha.current += 1;
      setEsperando(true);
      if (temporizador.current) clearTimeout(temporizador.current);
      try {
        const r = await fn();
        if (!r.ok) {
          deshacer();
          notify.error("No se pudo guardar", r.error);
        }
      } catch {
        deshacer();
        notify.error("No se pudo guardar", "Revisa la conexión e inténtalo otra vez.");
      } finally {
        enMarcha.current -= 1;
        if (enMarcha.current === 0) programarVistaPrevia();
      }
    },
    [programarVistaPrevia],
  );

  function cambiarVisible(valorId: string, valor: boolean) {
    setVisibles((v) => ({ ...v, [valorId]: valor }));
    void guardar(
      () => cambiarVisibleCaracteristicaAction(productId, valorId, valor),
      () => setVisibles((v) => ({ ...v, [valorId]: !valor })),
    );
  }

  function cambiarSeccion(clave: SeccionFicha, valor: boolean | null) {
    const antes = secciones[clave];
    setSecciones((s) => ({ ...s, [clave]: valor }));
    void guardar(
      () => guardarSeccionFichaAction(productId, clave, valor),
      () => setSecciones((s) => ({ ...s, [clave]: antes })),
    );
  }

  const grupos = useMemo(() => {
    return GRUPOS_ATRIBUTO.map((g) => ({
      clave: g,
      titulo: GRUPO_ETIQUETA[g],
      filas: props.caracteristicas.filter((c) => grupoEfectivo(c) === g).sort((a, b) => a.orden - b.orden),
    })).filter((g) => g.filas.length > 0);
  }, [props.caracteristicas]);

  const nVisibles = Object.values(visibles).filter(Boolean).length;
  const estado = esperando ? "Guardando…" : cargando ? "Generando la ficha…" : "Ficha al día";

  return (
    <div className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        {/* Casillas */}
        <div className="min-w-0 space-y-4">
          <div className="hidden flex-wrap gap-2 lg:flex">
            <BotonesPdf urlPdf={urlPdf} urlDescarga={urlDescarga} onCompartir={() => setCompartir(true)} />
          </div>

          {props.plantillaAnterior && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              Tu empresa usa una plantilla anterior. Esta vista previa y la descarga son de la plantilla «Tarifa»;
              las secciones solo se aplican a las plantillas nuevas (Configuración → PDF).
            </p>
          )}

          <section aria-labelledby="ficha-secciones" className="rounded-xl border bg-card">
            <h2 id="ficha-secciones" className="border-b px-4 py-3 text-sm font-semibold">
              Secciones de la ficha
            </h2>
            <ul className="divide-y">
              {SECCIONES.map((s) => {
                const propio = secciones[s.clave];
                const empresa = props.seccionesEmpresa[s.clave];
                const efectivo = propio ?? empresa;
                return (
                  <li key={s.clave} className="px-4 py-1">
                    <Casilla
                      marcada={efectivo}
                      onCambiar={(v) => cambiarSeccion(s.clave, v === empresa ? null : v)}
                      titulo={s.titulo}
                      detalle={
                        propio == null
                          ? `${s.ayuda} Como en la empresa.`
                          : `${s.ayuda} Solo en este producto (la empresa: ${empresa ? "sí" : "no"}).`
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="ficha-caract" className="rounded-xl border bg-card">
            <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
              <h2 id="ficha-caract" className="text-sm font-semibold">
                Características en la ficha
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {nVisibles} de {props.caracteristicas.length}
              </span>
            </div>
            {grupos.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Este producto no tiene características. Añádelas en Editar → Características.
              </p>
            ) : (
              grupos.map((g) => (
                <div key={g.clave}>
                  <h3 className="bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.titulo}{" "}
                    <span className="font-normal normal-case tracking-normal tabular-nums">
                      · {g.filas.filter((c) => visibles[c.valorId]).length} de {g.filas.length}
                    </span>
                  </h3>
                  <ul className="divide-y">
                    {g.filas.map((c) => (
                      <li key={c.valorId} className="px-4 py-1">
                        <Casilla
                          marcada={!!visibles[c.valorId]}
                          onCambiar={(v) => cambiarVisible(c.valorId, v)}
                          titulo={c.nombre}
                          detalle={valorLegible(c)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              Ancho, alto, fondo y peso salen siempre que estén rellenos; se cambian en Editar → Datos.
            </p>
          </section>
        </div>

        {/* Vista previa (escritorio) */}
        <div className="hidden min-w-0 lg:sticky lg:top-0 lg:block lg:self-start">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            {(esperando || cargando) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {estado}
          </div>
          <div className="relative overflow-hidden rounded-xl border bg-muted">
            {escritorio && (
            <iframe
              key={version}
              src={`${urlPdf}#navpanes=0&view=FitH`}
              title={`Ficha técnica de ${props.nombre}`}
              className={cn("h-[calc(100dvh-9rem)] min-h-[560px] w-full transition-opacity", cargando && "opacity-60")}
              onLoad={() => setCargando(false)}
            />
            )}
          </div>
        </div>
      </div>

      {/* Móvil: barra fija. «Ver ficha» abre el PDF entero, ya regenerado. */}
      <div className="sticky bottom-0 z-10 -mx-[var(--marco-pad)] mt-4 border-t bg-card px-[var(--marco-pad)] pt-2 pb-[calc(0.5rem+var(--safe-bottom))] lg:hidden">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {esperando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {esperando ? "Guardando…" : "Cambios guardados. «Ver ficha» abre el PDF actualizado."}
        </p>
        <div className="flex gap-2">
          <BotonesPdf urlPdf={urlPdf} urlDescarga={urlDescarga} onCompartir={() => setCompartir(true)} movil />
        </div>
      </div>

      <Sheet open={compartir} onOpenChange={setCompartir}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Compartir ficha técnica</SheetTitle>
            <SheetDescription>{props.nombre}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <ShareDatasheetPanel productId={productId} initialShares={props.shares} publicBaseUrl={props.publicBaseUrl} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** El iframe solo se monta en escritorio: en móvil no se genera un PDF que nadie ve. */
function useEsEscritorio(): boolean {
  const [es, setEs] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const cambiar = () => setEs(mq.matches);
    cambiar();
    mq.addEventListener("change", cambiar);
    return () => mq.removeEventListener("change", cambiar);
  }, []);
  return es;
}

function BotonesPdf({
  urlPdf,
  urlDescarga,
  onCompartir,
  movil,
}: {
  urlPdf: string;
  urlDescarga: string;
  onCompartir: () => void;
  movil?: boolean;
}) {
  const secundario =
    "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted";
  return (
    <>
      {movil && (
        <a
          href={urlPdf}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <ExternalLink className="h-4 w-4" /> Ver ficha
        </a>
      )}
      <a
        href={urlDescarga}
        download
        className={cn(
          movil
            ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card hover:bg-muted"
            : "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90",
        )}
        aria-label="Descargar PDF"
      >
        <Download className="h-4 w-4" />
        {!movil && " Descargar PDF"}
      </a>
      <button
        type="button"
        onClick={onCompartir}
        className={movil ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card hover:bg-muted" : secundario}
        aria-label="Compartir"
      >
        <Share2 className="h-4 w-4" />
        {!movil && " Compartir"}
      </button>
      {!movil && (
        <a href={urlPdf} target="_blank" rel="noopener" className={secundario}>
          <ExternalLink className="h-4 w-4" /> Abrir en otra pestaña
        </a>
      )}
    </>
  );
}

/** Fila de casilla: toda la fila es la zona de toque (≥ 44 px), la casilla mide 24 px. */
function Casilla({
  marcada,
  onCambiar,
  titulo,
  detalle,
}: {
  marcada: boolean;
  onCambiar: (v: boolean) => void;
  titulo: string;
  detalle: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5 select-none">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => onCambiar(e.target.checked)}
        className="h-6 w-6 shrink-0 cursor-pointer accent-primary"
      />
      <span className={cn("min-w-0 flex-1", !marcada && "text-muted-foreground")}>
        <span className={cn("block text-sm font-medium break-words", !marcada && "line-through decoration-1")}>{titulo}</span>
        <span className="block text-xs break-words text-muted-foreground">{detalle}</span>
      </span>
    </label>
  );
}
