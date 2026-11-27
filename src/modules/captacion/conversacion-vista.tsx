"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Ban, Bot, Check, CheckCheck, Clock, Loader2, Send, Smartphone, TriangleAlert } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { useRefrescoEnVivo } from "./usar-en-vivo";
import { MAX_TEXTO_SALIENTE } from "./bandeja-logica";
import {
  atenderConversacionAction,
  enviarMensajeAction,
  enviarPlantillaBandejaAction,
  type ConversacionDetalle,
  type MensajeVista,
  type PlantillaBandeja,
} from "./bandeja-actions";
import { devolverAlAsistenteAction } from "./asistente-actions";

const TZ = "Europe/Madrid";
const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const diaLargo = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const diaClave = new Intl.DateTimeFormat("es-ES", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

const ETIQUETA_TIPO: Record<string, string> = {
  imagen: "Imagen",
  documento: "Documento",
  audio: "Nota de voz",
  video: "Vídeo",
  sticker: "Sticker",
  ubicacion: "Ubicación",
  contactos: "Contacto",
  reaccion: "Reacción",
  plantilla: "Plantilla",
  otro: "Mensaje",
};

function textoMensaje(m: MensajeVista): { etiqueta: string | null; cuerpo: string | null } {
  if (m.tipo === "texto" || m.tipo === "boton") return { etiqueta: null, cuerpo: m.cuerpo };
  const etiqueta = ETIQUETA_TIPO[m.tipo] ?? "Mensaje";
  return { etiqueta, cuerpo: m.cuerpo ?? (m.tipo === "documento" ? m.mediaNombre : null) };
}

function Marca({ m }: { m: MensajeVista }) {
  if (m.direccion !== "saliente") return null;
  if (m.estado === "fallido") return <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-label="No entregado" />;
  if (m.estado === "leido") return <CheckCheck className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-label="Leído" />;
  if (m.estado === "entregado") return <CheckCheck className="h-3.5 w-3.5" aria-label="Entregado" />;
  return <Check className="h-3.5 w-3.5" aria-label="Enviado" />;
}

function Burbuja({ m }: { m: MensajeVista }) {
  const sale = m.direccion === "saliente";
  const { etiqueta, cuerpo } = textoMensaje(m);
  return (
    <div className={cn("flex", sale ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug shadow-sm sm:max-w-[70%]",
          sale ? "rounded-br-md bg-primary/10 text-foreground" : "rounded-bl-md border border-border bg-background",
        )}
      >
        {m.autor === "ia" ? (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Bot className="h-3 w-3" aria-hidden /> IA
          </p>
        ) : null}
        {m.origen !== "api" ? (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            {m.origen === "movil" ? (
              <>
                <Smartphone className="h-3 w-3" aria-hidden /> Desde el móvil
              </>
            ) : (
              "Historial de la app"
            )}
          </p>
        ) : null}
        {etiqueta ? <p className="text-xs font-semibold text-muted-foreground">{etiqueta}</p> : null}
        {cuerpo ? <p className="whitespace-pre-wrap break-words">{cuerpo}</p> : null}
        {m.estado === "fallido" && m.errorTexto ? (
          <p className="mt-1 text-xs text-destructive">{m.errorTexto}</p>
        ) : null}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] tabular-nums text-muted-foreground">
          {hora.format(new Date(m.metaAt))}
          <Marca m={m} />
        </p>
      </div>
    </div>
  );
}

