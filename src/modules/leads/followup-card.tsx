"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { logLeadContactSafeAction } from "./actions";

interface Props {
  leadId: string;
  lastContactAt: string | null;
}

/**
 * Card de seguimiento del lead. Calcula días desde el último contacto
 * y permite registrar uno nuevo con un click.
 */
export function LeadFollowupCard({ leadId, lastContactAt }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const lastMs = lastContactAt ? new Date(lastContactAt).getTime() : null;
  const daysSince =
    lastMs != null
      ? Math.floor((Date.now() - lastMs) / 86400000)
      : null;

  function logContact() {
    startTransition(async () => {
      const r = await logLeadContactSafeAction(leadId, "call");
      if (!r.ok) {
        notify.error("No se pudo registrar", r.error);
        return;
      }
      notify.success("Contacto registrado");
      router.refresh();
    });
  }

  let urgency = "border-blue-200 bg-blue-50 text-blue-900";
  let label = "Sin contactar todavía";
  let icon = <Clock className="h-5 w-5 text-blue-700" />;
  if (daysSince != null) {
    if (daysSince <= 1) {
      urgency = "border-emerald-200 bg-emerald-50 text-emerald-900";
      icon = <CheckCircle2 className="h-5 w-5 text-emerald-700" />;
      label = "Contactado hoy";
      if (daysSince === 1) label = "Contactado ayer";
    } else if (daysSince <= 7) {
      urgency = "border-blue-200 bg-blue-50 text-blue-900";
      label = `Hace ${daysSince} días`;
    } else if (daysSince <= 14) {
      urgency = "border-amber-200 bg-amber-50 text-amber-900";
      label = `Sin contacto ${daysSince}d — toca seguimiento`;
    } else {
      urgency = "border-red-300 bg-red-50 text-red-900";
      label = `Sin contacto ${daysSince}d — URGENTE`;
    }
  }

  return (
    <Card className={`border-2 ${urgency}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          Seguimiento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-bold">{label}</p>
        {lastContactAt && (
          <p className="text-xs opacity-80">
            Último:{" "}
            {new Date(lastContactAt).toLocaleString("es-ES")}
          </p>
        )}
        <Button
          onClick={logContact}
          disabled={pending}
          variant="success"
          size="sm"
          className="w-full gap-1.5"
        >
          <CheckCircle2 className="h-4 w-4" />
          {pending ? "Registrando…" : "He contactado ahora"}
        </Button>
      </CardContent>
    </Card>
  );
}
