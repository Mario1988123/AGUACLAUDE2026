"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  createCatalogShareAction,
  sendCatalogEmailAction,
} from "./catalog-actions";
import type { CatalogPricingVisibility } from "./catalog-pdf-v2";

interface Props {
  open: boolean;
  onClose: () => void;
  productIds: string[];
}

type Mode = "config" | "preview" | "email" | "done";

/**
 * Modal de configuración del catálogo:
 *   1) Configurar título, precios visibles, branding.
 *   2) Crear URL pública (opcionalmente enviar por email).
 *
 * Patrón: lectura llano para Mario:
 *   - "Catálogo" = un documento PDF con varios productos seleccionados.
 *   - "URL pública" = enlace web sin login.
 */
export function CatalogModal({ open, onClose, productIds }: Props) {
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [showBranding, setShowBranding] = useState(true);
  const [showContact, setShowContact] = useState(true);
  const [pricing, setPricing] = useState<CatalogPricingVisibility>({
    cash_individual: true,
    cash_business: false,
    renting_24: false,
    renting_36: false,
    renting_48: false,
    renting_60: false,
    rental: false,
  });
  const [noExpiry, setNoExpiry] = useState(false);

  // Estados de flujo
  const [mode, setMode] = useState<Mode>("config");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);

  // Para sub-modal envío por email
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [customMessage, setCustomMessage] = useState("");

  const [pending, startTransition] = useTransition();

  if (!open) return null;

  function togglePrice(key: keyof CatalogPricingVisibility) {
    setPricing((p) => ({ ...p, [key]: !p[key] }));
  }

  function close() {
    setMode("config");
    setPublicUrl(null);
    setShareId(null);
    setRecipientEmail("");
    setRecipientName("");
    setCustomMessage("");
    onClose();
  }

  function handleCreate() {
    if (productIds.length === 0) {
      notify.error("Selecciona al menos un producto");
      return;
    }
    startTransition(async () => {
      const r = await createCatalogShareAction({
        productIds,
        pricingVisibility: pricing,
        customTitle: title.trim() || undefined,
        customIntro: intro.trim() || undefined,
        showBranding,
        showContact,
        noExpiry,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setPublicUrl(r.public_url);
      setShareId(r.share.id);
      setMode("preview");
      try {
        await navigator.clipboard.writeText(r.public_url);
        notify.success("URL creada y copiada");
      } catch {
        notify.success("URL creada", r.public_url);
      }
    });
  }

  function handleSendEmail() {
    if (!recipientEmail.trim()) {
      notify.error("Falta el email del destinatario");
      return;
    }
    if (!shareId) {
      notify.error("Crea primero la URL pública");
      return;
    }
    startTransition(async () => {
      const r = await sendCatalogEmailAction({
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        customMessage: customMessage.trim() || undefined,
        reuseShareId: shareId,
      });
      if (!r.ok) {
        notify.error("No se pudo enviar", r.error);
        return;
      }
      notify.success(
        "Catálogo enviado",
        `Email con el enlace del catálogo enviado a ${recipientEmail.trim()}.`,
      );
      setMode("done");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">
              {mode === "config" && "Generar catálogo de productos"}
              {mode === "preview" && "Catálogo creado"}
              {mode === "email" && "Enviar catálogo por email"}
              {mode === "done" && "Listo"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {productIds.length} {productIds.length === 1 ? "producto" : "productos"} en el catálogo
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-2xl leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>

        {/* === Paso 1: configuración === */}
        {mode === "config" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="cat_title">Título (opcional)</Label>
              <Input
                id="cat_title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Catálogo Junio 2026"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat_intro">Mensaje en portada (opcional)</Label>
              <textarea
                id="cat_intro"
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                className="min-h-[60px] w-full rounded-xl border border-input bg-background p-3 text-sm"
                placeholder="Una breve presentación que verá el destinatario."
              />
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Qué precios mostrar
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <PriceCheck
                  label="Particular (con IVA)"
                  checked={!!pricing.cash_individual}
                  onChange={() => togglePrice("cash_individual")}
                />
                <PriceCheck
                  label="Empresa (base imponible)"
                  checked={!!pricing.cash_business}
                  onChange={() => togglePrice("cash_business")}
                />
                <PriceCheck
                  label="Renting 24 meses"
                  checked={!!pricing.renting_24}
                  onChange={() => togglePrice("renting_24")}
                />
                <PriceCheck
                  label="Renting 36 meses"
                  checked={!!pricing.renting_36}
                  onChange={() => togglePrice("renting_36")}
                />
                <PriceCheck
                  label="Renting 48 meses"
                  checked={!!pricing.renting_48}
                  onChange={() => togglePrice("renting_48")}
                />
                <PriceCheck
                  label="Renting 60 meses"
                  checked={!!pricing.renting_60}
                  onChange={() => togglePrice("renting_60")}
                />
                <PriceCheck
                  label="Alquiler mensual"
                  checked={!!pricing.rental}
                  onChange={() => togglePrice("rental")}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Si no marcas ninguno, el catálogo sale sin precios (solo
                información comercial). Si marcas varios, aparecerán todos.
              </p>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Branding
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showBranding}
                  onChange={(e) => setShowBranding(e.target.checked)}
                />
                Mostrar logo de la empresa
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showContact}
                  onChange={(e) => setShowContact(e.target.checked)}
                />
                Mostrar email y teléfono en el pie
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(e) => setNoExpiry(e.target.checked)}
                />
                Enlace sin caducidad (por defecto caduca a los 60 días)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={pending}>
                {pending ? "Creando..." : "Crear URL pública"}
              </Button>
            </div>
          </div>
        )}

        {/* === Paso 2: preview con URL === */}
        {mode === "preview" && publicUrl && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-green-50 p-4 text-sm text-green-900">
              ✓ URL pública creada y copiada al portapapeles.
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Enlace del catálogo
              </div>
              <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                {publicUrl}
              </code>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(publicUrl)
                    .then(() => notify.success("URL copiada"))
                    .catch(() => notify.error("No se pudo copiar"))
                }
              >
                Copiar
              </Button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted"
              >
                Abrir
              </a>
              <a
                href={`/api/pdf/catalog-v2/${publicUrl.split("/").pop()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted"
              >
                Descargar PDF
              </a>
              <Button onClick={() => setMode("email")}>
                Enviar por email
              </Button>
              <Button variant="outline" onClick={close}>
                Cerrar
              </Button>
            </div>
          </div>
        )}

        {/* === Paso 3: envío email === */}
        {mode === "email" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rem_email">Email del destinatario *</Label>
              <Input
                id="rem_email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="cliente@ejemplo.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rem_name">Nombre (opcional)</Label>
              <Input
                id="rem_name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Juan Pérez"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rem_msg">Mensaje personalizado (opcional)</Label>
              <textarea
                id="rem_msg"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="min-h-[80px] w-full rounded-xl border border-input bg-background p-3 text-sm"
                placeholder="Si lo dejas en blanco se usa la plantilla por defecto."
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              El email llevará solo el enlace al catálogo online (sin PDF
              adjunto). Así no saturamos el correo del destinatario.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setMode("preview")}
                disabled={pending}
              >
                Volver
              </Button>
              <Button onClick={handleSendEmail} disabled={pending}>
                {pending ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>
        )}

        {/* === Paso 4: done === */}
        {mode === "done" && (
          <div className="space-y-4 text-center">
            <div className="text-5xl">📬</div>
            <p className="text-sm">
              Email enviado correctamente. Puedes seguir trabajando.
            </p>
            <Button onClick={close}>Cerrar</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PriceCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
