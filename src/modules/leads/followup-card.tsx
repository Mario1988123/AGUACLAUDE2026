"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { logLeadContactSafeAction } from "./actions";

interface Props {
  leadId: string;
  lastContactAt: string | null;
}

/**
 * Indicador de seguimiento del lead — versión compacta inline.
 *
 * Se sustituyó la Card grande original por una banda fina horizontal con la
 * info esencial y un botón discreto. El botón "Contactado" de cambio de
 * estado vive aparte en LeadStatusActions (es otra cosa: marca el status
 * del lead como "contacted", esto solo registra timestamp de contacto).
 */
export function LeadFollowupCard({ leadId, lastContactAt }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const lastMs = lastContactAt ? new Date(lastContactAt).getTime() : null;
  const daysSince =
    lastMs != null ? Math.floor((Date.now() - lastMs) / 86400000) : null;

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

  // Tono + texto según urgencia
  let tone =
    "border-blue-200 bg-blue-50/60 text-blue-900";
  let label = "Sin contactar todavía";
  let Icon = Clock;
  if (daysSince != null) {
    if (daysSince === 0) {
      tone = "border-emerald-200 bg-emerald-50/60 text-emerald-900";
      Icon = CheckCircle2;
      label = "Contactado hoy";
    } else if (daysSince === 1) {
      tone = "border-emerald-200 bg-emerald-50/60 text-emerald-900";
      Icon = CheckCircle2;
      label = "Contactado ayer";
    } else if (daysSince <= 7) {
      tone = "border-blue-200 bg-blue-50/60 text-blue-900";
      label = `Último contacto hace ${daysSince} días`;
    } else if (daysSince <= 14) {
      tone = "border-amber-200 bg-amber-50/60 text-amber-900";
      Icon = AlertTriangle;
      label = `Sin contacto ${daysSince}d — toca seguimiento`;
    } else {
      tone = "border-red-300 bg-red-50/60 text-red-900";
      Icon = AlertTriangle;
      label = `Sin contacto ${daysSince}d — urgente`;
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${tone}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate font-semibold">{label}</span>
      </div>
      <button
        type="button"
        onClick={logContact}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1 rounded-md bg-current/10 px-2 text-xs font-bold hover:bg-current/20 disabled:opacity-50"
        title="Registra un nuevo contacto en el timeline"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {pending ? "Registrando…" : "Marcar contacto"}
      </button>
    </div>
  );
}
