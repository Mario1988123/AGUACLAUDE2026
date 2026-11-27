"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { StatusPill } from "@/shared/components/status-pill";
import { BotonConectarWhatsapp } from "./boton-conectar";
import {
  desconectarWhatsappAction,
  guardarAjustesCaptacionAction,
  refrescarNumeroAction,
  sincronizarPlantillasAction,
} from "./conexion-actions";
import type { ConexionCaptacion, EstadoCaptacion, PlantillaCaptacion } from "./tipos";

const ESTADO: Record<ConexionCaptacion["estado"], { label: string; tone: "success" | "onhold" | "rejected" | "neutral" }> = {
  activa: { label: "Conectado", tone: "success" },
  pendiente: { label: "A medias", tone: "onhold" },
  suspendida: { label: "Suspendido por Meta", tone: "rejected" },
  desconectada: { label: "Desconectado", tone: "neutral" },
};

const CALIDAD: Record<ConexionCaptacion["calidad"], { label: string; tone: "success" | "onhold" | "rejected" | "neutral" }> = {
  verde: { label: "Calidad alta", tone: "success" },
  amarilla: { label: "Calidad media", tone: "onhold" },
  roja: { label: "Calidad baja", tone: "rejected" },
  desconocida: { label: "Calidad sin datos", tone: "neutral" },
};

const PLANTILLA: Record<PlantillaCaptacion["estado"], { label: string; tone: "success" | "onhold" | "rejected" | "neutral" | "info" }> = {
  aprobada: { label: "Aprobada", tone: "success" },
  pendiente: { label: "En revisión", tone: "info" },
  rechazada: { label: "Rechazada", tone: "rejected" },
  pausada: { label: "Pausada", tone: "onhold" },
  desactivada: { label: "Desactivada", tone: "neutral" },
};

const fechaHora = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

function cuando(iso: string | null): string {
  return iso ? fechaHora.format(new Date(iso)) : "nunca";
}

function blank(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

export function PanelConfigCaptacion({ estado }: { estado: EstadoCaptacion }) {
  const { conexion: c, meta, esAdmin } = estado;
  const metaLista = Boolean(meta.appId && meta.configId);
  const conectada = c?.estado === "activa";

  return (
    <div className="space-y-6">
      {/* --- Estado --- */}
      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Número de WhatsApp</h2>
          {c ? <StatusPill {...ESTADO[c.estado]} /> : <StatusPill label="Sin conectar" tone="neutral" />}
        </div>

        {c && c.estado !== "desconectada" ? (
          <dl className="divide-y divide-border">
            <Fila etiqueta="Número" valor={c.numero_e164 ?? "—"} />
            <Fila etiqueta="Nombre visible" valor={c.nombre_visible ?? "—"} />
            <Fila etiqueta="Calidad" valor={<StatusPill {...CALIDAD[c.calidad]} />} />
            <Fila etiqueta="Límite de Meta" valor={`${c.limite_diario_meta} personas / 24 h`} />
            <Fila
              etiqueta="App del móvil"
              valor={c.coexistencia ? "También en WhatsApp Business" : "No: solo desde aquí"}
            />
            {c.coexistencia ? (
              <>
                <Fila etiqueta="Contactos pedidos a Meta" valor={cuando(c.sync_contactos_at)} />
                <Fila etiqueta="Historial pedido a Meta" valor={cuando(c.sync_historial_at)} />
              </>
            ) : null}
            <Fila etiqueta="Último aviso de Meta" valor={cuando(c.ultimo_webhook_at)} />
          </dl>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Hay dos formas de conectar:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-foreground">Número que ya está en WhatsApp Business:</strong>{" "}
                sigue funcionando en el móvil y además desde aquí. Lo que escribas en el móvil es
                gratis; lo que salga desde aquí lo cobra Meta.
              </li>
              <li>
                <strong className="text-foreground">Número nuevo:</strong> que no esté en ninguna
                app de WhatsApp. Pasa a funcionar solo desde aquí.
              </li>
            </ul>
          </div>
        )}

        {c?.coexistencia && c.estado === "activa" ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Abre WhatsApp Business en el móvil al menos una vez cada dos semanas: si pasa unos 14
            días sin usarse, Meta desconecta el número de aquí. En el móvil se desactivan las
            difusiones nuevas, los mensajes temporales y «ver una vez».
          </p>
        ) : null}

        {c?.ultimo_error && c.estado !== "activa" ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{c.ultimo_error}</p>
        ) : null}

        {esAdmin && !conectada ? (
          metaLista ? (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <BotonConectarWhatsapp
                  appId={meta.appId!}
                  configId={meta.configId!}
                  graphVersion={meta.graphVersion}
                  coexistencia
                  textoBoton="Conectar el número de WhatsApp Business"
                />
                <BotonConectarWhatsapp
                  appId={meta.appId!}
                  configId={meta.configId!}
                  graphVersion={meta.graphVersion}
                  variante="outline"
                  textoBoton={c?.estado === "pendiente" ? "Reintentar con un número nuevo" : "Conectar un número nuevo"}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Con el número de WhatsApp Business, Meta te pedirá escanear un código QR con la app
                del móvil (versión 2.24.17 o posterior).
              </p>
              <p className="text-xs text-muted-foreground">
                Se abre una ventana de Meta. En el móvil a veces no se abre bien: si pasa, hazlo
                desde un ordenador.
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Falta configurar la app de Meta en el servidor (META_APP_ID y META_CONFIG_ID). Lo
              hace Vercomi.
            </p>
          )
        ) : null}

        {esAdmin && conectada ? <BotonRefrescar /> : null}

        {!meta.webhookFirmado ? (
          <p className="text-xs text-destructive">
            Falta META_APP_SECRET en el servidor: los mensajes de Meta se rechazan hasta que se ponga.
          </p>
        ) : null}
      </section>

      {/* --- Ajustes --- */}
      {c && c.estado !== "desconectada" ? (
        <FormAjustes conexion={c} esAdmin={esAdmin} enviosPlataforma={estado.enviosPlataforma} />
      ) : null}

      {/* --- Plantillas --- */}
      {c && c.estado !== "desconectada" ? (
        <Plantillas plantillas={estado.plantillas} esAdmin={esAdmin} wabaId={c.waba_id} />
      ) : null}

      {/* --- Zona de peligro --- */}
      {esAdmin && c && c.estado !== "desconectada" ? <ZonaPeligro coexistencia={c.coexistencia} /> : null}
    </div>
  );
}

