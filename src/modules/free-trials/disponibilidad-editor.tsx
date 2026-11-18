"use client";

// Editor de la disponibilidad del cliente para instalar la prueba gratuita.
// Ver ./disponibilidad.ts para el formato que se guarda.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MultiDateCalendar } from "@/modules/contracts/install-preference";
import {
  capitalizar,
  DIAS_SEMANA,
  fechaCorta,
  resumenDisponibilidad,
  type Disponibilidad,
  type FranjaFecha,
  type FranjaSemanal,
} from "./disponibilidad";

type Modo = "ninguna" | "semanal" | "fechas";

const MODOS: Array<{ valor: Modo; etiqueta: string }> = [
  { valor: "ninguna", etiqueta: "Sin indicar" },
  { valor: "semanal", etiqueta: "Días fijos" },
  { valor: "fechas", etiqueta: "Días concretos" },
];

const HORARIO_INICIAL = { desde: "09:00", hasta: "14:00" };

function sumarHoras(hhmm: string, horas: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min((h ?? 0) * 60 + (m ?? 0) + horas * 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function ordenarFechas(f: FranjaFecha[]): FranjaFecha[] {
  return [...f].sort((a, b) =>
    a.fecha === b.fecha ? a.desde.localeCompare(b.desde) : a.fecha.localeCompare(b.fecha),
  );
}

/** Lo que se entrega al padre. Una franja semanal sin días cuenta como error
 *  (para que no se pierda en silencio), salvo que NINGUNA tenga días: entonces
 *  es que no se ha indicado nada. */
function calcular(m: Modo, s: FranjaSemanal[], f: FranjaFecha[]): Disponibilidad | null {
  if (m === "semanal") {
    return s.some((x) => x.dias.length > 0) ? { modo: "semanal", franjas: s } : null;
  }
  if (m === "fechas") {
    return f.length > 0 ? { modo: "fechas", franjas: ordenarFechas(f) } : null;
  }
  return null;
}

function HoraInput({
  value,
  onChange,
  etiqueta,
}: {
  value: string;
  onChange: (v: string) => void;
  etiqueta: string;
}) {
  return (
    <input
      type="time"
      step={900}
      value={value}
      aria-label={etiqueta}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-[6.5rem] rounded-lg border border-border bg-background px-2.5 text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function BotonIcono({
  onClick,
  etiqueta,
  children,
  peligro,
}: {
  onClick: () => void;
  etiqueta: string;
  children: React.ReactNode;
  peligro?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted ${
        peligro ? "text-destructive" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function DisponibilidadEditor({
  inicial,
  onChange,
}: {
  inicial: Disponibilidad | null;
  onChange: (d: Disponibilidad | null) => void;
}) {
  const [modo, setModo] = useState<Modo>(inicial?.modo ?? "ninguna");
  const [semanal, setSemanal] = useState<FranjaSemanal[]>(
    inicial?.modo === "semanal" ? inicial.franjas : [{ dias: [], ...HORARIO_INICIAL }],
  );
  const [fechas, setFechas] = useState<FranjaFecha[]>(
    inicial?.modo === "fechas" ? ordenarFechas(inicial.franjas) : [],
  );

  // Se guardan los dos modos por separado: cambiar de pestaña no borra lo
  // que se había puesto en la otra (solo se entrega la que esté activa).
  function aplicar(m: Modo, s: FranjaSemanal[], f: FranjaFecha[]) {
    setModo(m);
    setSemanal(s);
    setFechas(f);
    onChange(calcular(m, s, f));
  }

  // ── Días fijos ─────────────────────────────────────────────
  function cambiarSemanal(i: number, cambio: Partial<FranjaSemanal>) {
    aplicar(
      modo,
      semanal.map((x, j) => (j === i ? { ...x, ...cambio } : x)),
      fechas,
    );
  }
  function alternarDia(i: number, dia: number) {
    const dias = semanal[i]!.dias;
    cambiarSemanal(i, {
      dias: dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia].sort((a, b) => a - b),
    });
  }
  function anadirSemanal() {
    const ultima = semanal[semanal.length - 1] ?? { ...HORARIO_INICIAL };
    aplicar(modo, [...semanal, { dias: [], desde: ultima.desde, hasta: ultima.hasta }], fechas);
  }
  function quitarSemanal(i: number) {
    aplicar(
      modo,
      semanal.filter((_, j) => j !== i),
      fechas,
    );
  }

  // ── Días concretos ─────────────────────────────────────────
  const fechasMarcadas = Array.from(new Set(fechas.map((f) => f.fecha)));

  function cambiarCalendario(nuevas: string[]) {
    const ultima = fechas[fechas.length - 1] ?? HORARIO_INICIAL;
    const quedan = fechas.filter((f) => nuevas.includes(f.fecha));
    const nuevasFilas = nuevas
      .filter((n) => !fechas.some((f) => f.fecha === n))
      .map((fecha) => ({ fecha, desde: ultima.desde, hasta: ultima.hasta }));
    aplicar(modo, semanal, ordenarFechas([...quedan, ...nuevasFilas]));
  }
  function cambiarFecha(i: number, cambio: Partial<FranjaFecha>) {
    aplicar(
      modo,
      semanal,
      fechas.map((x, j) => (j === i ? { ...x, ...cambio } : x)),
    );
  }
  function otraFranjaMismoDia(i: number) {
    const base = fechas[i]!;
    const desde = base.hasta;
    aplicar(
      modo,
      semanal,
      ordenarFechas([...fechas, { fecha: base.fecha, desde, hasta: sumarHoras(desde, 2) }]),
    );
  }
  function quitarFecha(i: number) {
    aplicar(
      modo,
      semanal,
      fechas.filter((_, j) => j !== i),
    );
  }
  function mismoHorarioEnTodas() {
    const primera = fechas[0];
    if (!primera) return;
    // Un día con dos franjas se queda en una: la del primero.
    const unicas = fechasMarcadas.map((fecha) => ({
      fecha,
      desde: primera.desde,
      hasta: primera.hasta,
    }));
    aplicar(modo, semanal, unicas);
  }

  // Resumen solo con lo que ya está completo (sin franjas a medio poner).
  const lineas = resumenDisponibilidad(
    modo === "semanal"
      ? (() => {
          const ok = semanal.filter((x) => x.dias.length > 0 && x.desde < x.hasta);
          return ok.length > 0 ? { modo: "semanal" as const, franjas: ok } : null;
        })()
      : modo === "fechas"
        ? (() => {
            const ok = fechas.filter((x) => x.desde < x.hasta);
            return ok.length > 0 ? { modo: "fechas" as const, franjas: ok } : null;
          })()
        : null,
  );

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Cómo indicar la disponibilidad"
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:max-w-md"
      >
        {MODOS.map((o) => {
          const activo = modo === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => aplicar(o.valor, semanal, fechas)}
              className={`h-10 rounded-lg px-1.5 text-xs font-semibold transition-colors sm:text-sm ${
                activo
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.etiqueta}
            </button>
          );
        })}
      </div>

      {modo === "semanal" && (
        <div className="space-y-2 sm:max-w-md">
          <p className="text-xs text-muted-foreground">
            Marca los días y la franja. Si un día tiene otro horario, añade otra franja.
          </p>
          {semanal.map((f, i) => (
            <div key={i} className="space-y-2 rounded-xl border bg-card p-2.5">
              <div className="grid grid-cols-7 gap-1">
                {DIAS_SEMANA.map((d) => {
                  const activo = f.dias.includes(d.valor);
                  return (
                    <button
                      key={d.valor}
                      type="button"
                      aria-pressed={activo}
                      aria-label={d.largo}
                      title={d.largo}
                      onClick={() => alternarDia(i, d.valor)}
                      className={`h-10 rounded-lg border-2 text-sm font-bold transition-colors ${
                        activo
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:border-primary/40"
                      }`}
                    >
                      {d.corto}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <HoraInput
                  value={f.desde}
                  etiqueta="Desde"
                  onChange={(v) => cambiarSemanal(i, { desde: v })}
                />
                <span className="text-sm text-muted-foreground">a</span>
                <HoraInput
                  value={f.hasta}
                  etiqueta="Hasta"
                  onChange={(v) => cambiarSemanal(i, { hasta: v })}
                />
                {semanal.length > 1 && (
                  <div className="ml-auto">
                    <BotonIcono etiqueta="Quitar franja" onClick={() => quitarSemanal(i)} peligro>
                      <Trash2 className="h-4 w-4" />
                    </BotonIcono>
                  </div>
                )}
              </div>
              {f.desde >= f.hasta && (
                <p className="text-xs text-destructive">La hora de fin tiene que ser posterior.</p>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={anadirSemanal}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/5"
          >
            <Plus className="h-4 w-4" /> Añadir otra franja
          </button>
        </div>
      )}

      {modo === "fechas" && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_1fr] md:items-start">
          <MultiDateCalendar value={fechasMarcadas} onChange={cambiarCalendario} bloquearPasados />
          <div className="space-y-2">
            {fechas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Pulsa en el calendario los días que le vienen bien. Cada día lleva su horario.
              </p>
            ) : (
              <>
                {fechas.map((f, i) => (
                  <div
                    key={`${f.fecha}-${i}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-card p-2.5"
                  >
                    <span className="w-24 text-sm font-semibold">
                      {capitalizar(fechaCorta(f.fecha))}
                    </span>
                    <div className="order-last flex w-full items-center gap-1.5 sm:order-none sm:w-auto">
                      <HoraInput
                        value={f.desde}
                        etiqueta={`Desde, ${fechaCorta(f.fecha)}`}
                        onChange={(v) => cambiarFecha(i, { desde: v })}
                      />
                      <span className="text-sm text-muted-foreground">a</span>
                      <HoraInput
                        value={f.hasta}
                        etiqueta={`Hasta, ${fechaCorta(f.fecha)}`}
                        onChange={(v) => cambiarFecha(i, { hasta: v })}
                      />
                    </div>
                    <div className="ml-auto flex">
                      <BotonIcono etiqueta="Otra franja este día" onClick={() => otraFranjaMismoDia(i)}>
                        <Plus className="h-4 w-4" />
                      </BotonIcono>
                      <BotonIcono etiqueta="Quitar" onClick={() => quitarFecha(i)} peligro>
                        <Trash2 className="h-4 w-4" />
                      </BotonIcono>
                    </div>
                    {f.desde >= f.hasta && (
                      <p className="order-last w-full text-xs text-destructive">
                        La hora de fin tiene que ser posterior.
                      </p>
                    )}
                  </div>
                ))}
                {fechasMarcadas.length > 1 && (
                  <button
                    type="button"
                    onClick={mismoHorarioEnTodas}
                    className="h-10 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/5"
                  >
                    Mismo horario que el {fechaCorta(fechas[0]!.fecha)} en todos
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {lineas.length > 0 && (
        <div className="rounded-xl bg-primary/5 px-3 py-2 sm:max-w-md">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Le viene bien
          </p>
          <ul className="mt-0.5 space-y-0.5 text-sm">
            {lineas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
