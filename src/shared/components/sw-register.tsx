"use client";

import { useEffect } from "react";

/**
 * Registra el Service Worker generado por Serwist (`/sw.js`).
 *
 * Decisión 2026-05-20: tras endurecer el SW (no intercepta /api/* ni
 * RSC, fallback solo en navegaciones HTML que fallan por red) volvemos
 * a habilitarlo. En desarrollo se mantiene desactivado vía next.config.
 *
 * Serwist también puede registrar el SW automáticamente, pero hacemos
 * un fallback manual para asegurarnos.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* no-op: si Serwist ya lo registró, devolverá la misma reg */
    });
  }, []);
  return null;
}
