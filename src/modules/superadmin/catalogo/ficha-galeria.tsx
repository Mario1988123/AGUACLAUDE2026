"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { ORDEN_TIPO_FOTO, TIPO_FOTO_ETIQUETA } from "./catalogo-etiquetas";

/**
 * Galería de la ficha. Móvil: a todo el ancho, deslizamiento con scroll-snap y
 * puntos de posición. Escritorio: foto grande + tira de miniaturas agrupadas
 * por tipo. Tocar la foto la abre a pantalla completa. Siempre `object-contain`.
 */

export interface FotoGaleria {
  id: string;
  tipo: string;
  etiqueta: string | null;
  alt: string | null;
  url: string | null;
  miniatura: string | null;
  ancho: number | null;
  alto: number | null;
}

function Lupa() {
  return (
    <span className="pointer-events-none absolute right-2 bottom-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-foreground shadow-sm">
      <ZoomIn className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function rango(tipo: string) {
  const i = ORDEN_TIPO_FOTO.indexOf(tipo);
  return i === -1 ? ORDEN_TIPO_FOTO.length : i;
}

export function FichaGaleria({ fotos, nombre }: { fotos: FotoGaleria[]; nombre: string }) {
  // El banner es de cabecera: aquí solo si no hay nada más que enseñar.
  const ordenadas = useMemo(() => {
    const base = fotos.filter((f) => f.url);
    const sinBanner = base.filter((f) => f.tipo !== "banner");
    const lista = sinBanner.length > 0 ? sinBanner : base;
    return [...lista].sort((a, b) => rango(a.tipo) - rango(b.tipo));
  }, [fotos]);

  const grupos = useMemo(() => {
    const m = new Map<string, { foto: FotoGaleria; i: number }[]>();
    ordenadas.forEach((foto, i) => {
      const t = foto.tipo === "principal" || foto.tipo === "ficha" ? "principal" : foto.tipo;
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push({ foto, i });
    });
    return Array.from(m.entries());
  }, [ordenadas]);

  const [actual, setActual] = useState(0);
  const [grande, setGrande] = useState<number | null>(null);
  const carril = useRef<HTMLDivElement>(null);

  if (ordenadas.length === 0) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border bg-muted text-sm text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        Sin fotos
      </div>
    );
  }

  const fotoActual = (ordenadas[Math.min(actual, ordenadas.length - 1)] ?? ordenadas[0]) as FotoGaleria;

  function alDeslizar() {
    const el = carril.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== actual) setActual(i);
  }

  function irAPunto(i: number) {
    const el = carril.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setActual(i);
  }

  const rotulo = (f: FotoGaleria) =>
    f.etiqueta ?? TIPO_FOTO_ETIQUETA[f.tipo] ?? TIPO_FOTO_ETIQUETA.otras;

  return (
    <div className="min-w-0 space-y-3">
      {/* Móvil: carril deslizable */}
      <div className="lg:hidden">
        <div
          ref={carril}
          onScroll={alDeslizar}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl border bg-muted [scrollbar-width:none]"
        >
          {ordenadas.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setGrande(i)}
              className="relative aspect-square w-full shrink-0 snap-center"
              aria-label={`Ampliar foto ${i + 1} de ${ordenadas.length}`}
            >
              <Lupa />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={(i === 0 ? f.url : f.miniatura ?? f.url) ?? undefined}
                alt={f.alt ?? nombre}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                width={f.ancho ?? undefined}
                height={f.alto ?? undefined}
                className="h-full w-full object-contain p-3"
              />
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{rotulo(fotoActual)}</span>
          {ordenadas.length > 1 &&
            (ordenadas.length <= 10 ? (
              <div className="flex shrink-0 items-center">
                {ordenadas.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => irAPunto(i)}
                    aria-label={`Ir a la foto ${i + 1}`}
                    className="flex h-11 w-6 items-center justify-center"
                  >
                    <span
                      className={cn(
                        "block h-2 w-2 rounded-full transition-colors",
                        i === actual ? "bg-primary" : "bg-border",
                      )}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <span className="tabular-nums">
                {actual + 1} / {ordenadas.length}
              </span>
            ))}
        </div>
      </div>

      {/* Escritorio: foto grande + miniaturas por tipo */}
      <div className="hidden space-y-3 lg:block">
        <button
          type="button"
          onClick={() => setGrande(actual)}
          className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl border bg-muted"
          aria-label="Ampliar foto"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fotoActual.url ?? undefined}
            alt={fotoActual.alt ?? nombre}
            className="h-full w-full object-contain p-4"
          />
          <Lupa />
        </button>
        {ordenadas.length > 1 && (
          <div className="space-y-2">
            {grupos.map(([tipo, items]) => (
              <div key={tipo}>
                {grupos.length > 1 && (
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">
                    {TIPO_FOTO_ETIQUETA[tipo] ?? TIPO_FOTO_ETIQUETA.otras}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {items.map(({ foto, i }) => (
                    <button
                      key={foto.id}
                      type="button"
                      onClick={() => setActual(i)}
                      title={rotulo(foto)}
                      aria-label={rotulo(foto)}
                      aria-current={i === actual}
                      className={cn(
                        "h-14 w-14 overflow-hidden rounded-lg border-2 bg-muted",
                        i === actual ? "border-primary" : "border-transparent hover:border-border",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={(foto.miniatura ?? foto.url) ?? undefined}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain p-0.5"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pantalla completa */}
      <Dialog open={grande !== null} onOpenChange={(o) => !o && setGrande(null)}>
        <DialogContent className="max-w-[min(96vw,1100px)] gap-3 p-3 sm:p-4">
          {grande !== null && ordenadas[grande] && (
            <>
              <DialogTitle className="pr-10 text-sm">
                {rotulo(ordenadas[grande])}
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                  {grande + 1} / {ordenadas.length}
                </span>
              </DialogTitle>
              <DialogDescription className="sr-only">{nombre}</DialogDescription>
              <div className="flex items-center justify-center rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ordenadas[grande].url ?? undefined}
                  alt={ordenadas[grande].alt ?? nombre}
                  className="max-h-[75dvh] w-full object-contain"
                />
              </div>
              {ordenadas.length > 1 && (
                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setGrande((g) => (g === null ? g : (g - 1 + ordenadas.length) % ordenadas.length))}
                    className="inline-flex h-11 items-center gap-1 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted"
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setGrande((g) => (g === null ? g : (g + 1) % ordenadas.length))}
                    className="inline-flex h-11 items-center gap-1 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted"
                  >
                    Siguiente <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
