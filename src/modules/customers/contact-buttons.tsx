"use client";

import { useTransition } from "react";
import { Phone, MessageCircle } from "lucide-react";
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
      {/* Antes había un botón Email separado con mailto: que abría el
          cliente nativo del usuario (Outlook, Apple Mail…). El cliente
          no quería eso — quería enviar desde el CRM con plantillas. El
          envío real lo hace el MessageTemplateButton de abajo, que abre
          un modal interno con plantillas + envío vía Resend. Por eso
          aquí solo dejamos ese, con etiqueta "Email" para que se vea
          claro que es la acción principal de envío. */}
      <MessageTemplateButton
        recipientName={recipientName ?? null}
        commercialName={commercialName ?? null}
        phone={phone}
        email={email}
        customerId={customerId}
        triggerLabel={email ? "Email" : "Plantillas"}
      />
    </div>
  );
}
