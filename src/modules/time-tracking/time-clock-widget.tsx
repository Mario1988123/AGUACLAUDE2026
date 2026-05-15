"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Play, Pause, StopCircle } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { punchKindAction, getMyClockExtended } from "./actions";
import type { ClockExtended } from "./types";

/**
 * Widget de fichaje en el header. Tres botones según estado:
 *  - stopped + canPunch → "▶ Fichar entrada"
 *  - stopped + !canPunch → bloqueado con tooltip explicativo
 *  - working → cronómetro + "⏸ Pausa" + "⏹ Terminar"
 *  - on_break → "▶ Reanudar" + "⏹ Terminar"
 */
export function TimeClockWidget() {
  const [state, setState] = useState<ClockExtended | null>(null);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState("");
  const router = useRouter();
  const ask = useConfirm();

  function reload() {
    getMyClockExtended()
      .then(setState)
      .catch(() =>
        setState({ status: "stopped", canPunch: false, reason: "Error de carga" }),
      );
  }

  useEffect(() => {
    reload();
    // Recargar cada minuto por si entra ventana de fichaje
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (
      !state ||
      (state.status !== "working" && state.status !== "on_break") ||
      !state.since
    ) {
      setElapsed("");
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(state.since!).getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setElapsed(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  function getGeo(): Promise<{ lat: number | null; lng: number | null; acc: number | null }> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve({ lat: null, lng: null, acc: null });
        return;
      }
      const timeout = setTimeout(() => resolve({ lat: null, lng: null, acc: null }), 8000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeout);
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy ?? null,
          });
        },
        () => {
          clearTimeout(timeout);
          resolve({ lat: null, lng: null, acc: null });
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 },
      );
    });
  }

  async function doPunch(kind: "clock_in" | "clock_out" | "break_start" | "break_end") {
    const geo = await getGeo();
    if (geo.lat == null) {
      const ok = await ask({
        message:
          "No se ha obtenido tu GPS. El fichaje quedará marcado para revisión y se generará una incidencia. ¿Continuar?",
        confirmText: "Continuar",
        variant: "warning",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const result = await punchKindAction(kind, {
          geo_latitude: geo.lat,
          geo_longitude: geo.lng,
          accuracy_meters: geo.acc,
        });
        if (!result.ok) {
          notify.error("No se pudo fichar", result.error);
          return;
        }
        const labels: Record<typeof kind, string> = {
          clock_in: "Entrada registrada",
          clock_out: "Salida registrada · jornada terminada",
          break_start: "En pausa",
          break_end: "Reanudado",
        };
        notify.success(labels[kind]);
        setState(result.state);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function endShift() {
    const ok = await ask({
      message: "¿Terminar jornada?",
      confirmText: "Terminar jornada",
      variant: "destructive",
    });
    if (ok) doPunch("clock_out");
  }

  if (!state) return null;

  // Estado: STOPPED → botón de entrada. Si canPunch=false (ausencia
  // aprobada), el botón queda DESHABILITADO con el motivo como tooltip.
  // En cualquier otro caso (warning suave de fuera de turno), permite
  // fichar pero con punto ámbar.
  if (state.status === "stopped") {
    const blocked = !state.canPunch;
    const hasWarning = Boolean(state.reason);
    return (
      <button
        type="button"
        onClick={() => !blocked && doPunch("clock_in")}
        disabled={pending || blocked}
        className={
          blocked
            ? "hidden sm:inline-flex h-10 items-center gap-2 rounded-xl border-2 border-orange-300 bg-orange-50 px-3 text-sm font-bold text-orange-800 cursor-not-allowed"
            : "hidden sm:inline-flex h-10 items-center gap-2 rounded-xl border-2 border-border bg-card px-3 text-sm font-bold transition-all hover:bg-muted"
        }
        title={state.reason ?? "Fichar entrada"}
      >
        <Play className="h-4 w-4 fill-current" />
        <span>{blocked ? "Ausencia hoy" : "Fichar entrada"}</span>
        {!blocked && hasWarning ? (
          <span
            className="inline-block h-2 w-2 rounded-full bg-amber-500"
            aria-label={state.reason}
          />
        ) : !blocked ? (
          <Clock className="h-3.5 w-3.5 opacity-50" />
        ) : null}
      </button>
    );
  }

  // Estado: WORKING → cronómetro + pausa + terminar (un único contenedor
  // con borde envolvente y divisores verticales internos para que NO
  // parezca cortado).
  if (state.status === "working") {
    return (
      <div
        className="hidden sm:inline-flex h-10 items-stretch overflow-hidden rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-700"
        title={`Jornada en curso desde ${state.since ? new Date(state.since).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}`}
      >
        <div className="inline-flex items-center gap-2 px-3 text-sm font-bold min-w-[120px]">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="tabular-nums whitespace-nowrap">{elapsed}</span>
        </div>
        <button
          type="button"
          onClick={() => doPunch("break_start")}
          disabled={pending}
          className="inline-flex items-center justify-center border-l-2 border-emerald-500 px-3 hover:bg-amber-100 hover:text-amber-700"
          title="Pausa / Descanso"
        >
          <Pause className="h-4 w-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={endShift}
          disabled={pending}
          className="inline-flex items-center justify-center border-l-2 border-emerald-500 px-3 hover:bg-red-100 hover:text-red-700"
          title="Terminar jornada"
        >
          <StopCircle className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Estado: ON_BREAK → reanudar / terminar (con cronómetro de pausa)
  return (
    <div
      className="hidden sm:inline-flex h-10 items-stretch overflow-hidden rounded-xl border-2 border-amber-500 bg-amber-50 text-amber-700"
      title={`En descanso desde ${state.since ? new Date(state.since).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}`}
    >
      <div className="inline-flex items-center gap-2 px-3 text-sm font-bold min-w-[120px]">
        <Pause className="h-4 w-4 fill-current shrink-0" />
        <span className="tabular-nums whitespace-nowrap">{elapsed}</span>
      </div>
      <button
        type="button"
        onClick={() => doPunch("break_end")}
        disabled={pending}
        className="inline-flex items-center gap-1 border-l-2 border-amber-500 px-3 hover:bg-emerald-100 hover:text-emerald-700"
        title="Reanudar jornada"
      >
        <Play className="h-4 w-4 fill-current" />
        <span className="text-sm font-bold">Reanudar</span>
      </button>
      <button
        type="button"
        onClick={endShift}
        disabled={pending}
        className="inline-flex items-center justify-center border-l-2 border-amber-500 px-3 hover:bg-red-100 hover:text-red-700"
        title="Terminar jornada"
      >
        <StopCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
