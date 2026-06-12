/*
 * KILL SWITCH del Service Worker — 2026-06-13.
 *
 * El SW anterior (Serwist, con cacheOnNavigation) cacheaba las navegaciones y
 * servía páginas/listas viejas tras una mutación, de modo que borrar/desactivar
 * "no se actualizaba" y las acciones parecían no funcionar. Confirmado en
 * incógnito (sin SW todo funciona).
 *
 * Este archivo sustituye al SW antiguo. El navegador, al comprobar /sw.js
 * (lo hace por red, saltándose la caché), detecta este contenido nuevo, lo
 * instala y se AUTO-DESINSTALA borrando toda la caché y recargando las
 * pestañas abiertas para que sirvan contenido fresco de red.
 */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      // 1) Borrar toda la caché que dejó el SW antiguo.
      try {
        var keys = await caches.keys();
        await Promise.all(
          keys.map(function (k) {
            return caches.delete(k);
          }),
        );
      } catch (e) {
        /* no-op */
      }
      // 2) Desinstalar este propio Service Worker.
      try {
        await self.registration.unregister();
      } catch (e) {
        /* no-op */
      }
      // 3) Recargar las pestañas abiertas para que dejen de usar el SW muerto.
      try {
        var clients = await self.clients.matchAll({ type: "window" });
        clients.forEach(function (client) {
          try {
            client.navigate(client.url);
          } catch (e) {
            /* no-op */
          }
        });
      } catch (e) {
        /* no-op */
      }
    })(),
  );
});
