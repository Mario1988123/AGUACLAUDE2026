"use client";

import { useState, useTransition } from "react";
import { Save, Mail, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { setMyEmailSettingsSafeAction } from "./actions";

export function EmailSettingsForm({
  initial,
  domainVerified,
}: {
  initial: {
    from_email: string;
    from_name: string;
    signature_html: string;
    full_name: string;
    job_title: string;
    phone: string;
  };
  domainVerified: boolean;
}) {
  const [fromEmail, setFromEmail] = useState(initial.from_email);
  const [fromName, setFromName] = useState(initial.from_name);
  const [signature, setSignature] = useState(initial.signature_html);
  const [pending, startTransition] = useTransition();

  function generateSignature() {
    const sig = `<table cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td style="font-size: 13px; color: #444; line-height: 1.5;">
      <strong style="color: #222;">${escape(initial.full_name)}</strong>${initial.job_title ? `<br><span style="color: #777;">${escape(initial.job_title)}</span>` : ""}
      ${initial.phone ? `<br>📞 ${escape(initial.phone)}` : ""}${fromEmail ? `<br>✉ ${escape(fromEmail)}` : ""}
    </td>
  </tr>
</table>`;
    setSignature(sig);
    notify.success("Firma generada — puedes editarla si quieres");
  }

  function save() {
    if (!fromEmail.trim()) {
      notify.warning("Pon tu email empresa");
      return;
    }
    startTransition(async () => {
      const r = await setMyEmailSettingsSafeAction({
        from_email: fromEmail,
        from_name: fromName || undefined,
        signature_html: signature || undefined,
      });
      if (!r.ok) {
        if (r.partial) {
          notify.warning("Guardado parcial", r.error);
        } else {
          notify.error("Error", r.error);
        }
        return;
      }
      notify.success("Configuración guardada");
    });
  }

  return (
    <div className="space-y-4">
      {!domainVerified && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠ El admin aún no ha verificado un dominio en{" "}
          <a href="/configuracion/mailing" className="font-bold underline">
            /configuracion/mailing
          </a>
          . Hasta que se verifique, los emails que envíes pueden ir a spam.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Tu email empresa *
          </Label>
          <Input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value.toLowerCase())}
            placeholder="maria@aguasl.com"
          />
          <p className="text-xs text-muted-foreground">
            Debe pertenecer al dominio verificado por el admin.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Nombre que aparece como remitente</Label>
          <Input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="María García"
          />
          <p className="text-xs text-muted-foreground">
            Lo verá el cliente en su bandeja.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Firma del email (HTML)</Label>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={generateSignature}
            disabled={pending}
          >
            <Sparkles className="h-3.5 w-3.5" /> Generar firma
          </Button>
        </div>
        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-border bg-card p-3 text-xs font-mono"
          placeholder="HTML de tu firma. Pulsa 'Generar firma' para crear una básica."
        />
        {signature && (
          <div className="mt-2 rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
              Vista previa
            </div>
            <div
              className="text-sm"
              dangerouslySetInnerHTML={{ __html: signature }}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
