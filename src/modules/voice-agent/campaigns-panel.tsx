"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Loader2, Megaphone, Pause, Play, Plus, Users } from "lucide-react";
import {
  createCampaignAction,
  seedCampaignAction,
  setCampaignStatusAction,
  type CampaignRow,
  type CampaignStatus,
} from "./campaign-actions";

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Borrador",
  running: "En marcha",
  paused: "Pausada",
  done: "Cerrada",
};

function statusVariant(
  status: CampaignStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "running") return "default";
  if (status === "paused") return "destructive";
  if (status === "done") return "secondary";
  return "outline";
}

export function CampaignsPanel({ campaigns }: { campaigns: CampaignRow[] }) {
  const [pending, startTransition] = useTransition();

  // Campaña nueva
  const [newName, setNewName] = useState("");

  // Filtros de siembra. Viven en el panel y no por campaña porque se siembra
  // de una en una: se elige la campaña con su botón y estos son los filtros
  // que se le aplican.
  const [province, setProvince] = useState("");
  const [postalPrefix, setPostalPrefix] = useState("");
  const [onlyWithoutContract, setOnlyWithoutContract] = useState(true);
  const [limit, setLimit] = useState("200");

  function onCreate() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const r = await createCampaignAction(name);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo crear la campaña");
        return;
      }
      setNewName("");
      toast.success("Campaña creada en borrador. Ahora siémbrala con tus filtros.");
    });
  }

  function onSeed(campaign: CampaignRow) {
    startTransition(async () => {
      const parsedLimit = Number.parseInt(limit, 10);
      const r = await seedCampaignAction(campaign.id, {
        province: province.trim() || undefined,
        postalPrefix: postalPrefix.trim() || undefined,
        onlyWithoutContract,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      });
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo sembrar la campaña");
        return;
      }
      if (r.enqueued === 0) {
        toast.warning(
          `No se ha encolado ninguna llamada. ${describeSkipped(r.skipped)}`,
        );
        return;
      }
      toast.success(
        `${r.enqueued} llamada${r.enqueued === 1 ? "" : "s"} en cola. ${describeSkipped(r.skipped)}`,
      );
    });
  }

  function onSetStatus(campaign: CampaignRow, status: CampaignStatus) {
    if (status === "paused" && campaign.counts.pending > 0) {
      const ok = window.confirm(
        `Pausar «${campaign.name}» ANULA las ${campaign.counts.pending} llamadas que quedan en cola. No se recuperan: si luego quieres seguir, tendrás que volver a sembrar la campaña.\n\n¿Pausar de todas formas?`,
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const r = await setCampaignStatusAction(campaign.id, status);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo cambiar el estado");
        return;
      }
      toast.success(
        r.cancelled
          ? `Campaña ${STATUS_LABEL[status].toLowerCase()}. ${r.cancelled} llamada${r.cancelled === 1 ? "" : "s"} anulada${r.cancelled === 1 ? "" : "s"}.`
          : `Campaña ${STATUS_LABEL[status].toLowerCase()}.`,
      );
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Nueva campaña
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grow space-y-1">
            <label
              htmlFor="campaign-name"
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Nombre
            </label>
            <Input
              id="campaign-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Polígonos de Pontevedra — octubre"
              maxLength={120}
            />
          </div>
          <Button onClick={onCreate} disabled={pending || !newName.trim()}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Crear en borrador
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            A quién llamar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Estos filtros se aplican al pulsar «Sembrar» en una campaña. Solo
            entran leads que sean <strong>empresas</strong>: los particulares se
            descartan siempre y se te dice cuántos eran.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label
                htmlFor="seed-province"
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                Provincia
              </label>
              <Input
                id="seed-province"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                placeholder="Pontevedra"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="seed-postal"
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                Código postal (empieza por)
              </label>
              <Input
                id="seed-postal"
                value={postalPrefix}
                onChange={(e) => setPostalPrefix(e.target.value)}
                placeholder="36"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="seed-limit"
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                Máximo de llamadas
              </label>
              <Input
                id="seed-limit"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="numeric"
                placeholder="200"
              />
            </div>
            <div className="flex items-end">
              <label
                htmlFor="seed-without-contract"
                className="flex items-center gap-2 text-sm"
              >
                <input
                  id="seed-without-contract"
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={onlyWithoutContract}
                  onChange={(e) => setOnlyWithoutContract(e.target.checked)}
                />
                Solo los que no son ya clientes
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {campaigns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Todavía no hay campañas. Crea una arriba, siémbrala con tus filtros y
          revisa a quién ha cogido antes de ponerla en marcha.
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-bold">
                    <Megaphone className="h-4 w-4 text-muted-foreground" />
                    {c.name}
                    <Badge variant={statusVariant(c.status)}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </p>
                  {c.notes && (
                    <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>
                  )}
                  <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                    {c.counts.total} llamada{c.counts.total === 1 ? "" : "s"} ·{" "}
                    {c.counts.pending} en cola · {c.counts.calling} llamando ·{" "}
                    {c.counts.done} resueltas · {c.counts.failed} sin respuesta ·{" "}
                    {c.counts.cancelled} anuladas
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {c.status !== "done" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSeed(c)}
                      disabled={pending}
                    >
                      {pending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Users className="mr-2 h-4 w-4" />
                      )}
                      Sembrar
                    </Button>
                  )}
                  {(c.status === "draft" || c.status === "paused") && (
                    <Button
                      size="sm"
                      onClick={() => onSetStatus(c, "running")}
                      disabled={pending}
                      aria-label={`Poner en marcha la campaña ${c.name}`}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  {c.status === "running" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onSetStatus(c, "paused")}
                      disabled={pending}
                      aria-label={`Pausar la campaña ${c.name} y anular las llamadas en cola`}
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Resumen legible de lo que se ha quedado fuera de la siembra. */
function describeSkipped(skipped: {
  no_phone: number;
  individuals: number;
  already_queued: number;
  excluded: number;
}): string {
  const partes: string[] = [];
  if (skipped.individuals > 0) {
    partes.push(
      `${skipped.individuals} particular${skipped.individuals === 1 ? "" : "es"} descartado${skipped.individuals === 1 ? "" : "s"} (solo se llama a empresas)`,
    );
  }
  if (skipped.no_phone > 0) partes.push(`${skipped.no_phone} sin teléfono`);
  if (skipped.already_queued > 0) {
    partes.push(`${skipped.already_queued} ya estaban en cola`);
  }
  if (skipped.excluded > 0) {
    partes.push(`${skipped.excluded} en la lista de exclusión`);
  }
  return partes.length > 0 ? `${partes.join(", ")}.` : "";
}
