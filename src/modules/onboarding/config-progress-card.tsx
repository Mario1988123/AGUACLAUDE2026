"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import {
  markOnboardingStepDone,
  postponeOnboardingStep,
  type OnboardingSummary,
  type OnboardingStepState,
} from "./state-actions";
import { STEP_GROUP_LABEL } from "./steps-config";

const IMPORTANCE_TONE: Record<string, "destructive" | "warning" | "outline"> = {
  required: "destructive",
  recommended: "warning",
  optional: "outline",
};

const IMPORTANCE_LABEL: Record<string, string> = {
  required: "Obligatorio",
  recommended: "Recomendado",
  optional: "Opcional",
};

export function ConfigProgressCard({ summary }: { summary: OnboardingSummary }) {
  const [expanded, setExpanded] = useState(false);
  const pendingSteps = summary.steps.filter((s) => s.status === "pending");
  const postponedSteps = summary.steps.filter((s) => s.status === "postponed");

  // Solo mostrar la card si hay algo pendiente (required + recommended).
  const visiblePending = pendingSteps.filter(
    (s) => s.importance === "required" || s.importance === "recommended",
  );
  if (visiblePending.length === 0 && postponedSteps.length === 0) {
    return null;
  }

  // Agrupar por group
  const byGroup = new Map<string, OnboardingStepState[]>();
  for (const s of visiblePending) {
    if (!byGroup.has(s.group)) byGroup.set(s.group, []);
    byGroup.get(s.group)!.push(s);
  }

  const requiredPending = summary.totals.required_pending;
  const totalPending = visiblePending.length;
  const progressPct = Math.round(
    (summary.totals.completed / summary.totals.total) * 100,
  );

  return (
    <Card
      className={
        requiredPending > 0 ? "border-2 border-red-300" : "border-2 border-amber-300"
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            ⚙️ Configuración pendiente
            {requiredPending > 0 ? (
              <Badge variant="destructive">{requiredPending} obligatorio{requiredPending === 1 ? "" : "s"}</Badge>
            ) : (
              <Badge variant="warning">{totalPending} pendiente{totalPending === 1 ? "" : "s"}</Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground font-normal">
            {summary.totals.completed} / {summary.totals.total} pasos ·{" "}
            {progressPct}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Barra de progreso */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Lista colapsable */}
        {!expanded ? (
          <div className="space-y-2">
            {Array.from(byGroup.entries())
              .slice(0, 3)
              .map(([group, steps]) => (
                <div key={group}>
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {STEP_GROUP_LABEL[group as keyof typeof STEP_GROUP_LABEL]}
                  </div>
                  {steps.slice(0, 2).map((s) => (
                    <StepRow key={s.key} step={s} />
                  ))}
                  {steps.length > 2 && (
                    <div className="text-[11px] text-muted-foreground italic">
                      +{steps.length - 2} más en este grupo
                    </div>
                  )}
                </div>
              ))}
            {byGroup.size > 3 && (
              <div className="text-[11px] text-muted-foreground italic">
                +{byGroup.size - 3} grupos más
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(byGroup.entries()).map(([group, steps]) => (
              <div key={group}>
                <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {STEP_GROUP_LABEL[group as keyof typeof STEP_GROUP_LABEL]}
                </div>
                {steps.map((s) => (
                  <StepRow key={s.key} step={s} />
                ))}
              </div>
            ))}
            {postponedSteps.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Aparcados
                </div>
                {postponedSteps.map((s) => (
                  <StepRow key={s.key} step={s} />
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Ver menos
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Ver todos ({totalPending})
            </>
          )}
        </button>
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: OnboardingStepState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function done() {
    startTransition(async () => {
      const r = await markOnboardingStepDone(step.key);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Marcado como hecho");
      router.refresh();
    });
  }

  function postpone() {
    startTransition(async () => {
      const r = await postponeOnboardingStep(step.key, 7);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Aparcado 7 días");
      router.refresh();
    });
  }

  const isPostponed = step.status === "postponed";

  return (
    <div className="mt-1 flex items-start gap-2 rounded-xl border bg-card p-2.5 text-sm">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
          isPostponed
            ? "bg-muted text-muted-foreground"
            : step.importance === "required"
              ? "bg-red-100 text-red-700"
              : "bg-amber-100 text-amber-700"
        }`}
      >
        {isPostponed ? <Clock className="h-3 w-3" /> : "·"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{step.label}</span>
          <Badge variant={IMPORTANCE_TONE[step.importance] ?? "outline"} className="text-[10px]">
            {IMPORTANCE_LABEL[step.importance]}
          </Badge>
          {isPostponed && step.postponed_until && (
            <span className="text-[10px] text-muted-foreground">
              hasta{" "}
              {new Date(step.postponed_until).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
              })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <Link
            href={step.href as never}
            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10"
          >
            <ExternalLink className="h-3 w-3" />
            Ir a configurar
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={done}
            disabled={pending}
            className="h-7 gap-1 text-[11px]"
          >
            <CheckCircle2 className="h-3 w-3" /> Marcar hecho
          </Button>
          {!isPostponed && (
            <Button
              size="sm"
              variant="ghost"
              onClick={postpone}
              disabled={pending}
              className="h-7 gap-1 text-[11px]"
            >
              <Clock className="h-3 w-3" /> Aparcar 7d
            </Button>
          )}
        </div>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />
    </div>
  );
}
