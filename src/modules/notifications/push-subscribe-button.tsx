"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  registerPushSubscriptionAction,
  unregisterPushSubscriptionAction,
} from "./push-actions";
import { BotonPushNativo, esAppNativa } from "./registro-push-nativo";

/**
 * Botón para activar/desactivar notificaciones push en este dispositivo.
 *
 *  · Dentro de la app (iOS / Android) delega en <BotonPushNativo />: allí el
 *    push es nativo (APNs / FCM), no web.
 *  · En el navegador usa push web. Requiere:
 *      - el Service Worker de solo-push, public/push-sw.js, que registra este
 *        mismo botón al activar (el SW de Serwist sigue apagado);
 *      - NEXT_PUBLIC_VAPID_PUBLIC_KEY en env;
 *      - backend con web-push enviando con la clave privada VAPID.
 *
 * Por qué estaba muerto (hasta 2026-11-10): esperaba a
 * `navigator.serviceWorker.ready`, que no se resuelve nunca si no hay ningún
 * Service Worker registrado, y sw-register.tsx desinstalaba todos en cada carga.
 */
const SW_DE_PUSH = "/push-sw.js";

/** Registro del SW de push si ya existe; null si no (NUNCA se queda colgado). */
async function registroExistente(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  const sw = reg.active ?? reg.waiting ?? reg.installing;
  if (!sw) return null;
  try {
    return new URL(sw.scriptURL).pathname === SW_DE_PUSH ? reg : null;
  } catch {
    return null;
  }
}

/** Registra el SW de push (si no lo está) y espera a que esté activo. */
async function registrarSw(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(SW_DE_PUSH, {
    scope: "/",
    updateViaCache: "none",
  });
  if (reg.active) return reg;
  const listo = navigator.serviceWorker.ready;
  const tope = new Promise<never>((_, rechazar) =>
    setTimeout(() => rechazar(new Error("El navegador no activó el servicio de avisos")), 10_000),
  );
  return Promise.race([listo, tope]);
}
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function PushSubscribeButton() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [enApp, setEnApp] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (esAppNativa()) {
      setEnApp(true);
      return;
    }
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setSupported(false);
      return;
    }
    setSupported(true);
    registroExistente()
      .then(async (reg) => {
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setSubscribed(Boolean(sub));
      })
      .catch(() => setSubscribed(false));
  }, []);

  function subscribe() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      notify.warning(
        "Avisos sin configurar",
        "Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY. Avisa al administrador.",
      );
      return;
    }
    startTransition(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          notify.warning(
            "Permiso denegado",
            "Activa notificaciones desde la configuración del navegador.",
          );
          return;
        }
        const reg = await registrarSw();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        const json = sub.toJSON();
        const r = await registerPushSubscriptionAction({
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh!,
          auth: json.keys!.auth!,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        });
        if (!r.ok) {
          notify.error("No se pudo registrar", r.error);
          return;
        }
        setSubscribed(true);
        notify.success("Notificaciones activadas en este dispositivo");
      } catch (err) {
        notify.error(
          "Error al activar",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  function unsubscribe() {
    startTransition(async () => {
      try {
        const reg = await registroExistente();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) {
          const r = await unregisterPushSubscriptionAction(sub.endpoint);
          if (!r.ok) {
            notify.error("Error", r.error);
            return;
          }
          await sub.unsubscribe();
        }
        setSubscribed(false);
        notify.success("Notificaciones desactivadas");
      } catch (err) {
        notify.error(
          "Error de navegador",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  if (enApp) return <BotonPushNativo />;

  if (!supported) {
    return (
      <div className="space-y-2">
        <Button variant="outline" size="sm" disabled className="gap-1.5">
          <BellOff className="h-4 w-4" />
          Avisos no disponibles en este navegador
        </Button>
        <p className="text-xs text-muted-foreground">
          En iPhone y iPad solo funcionan si añades Hidromanager a la pantalla de inicio
          (Compartir → Añadir a pantalla de inicio) o usas la app.
        </p>
      </div>
    );
  }

  return subscribed ? (
    <Button
      variant="outline"
      size="sm"
      onClick={unsubscribe}
      disabled={pending}
      className="gap-1.5"
    >
      <BellOff className="h-4 w-4" />
      {pending ? "Desactivando…" : "Desactivar notificaciones"}
    </Button>
  ) : (
    <Button
      variant="success"
      size="sm"
      onClick={subscribe}
      disabled={pending}
      className="gap-1.5"
    >
      <Bell className="h-4 w-4" />
      {pending ? "Activando…" : "Activar notificaciones"}
    </Button>
  );
}
