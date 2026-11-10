"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  darDeBajaTokenDispositivoAction,
  registrarTokenDispositivoAction,
} from "./push-actions";

/**
 * Push NATIVO de la app de iOS y Android (Capacitor).
 *
 * La app carga esta misma web desde producción, así que el puente de Capacitor
 * está en `window.Capacitor` y se usa directamente (sin instalar
 * @capacitor/core en la web): `nativePromise()` para llamar al plugin
 * PushNotifications y `addListener()` para sus eventos.
 *
 * Qué hace <RegistroPushNativo />:
 *  · Fuera de la app, o en una versión de la app sin push, no hace NADA.
 *  · Si el permiso ya está dado: registra el dispositivo y manda el token al
 *    servidor (al iniciar sesión y en cada arranque).
 *  · Si aún no se ha preguntado: enseña un aviso PROPIO que explica para qué
 *    son los avisos; el permiso del sistema solo sale si el usuario pulsa
 *    «Activar avisos».
 *  · Al tocar una notificación navega a la `url` que trae.
 *  · Si llega con la app abierta, la enseña como aviso dentro de la app.
 *
 * Se monta UNA vez, en el layout de la zona privada (ver el informe de la
 * tarea / movil/LEEME.md). <BotonPushNativo /> es el control de /perfil.
 */

// ---------------------------------------------------------------------------
// Puente con la app
// ---------------------------------------------------------------------------

const PLUGIN = "PushNotifications";
/** Tiene que coincidir con movil/android (MainActivity.java) y push-tipos.ts. */
const CANAL_ANDROID = "avisos";
/** Marca que pone la app en el User-Agent cuando SÍ lleva push (ver
 *  movil/capacitor.config.ts). La 1.0.0 no la lleva: en Android esa versión no
 *  tiene Firebase y llamar a register() la cierra de golpe. */
const MARCA_PUSH = "HMPush/";
const CLAVE_POSPUESTO = "hm_push_aviso_pospuesto";
const CLAVE_DESACTIVADO = "hm_push_desactivado";
const DIAS_POSPUESTO = 7;
const ESPERA_AVISO_MS = 2500;

interface PuenteCapacitor {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: (
    plugin: string,
    metodo: string,
    opciones?: Record<string, unknown>,
  ) => Promise<unknown>;
  addListener?: (
    plugin: string,
    evento: string,
    oyente: (datos: unknown, error?: unknown) => void,
  ) => unknown;
}

function puente(): PuenteCapacitor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: PuenteCapacitor }).Capacitor ?? null;
}

