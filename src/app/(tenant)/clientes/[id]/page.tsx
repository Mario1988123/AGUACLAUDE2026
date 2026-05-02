import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/modules/customers/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
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

  const addresses = await listAddresses({ customer_id: id });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{displayName}</h1>
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
            className="inline-flex h-11 items-center gap-2 rounded-md bg-success px-4 text-sm font-medium text-success-foreground hover:bg-success/90"
          >
            <Phone className="h-4 w-4" /> Llamar
          </a>
        )}
        {customer.phone_primary && (
          <a
            href={`https://wa.me/${customer.phone_primary.replace(/[^0-9+]/g, "")}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="inline-flex h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted"
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
            <CardTitle>Datos bancarios</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Solo visibles para el administrador. Pendientes de UI.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipos instalados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Listado pendiente.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2">{value || "—"}</div>
    </div>
  );
}
