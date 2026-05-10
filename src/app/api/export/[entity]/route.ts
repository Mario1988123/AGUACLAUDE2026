import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { toCsv } from "@/shared/lib/csv/to-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITIES = [
  "leads",
  "customers",
  "contracts",
  "payments",
  "installations",
  "wallet",
  "audit",
  "time-records",
] as const;
type Entity = (typeof ENTITIES)[number];

function fmtCents(c: number | null | undefined): string {
  if (c == null) return "";
  return (c / 100).toFixed(2).replace(".", ",");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("es-ES");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES.includes(entity as Entity)) {
    return NextResponse.json({ error: "entity not supported" }, { status: 400 });
  }

  const session = await requireSession();
  if (!session.company_id) {
    return NextResponse.json({ error: "no company" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Audit log RGPD: registrar quién y cuándo descarga datos personales.
  // Estos exports incluyen tax_id/email/teléfono → trazabilidad obligatoria.
  const PERSONAL_DATA_ENTITIES = new Set<Entity>([
    "leads",
    "customers",
    "wallet",
    "payments",
  ]);
  if (PERSONAL_DATA_ENTITIES.has(entity as Entity)) {
    try {
      await supabase.from("events").insert({
        company_id: session.company_id,
        subject_type: "company",
        subject_id: session.company_id,
        kind: "personal_data.exported",
        payload: { entity, format: "csv" },
        actor_user_id: session.user_id,
      });
    } catch {
      /* no-op: el log no debe bloquear la descarga */
    }
  }

  let csv = "";
  switch (entity as Entity) {
    case "leads": {
      const { data } = await supabase
        .from("leads")
        .select(
          "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, tax_id, status, origin, potential, assigned_at, created_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        [
          "ID",
          "Tipo",
          "Razón social",
          "Nombre comercial",
          "Nombre",
          "Apellidos",
          "Email",
          "Teléfono",
          "DNI/CIF",
          "Estado",
          "Origen",
          "Potencial",
          "Asignado",
          "Creado",
        ],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.party_kind as string,
          r.legal_name as string,
          r.trade_name as string,
          r.first_name as string,
          r.last_name as string,
          r.email as string,
          r.phone_primary as string,
          r.tax_id as string,
          r.status as string,
          r.origin as string,
          r.potential as string,
          fmtDate(r.assigned_at as string),
          fmtDate(r.created_at as string),
        ]),
      );
      break;
    }
    case "customers": {
      const { data } = await supabase
        .from("customers")
        .select(
          "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, tax_id, is_active, created_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        [
          "ID",
          "Tipo",
          "Razón social",
          "Nombre comercial",
          "Nombre",
          "Apellidos",
          "Email",
          "Teléfono",
          "DNI/CIF",
          "Activo",
          "Creado",
        ],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.party_kind as string,
          r.legal_name as string,
          r.trade_name as string,
          r.first_name as string,
          r.last_name as string,
          r.email as string,
          r.phone_primary as string,
          r.tax_id as string,
          r.is_active ? "Sí" : "No",
          fmtDate(r.created_at as string),
        ]),
      );
      break;
    }
    case "contracts": {
      const { data } = await supabase
        .from("contracts")
        .select(
          "id, reference_code, status, customer_id, plan_type, total_cash_cents, monthly_cents, duration_months, signed_at, created_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        ["ID", "Ref", "Estado", "Cliente ID", "Plan", "Total contado (€)", "Cuota (€)", "Meses", "Firmado", "Creado"],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.reference_code as string,
          r.status as string,
          r.customer_id as string,
          r.plan_type as string,
          fmtCents(r.total_cash_cents as number | null),
          fmtCents(r.monthly_cents as number | null),
          (r.duration_months as number | null) ?? "",
          fmtDate(r.signed_at as string),
          fmtDate(r.created_at as string),
        ]),
      );
      break;
    }
    case "payments": {
      const { data } = await supabase
        .from("contract_payments")
        .select(
          "id, contract_id, concept, amount_cents, method, moment, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        ["ID", "Contrato ID", "Concepto", "Importe (€)", "Método", "Momento", "Estado", "Creado"],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.contract_id as string,
          r.concept as string,
          fmtCents(r.amount_cents as number),
          r.method as string,
          r.moment as string,
          r.status as string,
          fmtDate(r.created_at as string),
        ]),
      );
      break;
    }
    case "installations": {
      const { data } = await supabase
        .from("installations")
        .select(
          "id, reference_code, status, kind, customer_id, contract_id, scheduled_at, started_at, completed_at, duration_seconds",
        )
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        [
          "ID",
          "Ref",
          "Estado",
          "Tipo",
          "Cliente ID",
          "Contrato ID",
          "Programada",
          "Iniciada",
          "Completada",
          "Duración (min)",
        ],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.reference_code as string,
          r.status as string,
          r.kind as string,
          r.customer_id as string,
          r.contract_id as string,
          fmtDate(r.scheduled_at as string),
          fmtDate(r.started_at as string),
          fmtDate(r.completed_at as string),
          r.duration_seconds ? Math.round((r.duration_seconds as number) / 60) : "",
        ]),
      );
      break;
    }
    case "audit": {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data } = await supabase
        .from("events")
        .select(
          "id, occurred_at, subject_type, subject_id, kind, actor_user_id, payload",
        )
        .eq("company_id", session.company_id)
        .gte("occurred_at", ninetyDaysAgo)
        .order("occurred_at", { ascending: false })
        .limit(50000);
      type Row = {
        id: string;
        occurred_at: string;
        subject_type: string;
        subject_id: string;
        kind: string;
        actor_user_id: string | null;
        payload: Record<string, unknown> | null;
      };
      const rows = (data ?? []) as Row[];
      const actorIds = Array.from(
        new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => !!v)),
      );
      const nameMap = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("user_id, full_name")
          .in("user_id", actorIds);
        for (const p of (profiles ?? []) as Array<{
          user_id: string;
          full_name: string | null;
        }>) {
          nameMap.set(p.user_id, p.full_name ?? "");
        }
      }
      csv = toCsv(
        ["ID", "Fecha", "Entidad", "Entidad ID", "Evento", "Actor ID", "Actor", "Payload"],
        rows.map((r) => [
          r.id,
          fmtDate(r.occurred_at),
          r.subject_type,
          r.subject_id,
          r.kind,
          r.actor_user_id ?? "",
          r.actor_user_id ? nameMap.get(r.actor_user_id) ?? "" : "Sistema",
          r.payload ? JSON.stringify(r.payload) : "",
        ]),
      );
      break;
    }
    case "time-records": {
      // Registro horario para inspección de trabajo: una fila por fichaje
      // de los últimos 4 años (RD 8/2019 obliga a guardar 4 años).
      const fourYearsAgo = new Date();
      fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);
      const { data } = await supabase
        .from("time_punches")
        .select(
          "id, user_id, punch_kind, punched_at, geo_latitude, geo_longitude, needs_geo_review, is_manual, manual_reason, auto_closed, edited_by_admin, edited_reason",
        )
        .eq("company_id", session.company_id)
        .gte("punched_at", fourYearsAgo.toISOString())
        .order("punched_at", { ascending: true })
        .limit(200000);
      type Row = {
        id: string;
        user_id: string;
        punch_kind: string;
        punched_at: string;
        geo_latitude: number | null;
        geo_longitude: number | null;
        needs_geo_review: boolean;
        is_manual: boolean;
        manual_reason: string | null;
        auto_closed: boolean;
        edited_by_admin: string | null;
        edited_reason: string | null;
      };
      const rows = (data ?? []) as Row[];
      const uids = Array.from(new Set(rows.map((r) => r.user_id)));
      const nameMap = new Map<string, string>();
      if (uids.length > 0) {
        const { data: profs } = await supabase
          .from("user_profiles")
          .select("user_id, full_name")
          .in("user_id", uids);
        for (const p of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
          nameMap.set(p.user_id, p.full_name ?? "");
        }
      }
      csv = toCsv(
        [
          "ID Fichaje",
          "Empleado",
          "ID Empleado",
          "Tipo",
          "Fecha y hora",
          "Latitud",
          "Longitud",
          "Sin GPS",
          "Manual",
          "Motivo manual",
          "Autocerrado",
          "Editado por",
          "Motivo edición",
        ],
        rows.map((r) => [
          r.id,
          nameMap.get(r.user_id) ?? "",
          r.user_id,
          r.punch_kind,
          new Date(r.punched_at).toISOString(),
          r.geo_latitude != null ? String(r.geo_latitude) : "",
          r.geo_longitude != null ? String(r.geo_longitude) : "",
          r.needs_geo_review ? "SI" : "",
          r.is_manual ? "SI" : "",
          r.manual_reason ?? "",
          r.auto_closed ? "SI" : "",
          r.edited_by_admin ?? "",
          r.edited_reason ?? "",
        ]),
      );
      break;
    }
    case "wallet": {
      const { data } = await supabase
        .from("wallet_entries")
        .select(
          "id, contract_id, customer_id, concept, amount_cents, method, status, collected_at, validated_at",
        )
        .order("collected_at", { ascending: false })
        .limit(10000);
      csv = toCsv(
        [
          "ID",
          "Contrato ID",
          "Cliente ID",
          "Concepto",
          "Importe (€)",
          "Método",
          "Estado",
          "Cobrado",
          "Validado",
        ],
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          r.contract_id as string,
          r.customer_id as string,
          r.concept as string,
          fmtCents(r.amount_cents as number),
          r.method as string,
          r.status as string,
          fmtDate(r.collected_at as string),
          fmtDate(r.validated_at as string),
        ]),
      );
      break;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
