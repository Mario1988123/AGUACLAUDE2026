"use client";

import { useEffect } from "react";

/**
 * KILL SWITCH del Service Worker (2026-06-13).
 *
 * Antes registraba el SW de Serwist. Lo desactivamos: el SW cacheaba las
 * navegaciones (cacheOnNavigation) y servía páginas/listas viejas tras
 * mutaciones → borrar/desactivar "no se actualizaba". Confirmado en incógnito.
 *
 * Ahora, en cada carga, DESINSTALA cualquier Service Worker previo y limpia
 * toda la caché. Combinado con el kill-switch de /public/sw.js, esto limpia a
 * todos los usuarios que tuvieran el SW antiguo. (Pausa push; reversible.)
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) reg.unregister().catch(() => {});
      })
      .catch(() => {});
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((keys) => {
          for (const k of keys) caches.delete(k).catch(() => {});
        })
        .catch(() => {});
    }
  }, []);
  return null;
}
