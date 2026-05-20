/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Service Worker reactivado 2026-05-20.
 *
 * Diferencias respecto a la versión que tuvimos que apagar:
 *  · NO interceptamos navegaciones de "/api/*" — siempre van a red.
 *  · La fallback a /sin-conexion solo se aplica si la red falla CON
 *    excepción de red, NO si el server responde 5xx.
 *  · Cache-first solo para assets estáticos (_next/static, fonts, images).
 *  · skipWaiting=true para que las nuevas versiones tomen el control rápido.
 *  · Manejador push para futuras notificaciones nativas.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/sin-conexion",
        matcher({ request }) {
          // Sólo navegaciones HTML, y NUNCA endpoints API.
          if (request.destination !== "document") return false;
          const u = new URL(request.url);
          if (u.pathname.startsWith("/api/")) return false;
          if (u.searchParams.has("_rsc")) return false;
          return true;
        },
      },
    ],
  },
});

serwist.addEventListeners();

// ============================================================================
// Push notifications (decisión 2026-05-20)
// El backend envía push via web-push con VAPID keys. El payload es
// JSON: { title, body, url?, tag?, icon? }.
// ============================================================================
self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; icon?: string } = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    data = { title: "Notificación", body: event.data?.text() ?? "" };
  }
  const title = data.title ?? "AGUA CRM";
  const opts: NotificationOptions = {
    body: data.body ?? "",
    icon: data.icon ?? "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    tag: data.tag,
    data: { url: data.url ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Si ya hay una ventana abierta de la app, enfócala y navega.
        for (const client of clientList) {
          if ("focus" in client) {
            (client as WindowClient).navigate(url);
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
