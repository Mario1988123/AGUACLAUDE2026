"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Play, Square } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { punchAction, getMyCurrentStatus } from "./actions";

/**
 * Widget de fichaje en el header. Muestra estado actual y un botón para
 * fichar entrada/salida. Captura geolocalización obligatoria; si el usuario
 * la deniega, se registra igual pero con marca needs_geo_review + incidencia
 * automática para el admin.
 */
export function TimeClockWidget() {
  const [status, setStatus] = useState<"loading" | "working" | "stopped">("loading");
  const [since, setSince] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState("");
  const router = useRouter();

  useEffect(() => {
    getMyCurrentStatus()
      .then((s) => {
        setStatus(s.status);
        setSince(s.since);
      })
      .catch(() => setStatus("stopped"));
  }, []);

  useEffect(() => {
    if (status !== "working" || !since) {
      setElapsed("");
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(since).getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setElapsed(`${h}h ${String(m).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [status, since]);

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

  async function doPunch() {
    const geo = await getGeo();
    if (geo.lat == null) {
      const ok = confirm(
        "No se ha podido obtener tu ubicación GPS. El fichaje quedará marcado para revisión y se generará una incidencia. ¿Continuar?",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const r = await punchAction({
          geo_latitude: geo.lat,
          geo_longitude: geo.lng,
          accuracy_meters: geo.acc,
        });
        notify.success(r.kind === "clock_in" ? "Entrada registrada" : "Salida registrada");
        const s = await getMyCurrentStatus();
        setStatus(s.status);
        setSince(s.since);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (status === "loading") {
    return null;
  }

  return (
    <button
      type="button"
      onClick={doPunch}
      disabled={pending}
      className={`hidden sm:inline-flex h-10 items-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition-all ${
        status === "working"
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
      title={status === "working" ? "Pulsa para fichar SALIDA" : "Pulsa para fichar ENTRADA"}
    >
      {status === "working" ? (
        <>
          <Square className="h-4 w-4 fill-current" />
          <span>{elapsed || "Fichando…"}</span>
        </>
      ) : (
        <>
          <Play className="h-4 w-4 fill-current" />
          <span>Fichar</span>
        </>
      )}
      <Clock className="h-3.5 w-3.5 opacity-50" />
    </button>
  );
}
