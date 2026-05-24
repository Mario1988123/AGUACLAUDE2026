"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  TrendingDown,
  Wrench,
  ShieldCheck,
  Calendar,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { applyTeamDayRouteSafeAction } from "./team-actions";
import type { TeamMemberRoute } from "./team-actions";

const KIND_ICON = {
  installation: Wrench,
  maintenance: ShieldCheck,
  agenda: Calendar,
} as const;

const ROLE_LABEL: Record<string, string> = {
  installer: "Instalador",
  sales_rep: "Comercial",
  telemarketer: "TMK",
  technical_director: "Dir. técnico",
  commercial_director: "Dir. comercial",
  telemarketing_director: "Dir. TMK",
};

interface Props {
  initialDate: string;
  routes: TeamMemberRoute[];
}

export function TeamRoutesClient({ initialDate, routes }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [pending, startTransition] = useTransition();

  function reloadDate(newDate: string) {
    router.push(`/rutas/equipo?date=${newDate}` as never);
  }

  function applyOptimized(member: TeamMemberRoute) {
    if (member.plan.optimized.length === 0) {
      notify.warning("Sin paradas geolocalizadas para reordenar");
      return;
    }
    const saving =
      member.plan.currentKm > 0
        ? Math.max(0, member.plan.currentKm - member.plan.optimizedKm)
        : 0;
    if (
      !confirm(
        `Aplicar nueva ruta a ${member.member.full_name ?? "técnico"}? Ahorras ~${saving.toFixed(
          1,
        )} km. Las horas se recalculan con 60 min entre paradas a partir de la primera.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await applyTeamDayRouteSafeAction({
        user_id: member.member.user_id,
        ordered_ids: member.plan.optimized.map((o) => o.id),
        spacing_minutes: 60,
      });
      if (!r.ok) {
        notify.error("No se pudo aplicar", r.error);
        return;
      }
      notify.success("Ruta aplicada");
      router.refresh();
    });
  }

  function applyAll() {
    const candidates = routes.filter(
      (r) => r.plan.optimized.length > 1 && r.plan.optimizedKm < r.plan.currentKm,
    );
    if (candidates.length === 0) {
      notify.warning(
        "Nada que optimizar",
        "Las rutas actuales ya están en su mejor orden.",
      );
      return;
    }
    if (
      !confirm(
        `Aplicar la ruta optimizada a ${candidates.length} miembros con ahorro de km?`,
      )
    )
      return;
    startTransition(async () => {
      let ok = 0;
      let fail = 0;
      for (const c of candidates) {
        const r = await applyTeamDayRouteSafeAction({
          user_id: c.member.user_id,
          ordered_ids: c.plan.optimized.map((o) => o.id),
          spacing_minutes: 60,
        });
        if (r.ok) ok++;
        else fail++;
      }
      notify.success(`${ok} aplicadas`, fail ? `${fail} fallaron` : undefined);
      router.refresh();
    });
  }

  const totalCurrentKm = routes.reduce((s, r) => s + r.plan.currentKm, 0);
  const totalOptKm = routes.reduce((s, r) => s + r.plan.optimizedKm, 0);
  const totalSaving = Math.max(0, totalCurrentKm - totalOptKm);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1">
          <Label className="text-xs">Fecha</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              reloadDate(e.target.value);
            }}
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Actual total</div>
            <div className="font-bold tabular-nums">
              {totalCurrentKm.toFixed(1)} km
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Optimizado</div>
            <div className="font-bold tabular-nums text-emerald-700">
              {totalOptKm.toFixed(1)} km
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ahorro</div>
            <div className="font-bold tabular-nums text-primary">
              −{totalSaving.toFixed(1)} km
            </div>
          </div>
          <Button
            onClick={applyAll}
            disabled={pending || totalSaving < 0.1}
            variant="success"
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            Aplicar a todos
          </Button>
        </div>
      </div>

      {routes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No tienes miembros en tu equipo con tareas hoy.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {routes.map((r) => {
          const saving = Math.max(
            0,
            r.plan.currentKm - r.plan.optimizedKm,
          );
          const hasItems = r.plan.optimized.length > 0;
          const canSave =
            hasItems && r.plan.optimizedKm < r.plan.currentKm;
          return (
            <Card key={r.member.user_id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <div className="flex items-center gap-2 min-w-0">
                    <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">
                      {r.member.full_name ?? r.member.user_id.slice(0, 8)}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {ROLE_LABEL[r.member.role_key] ?? r.member.role_key}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {r.plan.currentKm.toFixed(1)} →
                    </span>
                    <span className="font-bold text-emerald-700 tabular-nums">
                      {r.plan.optimizedKm.toFixed(1)} km
                    </span>
                    {saving > 0.1 && (
                      <Badge variant="success" className="gap-1 text-[10px]">
                        <TrendingDown className="h-3 w-3" />
                        −{saving.toFixed(1)} km
                      </Badge>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!hasItems ? (
                  <p className="text-xs text-muted-foreground">
                    Sin tareas con geolocalización.
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {r.plan.optimized.map((it, idx) => {
                      const Icon = KIND_ICON[it.kind] ?? Calendar;
                      const hrefBase =
                        it.kind === "installation"
                          ? "/instalaciones"
                          : it.kind === "maintenance"
                            ? "/mantenimientos"
                            : "/agenda";
                      return (
                        <li
                          key={it.id}
                          className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5 text-xs"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 font-bold text-primary">
                            {idx + 1}
                          </span>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate font-medium">
                            {it.title}
                          </span>
                          <Link
                            href={`${hrefBase}/${it.id}` as never}
                            className="text-primary hover:underline"
                          >
                            Abrir
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {r.plan.withoutGeo.length > 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                    {r.plan.withoutGeo.length} tarea(s) sin geolocalización (no entran en la ruta).
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => applyOptimized(r)}
                    disabled={pending || !canSave}
                    variant={canSave ? "success" : "outline"}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Aplicar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
