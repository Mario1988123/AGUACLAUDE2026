import { notFound } from "next/navigation";
import {
  getProposal,
  getProposalItems,
} from "@/modules/proposals/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/proposals/schemas";
import { ProposalActions } from "@/modules/proposals/actions-panel";
import { requireSession } from "@/shared/lib/auth/session";
import { SendByEmailButton } from "@/modules/mailing/send-by-email-button";
import { DuplicateProposalButton } from "@/modules/proposals/duplicate-button";
import { BackButton } from "@/shared/components/back-button";
import { formatDateES } from "@/shared/lib/format-date";
import {
  Banknote,
  Calendar,
  Coins,
  ShieldCheck,
  Wrench,
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
  const [items, session] = await Promise.all([
    getProposalItems(id),
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
          <ProposalActions
            proposalId={proposal.id}
            status={proposal.status}
            canApprove={canApprove}
            hasLead={Boolean(proposal.lead_id)}
            contractId={contractId}
          />
          <a
            href={`/api/pdf/proposal/${proposal.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <Download className="h-4 w-4" /> PDF
          </a>
          <SendByEmailButton documentId={proposal.id} kind="proposal" short />
          <DuplicateProposalButton proposalId={proposal.id} />
          <BackButton href="/propuestas" />
        </div>
      </div>

      {/* Resumen del plan elegido — calculado desde proposal + proposal_items */}
      {(() => {
        const planType = proposal.chosen_plan_type ?? "cash";
        const colors = PLAN_COLOR[planType] ?? PLAN_COLOR.cash!;
        const duration = proposal.chosen_duration_months;

        // Cuota mensual: la del plan elegido (rental, renting, financing)
        const monthlyCents =
          planType === "rental"
            ? proposal.monthly_rental_cents
            : planType === "renting"
              ? proposal.monthly_renting_min_cents ?? proposal.monthly_renting_max_cents
              : null;

        // Pagos al firmar/instalar — calculado desde items
        const initialPayments: Array<{ label: string; cents: number }> = [];
        let depositSum = 0;
        let installationSum = 0;
        let firstPaymentSum = 0;
        for (const it of items) {
          if (it.deposit_cents) depositSum += it.deposit_cents * (it.quantity ?? 1);
          if (it.installation_included === false && it.installation_price_cents) {
            installationSum += it.installation_price_cents * (it.quantity ?? 1);
          }
          if (it.charge_first_payment_now && it.unit_price_cash_cents) {
            firstPaymentSum += it.unit_price_cash_cents * (it.quantity ?? 1);
          }
        }
        if (depositSum > 0) initialPayments.push({ label: "Fianza", cents: depositSum });
        if (installationSum > 0)
          initialPayments.push({ label: "Instalación", cents: installationSum });
        if (firstPaymentSum > 0)
          initialPayments.push({ label: "1ª cuota al firmar", cents: firstPaymentSum });
        const initialTotal = initialPayments.reduce((s, p) => s + p.cents, 0);

        const hasMaintenance = items.some((it) => it.maintenance_included);
        const firstMaintItem = items.find((it) => it.maintenance_included);
        const maintenancePeriodicity = firstMaintItem?.maintenance_periodicity_months;
        const maintenanceUntilDate = firstMaintItem?.maintenance_until_date;

        return (
          <div className={`rounded-2xl border-2 p-5 ${colors.bg} ${colors.border}`}>
            <div className={`flex items-center gap-2 ${colors.text}`}>
              {planType === "cash" ? (
                <Banknote className={`h-5 w-5 ${colors.icon}`} />
              ) : (
                <Calendar className={`h-5 w-5 ${colors.icon}`} />
              )}
              <h3 className="font-bold text-lg">{PLAN_LABEL[planType] ?? planType}</h3>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Precio principal */}
              <div>
                <div className="text-[11px] uppercase font-bold tracking-wider opacity-70">
                  {planType === "cash" ? "Precio total" : "Cuota mensual"}
                </div>
                {planType === "cash" ? (
                  <div className={`text-3xl font-bold tabular-nums ${colors.text}`}>
                    {formatCents(proposal.total_cash_cents) ?? "—"}
                  </div>
                ) : (
                  <div className={`text-3xl font-bold tabular-nums ${colors.text}`}>
                    {formatCents(monthlyCents) ?? "—"}
                    <span className="text-base font-medium">/mes</span>
                  </div>
                )}
              </div>

              {/* Permanencia / cuotas */}
              {duration && planType !== "cash" && (
                <div>
                  <div className="text-[11px] uppercase font-bold tracking-wider opacity-70">
                    Compromiso
                  </div>
                  <div className={`mt-0.5 flex items-center gap-1.5 text-base font-semibold ${colors.text}`}>
                    <ShieldCheck className={`h-4 w-4 ${colors.icon}`} />
                    {duration} {duration === 1 ? "cuota" : "cuotas"}
                  </div>
                </div>
              )}

              {/* Mantenimiento */}
              {hasMaintenance && (
                <div>
                  <div className="text-[11px] uppercase font-bold tracking-wider opacity-70">
                    Mantenimiento
                  </div>
                  <div className={`mt-0.5 flex items-center gap-1.5 text-base font-semibold ${colors.text}`}>
                    <Wrench className={`h-4 w-4 ${colors.icon}`} />
                    Incluido
                    {maintenancePeriodicity && (
                      <span className="font-normal text-sm">
                        · cada {maintenancePeriodicity}m
                      </span>
                    )}
                  </div>
                  {maintenanceUntilDate && (
                    <div className={`mt-0.5 text-xs ${colors.text} opacity-80`}>
                      Cubierto hasta {formatDateES(maintenanceUntilDate)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pagos al inicio */}
            {initialPayments.length > 0 && (
              <div className={`mt-4 rounded-xl bg-white/60 p-3 ${colors.text}`}>
                <div className="text-[11px] uppercase font-bold tracking-wider opacity-70">
                  Al firmar / instalar
                </div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {initialPayments.map((p) => (
                    <li key={p.label} className="flex items-center justify-between gap-2">
                      <span>{p.label}</span>
                      <span className="tabular-nums font-semibold">{formatCents(p.cents)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 pt-1.5 border-t border-current/20 font-bold">
                    <span>Total a entregar al inicio</span>
                    <span className="tabular-nums">{formatCents(initialTotal)}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle>Productos</CardTitle>
            {proposal.validity_until && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="h-3 w-3" /> Validez hasta {formatDateES(proposal.validity_until)}
              </span>
            )}
          </div>
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
          {proposal.rejected_reason && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <strong>Motivo del rechazo:</strong> {proposal.rejected_reason}
            </div>
          )}
        </CardContent>
      </Card>

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
