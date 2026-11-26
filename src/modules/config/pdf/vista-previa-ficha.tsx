"use client";

/**
 * Maqueta HTML de la hoja 1 de la ficha técnica (docs/DISENO_FICHAS_Y_PRODUCTOS.md
 * §C.3). Enseña estructura y color, no cada milímetro: el PDF real está a un
 * toque («Ver PDF real»). Se repinta sin ir al servidor al cambiar plantilla o
 * color. Las medidas van en `cqw` (1 mm de papel = 100/210 cqw).
 */

import type { CSSProperties } from "react";
import type { FichaModelo, PlantillaNueva } from "@/modules/products/ficha/modelo";
import type { PaletaFicha } from "@/modules/products/ficha/paleta";
import { cn } from "@/shared/lib/utils";

/** mm de papel → cqw del contenedor. */
const mm = (n: number) => `${((n * 100) / 210).toFixed(3)}cqw`;

function variables(p: PaletaFicha): CSSProperties {
  return {
    ["--papel" as string]: p.papel,
    ["--tinta" as string]: p.tinta,
    ["--tinta-suave" as string]: p.tintaSuave,
    ["--velo" as string]: p.velo,
    ["--campo" as string]: p.primarioCampo,
    ["--sobre-campo" as string]: p.sobreCampo,
    ["--trazo" as string]: p.primarioTrazo,
    ["--acento" as string]: p.acentoMarca,
    ["--acento-texto" as string]: p.acentoTexto,
  };
}

function Logo({ modelo, alto, ancho }: { modelo: FichaModelo; alto: number; ancho: number }) {
  if (modelo.empresa.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={modelo.empresa.logoUrl}
        alt=""
        style={{ maxHeight: mm(alto), maxWidth: mm(ancho) }}
        className="block object-contain object-left"
      />
    );
  }
  return (
    <span style={{ fontSize: mm(5), color: "var(--trazo)" }} className="font-bold">
      {modelo.empresa.nombre}
    </span>
  );
}

/** Filas visibles en la maqueta: las primeras de cada grupo hasta un tope. */
function bloquesRecortados(modelo: FichaModelo, tope: number) {
  let quedan = tope;
  return modelo.bloques
    .map((b) => {
      const filas = b.filas.slice(0, Math.max(0, quedan));
      quedan -= filas.length;
      return { ...b, filas, mas: b.filas.length - filas.length };
    })
    .filter((b) => b.filas.length > 0);
}

