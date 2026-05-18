"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Bell } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  getReminderTemplate,
  logPaymentReminderAction,
  type ReminderLevel,
} from "./payment-reminder-actions";

interface Props {
  invoiceId: string;
  invoiceRef: string;
  customerName: string;
  customerEmail: string | null;
  totalCents: number;
  daysOverdue: number;
  suggestedLevel: ReminderLevel;
}

const LEVEL_LABEL: Record<ReminderLevel, string> = {
  first: "1º Recordatorio amable",
  second: "2º Aviso (vencida)",
  final: "Requerimiento formal",
};

export function PaymentReminderButton({
  invoiceId,
  invoiceRef,
  customerName,
  customerEmail,
  totalCents,
  daysOverdue,
  suggestedLevel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<ReminderLevel>(suggestedLevel);

  function send() {
    if (!customerEmail) {
      notify.warning("El cliente no tiene email registrado");
      return;
    }
    const t = getReminderTemplate({
      level,
      invoice_ref: invoiceRef,
      customer_name: customerName,
      total_cents: totalCents,
      days_overdue: daysOverdue,
    });
    const mailto = `mailto:${customerEmail}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
    // Registrar antes de abrir cliente de email
    startTransition(async () => {
      const r = await logPaymentReminderAction({
        invoice_id: invoiceId,
        level,
        channel: "email",
      });
      if (!r.ok) {
        notify.error("No se pudo registrar", r.error);
        return;
      }
      window.location.href = mailto;
      setOpen(false);
      router.refresh();
    });
  }

  if (!customerEmail) return null;

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Bell className="h-4 w-4" /> Enviar recordatorio
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50/40 p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-amber-900">
        Recordatorio de impago
      </div>
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value as ReminderLevel)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {(Object.keys(LEVEL_LABEL) as ReminderLevel[]).map((l) => (
          <option key={l} value={l}>
            {LEVEL_LABEL[l]}
          </option>
        ))}
      </select>
      <div className="text-[11px] text-muted-foreground">
        Sugerido según historial: <strong>{LEVEL_LABEL[suggestedLevel]}</strong>.
        Al pulsar Enviar se abre tu cliente de email con la plantilla
        prerellenada y se registra el envío en el timeline.
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button size="sm" onClick={send} disabled={pending} className="gap-1">
          <Mail className="h-3 w-3" />
          {pending ? "Registrando…" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}
