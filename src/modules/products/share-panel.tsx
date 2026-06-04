"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  createProductDatasheetShareAction,
  revokeProductShareAction,
  type ProductShareItem,
} from "./share-actions";
import { sendProductDatasheetEmailAction } from "./email-share-actions";

interface Props {
  productId: string;
  initialShares: ProductShareItem[];
  /** Base absoluta para reconstruir URLs públicas en el cliente. */
  publicBaseUrl: string;
}

function buildPublicUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, "")}/datasheet/${token}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Sin caducidad";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Panel de "Compartir ficha técnica" en la ficha del producto.
 * Lo ve solo admin (la página padre se encarga de mostrarlo o no).
 */
export function ShareDatasheetPanel({
  productId,
  initialShares,
  publicBaseUrl,
}: Props) {
  const [shares, setShares] = useState<ProductShareItem[]>(initialShares);
  const [pending, startTransition] = useTransition();

  // Modal envío email
  const [modalOpen, setModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [reuseShareId, setReuseShareId] = useState<string | null>(null);

  function handleCreateShare() {
    startTransition(async () => {
      const r = await createProductDatasheetShareAction({ productId });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setShares((curr) => [r.share, ...curr]);
      try {
        await navigator.clipboard.writeText(r.public_url);
        notify.success("URL creada y copiada", "Ya puedes pegarla donde quieras.");
      } catch {
        notify.success("URL creada", r.public_url);
      }
    });
  }

  function handleRevoke(shareId: string) {
    if (!confirm("¿Revocar este enlace público? Después de revocar dejará de funcionar.")) return;
    startTransition(async () => {
      const r = await revokeProductShareAction(shareId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setShares((curr) => curr.filter((s) => s.id !== shareId));
      notify.success("Enlace revocado");
    });
  }

  function handleCopy(token: string) {
    const url = buildPublicUrl(publicBaseUrl, token);
    navigator.clipboard
      .writeText(url)
      .then(() => notify.success("URL copiada", url))
      .catch(() => notify.error("No se pudo copiar", url));
  }

  function handleSendEmail() {
    if (!recipientEmail.trim()) {
      notify.error("Falta el email del destinatario");
      return;
    }
    startTransition(async () => {
      const r = await sendProductDatasheetEmailAction({
        productId,
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        customMessage: customMessage.trim() || undefined,
        reuseShareId: reuseShareId,
      });
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success(
        "Email enviado",
        `Ficha técnica enviada a ${recipientEmail.trim()}.`,
      );
      setModalOpen(false);
      setRecipientEmail("");
      setRecipientName("");
      setCustomMessage("");
      setReuseShareId(null);
    });
  }

  const activeShares = shares.filter(
    (s) =>
      !s.revoked_at &&
      (!s.expires_at || new Date(s.expires_at).getTime() > Date.now()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleCreateShare} disabled={pending}>
          {pending ? "Creando..." : "Crear URL pública"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setModalOpen(true)}
          disabled={pending}
        >
          📧 Enviar por email
        </Button>
        <span className="text-xs text-muted-foreground">
          Caducidad por defecto 60 días · El destinatario verá la ficha sin
          tener que iniciar sesión.
        </span>
      </div>

      {activeShares.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Enlaces activos
          </h4>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {activeShares.map((s) => {
              const url = buildPublicUrl(publicBaseUrl, s.share_token);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {url}
                  </code>
                  <span className="text-[11px] text-muted-foreground">
                    {s.view_count} vistas · {formatDate(s.expires_at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(s.share_token)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Copiar
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Abrir
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setReuseShareId(s.id);
                      setModalOpen(true);
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(s.id)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Revocar
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Modal envío email */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-bold">Enviar ficha técnica</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="r_email">Email del destinatario *</Label>
                <Input
                  id="r_email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="cliente@ejemplo.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r_name">Nombre (opcional)</Label>
                <Input
                  id="r_name"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Juan Pérez"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="r_msg">Mensaje personalizado (opcional)</Label>
                <textarea
                  id="r_msg"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  className="min-h-[80px] w-full rounded-xl border border-input bg-background p-3 text-sm"
                  placeholder="Si lo dejas en blanco se usa la plantilla por defecto."
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                El email lleva adjunto el PDF de la ficha y un enlace público
                que el destinatario puede consultar online durante 60 días.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setModalOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={handleSendEmail} disabled={pending}>
                {pending ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