function Filas({ modelo, plantilla, tope }: { modelo: FichaModelo; plantilla: PlantillaNueva; tope: number }) {
  const bloques = bloquesRecortados(modelo, tope);
  if (bloques.length === 0) {
    return (
      <p style={{ fontSize: mm(3) }} className="text-[color:var(--tinta-suave)]">
        Este producto aún no tiene características.
      </p>
    );
  }
  return (
    <div className="space-y-[1.2cqw]">
      {bloques.map((b) => (
        <div key={b.clave}>
          {plantilla === "placa" ? (
            <div
              style={{ fontSize: mm(2.6), padding: `${mm(0.8)} ${mm(1.5)}`, background: "var(--velo)" }}
              className="font-bold uppercase tracking-wide text-[color:var(--tinta)]"
            >
              {b.titulo}
            </div>
          ) : (
            <div
              style={{
                fontSize: mm(3.3),
                borderBottom: `${plantilla === "escaparate" ? mm(0.55) : mm(0.4)} solid ${plantilla === "escaparate" ? "var(--trazo)" : "var(--tinta)"}`,
                color: plantilla === "escaparate" ? "var(--tinta)" : "var(--trazo)",
                paddingBottom: mm(0.6),
              }}
              className="font-bold"
            >
              {b.titulo}
            </div>
          )}
          {plantilla === "placa" ? (
            <div className="grid grid-cols-3">
              {b.filas.map((f, i) => (
                <div
                  key={i}
                  style={{ padding: `${mm(0.6)} ${mm(1.5)}`, borderBottom: `1px solid color-mix(in srgb, var(--tinta) 16%, white)` }}
                  className="min-w-0"
                >
                  <div style={{ fontSize: mm(2.2) }} className="truncate text-[color:var(--tinta-suave)]">
                    {f.cota && <b className="mr-[0.4cqw] text-[color:var(--acento)]">{f.cota}</b>}
                    {f.etiqueta}
                  </div>
                  <div style={{ fontSize: mm(3) }} className="truncate font-mono font-bold text-[color:var(--tinta)]">
                    {f.valor} {f.unidad}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            b.filas.map((f, i) => (
              <div
                key={i}
                style={{
                  fontSize: mm(2.9),
                  padding: `${mm(0.9)} 0`,
                  borderBottom: `1px solid color-mix(in srgb, var(--tinta) 16%, white)`,
                }}
                className="grid grid-cols-[1.4em_minmax(0,1fr)_6.5em_3em] items-center text-[color:var(--tinta)]"
              >
                <b className="text-[color:var(--acento)]">{f.cota ?? ""}</b>
                <span className="truncate">{f.etiqueta}</span>
                <b className="truncate text-center">{f.valor}</b>
                <span className="truncate text-[color:var(--tinta-suave)]">{f.unidad}</span>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function Foto({ modelo, className, style }: { modelo: FichaModelo; className?: string; style?: CSSProperties }) {
  if (!modelo.fotoUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={modelo.fotoUrl} alt="" className={cn("block object-contain", className)} style={style} />
  );
}

function Ventajas({ modelo, horizontal }: { modelo: FichaModelo; horizontal?: boolean }) {
  if (modelo.ventajas.length === 0) return null;
  return (
    <div
      className={cn(horizontal ? "grid" : "space-y-[1.2cqw]")}
      style={horizontal ? { gridTemplateColumns: `repeat(${modelo.ventajas.length}, minmax(0,1fr))` } : undefined}
    >
      {modelo.ventajas.map((v, i) => (
        <div key={i} className={cn("flex items-center gap-[1.4cqw]", horizontal && "flex-col text-center")}>
          <span
            aria-hidden="true"
            style={{ width: mm(2.6), height: mm(2.6), background: "var(--acento)" }}
            className="block shrink-0 rotate-45"
          />
          <span style={{ fontSize: mm(2.9) }} className="line-clamp-2 font-bold text-[color:var(--tinta)]">
            {v.titulo}
          </span>
        </div>
      ))}
    </div>
  );
}

function Pie({ modelo }: { modelo: FichaModelo }) {
  const e = modelo.empresa;
  const linea = [e.razonSocial ?? e.nombre, e.telefono, e.correo, e.web, e.localidad].filter(Boolean).join(" · ");
  return (
    <div
      className="absolute flex items-center gap-[1.5cqw]"
      style={{
        left: mm(12),
        right: mm(12),
        top: mm(274),
        paddingTop: mm(2.5),
        borderTop: `1px solid color-mix(in srgb, var(--tinta) 16%, white)`,
      }}
    >
      <Logo modelo={modelo} alto={7} ancho={24} />
      <span style={{ fontSize: mm(2.5) }} className="min-w-0 truncate text-[color:var(--tinta)]">
        {linea}
      </span>
    </div>
  );
}

export function VistaPreviaFicha({
  modelo,
  plantilla,
  paleta,
  className,
  topeFilas = 34,
}: {
  modelo: FichaModelo;
  plantilla: PlantillaNueva;
  paleta: PaletaFicha;
  className?: string;
  topeFilas?: number;
}) {
  return (
    <div className={cn("@container w-full", className)}>
      <div
        role="img"
        aria-label={`Maqueta de la ficha técnica en la plantilla ${plantilla}`}
        style={{ ...variables(paleta), aspectRatio: "210 / 297", background: "var(--papel)", containerType: "inline-size" }}
        className="relative w-full overflow-hidden rounded-sm shadow-sm ring-1 ring-border"
      >
        {plantilla === "tarifa" && <Tarifa modelo={modelo} topeFilas={topeFilas} />}
        {plantilla === "escaparate" && <Escaparate modelo={modelo} topeFilas={topeFilas} />}
        {plantilla === "placa" && <Placa modelo={modelo} topeFilas={topeFilas} />}
      </div>
    </div>
  );
}

function Tarifa({ modelo, topeFilas }: { modelo: FichaModelo; topeFilas: number }) {
  return (
    <>
      <div className="absolute flex items-center justify-between" style={{ left: mm(12), right: mm(12), top: mm(11), height: mm(14) }}>
        <Logo modelo={modelo} alto={14} ancho={46} />
        {modelo.referencia && (
          <span style={{ fontSize: mm(3) }} className="text-[color:var(--tinta-suave)]">
            Ref. {modelo.referencia}
          </span>
        )}
      </div>
      <div className="absolute" style={{ left: mm(12), right: mm(12), top: mm(29), borderTop: `1px solid color-mix(in srgb, var(--tinta) 16%, white)` }} />
      <div className="absolute space-y-[2cqw]" style={{ left: mm(12), width: mm(78), top: mm(37) }}>
        {modelo.fotoUrl && (
          <div style={{ height: mm(100), background: "var(--velo)", padding: mm(5) }} className="flex items-end justify-center">
            <Foto modelo={modelo} className="max-h-full max-w-full" />
          </div>
        )}
        {modelo.medidasUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={modelo.medidasUrl} alt="" style={{ height: mm(44) }} className="mx-auto block object-contain" />
        )}
        <Ventajas modelo={modelo} />
      </div>
      <div className="absolute overflow-hidden" style={{ left: mm(98), right: mm(12), top: mm(34), bottom: mm(26) }}>
        <div style={{ fontSize: mm(2.6), letterSpacing: "0.15em", color: "var(--trazo)" }} className="font-bold">
          FICHA TÉCNICA
        </div>
        <div style={{ fontSize: mm(7), color: "var(--trazo)", lineHeight: 1.1, marginTop: mm(1.5) }} className="font-bold">
          {modelo.nombre}
        </div>
        {modelo.descripcion && (
          <div style={{ fontSize: mm(3.3), marginTop: mm(1.5), marginBottom: mm(3) }} className="text-[color:var(--tinta-suave)]">
            {modelo.descripcion}
          </div>
        )}
        <Filas modelo={modelo} plantilla="tarifa" tope={topeFilas} />
      </div>
      <Pie modelo={modelo} />
    </>
  );
}

function Escaparate({ modelo, topeFilas }: { modelo: FichaModelo; topeFilas: number }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0" style={{ height: mm(46), background: "var(--campo)" }} />
      <div
        className="absolute bg-[var(--papel)]"
        style={{ left: mm(12), top: 0, width: mm(56), height: mm(21), padding: `${mm(3.5)} ${mm(5)}`, borderRadius: `0 0 ${mm(3)} ${mm(3)}` }}
      >
        <Logo modelo={modelo} alto={14} ancho={46} />
      </div>
      <div className="absolute" style={{ left: mm(98), right: mm(12), top: mm(11) }}>
        <div style={{ fontSize: mm(2.6), letterSpacing: "0.15em", color: "var(--sobre-campo)" }} className="font-bold">
          FICHA TÉCNICA
        </div>
        <div style={{ fontSize: mm(7.4), color: "var(--sobre-campo)", lineHeight: 1.1, marginTop: mm(2) }} className="font-bold">
          {modelo.nombre}
        </div>
      </div>
      <div className="absolute flex items-start justify-center" style={{ left: mm(16), width: mm(72), top: mm(24), height: mm(104) }}>
        <Foto modelo={modelo} className="max-h-full max-w-full" />
      </div>
      <div className="absolute" style={{ left: mm(12), width: mm(80), top: mm(130), borderTop: `${mm(0.25)} solid var(--tinta)` }} />
      <div
        className="absolute overflow-hidden"
        style={{ left: mm(98), right: mm(12), top: mm(54), bottom: mm(modelo.ventajas.length ? 56 : 26) }}
      >
        {modelo.descripcion && (
          <div style={{ fontSize: mm(3.6), marginBottom: mm(3) }} className="font-bold text-[color:var(--tinta)]">
            {modelo.descripcion}
          </div>
        )}
        <Filas modelo={modelo} plantilla="escaparate" tope={topeFilas} />
      </div>
      <div className="absolute" style={{ left: mm(12), right: mm(12), top: mm(243) }}>
        <Ventajas modelo={modelo} horizontal />
      </div>
      <div
        className="absolute flex items-center justify-between"
        style={{ left: mm(12), right: mm(12), top: mm(274), paddingTop: mm(2.5), borderTop: `${mm(0.4)} solid var(--trazo)` }}
      >
        <Logo modelo={modelo} alto={9} ancho={30} />
        {modelo.empresa.telefono && (
          <span style={{ fontSize: mm(5.6), color: "var(--acento-texto)" }} className="font-bold">
            {modelo.empresa.telefono}
          </span>
        )}
      </div>
    </>
  );
}

function Placa({ modelo, topeFilas }: { modelo: FichaModelo; topeFilas: number }) {
  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{ inset: mm(10), border: `${mm(0.3)} solid var(--trazo)`, borderRadius: mm(2.5) }}
    >
      <div className="grid shrink-0" style={{ gridTemplateColumns: `${mm(54)} 1fr ${mm(46)}`, height: mm(24), borderBottom: `${mm(0.3)} solid var(--trazo)` }}>
        <div className="flex items-center" style={{ padding: mm(4), borderRight: `${mm(0.2)} solid var(--trazo)` }}>
          <Logo modelo={modelo} alto={14} ancho={46} />
        </div>
        <div style={{ padding: mm(4), fontSize: mm(5.2), lineHeight: 1.1 }} className="font-bold text-[color:var(--tinta)]">
          {modelo.nombre}
        </div>
        <div style={{ padding: mm(4), background: "var(--campo)", color: "var(--sobre-campo)", fontSize: mm(2.6) }} className="font-bold tracking-wide">
          FICHA TÉCNICA
          {modelo.referencia && <div style={{ fontSize: mm(3.6) }} className="mt-[0.6cqw] font-mono">{modelo.referencia}</div>}
        </div>
      </div>
      <div className="flex shrink-0" style={{ height: mm(52), borderBottom: `${mm(0.2)} solid var(--trazo)` }}>
        {modelo.fotoUrl && (
          <div className="flex items-end justify-center" style={{ width: mm(58), padding: mm(3), borderRight: `1px solid color-mix(in srgb, var(--tinta) 16%, white)` }}>
            <Foto modelo={modelo} className="max-h-full max-w-full" />
          </div>
        )}
        {modelo.medidasUrl && (
          <div className="flex items-center justify-center" style={{ width: mm(66), padding: mm(3), borderRight: `1px solid color-mix(in srgb, var(--tinta) 16%, white)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={modelo.medidasUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        )}
        <div style={{ padding: mm(3), fontSize: mm(3) }} className="min-w-0 flex-1 font-bold text-[color:var(--tinta)]">
          {modelo.descripcion}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Filas modelo={modelo} plantilla="placa" tope={Math.round(topeFilas * 1.2)} />
      </div>
    </div>
  );
}

/** Ficha en miniatura para las tres propuestas de color: panel, título y filete. */
export function MuestraPaleta({ paleta, nombre }: { paleta: PaletaFicha; nombre: string }) {
  return (
    <div style={variables(paleta)} className="flex h-full w-full flex-col overflow-hidden rounded-md bg-[var(--papel)] ring-1 ring-border">
      <div className="h-3 w-full bg-[var(--campo)]" />
      <div className="flex flex-1 gap-1.5 p-1.5">
        <div className="w-1/3 rounded-[2px] bg-[var(--velo)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-bold leading-tight text-[color:var(--trazo)]">{nombre}</div>
          <div className="mt-1 h-[2px] w-full bg-[var(--tinta)]" />
          <div className="mt-1 flex items-center gap-1">
            <span className="block h-1.5 w-1.5 rotate-45 bg-[var(--acento)]" />
            <span className="h-[3px] flex-1 rounded bg-[color:var(--tinta-suave)] opacity-40" />
          </div>
          <div className="mt-1 h-[3px] w-2/3 rounded bg-[color:var(--tinta-suave)] opacity-40" />
        </div>
      </div>
    </div>
  );
}
