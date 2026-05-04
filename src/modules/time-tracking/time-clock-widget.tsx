"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Play, Pause, StopCircle } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
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
      const ok = confirm(
        "No se ha obtenido tu GPS. El fichaje quedará marcado para revisión y se generará una incidencia. ¿Continuar?",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        // punchKindAction ahora devuelve el estado actualizado tras el INSERT
        const fresh = await punchKindAction(kind, {
          geo_latitude: geo.lat,
          geo_longitude: geo.lng,
          accuracy_meters: geo.acc,
        });
        const labels: Record<typeof kind, string> = {
          clock_in: "Entrada registrada",
          clock_out: "Salida registrada · jornada terminada",
          break_start: "En pausa",
          break_end: "Reanudado",
        };
        notify.success(labels[kind]);
        setState(fresh);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!state) return null;

  // Estado: STOPPED → botón de entrada (o deshabilitado fuera de ventana)
  if (state.status === "stopped") {
    return (
      <button
        type="button"
        onClick={() => state.canPunch && doPunch("clock_in")}
        disabled={pending || !state.canPunch}
        className={`hidden sm:inline-flex h-10 items-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition-all ${
          state.canPunch
            ? "border-border bg-card hover:bg-muted"
            : "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
        }`}
        title={state.reason ?? "Fichar entrada"}
      >
        <Play className="h-4 w-4 fill-current" />
        <span>{state.canPunch ? "Fichar entrada" : "Fuera de turno"}</span>
        <Clock className="h-3.5 w-3.5 opacity-50" />
      </button>
    );
  }

  // Estado: WORKING → cronómetro + pausa + terminar
  if (state.status === "working") {
    return (
      <div className="hidden sm:flex items-center gap-1">
        <div
          className="inline-flex h-10 items-center gap-2 rounded-l-xl border-y-2 border-l-2 border-emerald-500 bg-emerald-50 px-3 text-sm font-bold text-emerald-700 min-w-[120px]"
          title={`Jornada en curso desde ${state.since ? new Date(state.since).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}`}
        >
          <Clock className="h-4 w-4 shrink-0" />
          <span className="tabular-nums whitespace-nowrap">{elapsed}</span>
        </div>
        <button
          type="button"
          onClick={() => doPunch("break_start")}
          disabled={pending}
          className="inline-flex h-10 items-center justify-center border-y-2 border-emerald-500 bg-emerald-50 px-2 text-emerald-700 hover:bg-amber-100 hover:text-amber-700"
          title="Pausa / Descanso"
        >
          <Pause className="h-4 w-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Terminar jornada?")) doPunch("clock_out");
          }}
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-r-xl border-2 border-emerald-500 bg-emerald-50 px-2 text-emerald-700 hover:bg-red-100 hover:text-red-700 hover:border-red-500"
          title="Terminar jornada"
        >
          <StopCircle className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Estado: ON_BREAK → reanudar / terminar (con cronómetro de pausa)
  return (
    <div className="hidden sm:flex items-center gap-1">
      <div
        className="inline-flex h-10 items-center gap-2 rounded-l-xl border-y-2 border-l-2 border-amber-500 bg-amber-50 px-3 text-sm font-bold text-amber-700 min-w-[120px]"
        title={`En descanso desde ${state.since ? new Date(state.since).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}`}
      >
        <Pause className="h-4 w-4 fill-current shrink-0" />
        <span className="tabular-nums whitespace-nowrap">{elapsed}</span>
      </div>
      <button
        type="button"
        onClick={() => doPunch("break_end")}
        disabled={pending}
        className="inline-flex h-10 items-center gap-1 border-y-2 border-amber-500 bg-amber-50 px-3 text-amber-700 hover:bg-emerald-100 hover:text-emerald-700"
        title="Reanudar jornada"
      >
        <Play className="h-4 w-4 fill-current" />
        <span className="text-sm font-bold">Reanudar</span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm("¿Terminar jornada?")) doPunch("clock_out");
        }}
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-r-xl border-2 border-amber-500 bg-amber-50 px-2 text-amber-700 hover:bg-red-100 hover:text-red-700"
        title="Terminar jornada"
      >
        <StopCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
