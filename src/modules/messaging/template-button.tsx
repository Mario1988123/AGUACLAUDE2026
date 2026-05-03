"use client";

import { useState } from "react";
import { MessageSquare, Copy, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { MESSAGE_TEMPLATES, renderTemplate, type MessageTemplate } from "./templates";

interface Props {
  recipientName: string | null;
  companyName?: string | null;
  commercialName?: string | null;
  ref?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Plantillas a usar. Si no se pasa, usa MESSAGE_TEMPLATES hardcoded fallback */
  templates?: MessageTemplate[];
}

export function MessageTemplateButton({
  recipientName,
  companyName,
  commercialName,
  ref,
  phone,
  email,
  templates,
}: Props) {
  const list = templates && templates.length > 0 ? templates : MESSAGE_TEMPLATES;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);

  const rendered = selected
    ? renderTemplate(selected, {
        nombre: recipientName ?? "",
        empresa: companyName ?? "",
        comercial: commercialName ?? "",
        ref: ref ?? "",
      })
    : null;

  function copyBody() {
    if (!rendered) return;
    navigator.clipboard.writeText(rendered.body).then(
      () => notify.success("Copiado al portapapeles"),
      () => notify.error("No se pudo copiar"),
    );
  }

  function openWhatsApp() {
    if (!rendered || !phone) return;
    const cleanPhone = phone.replace(/[^0-9+]/g, "");
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(rendered.body)}`;
    window.open(url, "_blank");
  }

  function openEmail() {
    if (!rendered || !email) return;
    const params = new URLSearchParams();
    if (rendered.subject) params.set("subject", rendered.subject);
    params.set("body", rendered.body);
    window.location.href = `mailto:${email}?${params.toString()}`;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquare className="h-4 w-4" /> Plantillas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plantillas de mensaje</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <ul className="space-y-1">
            {list.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`w-full rounded-xl border-2 px-3 py-2 text-left text-sm ${
                    selected?.key === t.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="font-semibold">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.channel}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-3">
            {!rendered ? (
              <p className="text-sm text-muted-foreground">Selecciona una plantilla.</p>
            ) : (
              <>
                {rendered.subject && (
                  <div className="rounded-xl border bg-muted/30 p-2 text-sm">
                    <span className="font-semibold">Asunto:</span> {rendered.subject}
                  </div>
                )}
                <textarea
                  readOnly
                  value={rendered.body}
                  rows={10}
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm font-mono"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={copyBody}>
                    <Copy className="h-4 w-4" /> Copiar
                  </Button>
                  {phone && (
                    <Button size="sm" onClick={openWhatsApp} className="bg-[#25D366] hover:bg-[#25D366]/90">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </Button>
                  )}
                  {email && (
                    <Button size="sm" variant="default" onClick={openEmail}>
                      <Mail className="h-4 w-4" /> Email
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
