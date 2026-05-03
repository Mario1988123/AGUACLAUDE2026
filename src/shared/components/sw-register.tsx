"use client";

import { useEffect } from "react";

/**
 * Registra el Service Worker pre-generado en /sw.js para habilitar PWA
 * (instalable en escritorio, Android e iOS). Se ejecuta sólo en producción
 * para evitar interferir con HMR de Next dev.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* fail-soft: si falla seguimos como web normal */
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
