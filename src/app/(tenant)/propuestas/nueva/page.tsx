import { listProducts } from "@/modules/products/actions";
import { listCustomers } from "@/modules/customers/actions";
import { ProposalCreateForm } from "@/modules/proposals/create-form";

export default async function NuevaPropuestaPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; lead_id?: string }>;
}) {
  const sp = await searchParams;
  const [products, customers] = await Promise.all([listProducts(), listCustomers()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nueva propuesta</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona destinatario, añade productos y revisa precios. Decisión #2: editar genera
          siempre nueva versión.
        </p>
      </div>
      <ProposalCreateForm
        customers={customers.map((c) => ({ id: c.id, name: c.display_name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          cash_price_cents: p.cash_price_cents,
        }))}
        defaultCustomerId={sp.customer_id}
        defaultLeadId={sp.lead_id}
      />
    </div>
  );
}
