/*
 * Service Worker SOLO de notificaciones push (2026-11-10).
 *
 * No tiene manejador "fetch" ni toca la caché: no intercepta ninguna petición,
 * así que NO puede servir páginas viejas (el problema por el que se apagó el
 * SW de Serwist el 2026-06-13; ver public/sw.js y next.config.ts).
 *
 * Lo registra el botón «Activar notificaciones» de /perfil
 * (src/modules/notifications/push-subscribe-button.tsx) y lo respeta el
 * limpiador de src/shared/components/sw-register.tsx.
 *
 * El servidor envía con web-push + VAPID un JSON: { title, body, url, tag, icon }.
 */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var datos = {};
  try {
    if (event.data) datos = event.data.json();
  } catch (e) {
    datos = { title: "Hidromanager", body: event.data ? event.data.text() : "" };
  }
  var titulo = datos.title || "Hidromanager";
  var opciones = {
    body: datos.body || "",
    icon: datos.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: datos.url || "/" },
  };
  if (datos.tag) {
    opciones.tag = datos.tag;
    opciones.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var ruta = (event.notification.data && event.notification.data.url) || "/";
  // Solo rutas de este mismo sitio.
  var destino = new URL(ruta, self.location.origin);
  if (destino.origin !== self.location.origin) destino = new URL("/", self.location.origin);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (ventanas) {
        for (var i = 0; i < ventanas.length; i++) {
          var ventana = ventanas[i];
          if ("focus" in ventana) {
            return ventana.focus().then(function (enfocada) {
              var v = enfocada || ventana;
              if ("navigate" in v) {
                return v.navigate(destino.href).catch(function () {
                  return self.clients.openWindow(destino.href);
                });
              }
              return undefined;
            });
          }
        }
        return self.clients.openWindow(destino.href);
      }),
  );
});
