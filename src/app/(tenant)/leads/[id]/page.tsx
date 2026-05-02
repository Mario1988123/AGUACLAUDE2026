import { notFound } from "next/navigation";
import Link from "next/link";
import { getLead } from "@/modules/leads/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
import { Timeline } from "@/modules/events/timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, ORIGIN_LABEL } from "@/modules/leads/schemas";
import { LeadStatusActions } from "@/modules/leads/status-actions";
import { ConvertLeadButton } from "@/modules/leads/convert-button";
import { Phone, MessageCircle, Mail, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let lead;
  try {
    lead = await getLead(id);
  } catch {
    notFound();
  }

  const displayName =
    lead.party_kind === "company"
      ? lead.trade_name || lead.legal_name || "Sin nombre"
      : `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Sin nombre";

  const addresses = await listAddresses({ lead_id: id });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <Badge variant={STATUS_VARIANT[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span>{lead.party_kind === "company" ? "Empresa" : "Particular"}</span>
            <span>·</span>
            <span>Origen: {ORIGIN_LABEL[lead.origin]}</span>
          </div>
        </div>
        <Link href="/leads" className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
      </div>

      {(lead.phone_primary || lead.email) && (
        <div className="flex flex-wrap gap-2">
          {lead.phone_primary && (
            <a
              href={`tel:${lead.phone_primary}`}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-success px-4 text-sm font-medium text-success-foreground hover:bg-success/90"
            >
              <Phone className="h-4 w-4" />
              Llamar
            </a>
          )}
          {lead.phone_primary && (
            <a
              href={`https://wa.me/${lead.phone_primary.replace(/[^0-9+]/g, "")}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-medium text-white hover:opacity-90"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              <Mail className="h-4 w-4" />
              Email
            </a>
          )}
        </div>
      )}

      {addresses.length === 0 && lead.status !== "converted" && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-dashed border-warning bg-warning/5 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="flex-1 text-sm">
            <div className="font-bold">Falta la dirección</div>
            <p className="text-muted-foreground">
              Añade una dirección abajo para poder programar visitas y, al convertir, traspasarla
              al cliente.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataRow label="Tipo" value={lead.party_kind === "company" ? "Empresa" : "Particular"} />
            {lead.party_kind === "company" ? (
              <>
                <DataRow label="Razón social" value={lead.legal_name} />
                <DataRow label="Nombre comercial" value={lead.trade_name} />
                <DataRow label="CIF" value={lead.tax_id} />
                <DataRow label="Persona de contacto" value={
                  `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || null
                } />
                <DataRow label="Tel. empresa" value={lead.phone_company} />
              </>
            ) : (
              <>
                <DataRow label="Nombre" value={lead.first_name} />
                <DataRow label="Apellidos" value={lead.last_name} />
                <DataRow label="DNI/NIE" value={lead.tax_id} />
              </>
            )}
            <DataRow label="Email" value={lead.email} />
            <DataRow label="Teléfono principal" value={lead.phone_primary} />
            <DataRow label="Potencial" value={lead.potential === "unknown" ? "Sin clasificar" : `Clase ${lead.potential}`} />
            {lead.notes && (
              <div className="border-t pt-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notas</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{lead.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Convertir</CardTitle>
            </CardHeader>
            <CardContent>
              <ConvertLeadButton
                leadId={lead.id}
                alreadyConverted={!!lead.converted_to_customer_id}
              />
              {lead.converted_to_customer_id && (
                <Link
                  href={`/clientes/${lead.converted_to_customer_id}` as never}
                  className="mt-3 block text-center text-sm text-primary hover:underline"
                >
                  Ver cliente →
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estado</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadStatusActions leadId={lead.id} currentStatus={lead.status} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Direcciones ({addresses.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AddressList leadId={id} addresses={addresses} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="lead" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 break-words">{value || "—"}</div>
    </div>
  );
}
