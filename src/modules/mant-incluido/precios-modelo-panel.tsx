"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { TIPO_LABEL } from "@/modules/equipos-modelo/logica";
import type { FilaPrecioModelo, GamaPrecioModelo } from "./datos";
import { guardarPrecioModeloAction } from "./actions";
import { centimosAEuros, eur, eurosACentimos, totalConIva, type PreciosTarifa } from "./logica";

/**
 * «Precio del mantenimiento por modelo»: una tarjeta por gama con sus dos
 * importes (base SIN IVA, como el precio general) y, plegadas debajo, sus
 * variantes. Se guarda fila a fila. Orden del precio de una visita:
 * equipo > cliente > modelo (variante → gama) > empresa.
 */
export function PreciosModeloPanel({
  gamas,
  empresa,
  iva,
}: {
  gamas: GamaPrecioModelo[];
  empresa: PreciosTarifa;
  iva: number;
}) {
  if (gamas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay gamas de equipo: marca el tipo (fuente u ósmosis) en la categoría o en el producto para que salgan
        aquí.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Precio de la visita cuando ya no está incluida. Manda sobre el general de la empresa; el que se ponga en un
        equipo o en un cliente manda sobre este. Vacío = el general.
      </p>
      {gamas.map((g, i) => (
        <div key={g.id} className="space-y-2">
          {gamas[i - 1]?.tipo !== g.tipo && (
            <h3 className="pt-1 text-sm font-bold">{TIPO_LABEL[g.tipo]}</h3>
          )}
          <TarjetaGama gama={g} empresa={empresa} iva={iva} />
        </div>
      ))}
    </div>
  );
}

function TarjetaGama({ gama, empresa, iva }: { gama: GamaPrecioModelo; empresa: PreciosTarifa; iva: number }) {
  const [abierta, setAbierta] = useState(false);
  const n = gama.variantes.length;
  return (
    <div className="rounded-lg border bg-card p-3">
      <FilaPrecio
        fila={gama}
        heredado={empresa}
        textoHeredado="General"
        ayudaVacio="Vacío = el general de la empresa."
        iva={iva}
      />
      {n > 0 && (
        <div className="mt-3 border-t pt-2">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium"
            aria-expanded={abierta}
            onClick={() => setAbierta((v) => !v)}
          >
            <span>
              {n} {n === 1 ? "variante" : "variantes"}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`} />
          </button>
          {abierta && (
            <div className="mt-2 space-y-2">
              {gama.variantes.map((v) => (
                <div key={v.id} className="rounded-md bg-muted/40 p-3">
                  <FilaPrecio
                    fila={v}
                    heredado={{
                      solo_filtros: gama.precios.solo_filtros ?? empresa.solo_filtros,
                      filtros_membrana: gama.precios.filtros_membrana ?? empresa.filtros_membrana,
                    }}
                    textoHeredado="Gama"
                    ayudaVacio="Vacío = el de la gama."
                    iva={iva}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilaPrecio({
  fila,
  heredado,
  textoHeredado,
  ayudaVacio,
  iva,
}: {
  fila: FilaPrecioModelo;
  heredado: PreciosTarifa;
  textoHeredado: string;
  ayudaVacio: string;
  iva: number;
}) {
  const [pf, setPf] = useState(centimosAEuros(fila.precios.solo_filtros));
  const [pm, setPm] = useState(centimosAEuros(fila.precios.filtros_membrana));
  const [pending, start] = useTransition();

  const cf = pf.trim() ? eurosACentimos(pf) : null;
  const cm = pm.trim() ? eurosACentimos(pm) : null;
  const invalido = (pf.trim() !== "" && cf == null) || (pm.trim() !== "" && cm == null);
  // Tras guardar, revalidatePath trae los valores nuevos en `fila` y deja de estar «cambiado».
  const cambiado = cf !== fila.precios.solo_filtros || cm !== fila.precios.filtros_membrana || invalido;

  function guardar() {
    if (invalido) {
      notify.warning("Algún precio no es válido", "Escribe por ejemplo 75 o 75,50");
      return;
    }
    start(async () => {
      const r = await guardarPrecioModeloAction({
        product_id: fila.id,
        precio_filtros_cents: cf,
        precio_membrana_cents: cm,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success(`Guardado: ${fila.nombre}`);
    });
  }

  const ph = (c: number | null) => (c != null ? `${textoHeredado}: ${eur(c)}` : "Sin precio");
  const conIva = (c: number | null) =>
    c != null ? (
      <p className="text-xs text-muted-foreground tabular-nums">
        Con IVA ({iva}%): {eur(totalConIva(c, iva))}
      </p>
    ) : null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold leading-tight break-words">
        {fila.nombre}
        {!fila.activo && <span className="ml-2 text-xs font-normal text-muted-foreground">(inactivo)</span>}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="block min-h-8 text-xs leading-tight" htmlFor={`mpf-${fila.id}`}>
            Solo filtros (€, sin IVA)
          </Label>
          <Input
            id={`mpf-${fila.id}`}
            inputMode="decimal"
            value={pf}
            onChange={(e) => setPf(e.target.value)}
            placeholder={ph(heredado.solo_filtros)}
          />
          {conIva(cf)}
        </div>
        <div className="space-y-1">
          <Label className="block min-h-8 text-xs leading-tight" htmlFor={`mpm-${fila.id}`}>
            Filtros + membrana (€, sin IVA)
          </Label>
          <Input
            id={`mpm-${fila.id}`}
            inputMode="decimal"
            value={pm}
            onChange={(e) => setPm(e.target.value)}
            placeholder={ph(heredado.filtros_membrana)}
          />
          {conIva(cm)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{ayudaVacio}</p>
        <Button size="sm" onClick={guardar} disabled={pending || !cambiado} className="min-h-11 shrink-0">
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