function BotonRefrescar() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      className="w-full sm:w-auto"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refrescarNumeroAction();
          if (!r.ok) toast.error(r.error);
          else toast.success("Datos del número actualizados");
        })
      }
    >
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
      Actualizar datos de Meta
    </Button>
  );
}

function FormAjustes({
  conexion: c,
  esAdmin,
  enviosPlataforma,
}: {
  conexion: ConexionCaptacion;
  esAdmin: boolean;
  enviosPlataforma: boolean;
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    envios_activos: c.envios_activos,
    margen_seguridad: String(c.margen_seguridad),
    tope_euros: String(Math.round(c.tope_gasto_mensual_cents / 100)),
    retencion_dias: String(c.retencion_dias),
    presentacion_empresa: c.presentacion_empresa ?? "",
    temas_prohibidos: c.temas_prohibidos ?? "",
  });
  const disabled = !esAdmin || pending;

  function guardar() {
    start(async () => {
      const r = await guardarAjustesCaptacionAction({
        envios_activos: f.envios_activos,
        margen_seguridad: Number.parseInt(f.margen_seguridad, 10) || 0,
        tope_gasto_mensual_cents: Math.round((Number.parseFloat(f.tope_euros.replace(",", ".")) || 0) * 100),
        retencion_dias: Number.parseInt(f.retencion_dias, 10) || 365,
        presentacion_empresa: blank(f.presentacion_empresa),
        temas_prohibidos: blank(f.temas_prohibidos),
      });
      if (!r.ok) toast.error(r.error);
      else toast.success("Ajustes guardados");
    });
  }

  return (
    <section className="space-y-5 rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-base font-bold">Ajustes</h2>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="envios">Mensajes en frío</Label>
          <p className="text-xs text-muted-foreground">
            Apagado, no sale ningún primer mensaje aunque haya campañas lanzadas. Las respuestas a
            quien ya te ha escrito no dependen de esto.
            {!enviosPlataforma ? " Además, Vercomi aún no ha abierto los envíos en la plataforma." : ""}
          </p>
        </div>
        <Switch
          id="envios"
          checked={f.envios_activos}
          disabled={disabled || c.estado !== "activa"}
          onCheckedChange={(v) => setF({ ...f, envios_activos: v })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="margen">Margen sobre el límite de Meta</Label>
          <Input
            id="margen"
            inputMode="numeric"
            value={f.margen_seguridad}
            disabled={disabled}
            onChange={(e) => setF({ ...f, margen_seguridad: e.target.value })}
            className="text-base"
          />
          <p className="text-xs text-muted-foreground">Personas al día que se dejan sin gastar.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tope">Tope de gasto al mes (€)</Label>
          <Input
            id="tope"
            inputMode="decimal"
            value={f.tope_euros}
            disabled={disabled}
            onChange={(e) => setF({ ...f, tope_euros: e.target.value })}
            className="text-base"
          />
          <p className="text-xs text-muted-foreground">Al llegar, se para todo hasta el mes siguiente.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retencion">Guardar conversaciones (días)</Label>
          <Input
            id="retencion"
            inputMode="numeric"
            value={f.retencion_dias}
            disabled={disabled}
            onChange={(e) => setF({ ...f, retencion_dias: e.target.value })}
            className="text-base"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="presentacion">Presentación de la empresa</Label>
        <Textarea
          id="presentacion"
          rows={3}
          value={f.presentacion_empresa}
          disabled={disabled}
          onChange={(e) => setF({ ...f, presentacion_empresa: e.target.value })}
          placeholder="Quiénes sois y qué ofrecéis, en dos o tres frases."
          className="text-base"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prohibidos">Temas de los que no se habla</Label>
        <Textarea
          id="prohibidos"
          rows={2}
          value={f.temas_prohibidos}
          disabled={disabled}
          onChange={(e) => setF({ ...f, temas_prohibidos: e.target.value })}
          className="text-base"
        />
      </div>

      {esAdmin ? (
        <Button onClick={guardar} disabled={pending} className="h-12 w-full sm:w-auto">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Guardar ajustes
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Solo el administrador puede cambiar estos ajustes.</p>
      )}
    </section>
  );
}

