import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const KINDS = [
  { kind: "lead.created", desc: "Nuevo lead captado", channels: ["app"] },
  { kind: "lead.converted", desc: "Lead convertido a cliente", channels: ["app", "email"] },
  { kind: "contract.signed", desc: "Contrato firmado", channels: ["app", "email"] },
  { kind: "installation.scheduled", desc: "Instalación agendada", channels: ["app"] },
  { kind: "installation.completed", desc: "Instalación completada", channels: ["app"] },
  { kind: "installation.started_far", desc: "Parte iniciado fuera de zona", channels: ["app"] },
  { kind: "installation.stock_shortage", desc: "Falta stock al programar", channels: ["app"] },
  { kind: "incident.created", desc: "Incidencia abierta", channels: ["app"] },
  { kind: "incident.assigned", desc: "Incidencia asignada", channels: ["app"] },
  { kind: "wallet.pending_validation", desc: "Cobro pendiente de validar", channels: ["app"] },
  { kind: "agenda.assigned", desc: "Tarea agenda asignada", channels: ["app"] },
];

export default async function ConfigNotificacionesPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            Eventos del sistema que generan notificación. Cada usuario podrá
            decidir desde su perfil qué canales activar.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Eventos disponibles ({KINDS.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {KINDS.map((k) => (
            <div
              key={k.kind}
              className="flex items-center justify-between rounded-lg border bg-card p-2"
            >
              <div>
                <code className="text-xs font-mono text-primary">{k.kind}</code>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {k.desc}
                </div>
              </div>
              <div className="flex gap-1">
                {k.channels.map((c) => (
                  <Badge key={c} variant="outline" className="text-[10px]">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Canales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>app</strong> → icono de campana en el header del CRM
            (siempre activo).
          </p>
          <p>
            <strong>email</strong> → notificación por correo. Activo en eventos
            críticos hacia cliente (contrato firmado, incidencia abierta,
            mantenimiento). Requiere consentimiento RGPD del cliente.
          </p>
          <p>
            <strong>whatsapp</strong> → mensaje WhatsApp Business. Disponible
            para mailing comercial dirigido si se configura el proveedor en{" "}
            <strong>/configuracion/mailing</strong>.
          </p>
          <p>
            <strong>push</strong> → notificación push del navegador. Disponible
            con la PWA activa (actualmente desactivada por configuración).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
