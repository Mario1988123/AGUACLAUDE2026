import { notFound } from "next/navigation";
import Link from "next/link";
import { getLead } from "@/modules/leads/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
import { listProposalsByLead } from "@/modules/proposals/actions";
import { ProposalsCard } from "@/modules/proposals/proposals-card";
import { Timeline } from "@/modules/events/timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, ORIGIN_LABEL } from "@/modules/leads/schemas";
import { LeadStatusActions } from "@/modules/leads/status-actions";
import { ConvertLeadButton } from "@/modules/leads/convert-button";
import { LeadContactButtons } from "@/modules/leads/contact-buttons";
import { Plus, MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";

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

  const [addresses, proposals] = await Promise.all([
    listAddresses({ lead_id: id }),
    listProposalsByLead(id),
  ]);
  const hasProposals = proposals.length > 0;
  const isConverted = lead.status === "converted";

  // Resolver nombre del comercial asignado (si lo hay)
  let assignedName: string | null = null;
  if (lead.assigned_user_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { createClient } = await import("@/shared/lib/supabase/server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data: prof } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", lead.assigned_user_id)
      .maybeSingle();
    assignedName = (prof as { full_name: string | null } | null)?.full_name ?? null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <Badge variant={STATUS_VARIANT[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>{lead.party_kind === "company" ? "Empresa" : "Particular"}</span>
            <span>·</span>
            <span>Origen: {ORIGIN_LABEL[lead.origin]}</span>
            {assignedName && (
              <>
                <span>·</span>
                <span>Asignado a <strong className="text-foreground">{assignedName}</strong></span>
              </>
            )}
          </div>
        </div>
        <Link href="/leads" className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
      </div>

      <LeadContactButtons leadId={lead.id} phone={lead.phone_primary} email={lead.email} />

      {addresses.length === 0 && !isConverted && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-dashed border-warning bg-warning/5 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="flex-1 text-sm">
            <div className="font-bold">Falta la dirección</div>
            <p className="text-muted-foreground">
              Añádela abajo para programar visitas y traspasarla al cliente al convertir.
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
          {isConverted ? (
            <Card>
              <CardHeader>
                <CardTitle>Convertido</CardTitle>
              </CardHeader>
              <CardContent>
                {lead.converted_to_customer_id && (
                  <Link
                    href={`/clientes/${lead.converted_to_customer_id}` as never}
                    className="block rounded-xl bg-success px-4 py-3 text-center text-sm font-semibold text-success-foreground hover:bg-success/90"
                  >
                    Ver cliente →
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : !hasProposals ? (
            <Card>
              <CardHeader>
                <CardTitle>Convertir directamente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Crea cliente sin propuesta (uso poco habitual). Lo recomendado es crear
                  propuesta y aceptarla.
                </p>
                <ConvertLeadButton leadId={lead.id} alreadyConverted={false} />
              </CardContent>
            </Card>
          ) : null}

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
          <div className="flex items-center justify-between">
            <CardTitle>Propuestas ({proposals.length})</CardTitle>
            {!isConverted && (
              <Button asChild size="sm">
                <Link href={`/propuestas/nueva?lead_id=${lead.id}` as never}>
                  <Plus className="h-4 w-4" /> Nueva propuesta
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ProposalsCard proposals={proposals} scope="lead" onAcceptedRedirect />
        </CardContent>
      </Card>

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
