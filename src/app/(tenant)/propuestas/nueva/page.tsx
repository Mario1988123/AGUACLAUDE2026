import { listProductsForProposal } from "@/modules/products/actions";
import { listCustomers } from "@/modules/customers/actions";
import { listLeads, getLead } from "@/modules/leads/actions";
import { ProposalCreateForm } from "@/modules/proposals/create-form";

export default async function NuevaPropuestaPage({
  searchParams,
}: {
  searchParams: Promise<{
    customer_id?: string;
    lead_id?: string;
    lead?: string;
    direct?: string;
  }>;
}) {
  const sp = await searchParams;
  const leadId = sp.lead_id ?? sp.lead;
  const directMode = sp.direct === "1";
  const [products, customers, leads] = await Promise.all([
    listProductsForProposal(),
    listCustomers(),
    listLeads().catch(() => []),
  ]);

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
        <h1 className="text-2xl font-bold">
          {directMode ? "Contrato directo (sin propuesta formal)" : "Nueva propuesta"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {directMode ? (
            <>
              El cliente acepta las condiciones de palabra. Configura plan,
              equipos y forma de pago — al guardar se crea propuesta+contrato
              en un solo paso.
            </>
          ) : leadDisplay ? (
            <>
              Para el lead <strong>{leadDisplay}</strong>
            </>
          ) : (
            "Selecciona destinatario, plan único y configura instalación, mantenimiento y precios por producto."
          )}
        </p>
      </div>
      {directMode && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          <strong className="text-amber-900">⚡ Modo contrato directo</strong>
          <p className="mt-1 text-amber-800">
            La propuesta se aceptará automáticamente y se generará el contrato
            en cuanto guardes. Si el precio cae bajo el mínimo autorizado
            necesitarás validación de nivel 1-2 (no podrás saltarte ese paso
            como nivel 3).
          </p>
        </div>
      )}
      <ProposalCreateForm
        customers={customers.map((c) => ({ id: c.id, name: c.display_name }))}
        leads={leads.map((l) => ({ id: l.id, name: l.display_name }))}
        products={products}
        defaultCustomerId={sp.customer_id}
        defaultLeadId={leadId}
        directMode={directMode}
      />
    </div>
  );
}
