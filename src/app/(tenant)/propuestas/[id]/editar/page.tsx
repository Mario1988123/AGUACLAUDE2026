import { notFound } from "next/navigation";
import { listProductsForProposal } from "@/modules/products/actions";
import { listCustomers } from "@/modules/customers/actions";
import { listLeads } from "@/modules/leads/actions";
import {
  getProposal,
  getProposalItems,
} from "@/modules/proposals/actions";
import { ProposalCreateForm } from "@/modules/proposals/create-form";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function EditarPropuestaPage({
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

  // Estados terminales: redirigir al detalle (no se puede editar)
  if (
    ["rejected", "expired", "superseded", "accepted"].includes(proposal.status)
  ) {
    notFound();
  }

  const [items, products, customers, leads] = await Promise.all([
    getProposalItems(id),
    listProductsForProposal(),
    listCustomers(),
    listLeads().catch(() => []),
  ]);

  const planType =
    proposal.chosen_plan_type === "financing"
      ? "cash"
      : (proposal.chosen_plan_type as "cash" | "rental" | "renting" | null) ?? "cash";

  const initial = {
    customer_id: proposal.customer_id,
    lead_id: proposal.lead_id,
    chosen_plan_type: planType,
    chosen_duration_months: proposal.chosen_duration_months,
    validity_until: proposal.validity_until,
    notes: proposal.notes,
    items: items.map((it) => ({
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cash_cents ?? 0,
      installation_included: it.installation_included ?? true,
      installation_price_cents: it.installation_price_cents ?? null,
      maintenance_included: it.maintenance_included ?? false,
      maintenance_until_date: it.maintenance_until_date ?? null,
      maintenance_price_cents: it.maintenance_price_cents ?? null,
      maintenance_periodicity_months: it.maintenance_periodicity_months ?? 12,
      deposit_cents: it.deposit_cents ?? null,
      charge_first_payment_now: it.charge_first_payment_now ?? false,
    })),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">
            Editar propuesta {proposal.reference_code ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Cambia plan, duración, productos o condiciones. Se actualiza la propuesta existente.
          </p>
        </div>
        <BackButton href={`/propuestas/${id}`} />
      </div>
      <ProposalCreateForm
        customers={customers.map((c) => ({ id: c.id, name: c.display_name }))}
        leads={leads.map((l) => ({ id: l.id, name: l.display_name }))}
        products={products}
        editId={id}
        initial={initial}
      />
    </div>
  );
}
