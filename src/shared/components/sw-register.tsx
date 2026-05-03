"use client";

import { useEffect } from "react";

/**
 * Limpia cualquier Service Worker previamente registrado por la app.
 * Mientras la PWA está desactivada (Serwist disable=true) este componente
 * desregistra los SW antiguos y borra sus cachés para que los clientes
 * que ya los tenían instalados dejen de interceptar las navegaciones.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {
        /* no-op */
      });
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {
          /* no-op */
        });
    }
  }, []);
  return null;
}
