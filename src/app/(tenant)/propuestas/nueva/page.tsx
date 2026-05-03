import { listProducts } from "@/modules/products/actions";
import { listCustomers } from "@/modules/customers/actions";
import { listLeads, getLead } from "@/modules/leads/actions";
import { ProposalCreateForm } from "@/modules/proposals/create-form";

export default async function NuevaPropuestaPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; lead_id?: string; lead?: string }>;
}) {
  const sp = await searchParams;
  // Soportar tanto `?lead_id=` como `?lead=` (link viejo y nuevo)
  const leadId = sp.lead_id ?? sp.lead;
  const [products, customers, leads] = await Promise.all([
    listProducts(),
    listCustomers(),
    listLeads().catch(() => []),
  ]);

  // Si hay leadId, traer su display_name para mostrarlo arriba
  let leadDisplay: string | null = null;
  if (leadId) {
    try {
      const l = await getLead(leadId);
      leadDisplay =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Lead"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Lead";
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nueva propuesta</h1>
        <p className="text-sm text-muted-foreground">
          {leadDisplay ? (
            <>
              Para el lead <strong>{leadDisplay}</strong>
            </>
          ) : (
            "Selecciona destinatario, añade productos y revisa precios."
          )}
        </p>
      </div>
      <ProposalCreateForm
        customers={customers.map((c) => ({ id: c.id, name: c.display_name }))}
        leads={leads.map((l) => ({ id: l.id, name: l.display_name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          cash_price_cents: p.cash_price_cents,
        }))}
        defaultCustomerId={sp.customer_id}
        defaultLeadId={leadId}
      />
    </div>
  );
}
