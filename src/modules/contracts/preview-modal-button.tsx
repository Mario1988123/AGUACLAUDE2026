"use client";

import { useState } from "react";
import { FileText, X, Printer } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface Clause {
  title: string;
  body: string;
  display_order: number;
}

interface PreviewItem {
  product_name_snapshot: string;
  quantity: number;
  unit_price_cents: number;
}

interface PreviewPayment {
  concept: string;
  amount_cents: number;
  method: string;
  moment: string;
}

interface PreviewSignature {
  signer_role: "representative" | "customer";
  signer_name: string;
  signer_tax_id: string | null;
  signature_data_url: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};

const MOMENT_LABEL: Record<string, string> = {
  on_signature: "A la firma",
  on_installation: "En la instalación",
  intermediate: "Intermedio",
  periodic: "Periódico",
};

function fmtEur(c: number | null) {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function ContractPreviewButton({
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
}: {
  contractRef: string;
  customerName: string;
  customerTaxId: string | null;
  planLabel: string;
  durationMonths: number | null;
  totalCash: number | null;
  monthly: number | null;
  items: PreviewItem[];
  payments: PreviewPayment[];
  clauses: Clause[];
  signatures: PreviewSignature[];
  companyIban: string | null;
  companyName: string | null;
  preferredSlotLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const repSig = signatures.find((s) => s.signer_role === "representative");
  const custSig = signatures.find((s) => s.signer_role === "customer");
  const hasTransfer = payments.some((p) => p.method === "transfer");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileText className="h-4 w-4" /> Ver contrato
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-0 sm:items-center sm:p-6 print:p-0"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white shadow-2xl sm:my-6 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl print:max-h-none print:overflow-visible print:shadow-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b p-3 print:hidden">
              <h2 className="text-base font-bold">Vista previa del contrato</h2>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="h-3 w-3" /> Imprimir
                </Button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 hover:bg-muted"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-8 text-sm text-slate-900 print:overflow-visible">
              {/* Cabecera */}
              <div className="border-b pb-4 text-center">
                <h1 className="text-2xl font-extrabold uppercase tracking-wide text-primary">
                  Contrato de servicios
                </h1>
                <p className="mt-1 text-xs text-slate-600">
                  Nº {contractRef} · Fecha: {today}
                </p>
              </div>

              {/* Partes */}
              <div className="space-y-1">
                <p className="font-semibold">Reunidos:</p>
                <p>
                  De una parte, <strong>{companyName ?? "[Empresa]"}</strong> (en adelante,
                  «la Empresa»).
                </p>
                <p>
                  De otra, <strong>{customerName}</strong>
                  {customerTaxId ? ` con DNI/CIF ${customerTaxId}` : ""} (en adelante,
                  «el Cliente»).
                </p>
              </div>

              {/* Objeto */}
              <div className="space-y-2">
                <h3 className="font-bold uppercase tracking-wide">1. Objeto del contrato</h3>
                <p>
                  Plan contratado: <strong>{planLabel}</strong>
                  {durationMonths ? ` · ${durationMonths} meses` : ""}.
                </p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-xs uppercase">
                      <th className="py-1">Producto</th>
                      <th className="py-1 text-right">Cant.</th>
                      <th className="py-1 text-right">Precio</th>
                      <th className="py-1 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="border-b border-slate-200">
                        <td className="py-1">{it.product_name_snapshot}</td>
                        <td className="py-1 text-right tabular-nums">{it.quantity}</td>
                        <td className="py-1 text-right tabular-nums">{fmtEur(it.unit_price_cents)}</td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtEur(it.unit_price_cents * it.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td colSpan={3} className="py-2 text-right">
                        {monthly ? "Cuota mensual" : "Total contado"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmtEur(monthly ?? totalCash)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Pagos */}
              {payments.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold uppercase tracking-wide">2. Pagos</h3>
                  <ul className="list-disc space-y-1 pl-5">
                    {payments.map((p, i) => (
                      <li key={i}>
                        <strong>{p.concept}:</strong> {fmtEur(p.amount_cents)} ·{" "}
                        {METHOD_LABEL[p.method] ?? p.method} · {MOMENT_LABEL[p.moment] ?? p.moment}
                      </li>
                    ))}
                  </ul>
                  {hasTransfer && companyIban && (
                    <div className="mt-2 rounded border border-slate-300 bg-slate-50 p-2 text-xs">
                      <strong>Para los pagos por transferencia:</strong>
                      <br />
                      IBAN: <code className="font-mono">{companyIban}</code>
                      {companyName && <> · Titular: {companyName}</>}
                    </div>
                  )}
                </div>
              )}

              {/* Preferencia horaria */}
              {preferredSlotLabel && (
                <div className="space-y-1">
                  <h3 className="font-bold uppercase tracking-wide">
                    3. Preferencia horaria de instalación
                  </h3>
                  <p>{preferredSlotLabel}</p>
                </div>
              )}

              {/* Cláusulas */}
              {clauses.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-bold uppercase tracking-wide">Cláusulas</h3>
                  {clauses
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((cl, i) => (
                      <div key={i} className="space-y-1">
                        <h4 className="font-semibold">
                          {i + 1}. {cl.title}
                        </h4>
                        <p className="whitespace-pre-wrap text-justify text-xs leading-relaxed text-slate-700">
                          {cl.body}
                        </p>
                      </div>
                    ))}
                </div>
              )}

              {/* Firmas */}
              <div className="grid gap-6 border-t pt-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase">La Empresa</p>
                  <div className="flex h-24 items-center justify-center rounded border border-slate-300 bg-slate-50">
                    {repSig?.signature_data_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={repSig.signature_data_url}
                        alt="Firma empresa"
                        className="max-h-20"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">— pendiente —</span>
                    )}
                  </div>
                  <p className="text-xs">
                    {repSig?.signer_name ?? "_____________________"}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase">El Cliente</p>
                  <div className="flex h-24 items-center justify-center rounded border border-slate-300 bg-slate-50">
                    {custSig?.signature_data_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={custSig.signature_data_url}
                        alt="Firma cliente"
                        className="max-h-20"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">— pendiente —</span>
                    )}
                  </div>
                  <p className="text-xs">
                    {custSig?.signer_name ?? customerName}
                    {(custSig?.signer_tax_id ?? customerTaxId) && (
                      <>
                        {" "}
                        · DNI {custSig?.signer_tax_id ?? customerTaxId}
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
