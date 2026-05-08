import { notFound } from "next/navigation";
import {
  getProposal,
  getProposalItems,
  getProposalPaymentOptions,
} from "@/modules/proposals/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/proposals/schemas";
import { ProposalActions } from "@/modules/proposals/actions-panel";
import { requireSession } from "@/shared/lib/auth/session";
import { SendByEmailButton } from "@/modules/mailing/send-by-email-button";
import { BackButton } from "@/shared/components/back-button";
import {
  Banknote,
  Calendar,
  Coins,
  ShieldCheck,
  Wrench,
  Star,
  Download,
} from "lucide-react";

function formatCents(cents: number | null | undefined) {
  if (cents == null || cents === 0) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

const PLAN_LABEL: Record<string, string> = {
  cash: "Pago al contado",
  rental: "Alquiler",
  renting: "Renting",
  financing: "Financiación",
};

const PLAN_COLOR: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  cash: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-900", icon: "text-emerald-600" },
  rental: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-900", icon: "text-blue-600" },
  renting: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-900", icon: "text-violet-600" },
  financing: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", icon: "text-amber-600" },
};

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let proposal;
  try {
    proposal = await getProposal(id);
  } catch {
    notFound();
  }
  const [items, paymentOptions, session] = await Promise.all([
    getProposalItems(id),
    getProposalPaymentOptions(id),
    requireSession(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any;
  const { data: existingContract } = await sb
    .from("contracts")
    .select("id")
    .eq("source_proposal_id", id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const contractId = (existingContract as { id: string } | null)?.id ?? null;

  const canApprove =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold">
              Propuesta {proposal.reference_code ?? "(sin código)"}
            </h1>
            <Badge variant={STATUS_VARIANT[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Para: <strong>{proposal.customer_or_lead_name}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/pdf/proposal/${proposal.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <Download className="h-4 w-4" /> PDF
          </a>
          <SendByEmailButton documentId={proposal.id} kind="proposal" short />
          <BackButton href="/propuestas" />
        </div>
      </div>

      {/* Planes de pago — el corazón de la propuesta */}
      {paymentOptions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paymentOptions.map((opt) => {
            const colors = PLAN_COLOR[opt.plan_type] ?? PLAN_COLOR.cash!;
            const initialPayments: Array<{ label: string; cents: number }> = [];
            if (opt.deposit_cents > 0) {
              initialPayments.push({ label: "Fianza", cents: opt.deposit_cents });
            }
            if (opt.installation_fee_cents > 0) {
              initialPayments.push({
                label: "Instalación",
                cents: opt.installation_fee_cents,
              });
            }
            if (opt.first_payment_cents && opt.first_payment_cents > 0) {
              initialPayments.push({
                label: "1ª cuota al firmar",
                cents: opt.first_payment_cents,
              });
            }
            const initialTotal = initialPayments.reduce((s, p) => s + p.cents, 0);

            return (
              <div
                key={opt.id}
                className={`relative rounded-2xl border-2 p-4 ${colors.bg} ${colors.border}`}
              >
                {opt.is_recommended && (
                  <div className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                    <Star className="h-3 w-3 fill-amber-900" /> Recomendado
                  </div>
                )}

                <div className={`flex items-center gap-2 ${colors.text}`}>
                  {opt.plan_type === "cash" ? (
                    <Banknote className={`h-5 w-5 ${colors.icon}`} />
                  ) : (
                    <Calendar className={`h-5 w-5 ${colors.icon}`} />
                  )}
                  <h3 className="font-bold">{PLAN_LABEL[opt.plan_type] ?? opt.plan_type}</h3>
                </div>

                <div className="mt-3">
                  {opt.plan_type === "cash" ? (
                    <div className={`text-2xl font-bold tabular-nums ${colors.text}`}>
                      {formatCents(opt.total_cents) ?? "—"}
                    </div>
                  ) : (
                    <div className={`text-2xl font-bold tabular-nums ${colors.text}`}>
                      {formatCents(opt.monthly_cents) ?? "—"}
                      <span className="text-sm font-medium">/mes</span>
                    </div>
                  )}
                </div>

                {/* Permanencia / cuotas (sin total acumulado) */}
                {(opt.permanence_months || opt.duration_months) && (
                  <div className={`mt-2 flex items-center gap-1.5 text-xs ${colors.text}`}>
                    <ShieldCheck className={`h-3.5 w-3.5 ${colors.icon}`} />
                    {opt.permanence_months ? (
                      <>Permanencia {opt.permanence_months} meses</>
                    ) : (
                      <>{opt.duration_months} cuotas</>
                    )}
                    {opt.duration_months && opt.permanence_months &&
                      opt.duration_months !== opt.permanence_months && (
                        <span> · {opt.duration_months} cuotas</span>
                      )}
                  </div>
                )}

                {opt.maintenance_included && (
                  <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${colors.text}`}>
                    <Wrench className={`h-3.5 w-3.5 ${colors.icon}`} />
                    Mantenimiento incluido
                    {opt.maintenance_periodicity_months &&
                      ` · cada ${opt.maintenance_periodicity_months} meses`}
                  </div>
                )}

                {/* Pagos al inicio (firma + instalación) */}
                {initialPayments.length > 0 && (
                  <div className={`mt-3 rounded-xl bg-white/60 p-3 ${colors.text}`}>
                    <div className="text-[11px] uppercase font-bold tracking-wider opacity-70">
                      Al firmar / instalar
                    </div>
                    <ul className="mt-1.5 space-y-1 text-sm">
                      {initialPayments.map((p) => (
                        <li key={p.label} className="flex items-center justify-between gap-2">
                          <span>{p.label}</span>
                          <span className="tabular-nums font-semibold">
                            {formatCents(p.cents)}
                          </span>
                        </li>
                      ))}
                      <li className="flex items-center justify-between gap-2 pt-1.5 border-t border-current/20 font-bold">
                        <span>Total inicio</span>
                        <span className="tabular-nums">{formatCents(initialTotal)}</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Productos</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin productos.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Producto</th>
                    <th className="py-2 text-right">Cant.</th>
                    <th className="py-2 text-right">Precio</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">{it.product_name_snapshot}</td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCents(it.unit_price_cash_cents) ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCents((it.unit_price_cash_cents ?? 0) * it.quantity) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {proposal.total_cash_cents != null && proposal.total_cash_cents > 0 && (
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td colSpan={3} className="py-3 text-right">
                        Total contado
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatCents(proposal.total_cash_cents)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ProposalActions
              proposalId={proposal.id}
              status={proposal.status}
              canApprove={canApprove}
              hasLead={Boolean(proposal.lead_id)}
              contractId={contractId}
            />
            {proposal.validity_until && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="h-3 w-3" />
                Validez hasta {proposal.validity_until}
              </p>
            )}
            {proposal.rejected_reason && (
              <p className="mt-4 text-xs">
                <strong>Motivo rechazo:</strong> {proposal.rejected_reason}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {proposal.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{proposal.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
