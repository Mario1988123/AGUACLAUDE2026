import { CustomerCreateForm } from "@/modules/customers/create-form";

export default function NuevoClientePage({
  searchParams,
}: {
  searchParams: Promise<{ from_lead?: string }>;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nuevo cliente</h1>
        <p className="text-sm text-muted-foreground">Datos básicos. Direcciones y banco se completan en la ficha.</p>
      </div>
      <CustomerCreateFormSync searchParams={searchParams} />
    </div>
  );
}

async function CustomerCreateFormSync({
  searchParams,
}: {
  searchParams: Promise<{ from_lead?: string }>;
}) {
  const sp = await searchParams;
  return <CustomerCreateForm sourceLeadId={sp.from_lead} />;
}