export function ConversacionVista({ c }: { c: ConversacionDetalle }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [enviando, startEnviar] = useTransition();
  const [atendiendo, startAtender] = useTransition();
  const [devolviendo, startDevolver] = useTransition();
  const fondo = useRef<HTMLDivElement>(null);
  useRefrescoEnVivo(`captacion-conv-${c.id}`, "captacion_mensajes", `conversacion_id=eq.${c.id}`);

  const ultimo = c.mensajes.at(-1)?.id;
  useEffect(() => {
    fondo.current?.scrollIntoView({ block: "end" });
  }, [ultimo]);

  function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    startEnviar(async () => {
      const r = await enviarMensajeAction({ conversacionId: c.id, texto: t });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTexto("");
      router.refresh();
    });
  }

  function atender(soltar: boolean) {
    startAtender(async () => {
      const r = await atenderConversacionAction({ conversacionId: c.id, soltar });
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  }

  function devolver() {
    startDevolver(async () => {
      const r = await devolverAlAsistenteAction({ id: c.id });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("El asistente vuelve a contestar");
        router.refresh();
      }
    });
  }

  let diaAnterior = "";
  return (
    <div className="flex h-[calc(100dvh_-_9.5rem_-_var(--safe-top,0px)_-_var(--safe-bottom,0px))] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-border md:h-[calc(100dvh_-_11rem_-_var(--safe-top,0px)_-_var(--safe-bottom,0px))] lg:h-[calc(100dvh_-_12rem)]">
      {/* Cabecera */}
      <header className="flex items-center gap-2 border-b border-border px-2 py-2 sm:px-3">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0">
          <Link href={"/captacion/bandeja" as never} aria-label="Volver a la bandeja">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{c.nombre}</h1>
          {c.telefono && c.telefono !== c.nombre ? (
            <p className="truncate text-xs tabular-nums text-muted-foreground">{c.telefono}</p>
          ) : null}
        </div>
        {c.sinAtender ? (
          <Button size="sm" className="h-10 shrink-0" disabled={atendiendo} onClick={() => atender(false)}>
            Atender
          </Button>
        ) : c.atendidaPorMi ? (
          <Button size="sm" variant="outline" className="h-10 shrink-0" disabled={atendiendo} onClick={() => atender(true)}>
            Soltar
          </Button>
        ) : null}
      </header>

      {/* Mensajes */}
      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain bg-muted/30 px-3 py-3">
        {c.hayMas ? (
          <p className="text-center text-xs text-muted-foreground">Se enseñan los 300 últimos mensajes.</p>
        ) : null}
        {c.mensajes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay mensajes.</p>
        ) : null}
        {c.mensajes.map((m) => {
          const d = new Date(m.metaAt);
          const clave = diaClave.format(d);
          const separador = clave !== diaAnterior ? diaLargo.format(d) : null;
          diaAnterior = clave;
          return (
            <div key={m.id} className="space-y-2">
              {separador ? (
                <p className="pt-2 text-center text-xs font-medium capitalize text-muted-foreground">{separador}</p>
              ) : null}
              <Burbuja m={m} />
            </div>
          );
        })}
        <div ref={fondo} />
      </div>

      {/* Asistente de IA (fase 5) */}
      {c.modo === "ia" && c.iaActiva && !c.cerrada && !c.bloqueada ? (
        <div className="flex items-start gap-2 border-t border-border bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold text-foreground">Contesta el asistente.</span> Si escribes, el asistente se calla.
          </p>
        </div>
      ) : c.puedeDevolverIA ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <p className="flex-1">El asistente no contesta en esta conversación.</p>
          <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={devolviendo} onClick={devolver}>
            {devolviendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Bot className="mr-1.5 h-3.5 w-3.5" />}
            Devolver al asistente
          </Button>
        </div>
      ) : null}

      {/* Caja de escribir */}
      <footer className="border-t border-border bg-background px-3 pt-2 pb-[max(0.5rem,var(--safe-bottom,0px))]">
        {!c.conexionActiva ? (
          <p className="py-2 text-sm text-muted-foreground">El número de WhatsApp no está conectado.</p>
        ) : c.cerrada || c.bloqueada ? (
          <div className="flex gap-2 py-2 text-sm text-muted-foreground">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>Pidió que no le escribiéramos. Está en la lista de bloqueo y desde aquí no se le envía nada.</p>
          </div>
        ) : !c.ventanaAbierta ? (
          <SelectorPlantilla c={c} onEnviada={() => router.refresh()} />
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribe un mensaje"
              aria-label="Mensaje"
              rows={1}
              maxLength={MAX_TEXTO_SALIENTE}
              className="max-h-40 min-h-11 flex-1 resize-none text-base"
            />
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0"
              disabled={enviando || texto.trim() === ""}
              aria-label="Enviar"
            >
              {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </form>
        )}
      </footer>
    </div>
  );
}

/**
 * Ventana de 24 h cerrada: en lugar de la caja de texto, el selector de
 * plantillas aprobadas con la vista previa de lo que recibirá.
 */
function SelectorPlantilla({ c, onEnviada }: { c: ConversacionDetalle; onEnviada: () => void }) {
  const [elegida, setElegida] = useState<string>(c.plantillas[0]?.id ?? "");
  const [enviando, start] = useTransition();
  const plantilla: PlantillaBandeja | undefined = c.plantillas.find((p) => p.id === elegida);

  return (
    <div className="space-y-2 py-2">
      <div className="flex gap-2 text-sm text-muted-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Han pasado más de 24 h desde su último mensaje: WhatsApp solo deja enviar una plantilla
          aprobada.
          {c.coexistencia ? " Desde la app del móvil sí puedes escribirle." : ""}
        </p>
      </div>
      {c.plantillas.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay plantillas aprobadas que se puedan mandar desde aquí.</p>
      ) : (
        <>
          <select
            aria-label="Plantilla"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            value={elegida}
            onChange={(e) => setElegida(e.target.value)}
          >
            {c.plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {plantilla ? (
            <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm">{plantilla.vista}</p>
          ) : null}
          <Button
            className="h-11 w-full"
            disabled={enviando || !plantilla}
            onClick={() =>
              start(async () => {
                const r = await enviarPlantillaBandejaAction({ conversacionId: c.id, plantillaId: elegida });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Plantilla enviada");
                onEnviada();
              })
            }
          >
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar plantilla
          </Button>
        </>
      )}
    </div>
  );
}
