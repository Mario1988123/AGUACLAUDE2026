"use client";

import { useEffect, useRef, useState } from "react";
import { notify } from "@/shared/hooks/use-toast";
import { getMyClockExtended } from "./actions";
import type { ClockExtended } from "./types";

const REMINDER_WINDOWS_MIN = [30, 15, 5]; // minutos antes a los que avisar

function minutesUntil(dateLike: Date): number {
  return Math.round((dateLike.getTime() - Date.now()) / 60000);
}

function buildTodayAt(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/**
 * Componente invisible que avisa al usuario:
 *  - X minutos antes del inicio de turno si no ha fichado entrada
 *  - X minutos antes del fin de turno si sigue trabajando
 *
 * Se monta una sola vez en el layout. Polea estado cada 60 s. Mantiene
 * en sessionStorage qué avisos ya se mostraron hoy para no repetir.
 */
export function ShiftReminders({ enabled = true }: { enabled?: boolean }) {
  const [state, setState] = useState<ClockExtended | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  // Restore shown set desde sessionStorage (sobrevive a recargas de la misma sesión)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("time-tracking:reminders");
      if (raw) shownRef.current = new Set(JSON.parse(raw));
    } catch {
      /* no-op */
    }
  }, []);

  function persistShown() {
    try {
      window.sessionStorage.setItem(
        "time-tracking:reminders",
        JSON.stringify(Array.from(shownRef.current)),
      );
    } catch {
      /* no-op */
    }
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    function load() {
      getMyClockExtended()
        .then((s) => {
          if (!cancelled) setState(s);
        })
        .catch(() => {});
    }
    load();
    const id = setInterval(load, 60_000); // refresh cada minuto
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !state || !state.shift) return;
    const start = buildTodayAt(state.shift.starts_at);
    const end = buildTodayAt(state.shift.ends_at);
    const todayKey = new Date().toISOString().slice(0, 10);

    // ---- Recordatorio de INICIO ----
    if (state.status === "stopped") {
      const minsLeft = minutesUntil(start);
      for (const w of REMINDER_WINDOWS_MIN) {
        if (minsLeft <= w && minsLeft >= 0) {
          const key = `${todayKey}:start:${w}`;
          if (!shownRef.current.has(key)) {
            shownRef.current.add(key);
            persistShown();
            notify.warning(
              "Tu jornada empieza pronto",
              `Te quedan ${minsLeft} min para fichar entrada (${state.shift.starts_at}).`,
            );
            break;
          }
        }
      }
    }

    // ---- Recordatorio de FIN ----
    if (state.status === "working" || state.status === "on_break") {
      const minsLeft = minutesUntil(end);
      for (const w of REMINDER_WINDOWS_MIN) {
        if (minsLeft <= w && minsLeft >= 0) {
          const key = `${todayKey}:end:${w}`;
          if (!shownRef.current.has(key)) {
            shownRef.current.add(key);
            persistShown();
            notify.warning(
              "Tu jornada acaba pronto",
              `Te quedan ${minsLeft} min para fichar salida (${state.shift.ends_at}).`,
            );
            break;
          }
        }
      }
      // Aviso si ya pasó el fin de turno y sigue trabajando
      if (Date.now() > end.getTime()) {
        const key = `${todayKey}:overrun`;
        if (!shownRef.current.has(key)) {
          shownRef.current.add(key);
          persistShown();
          notify.warning(
            "Sigues fichado tras fin de jornada",
            "Recuerda fichar salida para que cuadre el horario.",
          );
        }
      }
    }
  }, [state, enabled]);

  return null;
}
