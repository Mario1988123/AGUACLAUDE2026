"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createExpenseAction, uploadAndOcrReceiptAction, type OcrResultLite } from "./actions";

interface CategoryLite {
  id: string;
  code: string;
  name: string;
  group_code: string;
  vat_deductible: boolean;
  requires_client_link: boolean;
  irpf_exempt_logic: string | null;
}

interface CustomerOption {
  id: string;
  label: string;
}

const PAYMENT_METHODS = [
  { value: "corp_card", label: "Tarjeta empresa" },
  { value: "personal", label: "Dinero propio (reembolso)" },
  { value: "cash", label: "Efectivo empresa" },
] as const;

export function NewExpenseForm({
  categories,
  customers,
  ocrEnabled,
}: {
  categories: CategoryLite[];
  customers: CustomerOption[];
  ocrEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [ocr, setOcr] = useState<OcrResultLite | null>(null);

  const [form, setForm] = useState({
    category_code: "",
    payment_method: "personal" as "corp_card" | "personal" | "cash",
    corp_card_last4: "",
    customer_id: "",
    merchant_name: "",
    merchant_nif: "",
    issue_date: new Date().toISOString().slice(0, 10),
    document_type: "ticket_simple" as "ticket_simple" | "invoice_simple_qualified" | "invoice_full",
    document_number: "",
    total_eur: "",
    base_eur: "",
    vat_eur: "",
    notes: "",
  });

  function applyOcrToForm(o: OcrResultLite) {
    setOcr(o);
    setForm((f) => ({
      ...f,
      merchant_name: o.supplier_name ?? f.merchant_name,
      merchant_nif: o.supplier_nif ?? f.merchant_nif,
      issue_date: o.date ?? f.issue_date,
      document_number: o.receipt_number ?? f.document_number,
      total_eur: o.total_amount != null ? o.total_amount.toFixed(2) : f.total_eur,
      base_eur: o.total_net != null ? o.total_net.toFixed(2) : f.base_eur,
      vat_eur: o.total_tax != null ? o.total_tax.toFixed(2) : f.vat_eur,
      category_code: o.category_code ?? f.category_code,
    }));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    (async () => {
      try {
        const result = await uploadAndOcrReceiptAction(fd);
        applyOcrToForm(result);
        notify.success(
          ocrEnabled ? "Ticket leído por OCR · revisa los datos" : "Ticket subido",
        );
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    })();
    e.target.value = "";
  }

  function submit() {
    const totalCents = Math.round(Number(form.total_eur.replace(",", ".")) * 100);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      notify.warning("Importe inválido");
      return;
    }
    if (!form.category_code) {
      notify.warning("Selecciona la categoría");
      return;
    }
    const cat = categories.find((c) => c.code === form.category_code);
    if (cat?.requires_client_link && !form.customer_id) {
      notify.warning(
        "Esta categoría requiere asociar a un cliente",
        "Ej. comidas con cliente o atenciones.",
      );
      return;
    }
    if (form.payment_method === "corp_card" && form.corp_card_last4.length !== 4) {
      notify.warning("Indica los últimos 4 dígitos de la tarjeta");
      return;
    }
    const baseCents = form.base_eur
      ? Math.round(Number(form.base_eur.replace(",", ".")) * 100)
      : null;
    const vatCents = form.vat_eur
      ? Math.round(Number(form.vat_eur.replace(",", ".")) * 100)
      : null;
    startTransition(async () => {
      try {
        const r = await createExpenseAction({
          category_code: form.category_code,
          payment_method: form.payment_method,
          corp_card_last4:
            form.payment_method === "corp_card" ? form.corp_card_last4 : null,
          customer_id: form.customer_id || null,
          merchant_name: form.merchant_name || null,
          merchant_nif: form.merchant_nif || null,
          issue_date: form.issue_date,
          document_type: form.document_type,
          document_number: form.document_number || null,
          total_cents: totalCents,
          base_cents: baseCents,
          vat_cents: vatCents,
          vat_breakdown: ocr?.taxes
            ? ocr.taxes.map((t) => ({
                rate: t.rate,
                base: t.base ?? null,
                amount: Math.round(t.amount * 100) / 100,
              }))
            : null,
          notes: form.notes || null,
          receipt_storage_path: ocr?.storage_path ?? null,
          receipt_mime: ocr?.mime_type ?? null,
          ocr_provider: ocr?.raw ? "mindee" : null,
          ocr_raw: ocr?.raw ?? null,
          ocr_confidence: ocr?.confidence ?? null,
        });
        notify.success("Gasto enviado para aprobación");
        router.push(`/gastos/${r.id}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const selectedCat = categories.find((c) => c.code === form.category_code);
  const documentTypeOptions = [
    { value: "ticket_simple", label: "Ticket simplificado" },
    { value: "invoice_simple_qualified", label: "Factura simplificada con NIF" },
    { value: "invoice_full", label: "Factura completa" },
  ];

  // Aviso compliance: ticket > 400€ no deducible salvo factura
  const totalEur = Number(form.total_eur.replace(",", "."));
  const showNonDeductibleWarning =
    Number.isFinite(totalEur) &&
    totalEur > 400 &&
    form.document_type === "ticket_simple";

  return (
    <div className="space-y-4">
      {/* Subida ticket */}
      <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
        <Label className="font-bold">1. Foto del ticket</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {ocrEnabled
            ? "Sube el ticket y rellenamos los datos automáticamente."
            : "OCR no configurado. El ticket se guarda como adjunto y rellenas tú los datos."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 cursor-pointer">
            <Camera className="h-4 w-4" />
            <span>Hacer foto</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold cursor-pointer hover:bg-muted">
            <Upload className="h-4 w-4" />
            <span>Subir archivo</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={onFile}
              disabled={uploading}
              className="hidden"
            />
          </label>
          {uploading && <Loader2 className="h-5 w-5 animate-spin self-center" />}
        </div>
        {ocr && (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Ticket subido
              {ocr.confidence > 0 && (
                <span className="text-xs">
                  · OCR confianza {Math.round(ocr.confidence * 100)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-xs">Revisa los campos y corrige si es necesario.</p>
          </div>
        )}
      </div>

      {/* Categoría + cliente */}
      <div className="grid gap-3">
        <div className="space-y-1">
          <Label>2. Categoría *</Label>
          <select
            value={form.category_code}
            onChange={(e) => setForm({ ...form, category_code: e.target.value })}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Elige categoría…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCat && !selectedCat.vat_deductible && (
            <p className="text-xs text-amber-700">
              ⚠ El IVA de esta categoría no es deducible (típico de comidas con clientes).
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label>
            Cliente asociado{selectedCat?.requires_client_link ? " *" : " (opcional)"}
          </Label>
          <select
            value={form.customer_id}
            onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">— Ninguno —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pago */}
      <div className="grid gap-3">
        <div className="space-y-1">
          <Label>3. Forma de pago *</Label>
          <div className="grid gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setForm({ ...form, payment_method: m.value })}
                className={`rounded-xl border-2 p-3 text-left text-sm font-bold ${
                  form.payment_method === m.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {form.payment_method === "corp_card" && (
          <div className="space-y-1">
            <Label>Últimos 4 dígitos tarjeta *</Label>
            <Input
              maxLength={4}
              inputMode="numeric"
              value={form.corp_card_last4}
              onChange={(e) =>
                setForm({ ...form, corp_card_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
              }
            />
          </div>
        )}
      </div>

      {/* Datos del ticket */}
      <div className="grid gap-3">
        <div className="space-y-1">
          <Label>4. Establecimiento</Label>
          <Input
            value={form.merchant_name}
            onChange={(e) => setForm({ ...form, merchant_name: e.target.value })}
            placeholder="Restaurante Casa Pepe"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>NIF/CIF emisor</Label>
            <Input
              value={form.merchant_nif}
              onChange={(e) => setForm({ ...form, merchant_nif: e.target.value })}
              placeholder="B12345678"
            />
          </div>
          <div className="space-y-1">
            <Label>Fecha *</Label>
            <Input
              type="date"
              value={form.issue_date}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Tipo de documento</Label>
          <select
            value={form.document_type}
            onChange={(e) =>
              setForm({
                ...form,
                document_type: e.target.value as
                  | "ticket_simple"
                  | "invoice_simple_qualified"
                  | "invoice_full",
              })
            }
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            {documentTypeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {showNonDeductibleWarning && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Ticket simplificado &gt; 400€: la AEAT no permite deducir IVA. Pide factura completa
              al establecimiento.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Total € *</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.total_eur}
              onChange={(e) => setForm({ ...form, total_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Base € (opcional)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.base_eur}
              onChange={(e) => setForm({ ...form, base_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>IVA € (opcional)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={form.vat_eur}
              onChange={(e) => setForm({ ...form, vat_eur: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Notas (opcional)</Label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
            placeholder="Comida con cliente Pepe S.L. cierre instalación…"
          />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t bg-card/95 p-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button onClick={submit} disabled={pending || uploading} className="w-full" size="lg">
          {pending ? "Enviando…" : "Enviar gasto para aprobación"}
        </Button>
      </div>
    </div>
  );
}
