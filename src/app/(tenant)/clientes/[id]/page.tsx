import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/modules/customers/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
import { listBankAccounts } from "@/modules/customers/bank-accounts/actions";
import { BankAccountList } from "@/modules/customers/bank-accounts/bank-list";
import { listCustomerEquipment } from "@/modules/customers/equipment-actions";
import { CustomerEquipmentList } from "@/modules/customers/equipment-list";
import { listProposalsByCustomer } from "@/modules/proposals/actions";
import { ProposalsCard } from "@/modules/proposals/proposals-card";
import { listContractsByCustomer, listInstallationsByCustomer } from "@/modules/customers/actions";
import { CustomerContractsCard } from "@/modules/customers/contracts-card";
import { CustomerInstallationsCard } from "@/modules/customers/installations-card";
import { CustomerContactButtons } from "@/modules/customers/contact-buttons";
import { FromProposalBanner } from "@/modules/customers/from-proposal-banner";
import { Timeline } from "@/modules/events/timeline";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from_proposal?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fromProposal = sp.from_proposal;
  let customer;
  try {
    customer = await getCustomer(id);
  } catch {
    notFound();
  }

  const displayName =
    customer.party_kind === "company"
      ? customer.trade_name || customer.legal_name || "Sin nombre"
      : `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || "Sin nombre";

  const session = await requireSession();
  const addresses = await listAddresses({ customer_id: id });
  const canSeeBank = session.is_superadmin || session.roles.includes("company_admin");
  const bankAccounts = canSeeBank ? await listBankAccounts(id).catch(() => []) : [];
  const equipment = await listCustomerEquipment(id).catch(() => []);
  const customerProposals = await listProposalsByCustomer(id).catch(() => []);
  const contracts = await listContractsByCustomer(id).catch(() => []);
  const installations = await listInstallationsByCustomer(id).catch(() => []);

  // Resolver nombre del comercial asignado
  let assignedName: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = customer as any;
  if (c.assigned_user_id) {
    const { createClient: cc } = await import("@/shared/lib/supabase/server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (await cc()) as any;
    const { data: prof } = await sb
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", c.assigned_user_id)
      .maybeSingle();
    assignedName = (prof as { full_name: string | null } | null)?.full_name ?? null;
  }

  // Pendientes para el banner si venimos desde una propuesta aceptada
  const pendingFromProposal = fromProposal
    ? {
        dni: !customer.tax_id,
        iban: bankAccounts.length === 0,
        address: addresses.length === 0,
      }
    : null;

  return (
    <div className="space-y-6">
      {fromProposal && pendingFromProposal && (
        <FromProposalBanner proposalId={fromProposal} pending={pendingFromProposal} />
      )}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{displayName}</h1>
            {customer.is_active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="secondary">Inactivo</Badge>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {customer.party_kind === "company" ? "Empresa" : "Particular"}
            {customer.tax_id && ` · ${customer.tax_id}`}
            {assignedName && (
              <>
                {" · "}Asignado a <strong className="text-foreground">{assignedName}</strong>
              </>
            )}
          </div>
        </div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
      </div>

      <CustomerContactButtons
        customerId={id}
        phone={customer.phone_primary}
        email={customer.email}
        recipientName={displayName}
        commercialName={session.full_name}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Email" value={customer.email} />
            <Row label="Teléfono" value={customer.phone_primary} />
            <Row label="Tel. secundario" value={customer.phone_secondary} />
            {customer.notes && (
              <div className="border-t pt-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notas</div>
                <p className="mt-1 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direcciones ({addresses.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <AddressList customerId={id} addresses={addresses} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos bancarios{canSeeBank ? ` (${bankAccounts.length})` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            {canSeeBank ? (
              <BankAccountList customerId={id} accounts={bankAccounts} />
            ) : (
              <p className="text-sm text-muted-foreground">
                🔒 Solo el administrador de la empresa puede ver los datos bancarios.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Equipos instalados ({equipment.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerEquipmentList equipment={equipment} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Propuestas ({customerProposals.length})</CardTitle>
              <Button asChild size="sm">
                <Link href={`/propuestas/nueva?customer_id=${id}` as never}>
                  <Plus className="h-4 w-4" /> Nueva propuesta
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ProposalsCard proposals={customerProposals} scope="customer" />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contratos ({contracts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerContractsCard contracts={contracts} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Instalaciones ({installations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerInstallationsCard installations={installations} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="customer" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string | null; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2">{value || "—"}</div>
    </div>
  );
}