function Plantillas({
  plantillas,
  esAdmin,
  wabaId,
}: {
  plantillas: PlantillaCaptacion[];
  esAdmin: boolean;
  wabaId: string | null;
}) {
  const [pending, start] = useTransition();
  return (
    <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-bold">Plantillas</h2>
        <p className="text-sm text-muted-foreground">
          Se crean en el administrador de WhatsApp y Meta las revisa. Aquí se ven con su estado.
        </p>
      </div>

      {plantillas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna.</p>
      ) : (
        <ul className="divide-y divide-border">
          {plantillas.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.nombre}</div>
                <div className="text-xs text-muted-foreground">
                  {p.idioma} · {p.categoria === "marketing" ? "Marketing" : p.categoria === "utility" ? "Servicio" : "Autenticación"}
                  {p.motivo_rechazo ? ` · ${p.motivo_rechazo}` : ""}
                </div>
              </div>
              <StatusPill {...PLANTILLA[p.estado]} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {esAdmin ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await sincronizarPlantillasAction();
                if (!r.ok) toast.error(r.error);
                else toast.success(`Plantillas al día (${r.total ?? 0})`);
              })
            }
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Traer plantillas de Meta
          </Button>
        ) : null}
        {wabaId ? (
          <Button variant="ghost" asChild>
            <a
              href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Crear plantillas en Meta
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ZonaPeligro({ coexistencia }: { coexistencia: boolean }) {
  const [pending, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border border-destructive/40 p-4 sm:p-5">
      <h2 className="text-base font-bold text-destructive">Desconectar WhatsApp</h2>
      <p className="text-sm text-muted-foreground">
        {coexistencia
          ? "Se apagan los envíos y se borra el acceso guardado. El número sigue en la app del móvil; para soltarlo del todo de Meta, hay que desconectarlo también desde la app (Ajustes → Cuenta → Plataforma empresarial)."
          : "Se apagan los envíos, se borra el acceso guardado y se da de baja el número de la API."}{" "}
        Las conversaciones se conservan.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={pending} className="w-full sm:w-auto">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Desconectar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar el número?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejarás de recibir mensajes aquí. Para volver, habrá que conectar otra vez desde Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                start(async () => {
                  const r = await desconectarWhatsappAction();
                  if (!r.ok) toast.error(r.error);
                  else if (r.aviso) toast.warning(r.aviso, { duration: 15_000 });
                  else toast.success("Número desconectado");
                })
              }
            >
              Sí, desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
