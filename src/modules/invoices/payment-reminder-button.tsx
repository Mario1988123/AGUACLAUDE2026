"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Bell } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { logPaymentReminderAction } from "./payment-reminder-actions";
import { sendQuickEmailAction } from "@/modules/mailing/actions";
import {
  getReminderTemplate,
  type ReminderLevel,
} from "./payment-reminder-templates";

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
    // Envío INTERNO desde el CRM (antes abría cliente de email externo).
    startTransition(async () => {
      const sendRes = await sendQuickEmailAction({
        to_email: customerEmail,
        to_name: customerName,
        subject: t.subject,
        body: t.body,
        related_subject_type: "invoice",
        related_subject_id: invoiceId,
      });
      if (!sendRes.ok) {
        notify.error("No se pudo enviar", sendRes.error);
        return;
      }
      await logPaymentReminderAction({
        invoice_id: invoiceId,
        level,
        channel: "email",
      });
      notify.success("Recordatorio enviado desde el CRM");
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
        El recordatorio se envía directamente desde el CRM (SMTP/Resend) y se
        registra en el timeline.
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
