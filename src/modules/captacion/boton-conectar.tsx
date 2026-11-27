"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { conectarWhatsappAction } from "./conexion-actions";

/**
 * Embedded Signup v4 de Meta (comprobado en developers.facebook.com el
 * 2026-11-25). El navegador recibe dos cosas por caminos distintos y en
 * cualquier orden:
 *  · el `code` en el callback de FB.login (solo si se pulsa «Finalizar»)
 *  · waba_id y phone_number_id en un evento `message` WA_EMBEDDED_SIGNUP
 * Cuando están las dos, se mandan al servidor, que comprueba los ids con el
 * token antes de guardar nada.
 *
 * Coexistencia (onboarding-business-app-users, comprobado el 2026-11-27): con
 * featureType "whatsapp_business_app_onboarding" Meta deja conectar el número
 * que ya está en la app de WhatsApp Business (se escanea un QR en el móvil).
 * Al acabar manda FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, documentado solo
 * con waba_id: el servidor saca el número de la WABA. Decide el evento que
 * llega, no el botón pulsado.
 */

interface FBLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FBSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FBLoginResponse) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FBSdk;
    fbAsyncInit?: () => void;
  }
}

interface DatosSesion {
  waba_id: string;
  phone_number_id: string | null;
  business_id: string | null;
  coexistencia: boolean;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

function esOrigenFacebook(origen: string): boolean {
  try {
    const h = new URL(origen).hostname;
    return h === "facebook.com" || h.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

function cargarSdk(appId: string, version: string): Promise<FBSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.src = SDK_URL;
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.onerror = () => reject(new Error("No se pudo cargar el SDK de Facebook."));
      document.body.appendChild(s);
    }
  });
}

export function BotonConectarWhatsapp({
  appId,
  configId,
  graphVersion,
  coexistencia = false,
  textoBoton = "Conectar WhatsApp",
  variante = "default",
}: {
  appId: string;
  configId: string;
  graphVersion: string;
  /** true: abre el alta del número que ya está en la app de WhatsApp Business. */
  coexistencia?: boolean;
  textoBoton?: string;
  variante?: "default" | "outline";
}) {
  const [abierto, setAbierto] = useState(false);
  const [pending, startTransition] = useTransition();
  const codigo = useRef<string | null>(null);
  const sesion = useRef<DatosSesion | null>(null);
  const enviado = useRef(false);

  const intentarEnviar = useCallback(() => {
    if (enviado.current || !codigo.current || !sesion.current) return;
    enviado.current = true;
    const datos = { code: codigo.current, ...sesion.current };
    startTransition(async () => {
      const r = await conectarWhatsappAction(datos);
      setAbierto(false);
      if (!r.ok) toast.error(r.error);
      else if (r.aviso) toast.warning(r.aviso, { duration: 15_000 });
      else toast.success(datos.coexistencia ? "WhatsApp conectado. Sigue también en la app del móvil." : "WhatsApp conectado");
    });
  }, []);

  useEffect(() => {
    function alMensaje(ev: MessageEvent) {
      if (!esOrigenFacebook(ev.origin)) return;
      let data: unknown;
      try {
        data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      const d = data as {
        type?: string;
        event?: string;
        data?: Record<string, unknown>;
      };
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (d.event === "FINISH" && d.data) {
        const waba = texto(d.data.waba_id);
        const pnid = texto(d.data.phone_number_id);
        if (waba && pnid) {
          sesion.current = {
            waba_id: waba,
            phone_number_id: pnid,
            business_id: texto(d.data.business_id),
            coexistencia: false,
          };
          intentarEnviar();
        }
      } else if (d.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && d.data) {
        const waba = texto(d.data.waba_id);
        if (waba) {
          sesion.current = {
            waba_id: waba,
            phone_number_id: texto(d.data.phone_number_id),
            business_id: texto(d.data.business_id),
            coexistencia: true,
          };
          intentarEnviar();
        }
      } else if (d.event === "CANCEL") {
        setAbierto(false);
        toast.info("Alta cancelada. No se ha conectado nada.");
      } else if (d.event === "ERROR") {
        setAbierto(false);
        const msg = typeof d.data?.error_message === "string" ? d.data.error_message : "error desconocido";
        toast.error(`Meta devolvió un error: ${msg}`);
      }
    }
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, [intentarEnviar]);

  async function lanzar() {
    codigo.current = null;
    sesion.current = null;
    enviado.current = false;
    setAbierto(true);
    try {
      const FB = await cargarSdk(appId, graphVersion);
      // El callback de FB.login no puede ser async.
      FB.login(
        (r) => {
          const code = r?.authResponse?.code;
          if (!code) {
            setAbierto(false);
            return;
          }
          codigo.current = code;
          intentarEnviar();
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: coexistencia
            ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
            : { setup: {} },
        },
      );
    } catch (e) {
      setAbierto(false);
      toast.error(e instanceof Error ? e.message : "No se pudo abrir Meta.");
    }
  }

  const ocupado = abierto || pending;
  return (
    <Button onClick={lanzar} disabled={ocupado} variant={variante} className="h-12 w-full sm:w-auto">
      {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
      {pending ? "Conectando…" : abierto ? "Termina en la ventana de Meta…" : textoBoton}
    </Button>
  );
}
