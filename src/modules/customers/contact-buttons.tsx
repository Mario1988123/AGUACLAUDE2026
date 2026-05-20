"use client";

import { useTransition } from "react";
import { Phone, MessageCircle, Mail } from "lucide-react";
import { logCustomerContactSafeAction } from "./actions";
import { notify } from "@/shared/hooks/use-toast";
import { MessageTemplateButton } from "@/modules/messaging/template-button";

export function CustomerContactButtons({
  customerId,
  phone,
  email,
  recipientName,
  commercialName,
}: {
  customerId: string;
  phone: string | null;
  email: string | null;
  recipientName?: string | null;
  commercialName?: string | null;
}) {
  const [, startTransition] = useTransition();

  function handle(channel: "call" | "whatsapp" | "email", url: string) {
    startTransition(async () => {
      const r = await logCustomerContactSafeAction(customerId, channel);
      if (!r.ok) {
        notify.error("No se pudo registrar el contacto", r.error);
      }
    });
    window.location.href = url;
  }

  if (!phone && !email) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {phone && (
        <button
          type="button"
          onClick={() => handle("call", `tel:${phone}`)}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-success px-4 text-sm font-semibold text-success-foreground hover:bg-success/90"
        >
          <Phone className="h-4 w-4" /> Llamar
        </button>
      )}
      {phone && (
        <button
          type="button"
          onClick={() =>
            handle("whatsapp", `https://wa.me/${phone.replace(/[^0-9+]/g, "")}`)
          }
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </button>
      )}
      {email && (
        <button
          type="button"
          onClick={() => handle("email", `mailto:${email}`)}
          className="inline-flex h-12 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted"
        >
          <Mail className="h-4 w-4" /> Email
        </button>
      )}
      <MessageTemplateButton
        recipientName={recipientName ?? null}
        commercialName={commercialName ?? null}
        phone={phone}
        email={email}
      />
    </div>
  );
}
