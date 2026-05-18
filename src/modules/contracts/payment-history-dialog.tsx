"use client";

import { useEffect, useState } from "react";
import { History, CreditCard, Wallet, Banknote, FileSignature, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Badge } from "@/shared/ui/badge";
import {
  getContractPaymentHistory,
  type PaymentHistoryEntry,
  type PaymentHistoryResult,
} from "./payment-history-actions";

function eur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  collected_pending_validation: "Pdte. validar",
  validated: "Validado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<
  string,
  "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  pending: "warning",
  collected_pending_validation: "secondary",
  validated: "success",
  rejected: "destructive",
  cancelled: "outline",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};

function MethodIcon({ method }: { method: string }) {
  if (method === "cash") return <Banknote className="h-3.5 w-3.5" />;
  if (method === "card") return <CreditCard className="h-3.5 w-3.5" />;
  if (method === "direct_debit" || method === "transfer")
    return <Wallet className="h-3.5 w-3.5" />;
  return <FileSignature className="h-3.5 w-3.5" />;
}

function CategoryBadge({ category }: { category: PaymentHistoryEntry["category"] }) {
  if (category === "fee")
    return <Badge variant="default" className="text-[10px]">Cuota</Badge>;
  if (category === "deposit")
    return <Badge variant="secondary" className="text-[10px]">Fianza</Badge>;
  if (category === "install")
    return <Badge variant="outline" className="text-[10px]">Instalación</Badge>;
  return <Badge variant="outline" className="text-[10px]">Otro</Badge>;
}

export function PaymentHistoryDialog({
  contractId,
  onClose,
}: {
  contractId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<PaymentHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await getContractPaymentHistory(contractId);
      setData(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial de cobros
            {data?.contract_reference && (
              <span className="font-mono text-sm text-muted-foreground">
                · {data.contract_reference}
              </span>
            )}
            {data?.customer_name && (
              <span className="text-sm text-muted-foreground">
                · {data.customer_name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Cargando…
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {data.error ?? "No se pudo cargar el historial"}
          </div>
        )}

        {!loading && data && data.ok && (
          <div className="space-y-4">
            {/* Totales */}
            <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
              <Stat
                label="Cuotas cobradas"
                value={eur(data.totals.fees_collected_cents)}
                tone="success"
              />
              <Stat
                label="Cuotas pendientes"
                value={eur(data.totals.fees_pending_cents)}
                tone={data.totals.fees_pending_cents > 0 ? "warning" : "muted"}
              />
              <Stat
                label="Fianza retenida"
                value={eur(
                  data.totals.deposit_collected_cents -
                    data.totals.deposit_returned_cents,
                )}
                tone="primary"
              />
              <Stat
                label="Total cobrado"
                value={eur(data.totals.total_collected_cents)}
                tone="primary"
              />
            </div>

            {/* Lista de movimientos */}
            {data.entries.length === 0 ? (
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                Aún no hay movimientos para este contrato.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Concepto</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Método</th>
                      <th className="px-3 py-2 text-right">Importe</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.entries.map((e) => (
                      <tr key={e.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {formatDate(e.validated_at ?? e.collected_at ?? e.created_at)}
                        </td>
                        <td className="px-3 py-2">
                          <div>{e.concept}</div>
                          {e.notes && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {e.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <CategoryBadge category={e.category} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 text-xs">
                            <MethodIcon method={e.method} />
                            {METHOD_LABEL[e.method] ?? e.method}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">
                          <span
                            className={
                              e.amount_cents < 0 ? "text-emerald-600" : ""
                            }
                          >
                            {eur(e.amount_cents)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              STATUS_TONE[e.effective_status] ?? "outline"
                            }
                            className="text-[10px]"
                          >
                            {STATUS_LABEL[e.effective_status] ?? e.effective_status}
                          </Badge>
                          {e.status !== e.effective_status && (
                            <div
                              className="mt-0.5 text-[10px] text-muted-foreground"
                              title="Estado real reflejado desde wallet vinculado"
                            >
                              (wallet: {e.wallet_status})
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Histórico cronológico de todos los movimientos del contrato:
              fianzas, cuotas mensuales, devoluciones, retenciones y demás
              cobros. Las cuotas se generan automáticamente el día 1 de cada
              mes (cron) salvo que el contrato esté pausado.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "muted";
}) {
  const cls = {
    primary: "bg-primary/5 text-primary border-primary/20",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    muted: "bg-muted/40 text-muted-foreground border-border",
  }[tone];
  return (
    <div className={`rounded-xl border p-2 ${cls}`}>
      <div className="text-[10px] font-bold uppercase">{label}</div>
      <div className="mt-0.5 text-base font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
