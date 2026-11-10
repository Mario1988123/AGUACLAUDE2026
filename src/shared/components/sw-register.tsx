"use client";

import { useEffect } from "react";

/** Service Worker SOLO de push (public/push-sw.js): no cachea ni intercepta
 *  peticiones, así que no se desinstala. */
const SW_DE_PUSH = "/push-sw.js";

function esElDePush(reg: ServiceWorkerRegistration): boolean {
  const sw = reg.active ?? reg.waiting ?? reg.installing;
  if (!sw) return false;
  try {
    return new URL(sw.scriptURL).pathname === SW_DE_PUSH;
  } catch {
    return false;
  }
}

/**
 * KILL SWITCH del Service Worker (2026-06-13).
 *
 * Antes registraba el SW de Serwist. Lo desactivamos: el SW cacheaba las
 * navegaciones (cacheOnNavigation) y servía páginas/listas viejas tras
 * mutaciones → borrar/desactivar "no se actualizaba". Confirmado en incógnito.
 *
 * Ahora, en cada carga, DESINSTALA cualquier Service Worker previo y limpia
 * toda la caché. Combinado con el kill-switch de /public/sw.js, esto limpia a
 * todos los usuarios que tuvieran el SW antiguo.
 *
 * Excepción (2026-11-10): el SW de solo-push (/push-sw.js) se respeta. Este
 * limpiador lo desinstalaba en cada carga y por eso el push web estaba muerto:
 * el botón de /perfil esperaba a un Service Worker que nunca llegaba a existir.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) {
          if (esElDePush(reg)) continue;
          reg.unregister().catch(() => {});
        }
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
