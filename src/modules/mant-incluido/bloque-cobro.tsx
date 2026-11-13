"use client";

import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  ETIQUETA_TARIFA,
  TARIFAS,
  centimosAEuros,
  diferenciaMembrana,
  eur,
  eurosACentimos,
  totalConIva,
  type PreciosTarifa,
  type Tarifa,
} from "./logica";

/** Lo que el servidor pasa al formulario de cierre (serializable). */
export interface ConfigCobroCierre {
  /** cobrar = la visita se cobra (k > N); oficina = ya pagada en oficina (solo diferencia de membrana). */
  modo: "cobrar" | "oficina";
  precios: PreciosTarifa;
  iva: number;
  pagadoTarifa: Tarifa | null;
  pagadoCents: number | null;
}

export interface EstadoCobro {
  cobrado: boolean | null;
  metodo: "cash" | "card" | null;
  importe: string;
  motivo: string;
}

export const COBRO_INICIAL: EstadoCobro = { cobrado: null, metodo: null, importe: "", motivo: "" };

/** Base SIN IVA que hay que cobrar con la tarifa elegida (null = sin precio / no aplica). */
export function baseACobrar(cfg: ConfigCobroCierre, tarifa: Tarifa | null): number | null {
  if (!tarifa) return null;
  if (cfg.modo === "cobrar") return cfg.precios[tarifa];
  return diferenciaMembrana(
    cfg.pagadoTarifa,
    tarifa,
    cfg.precios.solo_filtros,
    cfg.precios.filtros_membrana,
    cfg.pagadoCents,
  );
}

/** ¿Hay que enseñar el bloque «¿Cobrado?»? */
export function hayQueCobrar(cfg: ConfigCobroCierre | null, tarifa: Tarifa | null): boolean {
  if (!cfg) return false;
  if (cfg.modo === "cobrar") return true;
  return baseACobrar(cfg, tarifa) != null;
}

/** Error legible o null si se puede enviar. */
export function errorCobro(
  cfg: ConfigCobroCierre | null,
  tarifa: Tarifa | null,
  st: EstadoCobro,
): string | null {
  if (!cfg) return null;
  if (cfg.modo === "cobrar" && !tarifa) return "Elige la tarifa que cobras";
  if (!hayQueCobrar(cfg, tarifa)) return null;
  if (st.cobrado == null) return "Indica si has cobrado";
  if (st.cobrado) {
    if (!st.metodo) return "Elige efectivo o tarjeta";
    const c = eurosACentimos(st.importe);
    if (!c || c <= 0) return "Escribe el importe cobrado";
    return null;
  }
  return st.motivo.trim() ? null : "Escribe por qué no has cobrado";
}

/** Valor para el servidor. */
export function cobroParaEnviar(st: EstadoCobro) {
  return {
    cobrado: !!st.cobrado,
    metodo: st.cobrado ? st.metodo : null,
    cents: st.cobrado ? eurosACentimos(st.importe) : null,
    motivo: st.cobrado ? null : st.motivo.trim() || null,
  };
}

const BTN =
  "min-h-14 rounded-xl border-2 px-2 text-sm font-bold transition";
const ON = "border-primary bg-primary/10 text-primary";
const OFF = "border-border bg-card hover:bg-muted/40";

/**
 * Bloque de cobro del cierre de visita (a 390 px: botones grandes a dos
 * columnas, nada en horizontal que no quepa). La tarifa la controla el
 * formulario padre; si `mostrarTarifa`, el selector va aquí.
 */
export function BloqueCobro({
  cfg,
  tarifa,
  onTarifa,
  mostrarTarifa,
  valor,
  onChange,
}: {
  cfg: ConfigCobroCierre;
  tarifa: Tarifa | null;
  onTarifa: (t: Tarifa) => void;
  mostrarTarifa: boolean;
  valor: EstadoCobro;
  onChange: (v: EstadoCobro) => void;
}) {
  const base = baseACobrar(cfg, tarifa);
  const total = base != null ? totalConIva(base, cfg.iva) : null;
  const visible = hayQueCobrar(cfg, tarifa);

  function elegirTarifa(t: Tarifa) {
    onTarifa(t);
    // Prerrellena el importe con el total con IVA de la tarifa (editable).
    const b = baseACobrar(cfg, t);
    if (b != null) onChange({ ...valor, importe: centimosAEuros(totalConIva(b, cfg.iva)) });
  }

  return (
    <div className="space-y-3">
      {cfg.modo === "cobrar" && mostrarTarifa && (
        <div className="space-y-2">
          <Label className="text-sm font-bold uppercase tracking-wide">¿Qué tarifa cobras?</Label>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {TARIFAS.map((t) => {
              const p = cfg.precios[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => elegirTarifa(t)}
                  aria-pressed={tarifa === t}
                  className={`${BTN} py-2 ${tarifa === t ? ON : OFF}`}
                >
                  <span className="block">{ETIQUETA_TARIFA[t]}</span>
                  <span className="block text-xs font-semibold opacity-80">
                    {p != null ? `${eur(p)} + IVA (${eur(totalConIva(p, cfg.iva))})` : "Precio a mano"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visible && (
        <div className="space-y-3 rounded-xl border-2 border-red-300 bg-red-50 p-3">
          <p className="text-sm font-bold text-red-900">
            {cfg.modo === "oficina" ? "Diferencia por membrana" : "Cobro del mantenimiento"}
            {base != null && total != null ? (
              <span className="mt-0.5 block text-base">
                {eur(base)} + IVA = {eur(total)}
              </span>
            ) : tarifa ? (
              <span className="mt-0.5 block font-semibold">Sin precio definido: pon el importe a mano.</span>
            ) : null}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [true, "Cobrado"],
                [false, "No cobrado"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  onChange({
                    ...valor,
                    cobrado: v,
                    importe: valor.importe || (total != null ? centimosAEuros(total) : ""),
                  })
                }
                aria-pressed={valor.cobrado === v}
                className={`${BTN} ${valor.cobrado === v ? ON : OFF}`}
              >
                {label}
              </button>
            ))}
          </div>
          {valor.cobrado === true && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["cash", "Efectivo"],
                    ["card", "Tarjeta"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ ...valor, metodo: m })}
                    aria-pressed={valor.metodo === m}
                    className={`${BTN} ${valor.metodo === m ? ON : OFF}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cobro-importe">Importe cobrado (IVA incluido, €)</Label>
                <Input
                  id="cobro-importe"
                  inputMode="decimal"
                  value={valor.importe}
                  onChange={(e) => onChange({ ...valor, importe: e.target.value })}
                  placeholder="0,00"
                />
              </div>
            </>
          )}
          {valor.cobrado === false && (
            <div className="space-y-1.5">
              <Label htmlFor="cobro-motivo">¿Por qué no has cobrado?</Label>
              <Input
                id="cobro-motivo"
                value={valor.motivo}
                maxLength={500}
                onChange={(e) => onChange({ ...valor, motivo: e.target.value })}
                placeholder="No tenía dinero, pagará en oficina…"
              />
              <p className="text-xs text-red-900">Se avisa a la oficina para que lo cobre.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
