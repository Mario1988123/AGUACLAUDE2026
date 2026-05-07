"use client";

import { useState } from "react";
import { Sparkles, X, ArrowLeft, ArrowRight, CheckCircle2, Coins, PenLine, Calendar, FileText } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { InstallPreference } from "./install-preference";
import { SignaturesCard } from "./signature-pad";
import { CollectInline } from "./quick-collect-inline";
import type { ContractSignature } from "./signatures-actions";

interface PaymentRow {
  id: string;
  concept: string;
  amount_cents: number;
  method: string;
  moment: string;
  status: string;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  collected_pending_validation: "Cobrado · pdte. validar",
  validated: "Validado",
};

function fmtEur(c: number | null) {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

interface PreviewBag {
  contractRef: string;
  customerName: string;
  customerTaxId: string | null;
  planLabel: string;
  durationMonths: number | null;
  totalCash: number | null;
  monthly: number | null;
  items: Array<{ product_name_snapshot: string; quantity: number; unit_price_cents: number }>;
  payments: PaymentRow[];
  clauses: Array<{ title: string; body: string; display_order: number }>;
  signatures: ContractSignature[];
  companyIban: string | null;
  companyName: string | null;
  preferredSlotLabel: string | null;
}

export function ContractCompleteWizard({
  contractId,
  payments,
  signatures,
  initialPreference,
  defaultRepresentativeName,
  defaultCustomerName,
  defaultCustomerTaxId,
  preview,
  canEdit,
  canEditCollectedPayments = false,
}: {
  contractId: string;
  payments: PaymentRow[];
  signatures: ContractSignature[];
  initialPreference: {
    slot: "morning" | "afternoon" | "any" | "custom" | null;
    notes: string | null;
    days_of_week: number[] | null;
    dates: string[] | null;
  };
  defaultRepresentativeName?: string;
  defaultCustomerName?: string;
  defaultCustomerTaxId?: string | null;
  preview: PreviewBag;
  canEdit: boolean;
  canEditCollectedPayments?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [showPreview, setShowPreview] = useState(false);

  const STEPS = [
    { n: 1, label: "Cobros", icon: Coins },
    { n: 2, label: "Preferencia", icon: Calendar },
    { n: 3, label: "Firmas", icon: PenLine },
    { n: 4, label: "Resumen", icon: CheckCircle2 },
  ] as const;

  function reset() {
    setOpen(false);
    setStep(1);
    setShowPreview(false);
  }

  const repSig = signatures.find((s) => s.signer_role === "representative");
  const custSig = signatures.find((s) => s.signer_role === "customer");
  const allCollected = payments.every((p) => p.status !== "pending");
  const allSigned = Boolean(repSig && custSig);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="success"
        className="gap-2"
        disabled={!canEdit}
      >
        <Sparkles className="h-4 w-4" /> Completar contrato
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6"
          onClick={reset}
        >
          <div
            className="my-4 flex w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-base font-bold">Completar contrato</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowPreview(true)}>
                  <FileText className="h-3 w-3" /> Ver contrato
                </Button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full p-2 hover:bg-muted"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Stepper */}
            <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const active = step === s.n;
                const done = step > s.n;
                return (
                  <div key={s.n} className="flex flex-1 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(s.n)}
                      className={`flex flex-1 items-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-bold transition ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : done
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{s.n}. {s.label}</span>
                      <span className="sm:hidden">{s.n}</span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className="hidden h-0.5 w-3 bg-border sm:block" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Body */}
            <div className="max-h-[65vh] flex-1 overflow-y-auto p-4">
              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Marca el momento y el método de cobro de cada línea. Cada concepto es
                    independiente: el equipo, la instalación, la fianza o la cuota se
                    pueden cobrar en momentos y con métodos distintos.
                  </p>
                  {payments.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Sin pagos definidos.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {payments.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-xl border-2 border-border bg-card p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-bold">{p.concept}</div>
                              <div className="text-xs text-muted-foreground">
                                {fmtEur(p.amount_cents)} ·{" "}
                                {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                              </div>
                            </div>
                            <Badge variant={p.status === "validated" ? "success" : "secondary"}>
                              {STATUS_LABEL[p.status] ?? p.status}
                            </Badge>
                          </div>
                          <div className="mt-3">
                            <CollectInline
                              paymentId={p.id}
                              status={p.status}
                              defaultMethod={p.method}
                              amountLabel={fmtEur(p.amount_cents)}
                              canEditAfterCollect={canEditCollectedPayments}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Indica al cliente qué franja, días o fechas concretas le vienen mejor
                    para la instalación. Es informativo y ayuda al técnico al agendar.
                  </p>
                  <InstallPreference
                    contractId={contractId}
                    initialSlot={initialPreference.slot}
                    initialNotes={initialPreference.notes}
                    initialDaysOfWeek={initialPreference.days_of_week}
                    initialDates={initialPreference.dates}
                    canEdit={canEdit}
                  />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Cada firma se valida por separado. Una vez validada, el lienzo se
                    cierra y aparece la imagen guardada con badge «Validada». Puedes
                    re-firmar si fuera necesario.
                  </p>
                  <SignaturesCard
                    contractId={contractId}
                    signatures={signatures}
                    defaultRepresentativeName={defaultRepresentativeName}
                    defaultCustomerName={defaultCustomerName}
                    defaultCustomerTaxId={defaultCustomerTaxId}
                  />
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3">
                  <h3 className="font-bold">Resumen del contrato</h3>
                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center justify-between rounded-xl border border-border p-3">
                      <span>
                        <Coins className="mr-1 inline h-4 w-4" /> Cobros
                      </span>
                      {allCollected ? (
                        <Badge variant="success">Todos completados</Badge>
                      ) : (
                        <Badge variant="warning">
                          {payments.filter((p) => p.status === "pending").length} pendientes
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-border p-3">
                      <span>
                        <PenLine className="mr-1 inline h-4 w-4" /> Firmas
                      </span>
                      {allSigned ? (
                        <Badge variant="success">Las dos firmadas</Badge>
                      ) : (
                        <Badge variant="warning">
                          {(repSig ? 0 : 1) + (custSig ? 0 : 1)} pendientes
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button onClick={() => setShowPreview(true)} className="w-full" variant="outline">
                    <FileText className="h-4 w-4" /> Ver contrato completo
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Cuando esté todo listo, cierra este modal y pulsa «Marcar firmado» en
                    el bloque de Estado.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t p-4">
              <Button
                variant="outline"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                disabled={step === 1}
              >
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
              <span className="text-xs text-muted-foreground">Paso {step} de 4</span>
              {step < 4 ? (
                <Button onClick={() => setStep((s) => ((s + 1) as 2 | 3 | 4))}>
                  Siguiente <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={reset} variant="success">
                  Cerrar
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {showPreview && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-2 sm:p-6"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="my-6 w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="text-base font-bold">Vista previa del contrato</h3>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PreviewBody {...preview} />
          </div>
        </div>
      )}
    </>
  );
}

function PreviewBody({
  contractRef,
  customerName,
  customerTaxId,
  planLabel,
  durationMonths,
  totalCash,
  monthly,
  items,
  payments,
  clauses,
  signatures,
  companyIban,
  companyName,
  preferredSlotLabel,
}: PreviewBag) {
  const today = new Date().toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const repSig = signatures.find((s) => s.signer_role === "representative");
  const custSig = signatures.find((s) => s.signer_role === "customer");
  const hasTransfer = payments.some((p) => p.method === "transfer");

  return (
    <div className="space-y-5 p-6 text-sm text-slate-900">
      <div className="border-b pb-3 text-center">
        <h1 className="text-xl font-extrabold uppercase tracking-wide text-primary">
          Contrato de servicios
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Nº {contractRef} · Fecha: {today}
        </p>
      </div>
      <div className="space-y-1">
        <p>
          De una parte, <strong>{companyName ?? "[Empresa]"}</strong> («la Empresa»).
        </p>
        <p>
          De otra, <strong>{customerName}</strong>
          {customerTaxId ? ` con DNI/CIF ${customerTaxId}` : ""} («el Cliente»).
        </p>
      </div>
      <div className="space-y-2">
        <h3 className="font-bold">1. Objeto</h3>
        <p>
          Plan: <strong>{planLabel}</strong>
          {durationMonths ? ` · ${durationMonths} meses` : ""}.
        </p>
        <table className="w-full border-separate border-spacing-x-3 border-spacing-y-1">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase">
              <th className="px-2 py-1">Producto</th>
              <th className="px-2 py-1 text-right">Cant.</th>
              <th className="px-2 py-1 text-right">Precio</th>
              <th className="px-2 py-1 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="px-2 py-1">{it.product_name_snapshot}</td>
                <td className="px-2 py-1 text-right tabular-nums">{it.quantity}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtEur(it.unit_price_cents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {fmtEur(it.unit_price_cents * it.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={3} className="px-2 py-1 text-right">
                Total
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtEur(monthly ?? totalCash)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {payments.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-bold">2. Pagos</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {payments.map((p, i) => (
              <li key={i}>
                <strong>{p.concept}:</strong> {fmtEur(p.amount_cents)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
              </li>
            ))}
          </ul>
          {hasTransfer && companyIban && (
            <div className="mt-2 rounded border border-slate-300 bg-slate-50 p-2 text-xs">
              <strong>Transferencias:</strong> IBAN <code>{companyIban}</code>
            </div>
          )}
        </div>
      )}
      {preferredSlotLabel && (
        <div className="space-y-1">
          <h3 className="font-bold">3. Preferencia horaria</h3>
          <p className="text-xs">{preferredSlotLabel}</p>
        </div>
      )}
      {clauses.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold">Cláusulas</h3>
          {clauses
            .sort((a, b) => a.display_order - b.display_order)
            .map((cl, i) => (
              <div key={i}>
                <h4 className="text-sm font-semibold">
                  {i + 1}. {cl.title}
                </h4>
                <p className="whitespace-pre-wrap text-justify text-xs leading-relaxed text-slate-700">
                  {cl.body}
                </p>
              </div>
            ))}
        </div>
      )}
      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold">La Empresa</p>
          <div className="flex h-20 items-center justify-center rounded border border-slate-300 bg-slate-50">
            {repSig?.signature_data_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={repSig.signature_data_url} alt="Firma empresa" className="max-h-16" />
            ) : (
              <span className="text-xs text-slate-400">— pendiente —</span>
            )}
          </div>
          <p className="text-xs">{repSig?.signer_name ?? "____________________"}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold">El Cliente</p>
          <div className="flex h-20 items-center justify-center rounded border border-slate-300 bg-slate-50">
            {custSig?.signature_data_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={custSig.signature_data_url} alt="Firma cliente" className="max-h-16" />
            ) : (
              <span className="text-xs text-slate-400">— pendiente —</span>
            )}
          </div>
          <p className="text-xs">
            {custSig?.signer_name ?? customerName}
            {(custSig?.signer_tax_id ?? customerTaxId) && ` · DNI ${custSig?.signer_tax_id ?? customerTaxId}`}
          </p>
        </div>
      </div>
    </div>
  );
}
