"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  registerPushSubscriptionAction,
  unregisterPushSubscriptionAction,
} from "./push-actions";

/**
 * Botón para activar/desactivar notificaciones push en este dispositivo.
 * Requiere:
 *  · SW registrado (lo hace Serwist automáticamente).
 *  · NEXT_PUBLIC_VAPID_PUBLIC_KEY en env.
 *  · Backend con web-push enviando con la clave privada VAPID.
 */
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
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    });
  }, []);

  function subscribe() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      notify.warning(
        "Push notifications no configuradas",
        "Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY. Avisa al admin.",
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
        const reg = await navigator.serviceWorker.ready;
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
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await unregisterPushSubscriptionAction(sub.endpoint);
          await sub.unsubscribe();
        }
        setSubscribed(false);
        notify.success("Notificaciones desactivadas");
      } catch (err) {
        notify.error(
          "Error",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  if (!supported) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5">
        <BellOff className="h-4 w-4" />
        Push no soportado
      </Button>
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
