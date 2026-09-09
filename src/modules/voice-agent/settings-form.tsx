"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { Loader2, KeyRound, FileText, Copy } from "lucide-react";
import {
  saveVoiceSettingsAction,
  rotateToolSecretAction,
  previewPromptAction,
  type VoiceSettingsInput,
} from "./settings-actions";
import type { VoiceSettings } from "./settings";

const PREFIX_400_DEADLINE = Date.UTC(2026, 9, 17);

function blank(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export function VoiceSettingsForm({ initial }: { initial: VoiceSettings }) {
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [f, setF] = useState({
    service_enabled: initial.service_enabled,
    commercial_enabled: initial.commercial_enabled,
    agent_id_service: initial.agent_id_service ?? "",
    agent_id_commercial: initial.agent_id_commercial ?? "",
    caller_id_service: initial.caller_id_service ?? "",
    caller_id_commercial: initial.caller_id_commercial ?? "",
    service_window_start: initial.service_window_start,
    service_window_end: initial.service_window_end,
    max_attempts: initial.max_attempts,
    retry_hours: initial.retry_hours,
    monthly_minutes_cap: initial.monthly_minutes_cap,
    max_call_seconds: initial.max_call_seconds,
    escalation_phone: initial.escalation_phone ?? "",
    record_audio: initial.record_audio,
    transcript_retention_days: initial.transcript_retention_days,
    company_pitch: initial.company_pitch ?? "",
    forbidden_topics: initial.forbidden_topics ?? "",
    inbound_enabled: initial.inbound_enabled,
    agent_id_inbound: initial.agent_id_inbound ?? "",
    inbound_can_book: initial.inbound_can_book,
    inbound_can_open_incident: initial.inbound_can_open_incident,
    transfer_enabled: initial.transfer_enabled,
    whatsapp_confirm_enabled: initial.whatsapp_confirm_enabled,
    whatsapp_sender: initial.whatsapp_sender ?? "",
  });

  const past400 = Date.now() >= PREFIX_400_DEADLINE;

  function onSave() {
    const payload: VoiceSettingsInput = {
      service_enabled: f.service_enabled,
      commercial_enabled: f.commercial_enabled,
      provider: initial.provider as VoiceSettingsInput["provider"],
      agent_id_service: blank(f.agent_id_service),
      agent_id_commercial: blank(f.agent_id_commercial),
      caller_id_service: blank(f.caller_id_service),
      caller_id_commercial: blank(f.caller_id_commercial),
      service_window_start: f.service_window_start,
      service_window_end: f.service_window_end,
      commercial_window_start: initial.commercial_window_start,
      commercial_window_end: initial.commercial_window_end,
      max_attempts: f.max_attempts,
      retry_hours: f.retry_hours,
      monthly_minutes_cap: f.monthly_minutes_cap,
      max_call_seconds: f.max_call_seconds,
      escalation_phone: blank(f.escalation_phone),
      record_audio: f.record_audio,
      transcript_retention_days: f.transcript_retention_days,
      company_pitch: blank(f.company_pitch),
      forbidden_topics: blank(f.forbidden_topics),
      inbound_enabled: f.inbound_enabled,
      agent_id_inbound: blank(f.agent_id_inbound),
      inbound_can_book: f.inbound_can_book,
      inbound_can_open_incident: f.inbound_can_open_incident,
      transfer_enabled: f.transfer_enabled,
      whatsapp_confirm_enabled: f.whatsapp_confirm_enabled,
      whatsapp_sender: blank(f.whatsapp_sender),
    };
    startTransition(async () => {
      const r = await saveVoiceSettingsAction(payload);
      if (!r.ok) toast.error(r.error ?? "No se pudo guardar");
      else toast.success("Configuración guardada");
    });
  }

  function onRotate() {
    startTransition(async () => {
      const r = await rotateToolSecretAction();
      if (!r.ok || !r.secret) {
        toast.error(r.error ?? "No se pudo generar");
        return;
      }
      setSecret(r.secret);
      toast.success("Secreto generado. Cópialo ahora: no se vuelve a mostrar.");
    });
  }

  function onPreview(purpose: "service" | "commercial" | "inbound") {
    startTransition(async () => {
      const r = await previewPromptAction(purpose);
      if (!r.ok || !r.prompt) {
        toast.error(r.error ?? "No se pudo generar el guion");
        return;
      }
      setPrompt(`${r.first_message}\n\n${"─".repeat(60)}\n\n${r.prompt}`);
    });
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {/* ---------------- SERVICIO ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Agendar mantenimientos</h2>
            <p className="text-sm text-muted-foreground">
              Llamadas a tus clientes para cerrar la fecha de la revisión que ya
              tienen contratada. No es marketing: no necesita consentimiento
              previo ni prefijo 400.
            </p>
          </div>
          <Switch
            checked={f.service_enabled}
            onCheckedChange={(v) => setF({ ...f, service_enabled: v })}
            aria-label="Activar el agente de servicio"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="caller_service"
            label="Número desde el que llama"
            hint="Geográfico, 800 o 900. NO puede ser del rango 400."
          >
            <Input
              id="caller_service"
              value={f.caller_id_service}
              onChange={(e) => setF({ ...f, caller_id_service: e.target.value })}
              placeholder="+34911234567"
            />
          </Field>
          <Field
            id="agent_service"
            label="ID del agente en la plataforma"
            hint="Lo da ElevenLabs/Twilio al crear el agente."
          >
            <Input
              id="agent_service"
              value={f.agent_id_service}
              onChange={(e) => setF({ ...f, agent_id_service: e.target.value })}
            />
          </Field>
          <Field id="win_start" label="Empieza a llamar a las" hint="Hora de Madrid.">
            <Input
              id="win_start"
              type="number"
              min={0}
              max={23}
              value={f.service_window_start}
              onChange={(e) =>
                setF({ ...f, service_window_start: Number(e.target.value) })
              }
            />
          </Field>
          <Field id="win_end" label="Deja de llamar a las">
            <Input
              id="win_end"
              type="number"
              min={1}
              max={24}
              value={f.service_window_end}
              onChange={(e) =>
                setF({ ...f, service_window_end: Number(e.target.value) })
              }
            />
          </Field>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPreview("service")}
          disabled={pending}
        >
          <FileText className="mr-2 h-4 w-4" />
          Ver el guion que dirá el agente
        </Button>
      </section>

      {/* ---------------- COMERCIAL ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Captación comercial (solo empresas)</h2>
            <p className="text-sm text-muted-foreground">
              Nunca llama a particulares: el sistema lo rechaza en la base de
              datos. Requiere numeración del rango 400
              {past400
                ? " — obligatoria desde el 17-oct-2026."
                : " a partir del 17-oct-2026."}
            </p>
          </div>
          <Switch
            checked={f.commercial_enabled}
            onCheckedChange={(v) => setF({ ...f, commercial_enabled: v })}
            aria-label="Activar el agente comercial"
            disabled={!f.caller_id_commercial.trim()}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="caller_comm"
            label="Número comercial (rango 400)"
            hint="Se pide al operador. Formato +34400XXXXXX."
          >
            <Input
              id="caller_comm"
              value={f.caller_id_commercial}
              onChange={(e) =>
                setF({ ...f, caller_id_commercial: e.target.value })
              }
              placeholder="+34400123456"
            />
          </Field>
          <Field id="agent_comm" label="ID del agente comercial">
            <Input
              id="agent_comm"
              value={f.agent_id_commercial}
              onChange={(e) =>
                setF({ ...f, agent_id_commercial: e.target.value })
              }
            />
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">
          Ventana legal fija: 9:00–21:00, de lunes a viernes, sin festivos. No es
          configurable a propósito.
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPreview("commercial")}
          disabled={pending}
        >
          <FileText className="mr-2 h-4 w-4" />
          Ver el guion comercial
        </Button>
      </section>

      {/* ---------------- RECEPCIONISTA ENTRANTE ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Recepcionista (llamadas entrantes)</h2>
            <p className="text-sm text-muted-foreground">
              Atiende el teléfono de la empresa. Aquí llama el cliente, así que
              no hay consentimiento ni horario que valga — pero la Ley 10/2025
              pesa más que en ningún otro sitio: siempre tiene que poder pedir
              una persona.
            </p>
          </div>
          <Switch
            checked={f.inbound_enabled}
            onCheckedChange={(v) => setF({ ...f, inbound_enabled: v })}
            aria-label="Activar la recepcionista"
          />
        </div>

        <Field
          id="agent_inbound"
          label="ID del agente de entrada"
          hint="Los números que atiende se dan de alta en la propia página del agente de voz."
        >
          <Input
            id="agent_inbound"
            value={f.agent_id_inbound}
            onChange={(e) => setF({ ...f, agent_id_inbound: e.target.value })}
          />
        </Field>

        <div className="space-y-2">
          <Toggle
            label="Puede cerrar y cambiar citas"
            hint="Si lo apagas, informa de la fecha pero deriva el cambio a una persona. Recomendado empezar apagado."
            checked={f.inbound_can_book}
            onChange={(v) => setF({ ...f, inbound_can_book: v })}
          />
          <Toggle
            label="Puede abrir incidencias"
            hint="Una avería queda registrada al momento en vez de esperar a que alguien devuelva la llamada."
            checked={f.inbound_can_open_incident}
            onChange={(v) => setF({ ...f, inbound_can_open_incident: v })}
          />
          <Toggle
            label="Puede transferir a una persona"
            hint="Necesita el móvil de guardia de abajo. Si está apagado, el agente dice «le llama un compañero» y crea la tarea, en vez de prometer un pase que no puede hacer."
            checked={f.transfer_enabled}
            onChange={(v) => setF({ ...f, transfer_enabled: v })}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPreview("inbound")}
          disabled={pending}
        >
          <FileText className="mr-2 h-4 w-4" />
          Ver el guion de la recepcionista
        </Button>
      </section>

      {/* ---------------- WHATSAPP ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Confirmación por WhatsApp</h2>
            <p className="text-sm text-muted-foreground">
              Tras cerrar una cita por teléfono, el cliente recibe un mensaje con
              la fecha y un enlace para cambiarla. Sube la asistencia a la visita
              y deja por escrito lo que se acordó.
            </p>
          </div>
          <Switch
            checked={f.whatsapp_confirm_enabled}
            onCheckedChange={(v) => setF({ ...f, whatsapp_confirm_enabled: v })}
            aria-label="Activar la confirmación por WhatsApp"
            disabled={!f.whatsapp_sender.trim()}
          />
        </div>

        <Field
          id="wa_sender"
          label="Número WhatsApp Business de esta empresa"
          hint="Sin un número propio no se manda nada: usar uno compartido haría que tus clientes y los de otra empresa recibieran mensajes del mismo remitente."
        >
          <Input
            id="wa_sender"
            value={f.whatsapp_sender}
            onChange={(e) => setF({ ...f, whatsapp_sender: e.target.value })}
            placeholder="+34612345678"
          />
        </Field>
      </section>

      {/* ---------------- LÍMITES Y RGPD ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="text-base font-bold">Límites, escalado y datos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            id="cap"
            label="Tope de minutos al mes"
            hint="Corte duro. Al llegar, deja de llamar."
          >
            <Input
              id="cap"
              type="number"
              min={0}
              value={f.monthly_minutes_cap}
              onChange={(e) =>
                setF({ ...f, monthly_minutes_cap: Number(e.target.value) })
              }
            />
          </Field>
          <Field id="maxsec" label="Duración máxima por llamada (s)">
            <Input
              id="maxsec"
              type="number"
              min={30}
              max={900}
              value={f.max_call_seconds}
              onChange={(e) =>
                setF({ ...f, max_call_seconds: Number(e.target.value) })
              }
            />
          </Field>
          <Field id="attempts" label="Intentos por persona">
            <Input
              id="attempts"
              type="number"
              min={1}
              max={5}
              value={f.max_attempts}
              onChange={(e) => setF({ ...f, max_attempts: Number(e.target.value) })}
            />
          </Field>
          <Field id="retry" label="Horas entre intentos">
            <Input
              id="retry"
              type="number"
              min={1}
              max={168}
              value={f.retry_hours}
              onChange={(e) => setF({ ...f, retry_hours: Number(e.target.value) })}
            />
          </Field>
          <Field
            id="escal"
            label="Móvil de guardia"
            hint="A donde se transfiere si piden una persona."
          >
            <Input
              id="escal"
              value={f.escalation_phone}
              onChange={(e) => setF({ ...f, escalation_phone: e.target.value })}
              placeholder="+34600111222"
            />
          </Field>
          <Field id="retention" label="Días que se guarda la transcripción">
            <Input
              id="retention"
              type="number"
              min={7}
              max={365}
              value={f.transcript_retention_days}
              onChange={(e) =>
                setF({ ...f, transcript_retention_days: Number(e.target.value) })
              }
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 p-3">
          <div>
            <p className="text-sm font-medium">Grabar el audio de las llamadas</p>
            <p className="text-xs text-muted-foreground">
              La transcripción se guarda siempre. El audio añade obligaciones de
              información y retención; la recomendación es dejarlo apagado.
            </p>
          </div>
          <Switch
            checked={f.record_audio}
            onCheckedChange={(v) => setF({ ...f, record_audio: v })}
            aria-label="Grabar audio"
          />
        </div>
      </section>

      {/* ---------------- GUION ---------------- */}
      <section className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="text-base font-bold">Cómo habla el agente</h2>
        <Field
          id="pitch"
          label="Contexto de tu empresa"
          hint="Tono, marcas que instalas, zona. Se añade al guion; no puede alterar las frases legales obligatorias."
        >
          <Textarea
            id="pitch"
            rows={4}
            value={f.company_pitch}
            onChange={(e) => setF({ ...f, company_pitch: e.target.value })}
          />
        </Field>
        <Field
          id="forbidden"
          label="Temas que no puede tocar"
          hint="Uno por línea. Ej.: precios de la competencia, plazos de instalación."
        >
          <Textarea
            id="forbidden"
            rows={3}
            value={f.forbidden_topics}
            onChange={(e) => setF({ ...f, forbidden_topics: e.target.value })}
          />
        </Field>
      </section>

      {/* ---------------- SECRETO ---------------- */}
      <section className="space-y-3 rounded-xl border border-border p-5">
        <h2 className="text-base font-bold">Secreto de herramientas</h2>
        <p className="text-sm text-muted-foreground">
          Es lo que la plataforma de voz presenta al llamar a tus endpoints. De
          él se deduce a qué empresa pertenece la llamada, así que{" "}
          <strong>no lo pegues nunca en el prompt del agente</strong>: va en la
          cabecera <code className="rounded bg-muted px-1">x-hm-voice-secret</code>.
        </p>
        <Button type="button" variant="outline" onClick={onRotate} disabled={pending}>
          <KeyRound className="mr-2 h-4 w-4" />
          {initial.tool_secret_hash ? "Generar uno nuevo" : "Generar secreto"}
        </Button>
        {initial.tool_secret_hash && !secret && (
          <p className="text-xs text-muted-foreground">
            Ya hay un secreto activo. Si generas otro, el anterior deja de
            funcionar y hay que actualizarlo en la plataforma de voz.
          </p>
        )}
        {secret && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
            <p className="text-xs font-bold">
              Cópialo ahora. No se vuelve a mostrar.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                {secret}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast.success("Copiado");
                }}
                aria-label="Copiar el secreto"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {prompt && (
        <section className="space-y-2 rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Guion completo</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(prompt);
                toast.success("Guion copiado");
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">
            {prompt}
          </pre>
        </section>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