function agente(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/** ¿Estamos dentro de la app (y no en un navegador)? */
export function esAppNativa(): boolean {
  if (typeof window === "undefined") return false;
  if (agente().includes("HidromanagerApp/")) return true;
  try {
    return puente()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** ¿Esta versión de la app lleva push y el puente está disponible? */
export function appAdmitePush(): boolean {
  if (!esAppNativa()) return false;
  if (!agente().includes(MARCA_PUSH)) return false;
  const cap = puente();
  return typeof cap?.nativePromise === "function" && typeof cap?.addListener === "function";
}

function plataforma(): "ios" | "android" {
  try {
    const p = puente()?.getPlatform?.();
    if (p === "ios" || p === "android") return p;
  } catch {
    /* se decide por el User-Agent */
  }
  return /iPhone|iPad|iPod/i.test(agente()) ? "ios" : "android";
}

function versionApp(): string | null {
  return /HidromanagerApp\/(\d+(?:\.\d+){0,3})/.exec(agente())?.[1] ?? null;
}

function llamar(metodo: string, opciones?: Record<string, unknown>): Promise<unknown> {
  const cap = puente();
  if (!cap?.nativePromise) return Promise.reject(new Error("Sin puente nativo"));
  return cap.nativePromise(PLUGIN, metodo, opciones ?? {});
}

function leerLocal(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirLocal(clave: string, valor: string | null): void {
  try {
    if (valor === null) window.localStorage.removeItem(clave);
    else window.localStorage.setItem(clave, valor);
  } catch {
    /* almacenamiento bloqueado: no pasa nada */
  }
}

/** Solo rutas internas ("/incidencias"); nunca un dominio de fuera. */
function rutaSegura(valor: unknown): string {
  if (typeof valor !== "string") return "/";
  if (!valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) return "/";
  return valor;
}

// ---------------------------------------------------------------------------
// Estado compartido (un único registro por carga de página)
// ---------------------------------------------------------------------------

type Permiso = "desconocido" | "preguntar" | "concedido" | "denegado";

interface EstadoPush {
  permiso: Permiso;
  token: string | null;
}

let estado: EstadoPush = { permiso: "desconocido", token: null };
const ESTADO_SERVIDOR: EstadoPush = { permiso: "desconocido", token: null };
const suscriptores = new Set<() => void>();
let oyentesPuestos = false;
let usuarioActual: string | null = null;
let ultimoEnviado: string | null = null;
let navegar: (ruta: string) => void = (ruta) => {
  window.location.assign(ruta);
};

function cambiar(parcial: Partial<EstadoPush>): void {
  estado = { ...estado, ...parcial };
  suscriptores.forEach((s) => s());
}

function suscribir(aviso: () => void): () => void {
  suscriptores.add(aviso);
  return () => {
    suscriptores.delete(aviso);
  };
}

function usarEstado(): EstadoPush {
  return useSyncExternalStore(
    suscribir,
    () => estado,
    () => ESTADO_SERVIDOR,
  );
}

function aPermiso(valor: unknown): Permiso {
  const recibir = (valor as { receive?: string } | null)?.receive;
  if (recibir === "granted") return "concedido";
  if (recibir === "denied") return "denegado";
  return "preguntar";
}

/** Manda el token al servidor (una vez por usuario y token en cada arranque). */
function enviarAlServidor(): void {
  const token = estado.token;
  if (!token || !usuarioActual) return;
  const clave = `${usuarioActual}:${token}`;
  if (ultimoEnviado === clave) return;
  ultimoEnviado = clave;
  registrarTokenDispositivoAction({
    plataforma: plataforma(),
    token,
    version_app: versionApp(),
  })
    .then((r) => {
      if (!r.ok) {
        ultimoEnviado = null;
        console.warn("[push] el servidor no guardó el token:", r.error);
      }
    })
    .catch(() => {
      ultimoEnviado = null;
    });
}

function ponerOyentes(): void {
  if (oyentesPuestos) return;
  const cap = puente();
  if (!cap?.addListener) return;
  oyentesPuestos = true;

  // El sistema entrega el token (APNs en iOS, FCM en Android).
  cap.addListener(PLUGIN, "registration", (datos) => {
    const valor = (datos as { value?: unknown } | null)?.value;
    if (typeof valor !== "string" || !valor) return;
    cambiar({ token: valor, permiso: "concedido" });
    enviarAlServidor();
  });

  cap.addListener(PLUGIN, "registrationError", (datos) => {
    console.warn("[push] el dispositivo no pudo registrarse:", datos);
  });

  // Llega con la app abierta: aviso dentro de la app.
  cap.addListener(PLUGIN, "pushNotificationReceived", (datos) => {
    const n = datos as {
      title?: string;
      body?: string;
      data?: { url?: unknown };
    } | null;
    if (!n?.title && !n?.body) return;
    const ruta = rutaSegura(n.data?.url);
    toast(n.title || "Hidromanager", {
      description: n.body || undefined,
      duration: 8000,
      action: { label: "Ver", onClick: () => navegar(ruta) },
    });
  });

  // El usuario toca la notificación (con la app cerrada o en segundo plano).
  cap.addListener(PLUGIN, "pushNotificationActionPerformed", (datos) => {
    const n = (datos as { notification?: { data?: { url?: unknown } } } | null)?.notification;
    if (!n) return;
    navegar(rutaSegura(n.data?.url));
  });
}

async function registrarDispositivo(): Promise<void> {
  if (plataforma() === "android") {
    // El canal ya lo crea la app al arrancar; esto es un seguro (no duplica).
    await llamar("createChannel", {
      id: CANAL_ANDROID,
      name: "Avisos",
      description: "Asignaciones, incidencias y cambios de agenda",
      importance: 4,
      visibility: 0,
    }).catch(() => undefined);
  }
  await llamar("register");
}

/** Pide el permiso al sistema y, si lo dan, registra el dispositivo. */
async function activarPush(): Promise<Permiso> {
  ponerOyentes();
  escribirLocal(CLAVE_DESACTIVADO, null);
  const permiso = aPermiso(await llamar("requestPermissions"));
  cambiar({ permiso });
  if (permiso === "concedido") await registrarDispositivo();
  return permiso;
}

async function desactivarPush(): Promise<void> {
  const token = estado.token;
  escribirLocal(CLAVE_DESACTIVADO, "1");
  if (token) {
    const r = await darDeBajaTokenDispositivoAction(token);
    if (!r.ok) throw new Error(r.error);
  }
  await llamar("unregister").catch(() => undefined);
  ultimoEnviado = null;
  cambiar({ token: null });
}

// ---------------------------------------------------------------------------
// Componente que se monta en el layout de la zona privada
// ---------------------------------------------------------------------------

export function RegistroPushNativo({ userId }: { userId: string }) {
  const router = useRouter();
  const { permiso } = usarEstado();
  const [avisoVisible, setAvisoVisible] = useState(false);
  const [pendiente, startTransition] = useTransition();

  // Navegación al tocar una notificación: por el router de Next (sin recargar).
  useEffect(() => {
    navegar = (ruta) => {
      try {
        if (window.location.pathname + window.location.search === ruta) router.refresh();
        else router.push(ruta as Route);
      } catch {
        window.location.assign(ruta);
      }
    };
    return () => {
      navegar = (ruta) => {
        window.location.assign(ruta);
      };
    };
  }, [router]);

  // Arranque e inicio de sesión: comprobar el permiso y, si está dado,
  // registrar el dispositivo y mandar el token.
  useEffect(() => {
    if (!userId || !appAdmitePush()) return;
    usuarioActual = userId;
    ponerOyentes();
    // Si ya hay token de un registro anterior de esta misma carga (cambio de
    // usuario sin recargar), se reenvía con el usuario nuevo.
    enviarAlServidor();

    let cancelado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    llamar("checkPermissions")
      .then((resultado) => {
        if (cancelado) return;
        const actual = aPermiso(resultado);
        cambiar({ permiso: actual });
        if (actual === "concedido") {
          if (leerLocal(CLAVE_DESACTIVADO) !== "1") {
            registrarDispositivo().catch((e) =>
              console.warn("[push] no se pudo registrar el dispositivo:", e),
            );
          }
          return;
        }
        if (actual !== "preguntar") return;
        const pospuesto = Number(leerLocal(CLAVE_POSPUESTO) ?? 0);
        if (pospuesto && Date.now() - pospuesto < DIAS_POSPUESTO * 86_400_000) return;
        // Nunca nada más abrir: se deja que el usuario vea antes su pantalla.
        temporizador = setTimeout(() => {
          if (!cancelado) setAvisoVisible(true);
        }, ESPERA_AVISO_MS);
      })
      .catch((e) => console.warn("[push] no se pudo consultar el permiso:", e));

    return () => {
      cancelado = true;
      if (temporizador) clearTimeout(temporizador);
    };
  }, [userId]);

  if (!avisoVisible || permiso !== "preguntar") return null;

  function ahoraNo() {
    escribirLocal(CLAVE_POSPUESTO, String(Date.now()));
    setAvisoVisible(false);
  }

  function activar() {
    startTransition(async () => {
      try {
        const resultado = await activarPush();
        setAvisoVisible(false);
        if (resultado === "concedido") {
          notify.success("Avisos activados en este móvil");
        } else {
          // Dijo que no en el aviso del sistema: no se insiste.
          escribirLocal(CLAVE_POSPUESTO, String(Date.now()));
        }
      } catch (e) {
        setAvisoVisible(false);
        console.warn("[push] no se pudieron activar los avisos:", e);
        notify.warning(
          "No se pudieron activar los avisos",
          "Inténtalo más tarde desde Mi perfil.",
        );
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-labelledby="aviso-push-titulo"
      aria-describedby="aviso-push-texto"
      className="fixed inset-x-3 z-50 mx-auto max-w-md rounded-2xl border bg-card p-4 text-card-foreground shadow-lg"
      style={{ bottom: "calc(var(--safe-bottom, 0px) + 5.5rem)" }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p id="aviso-push-titulo" className="text-sm font-semibold">
            ¿Te avisamos en este móvil?
          </p>
          <p id="aviso-push-texto" className="mt-1 text-sm text-muted-foreground">
            Solo cuando tengas que hacer algo: una instalación o una cita que te asignan, una
            incidencia, un cambio en tu agenda. Sin publicidad, y lo puedes quitar en Mi perfil.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={ahoraNo} disabled={pendiente}>
          Ahora no
        </Button>
        <Button size="sm" onClick={activar} disabled={pendiente}>
          {pendiente ? "Activando…" : "Activar avisos"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Control de /perfil dentro de la app
// ---------------------------------------------------------------------------

export function BotonPushNativo() {
  const { permiso, token } = usarEstado();
  const [admite, setAdmite] = useState<boolean | null>(null);
  const [pendiente, startTransition] = useTransition();

  useEffect(() => {
    const ok = appAdmitePush();
    setAdmite(ok);
    if (!ok) return;
    ponerOyentes();
    if (estado.permiso === "desconocido") {
      llamar("checkPermissions")
        .then((r) => cambiar({ permiso: aPermiso(r) }))
        .catch(() => undefined);
    }
  }, []);

  if (admite === null) return null;

  if (!admite) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta versión de la app todavía no admite avisos. Actualízala desde la tienda para
        recibirlos.
      </p>
    );
  }

  if (permiso === "denegado") {
    return (
      <p className="text-sm text-muted-foreground">
        Los avisos están bloqueados para Hidromanager. Actívalos en los Ajustes del móvil →
        Notificaciones → Hidromanager y vuelve a abrir la app.
      </p>
    );
  }

  const activo = permiso === "concedido" && Boolean(token);

  function activar() {
    startTransition(async () => {
      try {
        const resultado = await activarPush();
        if (resultado === "concedido") notify.success("Avisos activados en este móvil");
        else
          notify.warning(
            "Permiso denegado",
            "Actívalo en los Ajustes del móvil → Notificaciones → Hidromanager.",
          );
      } catch (e) {
        notify.error("No se pudieron activar los avisos", e instanceof Error ? e.message : String(e));
      }
    });
  }

  function desactivar() {
    startTransition(async () => {
      try {
        await desactivarPush();
        notify.success("Avisos desactivados en este móvil");
      } catch (e) {
        notify.error("No se pudieron desactivar", e instanceof Error ? e.message : String(e));
      }
    });
  }

  return activo ? (
    <Button variant="outline" size="sm" onClick={desactivar} disabled={pendiente} className="gap-1.5">
      <BellOff className="h-4 w-4" />
      {pendiente ? "Desactivando…" : "Desactivar avisos en este móvil"}
    </Button>
  ) : (
    <Button variant="success" size="sm" onClick={activar} disabled={pendiente} className="gap-1.5">
      <Bell className="h-4 w-4" />
      {pendiente ? "Activando…" : "Activar avisos en este móvil"}
    </Button>
  );
}
