"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Copy, KeyRound, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  cambiarEstadoAccesoPortalAction,
  enviarAccesoPorCorreoAction,
  estadoAccesoPortalAction,
  generarAccesoPortalAction,
  marcarAccesoEnviadoAction,
  type EstadoAccesoPortal,
} from "./acceso-actions";

const VIA: Record<string, string> = { email: "correo", whatsapp: "WhatsApp", manual: "en mano" };

function fecha(v: string | null): string {
  if (!v) return "nunca";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}

/** Teléfono para wa.me: solo dígitos y, si es un móvil español de 9 cifras, con 34 delante. */
function telefonoWhatsApp(tel: string): string {
  const d = tel.replace(/\D/g, "").replace(/^00/, "");
  return d.length === 9 ? `34${d}` : d;
}

interface Props {
  customerId: string;
  customerName: string;
}

export function PortalAccesoCard({ customerId, customerName }: Props) {
  const ask = useConfirm();
  const [pending, startTransition] = useTransition();
  const [estado, setEstado] = useState<EstadoAccesoPortal | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // Contraseña recién generada: solo vive en memoria de esta pantalla.
  const [recien, setRecien] = useState<{ usuario: string; clave: string } | null>(null);

  const cargar = useCallback(async () => {
    const r = await estadoAccesoPortalAction(customerId);
    if (r.ok) {
      setEstado(r.estado);
      setErrorCarga(null);
    } else setErrorCarga(r.error);
  }, [customerId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function generar() {
    if (estado?.existe) {
      const ok = await ask({
        title: "Generar contraseña nueva",
        message: `La contraseña actual de ${customerName || "este cliente"} dejará de funcionar. ¿Seguimos?`,
        confirmText: "Generar nueva",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const r = await generarAccesoPortalAction(customerId);
      if (!r.ok) {
        notify.error("No se pudo generar el acceso", r.error);
        return;
      }
      setRecien({ usuario: r.usuario, clave: r.clave });
      notify.success(r.nuevo ? "Acceso creado" : "Contraseña nueva generada");
      await cargar();
    });
  }

  function copiar() {
    if (!recien) return;
    const url = `${window.location.origin}/portal/entrar`;
    navigator.clipboard
      .writeText(`Área de clientes: ${url}\nUsuario: ${recien.usuario}\nContraseña: ${recien.clave}`)
      .then(
        () => notify.success("Copiado", "Usuario, contraseña y enlace"),
        () => notify.error("No se pudo copiar"),
      );
  }

  function enviarCorreo() {
    if (!recien) return;
    startTransition(async () => {
      const r = await enviarAccesoPorCorreoAction(customerId, recien.clave);
      if (!r.ok) {
        notify.error("No se pudo enviar el correo", r.error);
        return;
      }
      notify.success("Enviado por correo", estado?.email_cliente ?? undefined);
      await cargar();
    });
  }

  function enviarWhatsApp() {
    if (!recien || !estado?.telefono_cliente) return;
    const url = `${window.location.origin}/portal/entrar`;
    const nombre = customerName.split(" ")[0] ?? "";
    const texto =
      `Hola${nombre ? ` ${nombre}` : ""}, ya tienes acceso a tu área de clientes, donde puedes ver tus equipos, ` +
      `próximas visitas, contratos y facturas.\n\n${url}\nUsuario: ${recien.usuario} (tu DNI)\n` +
      `Contraseña: ${recien.clave}\n\nEscríbela con los guiones. Puedes cambiarla al entrar.`;
    window.open(
      `https://wa.me/${telefonoWhatsApp(estado.telefono_cliente)}?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener",
    );
    startTransition(async () => {
      await marcarAccesoEnviadoAction(customerId, "whatsapp");
      await cargar();
    });
  }

  function entregadaEnMano() {
    startTransition(async () => {
      const r = await marcarAccesoEnviadoAction(customerId, "manual");
      if (!r.ok) notify.error("No se pudo anotar", r.error);
      setRecien(null);
      await cargar();
    });
  }

  async function cambiarEstado(activar: boolean) {
    if (!activar) {
      const ok = await ask({
        title: "Desactivar acceso",
        message: `${customerName || "El cliente"} no podrá entrar en su área hasta que lo reactives.`,
        confirmText: "Desactivar",
        variant: "destructive",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const r = await cambiarEstadoAccesoPortalAction(customerId, activar);
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        return;
      }
      setRecien(null);
      notify.success(activar ? "Acceso reactivado" : "Acceso desactivado");
      await cargar();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Área de clientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {errorCarga && <p className="text-destructive">{errorCarga}</p>}
        {!estado && !errorCarga && <div className="h-16 animate-pulse rounded-md bg-muted" />}

        {estado && !estado.existe && (
          <>
            <p className="text-muted-foreground">
              El cliente puede entrar con su DNI y una contraseña para ver sus equipos, próximas
              visitas, contratos y facturas. La contraseña la generamos aquí y se la mandas.
            </p>
            {estado.bloqueo_alta ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">{estado.bloqueo_alta}</p>
            ) : (
              <Button onClick={generar} disabled={pending} className="h-11">
                <KeyRound className="mr-2 h-4 w-4" />
                Dar acceso
              </Button>
            )}
          </>
        )}

        {estado?.existe && (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Usuario</dt>
                <dd className="font-mono">{estado.usuario}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  {estado.activo ? (
                    <span className="text-emerald-700">Activo</span>
                  ) : (
                    <span className="text-destructive">Desactivado</span>
                  )}
                  {estado.bloqueado_hasta && (
                    <span className="text-amber-700"> · bloqueado por intentos hasta {fecha(estado.bloqueado_hasta)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Último acceso</dt>
                <dd>{fecha(estado.ultimo_acceso)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contraseña enviada</dt>
                <dd>
                  {estado.clave_enviada_el
                    ? `${fecha(estado.clave_enviada_el)} por ${VIA[estado.clave_enviada_por ?? ""] ?? "—"}`
                    : "sin anotar"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={generar} disabled={pending} className="h-11">
                <KeyRound className="mr-2 h-4 w-4" />
                Contraseña nueva
              </Button>
              {estado.activo ? (
                <Button variant="outline" onClick={() => cambiarEstado(false)} disabled={pending} className="h-11">
                  Desactivar
                </Button>
              ) : (
                <Button variant="outline" onClick={() => cambiarEstado(true)} disabled={pending} className="h-11">
                  Reactivar
                </Button>
              )}
            </div>
          </>
        )}

        {recien && (
          <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
            <p className="font-medium text-sky-950">
              Mándasela ahora: por seguridad no se vuelve a mostrar.
            </p>
            <div className="grid grid-cols-1 gap-1">
              <span className="text-muted-foreground">Usuario</span>
              <span className="font-mono text-base">{recien.usuario}</span>
              <span className="mt-2 text-muted-foreground">Contraseña</span>
              <span className="select-all break-all font-mono text-xl tracking-wide">{recien.clave}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copiar} className="h-11">
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
              {estado?.email_cliente && (
                <Button variant="outline" onClick={enviarCorreo} disabled={pending} className="h-11">
                  <Mail className="mr-2 h-4 w-4" />
                  Enviar por correo
                </Button>
              )}
              {estado?.telefono_cliente && (
                <Button variant="outline" onClick={enviarWhatsApp} disabled={pending} className="h-11">
                  <MessageCircle className="mr-2 h-4 w-4" />
                  WhatsApp
                </Button>
              )}
              <Button variant="ghost" onClick={entregadaEnMano} disabled={pending} className="h-11">
                Ya se la he dado
              </Button>
            </div>
            {!estado?.email_cliente && !estado?.telefono_cliente && (
              <p className="text-muted-foreground">
                El cliente no tiene email ni teléfono: cópiala y dásela en mano.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
