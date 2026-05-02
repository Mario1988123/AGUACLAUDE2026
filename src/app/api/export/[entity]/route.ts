import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { toCsv } from "@/shared/lib/csv/to-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITIES = ["leads", "customers", "contracts", "payments", "installations", "wallet"] as const;
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
