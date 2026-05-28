"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Send, Plus, CalendarDays, Users } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import {
  createCampaignAction,
  sendCampaignAction,
  type CampaignListItem,
  type MarketingTemplateOption,
  type EphemerisSuggestion,
} from "./campaigns-actions";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  sent: "Enviada",
  cancelled: "Cancelada",
  failed: "Fallida",
};

export function CampaignsClient({
  campaigns,
  templates,
  suggestions,
  audienceCount,
}: {
  campaigns: CampaignListItem[];
  templates: MarketingTemplateOption[];
  suggestions: EphemerisSuggestion[];
  audienceCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  function create() {
    if (!name.trim()) return notify.warning("Ponle un nombre a la campaña");
    if (!templateId) return notify.warning("Elige una plantilla de marketing");
    startTransition(async () => {
      const r = await createCampaignAction({ name, template_id: templateId });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Campaña creada en borrador");
      setName("");
      router.refresh();
    });
  }

  function send(id: string, campaignName: string) {
    if (
      !confirm(
        `¿Enviar "${campaignName}" a ${audienceCount} cliente(s) con consentimiento comercial? Esta acción no se puede deshacer.`,
      )
    )
      return;
    startTransition(async () => {
      const r = await sendCampaignAction(id);
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success(
        "Campaña enviada",
        `${r.sent} enviados · ${r.failed} fallidos · ${r.recipients} destinatarios`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Crear campaña */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Nueva campaña
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay plantillas de tipo <strong>marketing</strong>. Crea una en{" "}
              Configuración → Mailing → Plantillas antes de lanzar una campaña.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Newsletter mayo"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Plantilla (marketing)</Label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Audiencia estimada: <strong>{audienceCount}</strong> cliente(s) con
              consentimiento comercial
            </span>
            {templates.length > 0 && (
              <Button onClick={create} disabled={pending} className="gap-2">
                <Plus className="h-4 w-4" /> Crear borrador
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sugerencias por efeméride */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Próximas efemérides del agua
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Fechas señaladas para lanzar una campaña con gancho. Pulsa para
              pre-rellenar el nombre.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => setName(`Campaña · ${s.name}`)}
                className="flex items-start gap-3 rounded-xl border p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="flex flex-col items-center rounded-lg bg-primary/10 px-2 py-1 text-primary">
                  <span className="text-xs font-bold uppercase">{s.date_label}</span>
                  <span className="text-[10px]">en {s.in_days}d</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{s.name}</span>
                    {s.importance === "high" && (
                      <Badge variant="warning" className="text-[10px]">
                        clave
                      </Badge>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Listado de campañas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" /> Campañas ({campaigns.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no has creado ninguna campaña.
            </p>
          ) : (
            campaigns.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant={c.status === "sent" ? "success" : "secondary"}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Plantilla: {c.template_name ?? "—"}
                    {c.status === "sent" &&
                      ` · ${c.total_sent} enviados / ${c.total_failed} fallidos de ${c.total_recipients}`}
                  </p>
                </div>
                {(c.status === "draft" || c.status === "failed") && (
                  <Button
                    size="sm"
                    onClick={() => send(c.id, c.name)}
                    disabled={pending}
                    className="gap-2 shrink-0"
                  >
                    <Send className="h-4 w-4" /> Enviar
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
