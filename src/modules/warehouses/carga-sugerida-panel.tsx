"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardList, Minus, Plus, Sparkles, X } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import {
  anularMiCargaSugerida,
  confirmarMiCarga,
  guardarMiPreferenciaCarga,
  pedirMiCargaSugerida,
  verMiCargaSugerida,
} from "./carga-sugerida-actions";
import type { OrdenPendiente, PreferenciaCarga, SugerenciaCarga } from "./carga-sugerida-datos";
import type { MomentoCarga } from "./carga-sugerida-logica";

type Dia = "hoy" | "manana";

const ESTADO_ORDEN: Record<string, string> = {
  requested: "Pedida",
  preparing: "El almacén la prepara",
  prepared: "Preparada en el almacén",
  in_transit: "En camino",
};

function nombreDia(clave: string | null): string {
  if (!clave) return "sin día";
  const d = new Date(`${clave}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

const claveLinea = (l: { tipo: string; id: string }) => `${l.tipo}:${l.id}`;

/**
 * «Carga de la furgoneta» en Mi furgoneta (técnico, 2026-11-25): preferencia
 * de cuándo carga, botón para pedir la sugerencia y sus cargas pendientes.
 * Móvil primero: todo pulsable de 44 px o más.
 */
export function CargaSugeridaPanel({
  preferencia,
  pendientes,
}: {
  preferencia: PreferenciaCarga;
  pendientes: OrdenPendiente[];
}) {
  const router = useRouter();
  const [momento, setMomento] = useState<MomentoCarga>(preferencia.momento);
  const [auto, setAuto] = useState(preferencia.sugerencia_auto);
  const [sugerencia, setSugerencia] = useState<SugerenciaCarga | null>(null);
  const [diaVisto, setDiaVisto] = useState<Dia>(preferencia.momento === "tarde" ? "manana" : "hoy");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();

  const diaPorDefecto: Dia = momento === "tarde" ? "manana" : "hoy";
  const otroDia: Dia = diaPorDefecto === "manana" ? "hoy" : "manana";

  function guardarPreferencia(m: MomentoCarga, a: boolean) {
    const antes = { momento, auto };
    setMomento(m);
    setAuto(m === "tarde" ? a : false);
    startTransition(async () => {
      const r = await guardarMiPreferenciaCarga({ momento: m, sugerencia_auto: m === "tarde" ? a : false });
      if (!r.ok) {
        setMomento(antes.momento);
        setAuto(antes.auto);
        notify.error("No se pudo guardar", r.error);
      }
    });
  }

  function sugerir(dia: Dia) {
    startTransition(async () => {
      const r = await verMiCargaSugerida(dia);
      if (!r.ok) {
        notify.error("No se pudo calcular", r.error);
        return;
      }
      setDiaVisto(dia);
      setSugerencia(r.sugerencia);
      setCantidades(Object.fromEntries(r.sugerencia.lineas.map((l) => [claveLinea(l), l.aCargar])));
    });
  }

  function pedir(reemplazar = false) {
    if (!sugerencia) return;
    const lineas = sugerencia.lineas
      .map((l) => ({ tipo: l.tipo, id: l.id, cantidad: cantidades[claveLinea(l)] ?? 0 }))
      .filter((l) => l.cantidad > 0);
    startTransition(async () => {
      const r = await pedirMiCargaSugerida({ dia: diaVisto, lineas, reemplazar });
      if (!r.ok) {
        if (r.yaExiste && !reemplazar && window.confirm(r.error)) {
          pedir(true);
          return;
        }
        if (!r.yaExiste) notify.error("No se pudo pedir la carga", r.error);
        return;
      }
      notify.success("Carga pedida", r.aviso ?? "Cuando la tengas en la furgoneta, pulsa «Ya lo he cargado».");
      setSugerencia(null);
      router.refresh();
    });
  }

  function confirmar(id: string) {
    startTransition(async () => {
      const r = await confirmarMiCarga(id);
      if (!r.ok) {
        notify.error("No se pudo confirmar", r.error);
        return;
      }
      notify.success("Carga confirmada", "Ya está en tu furgoneta.");
      router.refresh();
    });
  }

  function anular(id: string) {
    if (!window.confirm("¿Anular esta carga pedida?")) return;
    startTransition(async () => {
      const r = await anularMiCargaSugerida(id);
      if (!r.ok) {
        notify.error("No se pudo anular", r.error);
        return;
      }
      router.refresh();
    });
  }

  function cambiar(k: string, delta: number) {
    setCantidades((prev) => ({ ...prev, [k]: Math.max(0, Math.min(500, (prev[k] ?? 0) + delta)) }));
  }

  const totalElegido = sugerencia
    ? sugerencia.lineas.reduce((s, l) => s + (cantidades[claveLinea(l)] ?? 0), 0)
    : 0;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="carga-sugerida-titulo">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="carga-sugerida-titulo" className="text-base font-bold">
          Carga para tus trabajos
        </h2>
      </div>

      {/* Preferencia: cuándo carga */}
      {preferencia.disponible && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">¿Cuándo pasas por el almacén?</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cuándo cargas la furgoneta">
            {(["tarde", "manana"] as MomentoCarga[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={momento === m}
                disabled={pending}
                onClick={() => momento !== m && guardarPreferencia(m, auto)}
                className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${
                  momento === m ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"
                }`}
              >
                {m === "tarde" ? "Por la tarde" : "Por la mañana"}
                <span className="block text-xs font-normal text-muted-foreground">
                  {m === "tarde" ? "cargo para mañana" : "cargo para hoy"}
                </span>
              </button>
            ))}
          </div>
          {momento === "tarde" && (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3">
              <input
                type="checkbox"
                checked={auto}
                disabled={pending}
                onChange={(e) => guardarPreferencia("tarde", e.target.checked)}
                className="h-5 w-5 shrink-0 accent-primary"
              />
              <span className="text-sm">
                Prepárame la carga de mañana a las 16:00
                <span className="block text-xs text-muted-foreground">Te llega un aviso solo si hay algo que cargar.</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* Cargas pedidas, aún sin cargar */}
      {pendientes.length > 0 && (
        <ul className="space-y-2">
          {pendientes.map((o) => (
            <li key={o.id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-sm font-semibold">
                Carga para el {nombreDia(o.dia)}
                <span className="ml-2 text-xs font-medium text-muted-foreground">{ESTADO_ORDEN[o.status] ?? o.status}</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {o.lineas.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{l.nombre}</span>
                    <span className="shrink-0 font-semibold tabular-nums">× {l.cantidad}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirmar(o.id)}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Ya lo he cargado
                </button>
                {o.esSugerencia && o.status === "requested" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => anular(o.id)}
                    className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50"
                  >
                    Anular
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Botón principal */}
      {!sugerencia && (
        <div className="space-y-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => sugerir(diaPorDefecto)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {pending ? "Calculando…" : `Sugerir carga para ${diaPorDefecto === "manana" ? "mañana" : "hoy"}`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => sugerir(otroDia)}
            className="h-11 w-full text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            o para {otroDia === "manana" ? "mañana" : "hoy"}
          </button>
        </div>
      )}

      {/* Sugerencia calculada */}
      {sugerencia && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Para el {nombreDia(sugerencia.dia)}</p>
              <p className="text-xs text-muted-foreground">
                {sugerencia.trabajos.instalaciones} instalación{sugerencia.trabajos.instalaciones === 1 ? "" : "es"} ·{" "}
                {sugerencia.trabajos.mantenimientos} mantenimiento{sugerencia.trabajos.mantenimientos === 1 ? "" : "s"} · de{" "}
                {sugerencia.origen.nombre}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSugerencia(null)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border"
              aria-label="Cerrar la sugerencia"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {sugerencia.avisos.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-muted/60 p-3 text-xs">
              {sugerencia.avisos.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          {sugerencia.lineas.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No te hace falta cargar nada: ya llevas lo necesario.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {sugerencia.lineas.map((l) => {
                const k = claveLinea(l);
                const c = cantidades[k] ?? 0;
                const motivo = [
                  l.paraTrabajos > 0 ? `${l.paraTrabajos} para trabajos` : null,
                  l.paraReserva > 0 ? `${l.paraReserva} para la reserva` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={k} className="flex min-h-16 items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{l.nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {l.tipo === "filtro" ? "Filtro · " : ""}
                        {motivo}
                      </p>
                      {!l.hayEnAlmacen && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">No hay en el almacén</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => cambiar(k, -1)}
                        disabled={c === 0}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-40"
                        aria-label={`Una menos de ${l.nombre}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-8 text-center text-base font-bold tabular-nums">{c}</span>
                      <button
                        type="button"
                        onClick={() => cambiar(k, 1)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border"
                        aria-label={`Una más de ${l.nombre}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {sugerencia.sobrantes.length > 0 && (
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold">Puedes dejar en el almacén</p>
              <p className="text-xs text-muted-foreground">Llevas más de lo que piden tus trabajos y la reserva:</p>
              <p className="mt-1">{sugerencia.sobrantes.map((s) => s.nombre).join(", ")}</p>
            </div>
          )}

          {sugerencia.lineas.length > 0 && (
            <button
              type="button"
              disabled={pending || totalElegido === 0}
              onClick={() => pedir()}
              className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Guardando…" : `Pedir esta carga (${totalElegido} ud${totalElegido === 1 ? "" : "s"}.)`}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Pedirla no mueve nada: el stock pasa a tu furgoneta cuando pulses «Ya lo he cargado» o cuando el almacén la
            entregue.
          </p>
        </div>
      )}
    </section>
  );
}
