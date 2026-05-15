"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Crosshair, Play, Pause, StopCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { MapPicker } from "@/shared/components/map-picker";
import { punchKindAction, getMyClockExtended } from "./actions";
import type { ClockExtended } from "./types";

interface Props {
  userName: string;
  initialState: ClockExtended;
  /** Resumen del día actual (worked minutes). Se recalcula al refrescar. */
  todayWorkedMinutes: number;
  todayExpectedMinutes: number;
}

function fmtMin(m: number): string {
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}h ${String(abs % 60).padStart(2, "0")}min`;
}

export function PunchPageClient({
  userName,
  initialState,
  todayWorkedMinutes,
  todayExpectedMinutes,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<ClockExtended>(initialState);
  const [pending, startTransition] = useTransition();
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "ok" | "denied">("idle");
  const [elapsed, setElapsed] = useState("");

  // Capturar GPS al cargar
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("denied");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAccuracy(pos.coords.accuracy ?? null);
        setGeoStatus("ok");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  // Cronómetro
  useEffect(() => {
    if (
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

  // Refresh estado cada 60s por si pasa la ventana
  useEffect(() => {
    const id = setInterval(() => {
      getMyClockExtended().then(setState).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, []);

  async function doPunch(
    kind: "clock_in" | "clock_out" | "break_start" | "break_end",
  ) {
    if (geoStatus !== "ok") {
      const ok = confirm(
        "No se ha obtenido tu ubicación. Se generará una incidencia para revisión. ¿Continuar?",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const next = await punchKindAction(kind, {
          geo_latitude: lat,
          geo_longitude: lng,
          accuracy_meters: accuracy,
        });
        setState(next);
        notify.success(
          kind === "clock_in"
            ? "Entrada registrada"
            : kind === "clock_out"
              ? "Salida registrada"
              : kind === "break_start"
                ? "Descanso iniciado"
                : "Descanso terminado",
        );
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const initials = userName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase() || "?";

  const blockedReason = state.status === "stopped" && !state.canPunch ? state.reason : null;

  return (
    <div className="space-y-4">
      {/* Cabecera con avatar */}
      <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
          {initials}
        </div>
        <div>
          <div className="font-bold">{userName}</div>
          <div className="text-xs text-muted-foreground">
            {state.status === "working" && (
              <span className="text-emerald-700">● Trabajando · {elapsed}</span>
            )}
            {state.status === "on_break" && (
              <span className="text-amber-700">● En descanso · {elapsed}</span>
            )}
            {state.status === "stopped" && (
              <span className="text-muted-foreground">○ Sin fichar</span>
            )}
          </div>
        </div>
      </div>

      {/* Mapa + estado geo */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2.5 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-primary" />
          {geoStatus === "locating" && "Localizando tu ubicación..."}
          {geoStatus === "ok" && "Ubicación capturada"}
          {geoStatus === "denied" && (
            <span className="text-amber-700">
              Sin ubicación · el fichaje se marcará para revisión
            </span>
          )}
          {geoStatus === "idle" && "Esperando GPS"}
        </div>
        <MapPicker
          latitude={lat}
          longitude={lng}
          onChange={(la, ln) => {
            // Permitir corrección manual si el GPS no es preciso. El admin
            // verá esto como needs_geo_review si la diferencia es grande.
            setLat(la);
            setLng(ln);
            setGeoStatus("ok");
          }}
          height={260}
        />
        <div className="border-t bg-card p-3">
          {blockedReason && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠ {blockedReason}
            </div>
          )}
          {/* Acciones según estado */}
          {state.status === "stopped" && (
            <Button
              size="lg"
              variant="success"
              className="w-full text-base"
              disabled={pending || !state.canPunch}
              onClick={() => doPunch("clock_in")}
            >
              <Play className="h-5 w-5" />
              {pending ? "Fichando..." : "Fichar entrada"}
            </Button>
          )}
          {state.status === "working" && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="outline"
                disabled={pending}
                onClick={() => doPunch("break_start")}
              >
                <Pause className="h-4 w-4" /> Pausa
              </Button>
              <Button
                size="lg"
                variant="destructive"
                disabled={pending}
                onClick={() => doPunch("clock_out")}
              >
                <StopCircle className="h-4 w-4" /> Fichar salida
              </Button>
            </div>
          )}
          {state.status === "on_break" && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="success"
                disabled={pending}
                onClick={() => doPunch("break_end")}
              >
                <Play className="h-4 w-4" /> Reanudar
              </Button>
              <Button
                size="lg"
                variant="destructive"
                disabled={pending}
                onClick={() => doPunch("clock_out")}
              >
                <StopCircle className="h-4 w-4" /> Fichar salida
              </Button>
            </div>
          )}
          {geoStatus === "denied" && (
            <button
              type="button"
              onClick={() => {
                if (!navigator.geolocation) return;
                setGeoStatus("locating");
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLat(pos.coords.latitude);
                    setLng(pos.coords.longitude);
                    setAccuracy(pos.coords.accuracy ?? null);
                    setGeoStatus("ok");
                  },
                  () => setGeoStatus("denied"),
                  { enableHighAccuracy: true, timeout: 8000 },
                );
              }}
              className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-primary hover:underline"
            >
              <Crosshair className="h-3 w-3" /> Reintentar GPS
            </button>
          )}
        </div>
      </div>

      {/* Resumen del día */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-muted-foreground">Hoy</div>
          <div className="text-right">
            <div className="text-2xl font-extrabold tabular-nums">
              {fmtMin(todayWorkedMinutes)}
            </div>
            {todayExpectedMinutes > 0 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                / {fmtMin(todayExpectedMinutes)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
