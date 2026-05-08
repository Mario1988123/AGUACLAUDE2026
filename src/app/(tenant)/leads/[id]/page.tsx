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
import { EditLeadButton } from "@/modules/leads/edit-lead-button";
import { LeadContactButtons } from "@/modules/leads/contact-buttons";
import { ReassignLeadButton } from "@/modules/leads/reassign-button";
import { Plus, MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { listTeamMembers } from "@/modules/agenda/actions";

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

  const [addresses, proposals, session, team] = await Promise.all([
    listAddresses({ lead_id: id }),
    listProposalsByLead(id),
    requireSession(),
    listTeamMembers().catch(() => []),
  ]);
  const canReassign =
    session.is_superadmin || session.roles.includes("company_admin");
  const hasProposals = proposals.length > 0;
  const isConverted = lead.status === "converted";

  let assignedName: string | null = null;
  if (lead.assigned_user_id) {
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
    <div className="space-y-5">
      {/* Header: nombre + badge + meta + Volver */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold">{displayName}</h1>
            <Badge variant={STATUS_VARIANT[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span>{lead.party_kind === "company" ? "Empresa" : "Particular"}</span>
            <span>·</span>
            <span>Origen: {ORIGIN_LABEL[lead.origin]}</span>
            {assignedName && (
              <>
                <span>·</span>
                <span>
                  Asignado a <strong className="text-foreground">{assignedName}</strong>
                </span>
              </>
            )}
          </div>
        </div>
        <Link href="/leads" className="text-sm text-primary hover:underline self-start mt-2">
          ← Volver
        </Link>
      </div>

      {/* Toolbar de acciones agrupada arriba */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/50 p-3">
        <LeadContactButtons
          leadId={lead.id}
          phone={lead.phone_primary}
          email={lead.email}
          recipientName={displayName}
          commercialName={session.full_name}
        />
        {!isConverted && (
          <>
            <span className="hidden sm:inline-block h-8 w-px bg-border mx-1" aria-hidden />
            <LeadStatusActions leadId={lead.id} currentStatus={lead.status} />
            {!hasProposals && <ConvertLeadButton leadId={lead.id} alreadyConverted={false} />}
            {canReassign && (
              <ReassignLeadButton
                leadId={lead.id}
                currentUserId={lead.assigned_user_id}
                team={team}
              />
            )}
          </>
        )}
        {isConverted && lead.converted_to_customer_id && (
          <Link
            href={`/clientes/${lead.converted_to_customer_id}` as never}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
          >
            Ver cliente →
          </Link>
        )}
      </div>

      {/* Datos: full-width, Editar en esquina superior derecha */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Datos</CardTitle>
            {!isConverted && (
              <EditLeadButton
                leadId={lead.id}
                initial={{
                  party_kind: lead.party_kind,
                  legal_name: lead.legal_name,
                  trade_name: lead.trade_name,
                  first_name: lead.first_name,
                  last_name: lead.last_name,
                  email: lead.email,
                  phone_primary: lead.phone_primary,
                  phone_company: lead.phone_company,
                  tax_id: lead.tax_id,
                  notes: lead.notes,
                  potential: lead.potential,
                }}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <DataRow label="Tipo" value={lead.party_kind === "company" ? "Empresa" : "Particular"} />
            {lead.party_kind === "company" ? (
              <>
                <DataRow label="Razón social" value={lead.legal_name} />
                <DataRow label="Nombre comercial" value={lead.trade_name} />
                <DataRow label="CIF" value={lead.tax_id} />
                <DataRow
                  label="Persona contacto"
                  value={`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || null}
                />
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
            <DataRow label="Teléfono" value={lead.phone_primary} />
            <DataRow
              label="Potencial"
              value={lead.potential === "unknown" ? "Sin clasificar" : `Clase ${lead.potential}`}
            />
          </div>
          {lead.notes && (
            <div className="mt-4 border-t pt-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Notas</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{lead.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Direcciones */}
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

      {/* Propuestas */}
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

      {/* Timeline */}
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
      <div className="col-span-2 break-words font-medium">{value || "—"}</div>
    </div>
  );
}
