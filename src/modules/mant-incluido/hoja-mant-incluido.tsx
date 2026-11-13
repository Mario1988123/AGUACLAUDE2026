"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { guardarMantEquipoAction } from "./actions";
import type { ResumenMant } from "./datos";
import {
  N_MAXIMO,
  anioDeClave,
  centimosAEuros,
  eur,
  eurosACentimos,
  nDesdeAnioCobro,
  nDesdeMeses,
  type PreciosTarifa,
} from "./logica";

const ATAJOS_N = [0, 1, 2, 3, 4, 5];

function precioHeredado(
  t: keyof PreciosTarifa,
  cliente: PreciosTarifa,
  empresa: PreciosTarifa,
  incluirCliente: boolean,
): string {
  if (incluirCliente && cliente[t] != null) return `Cliente: ${eur(cliente[t]!)}`;
  if (empresa[t] != null) return `Empresa: ${eur(empresa[t]!)}`;
  return "Sin precio";
}

/**
 * Hoja (inferior en móvil) para poner N = nº de mantenimientos anuales
 * incluidos y los precios por visita del equipo y del cliente.
 * Solo nivel 1/2 (lo comprueba también el servidor).
 */
export function HojaMantIncluido({
  equipoId,
  equipoNombre,
  mant,
}: {
  equipoId: string;
  equipoNombre: string;
  mant: ResumenMant;
}) {
  const [abierto, setAbierto] = useState(false);
  const [n, setN] = useState<string>(mant.n != null ? String(mant.n) : "");
  const [meses, setMeses] = useState("");
  const [anioCobro, setAnioCobro] = useState("");
  const [pf, setPf] = useState(centimosAEuros(mant.precios.equipo.solo_filtros));
  const [pm, setPm] = useState(centimosAEuros(mant.precios.equipo.filtros_membrana));
  const [cf, setCf] = useState(centimosAEuros(mant.precios.cliente.solo_filtros));
  const [cm, setCm] = useState(centimosAEuros(mant.precios.cliente.filtros_membrana));
  const [origen, setOrigen] = useState<"venta" | "renting" | "manual" | "importacion" | null>(
    (mant.origen as "venta" | "renting" | "manual" | "importacion" | null) ?? null,
  );
  const [pending, start] = useTransition();

  const nNum = n.trim() === "" ? null : Number(n);
  const nOk = nNum == null || (Number.isInteger(nNum) && nNum >= 0 && nNum <= N_MAXIMO);
  const anioInst = mant.installedAt ? anioDeClave(mant.installedAt) : null;
  const vista = useMemo(() => {
    if (nNum == null || !nOk || anioInst == null) return null;
    return {
      hasta: nNum > 0 ? `visita de ${anioInst + nNum}` : "ninguna",
      paga: anioInst + nNum + 1,
    };
  }, [nNum, nOk, anioInst]);

  function abrir() {
    // Prerrelleno con el valor por defecto de la empresa si no hay dato.
    if (mant.n == null && mant.nDefecto != null && n === "") setN(String(mant.nDefecto));
    setAbierto(true);
  }

  function aplicarMeses() {
    const r = nDesdeMeses(Number(meses));
    if (r == null) return notify.warning("Escribe los meses del renting o la financiación");
    setN(String(r));
    setOrigen("renting");
  }

  function aplicarAnio() {
    if (!mant.installedAt) return notify.warning("El equipo no tiene fecha de instalación");
    const r = nDesdeAnioCobro(Number(anioCobro), mant.installedAt);
    if (r == null) return notify.warning("Ese año es anterior a la instalación");
    setN(String(r));
  }

  function guardar() {
    if (!nOk) return notify.warning(`N tiene que ser un número entero entre 0 y ${N_MAXIMO}`);
    const vals = [pf, pm, cf, cm].map((v) => (v.trim() ? eurosACentimos(v) : null));
    if ([pf, pm, cf, cm].some((v, i) => v.trim() !== "" && vals[i] == null)) {
      return notify.warning("Algún precio no es válido", "Escribe por ejemplo 75 o 75,50");
    }
    const clienteCambia =
      vals[2] !== mant.precios.cliente.solo_filtros || vals[3] !== mant.precios.cliente.filtros_membrana;
    start(async () => {
      const r = await guardarMantEquipoAction({
        equipment_id: equipoId,
        n: nNum,
        origen: origen ?? (mant.modalidad === "cash" ? "venta" : "manual"),
        precio_filtros_cents: vals[0],
        precio_membrana_cents: vals[1],
        cliente: clienteCambia ? { precio_filtros_cents: vals[2], precio_membrana_cents: vals[3] } : null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Mantenimiento incluido guardado");
      setAbierto(false);
      location.reload();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2 text-xs font-semibold hover:bg-muted"
        title="Mantenimientos incluidos y precio por visita"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" /> Mant. incluido
      </button>
      {abierto && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-3"
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`mant-incl-${equipoId}`}
            className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div className="min-w-0">
                <h2 id={`mant-incl-${equipoId}`} className="text-base font-bold">
                  Mantenimientos incluidos
                </h2>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {equipoNombre}
                  {mant.installedAt ? ` · instalado en ${anioInst}` : " · sin fecha de instalación"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {mant.modalidad === "rental" && (
                <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
                  Alquiler: el mantenimiento va incluido mientras el equipo siga de alta. Solo hace falta N si
                  el alquiler termina.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor={`n-${equipoId}`}>Nº de mantenimientos anuales incluidos (N)</Label>
                <div className="flex flex-wrap gap-2">
                  {ATAJOS_N.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setN(String(v))}
                      aria-pressed={n === String(v)}
                      className={`h-11 min-w-11 rounded-xl border-2 px-3 text-sm font-bold ${
                        n === String(v) ? "border-primary bg-primary/10 text-primary" : "border-border"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                  <Input
                    id={`n-${equipoId}`}
                    inputMode="numeric"
                    value={n}
                    onChange={(e) => setN(e.target.value.replace(/\D/g, ""))}
                    className="h-11 w-20"
                    placeholder="—"
                  />
                  <button
                    type="button"
                    onClick={() => setN("")}
                    className="h-11 rounded-xl border-2 border-border px-3 text-sm font-semibold"
                  >
                    Sin dato
                  </button>
                </div>
                {vista ? (
                  <p className="text-sm">
                    Incluido hasta: <strong>{vista.hasta}</strong> · Empieza a pagar:{" "}
                    <strong>{vista.paga}</strong>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    La visita anual k-ésima es gratis si k ≤ N. Con 0, paga desde la primera.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label className="text-xs" htmlFor={`meses-${equipoId}`}>
                        Renting / financiación (meses)
                      </Label>
                      <Input
                        id={`meses-${equipoId}`}
                        inputMode="numeric"
                        value={meses}
                        onChange={(e) => setMeses(e.target.value.replace(/\D/g, ""))}
                        placeholder="48"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={aplicarMeses}>
                      Usar
                    </Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label className="text-xs" htmlFor={`anio-${equipoId}`}>
                        Cobrar a partir del año
                      </Label>
                      <Input
                        id={`anio-${equipoId}`}
                        inputMode="numeric"
                        value={anioCobro}
                        onChange={(e) => setAnioCobro(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="2030"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={aplicarAnio}>
                      Usar
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold">Precio por visita de este equipo (sin IVA)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`pf-${equipoId}`}>Solo filtros (€)</Label>
                    <Input
                      id={`pf-${equipoId}`}
                      inputMode="decimal"
                      value={pf}
                      onChange={(e) => setPf(e.target.value)}
                      placeholder={precioHeredado("solo_filtros", mant.precios.cliente, mant.precios.empresa, true)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`pm-${equipoId}`}>Filtros + membrana (€)</Label>
                    <Input
                      id={`pm-${equipoId}`}
                      inputMode="decimal"
                      value={pm}
                      onChange={(e) => setPm(e.target.value)}
                      placeholder={precioHeredado("filtros_membrana", mant.precios.cliente, mant.precios.empresa, true)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Vacío = usa el del cliente o, si no, el de la empresa.</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold">Precio para todos los equipos del cliente (sin IVA)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`cf-${equipoId}`}>Solo filtros (€)</Label>
                    <Input
                      id={`cf-${equipoId}`}
                      inputMode="decimal"
                      value={cf}
                      onChange={(e) => setCf(e.target.value)}
                      placeholder={precioHeredado("solo_filtros", mant.precios.cliente, mant.precios.empresa, false)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`cm-${equipoId}`}>Filtros + membrana (€)</Label>
                    <Input
                      id={`cm-${equipoId}`}
                      inputMode="decimal"
                      value={cm}
                      onChange={(e) => setCm(e.target.value)}
                      placeholder={precioHeredado("filtros_membrana", mant.precios.cliente, mant.precios.empresa, false)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Vacío = usa el de la empresa.</p>
              </div>
            </div>

            <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button className="w-full" size="lg" onClick={guardar} disabled={pending || !nOk}>
                {pending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
