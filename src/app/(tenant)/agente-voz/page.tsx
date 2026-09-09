import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import {
  assertModuleActive,
  requireModuleAccess,
} from "@/shared/lib/auth/module-guard";
import { listVoiceTasks } from "@/modules/voice-agent/queue-actions";
import { getVoiceSettingsAction } from "@/modules/voice-agent/settings-actions";
import { QueuePanel } from "@/modules/voice-agent/queue-panel";
import { listInboundCalls } from "@/modules/voice-agent/inbound-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  PhoneCall,
  PhoneIncoming,
  Megaphone,
  ShieldAlert,
  Settings,
  TriangleAlert,
} from "lucide-react";

const INBOUND_OUTCOME: Record<string, string> = {
  incident_created: "Avería registrada",
  appointment_booked: "Cita cerrada",
  info_provided: "Consulta resuelta",
  lead_created: "Interesado nuevo",
  escalated: "Pasó a una persona",
  transferred: "Transferida",
  spam: "Spam",
  failed: "Error",
};

export const dynamic = "force-dynamic";

const MANAGER_ROLES = [
  "company_admin",
  "technical_director",
  "telemarketing_director",
];

export default async function AgenteVozPage() {
  await assertModuleActive("voice_agent");
  const session = await requireSession();
  requireModuleAccess(session, MANAGER_ROLES);

  const [settings, serviceTasks, commercialTasks, inboundCalls] = await Promise.all([
    getVoiceSettingsAction(),
    listVoiceTasks("service"),
    listVoiceTasks("commercial"),
    listInboundCalls(30),
  ]);

  const isAdmin = session.is_superadmin || session.roles.includes("company_admin");
  const canSeeCampaigns =
    isAdmin || session.roles.includes("telemarketing_director");
  const simulating = process.env.VOICE_AGENT_SIMULATE === "true";

  const pendingService = serviceTasks.filter((t) => t.status === "pending").length;
  const confirmed = serviceTasks.filter((t) => t.outcome === "confirmed" || t.outcome === "rescheduled").length;
  const answered = serviceTasks.filter((t) => t.outcome && t.outcome !== "no_answer" && t.outcome !== "voicemail" && t.outcome !== "busy").length;
  const minutesUsed = settings?.minutes_used_month ?? 0;
  const cap = settings?.monthly_minutes_cap ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Agente de voz IA
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tres canales que no se mezclan: llama a tus clientes para cerrar la
            fecha del mantenimiento, atiende el teléfono cuando llaman ellos, y
            —por separado, con otro número y otras reglas— hace captación
            comercial. Nunca a particulares.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSeeCampaigns && (
            <Link
              href="/agente-voz/campanas"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Megaphone className="h-4 w-4" />
              Campañas
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/configuracion/agente-voz"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Settings className="h-4 w-4" />
              Configurar
            </Link>
          )}
        </div>
      </div>

      {simulating && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">Modo simulación activo</p>
            <p className="text-muted-foreground">
              La cola funciona, los guardarraíles se aplican y todo queda
              registrado, pero <strong>no se marca ningún número</strong>. Es el
              modo correcto para probar. Se desactiva quitando{" "}
              <code className="rounded bg-muted px-1">VOICE_AGENT_SIMULATE</code>.
            </p>
          </div>
        </div>
      )}

      {!settings?.service_enabled && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-bold">El agente de servicio está apagado</p>
            <p className="text-muted-foreground">
              Puedes llenar la cola igualmente para ver a quién llamaría, pero no
              saldrá ninguna llamada hasta que lo actives en Configurar.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="En cola" value={String(pendingService)} />
        <StatCard label="Contestadas" value={String(answered)} />
        <StatCard
          label="Citas cerradas"
          value={String(confirmed)}
          hint={answered > 0 ? `${Math.round((confirmed / answered) * 100)}% de las contestadas` : undefined}
        />
        <StatCard
          label="Minutos este mes"
          value={`${minutesUsed.toFixed(0)} / ${cap}`}
          hint={cap > 0 && minutesUsed >= cap ? "Tope alcanzado: no se llama más" : undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4" />
            Mantenimientos — llamadas de servicio
          </CardTitle>
          <Badge variant="outline">Sin restricción legal</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Llamada amparada por el contrato que el cliente ya tiene (art. 6.1.b
            RGPD). No necesita consentimiento previo ni el prefijo 400 — de hecho
            el 400 tiene <strong>prohibido</strong> usarse para atención al
            cliente. Sale del número de siempre de la empresa.
          </p>
          <QueuePanel tasks={serviceTasks} canSeed />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneIncoming className="h-4 w-4" />
            Recepcionista — llamadas atendidas
          </CardTitle>
          <Badge variant={settings?.inbound_enabled ? "default" : "secondary"}>
            {settings?.inbound_enabled ? "Activa" : "Apagada"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Aquí llama el cliente, así que no hay consentimiento ni horario que
            comprobar. Lo que sí hay, y con más peso que en las salientes, es el
            derecho a que le atienda una persona en cuanto lo pida.
          </p>
          {inboundCalls.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Todavía no ha entrado ninguna llamada. Da de alta el número en
              Configurar para que la recepcionista empiece a atender.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-bold">Cuándo</th>
                    <th className="px-3 py-2 font-bold">Teléfono</th>
                    <th className="px-3 py-2 font-bold">Duración</th>
                    <th className="px-3 py-2 font-bold">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {inboundCalls.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {new Intl.DateTimeFormat("es-ES", {
                          timeZone: "Europe/Madrid",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(c.started_at))}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{c.to_phone_e164}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {c.duration_seconds != null
                          ? `${Math.floor(c.duration_seconds / 60)}:${String(
                              c.duration_seconds % 60,
                            ).padStart(2, "0")}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {c.human_escalation_requested && (
                          <Badge variant="destructive" className="mr-2">
                            Pidió persona
                          </Badge>
                        )}
                        <span className="text-muted-foreground">
                          {INBOUND_OUTCOME[c.outcome ?? ""] ?? c.outcome ?? "En curso"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4" />
            Captación comercial — solo empresas
          </CardTitle>
          <Badge variant={settings?.commercial_enabled ? "default" : "secondary"}>
            {settings?.commercial_enabled ? "Activa" : "Apagada"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Solo a personas jurídicas. El sistema{" "}
            <strong>rechaza a nivel de base de datos</strong> cualquier intento de
            encolar una llamada comercial a un particular, aunque el resto esté
            bien configurado. Requiere numeración del rango 400
            {settings?.caller_id_commercial ? (
              <>
                {" "}
                (configurado:{" "}
                <code className="rounded bg-muted px-1">
                  {settings.caller_id_commercial}
                </code>
                )
              </>
            ) : (
              <> — todavía sin configurar, así que no puede activarse</>
            )}
            .
          </p>
          <QueuePanel tasks={commercialTasks} canSeed={false} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
