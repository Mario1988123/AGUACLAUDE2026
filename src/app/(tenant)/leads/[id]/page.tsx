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
import { LeadFollowupCard } from "@/modules/leads/followup-card";
import { ReassignLeadButton } from "@/modules/leads/reassign-button";
import { Plus, MapPin } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { listTeamMembers } from "@/modules/agenda/actions";
import { CreateAgendaButton } from "@/modules/agenda/create-form";
import { BackButton } from "@/shared/components/back-button";
import { getLeadReferrer } from "@/modules/referrals/actions";

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

  const [addresses, proposals, session, team, referrer] = await Promise.all([
    listAddresses({ lead_id: id }),
    listProposalsByLead(id),
    requireSession(),
    listTeamMembers().catch(() => []),
    getLeadReferrer(id).catch(() => null),
  ]);
  // Scope check para nivel 2/3.
  {
    const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
    const visibleUserIds = await resolveVisibleUserIds(session);
    if (visibleUserIds !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l = lead as any;
      const inScope =
        (l.assigned_user_id && visibleUserIds.includes(l.assigned_user_id)) ||
        (l.created_by && visibleUserIds.includes(l.created_by));
      if (!inScope) notFound();
    }
  }
  const canReassign =
    session.is_superadmin || session.roles.includes("company_admin");
  const hasProposals = proposals.length > 0;
  const isConverted = lead.status === "converted";

  let assignedName: string | null = null;
  let lastContactAt: string | null = null;
  {
    const { createClient } = await import("@/shared/lib/supabase/server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    if (lead.assigned_user_id) {
      const { data: prof } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("user_id", lead.assigned_user_id)
        .maybeSingle();
      assignedName = (prof as { full_name: string | null } | null)?.full_name ?? null;
    }
    // Último contacto registrado para el FollowupCard
    try {
      const { data: lastEv } = await supabase
        .from("events")
        .select("occurred_at")
        .eq("subject_type", "lead")
        .eq("subject_id", lead.id)
        .eq("kind", "lead.contacted")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastContactAt =
        (lastEv as { occurred_at: string | null } | null)?.occurred_at ?? null;
    } catch {
      /* */
    }
  }

  return (
    <div className="space-y-5">
      {/* Header: BackButton arriba, nombre + badge + meta debajo (orden lógico móvil) */}
      <div className="space-y-2">
        <BackButton href="/leads" />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-bold sm:text-3xl">{displayName}</h1>
          <Badge variant={STATUS_VARIANT[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{lead.party_kind === "company" ? "Empresa" : "Particular"}</span>
          <span aria-hidden="true">·</span>
          <span>Origen: {ORIGIN_LABEL[lead.origin]}</span>
          {referrer && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Recomendado por{" "}
                <Link
                  href={`/clientes/${referrer.customer_id}` as never}
                  className="font-semibold text-foreground hover:underline"
                >
                  {referrer.name}
                </Link>
              </span>
            </>
          )}
          {assignedName && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Asignado a <strong className="text-foreground">{assignedName}</strong>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Seguimiento (decisión 2026-05-20) — solo si el lead NO está convertido */}
      {!isConverted && (
        <LeadFollowupCard leadId={lead.id} lastContactAt={lastContactAt} />
      )}

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
            <Link
              href={`/calculadora-ahorro/nueva?lead_id=${lead.id}` as never}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted hover:border-primary/40"
            >
              📊 Calcular ahorro
            </Link>
            <Link
              href={`/pruebas-gratuitas/nueva?lead_id=${lead.id}` as never}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted hover:border-primary/40"
              title="Entregar equipo en prueba sin contrato"
            >
              🎁 Prueba gratuita
            </Link>
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

      {/* Agendar — mismo flujo que la agenda, ya vinculado a este lead.
          Al pulsar se despliega el formulario completo (cliente prefijado). */}
      {!isConverted && (
        <CreateAgendaButton
          teamMembers={team}
          presetSubject={{ type: "lead", id: lead.id, label: displayName }}
          presetTitle="Visita comercial"
          triggerLabel="📅 Agendar"
          triggerVariant="outline"
        />
      )}

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
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
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
    <div className="flex flex-col gap-0.5 text-sm sm:grid sm:grid-cols-3 sm:gap-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground sm:text-sm sm:normal-case sm:tracking-normal">
        {label}
      </div>
      <div className="break-words font-medium sm:col-span-2">{value || "—"}</div>
    </div>
  );
}
