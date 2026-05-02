import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/modules/customers/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
import { listBankAccounts } from "@/modules/customers/bank-accounts/actions";
import { BankAccountList } from "@/modules/customers/bank-accounts/bank-list";
import { listCustomerEquipment } from "@/modules/customers/equipment-actions";
import { CustomerEquipmentList } from "@/modules/customers/equipment-list";
import { Timeline } from "@/modules/events/timeline";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Phone, MessageCircle, Mail } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  return (
    <div className="space-y-6">
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
          </div>
        </div>
        <Link href="/clientes" className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {customer.phone_primary && (
          <a
            href={`tel:${customer.phone_primary}`}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-success px-4 text-sm font-semibold text-success-foreground hover:bg-success/90"
          >
            <Phone className="h-4 w-4" /> Llamar
          </a>
        )}
        {customer.phone_primary && (
          <a
            href={`https://wa.me/${customer.phone_primary.replace(/[^0-9+]/g, "")}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="inline-flex h-12 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted"
          >
            <Mail className="h-4 w-4" /> Email
          </a>
        )}
      </div>

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
