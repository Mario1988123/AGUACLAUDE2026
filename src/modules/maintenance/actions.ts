"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { maintenanceCreateSchema, completeMaintenanceSchema } from "./schemas";

export interface MaintenanceRow {
  id: string;
  status: string;
  kind: string;
  customer_id: string;
  customer_name: string | null;
  technician_user_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  is_charged: boolean;
  charge_cents: number | null;
}

export async function listMaintenance(): Promise<MaintenanceRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("maintenance_jobs")
    .select(
      "id, status, kind, customer_id, technician_user_id, scheduled_at, completed_at, is_charged, charge_cents",
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (
    session.roles.includes("installer") &&
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    query = query.eq("technician_user_id", session.user_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<MaintenanceRow, "customer_name">>;
  const ids = Array.from(new Set(rows.map((r) => r.customer_id)));
  let nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", ids);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    nameMap = new Map(
      ((cs ?? []) as CC[]).map((c) => [
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      ]),
    );
  }
  return rows.map((r) => ({ ...r, customer_name: nameMap.get(r.customer_id) ?? null }));
}

export async function createMaintenanceAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = maintenanceCreateSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: created, error } = await supabase
    .from("maintenance_jobs")
    .insert({
      company_id: session.company_id,
      customer_id: parsed.customer_id,
      customer_equipment_id: parsed.customer_equipment_id || null,
      contract_id: parsed.contract_id || null,
      kind: parsed.kind,
      status: "scheduled",
      scheduled_at: parsed.scheduled_at,
      technician_user_id: parsed.technician_user_id || null,
      is_charged: parsed.is_charged,
      charge_cents: parsed.charge_cents ?? null,
      notes: parsed.notes || null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (created as { id: string }).id;

  // Crear evento agenda si hay técnico asignado
  if (parsed.technician_user_id) {
    await supabase.from("agenda_events").insert({
      company_id: session.company_id,
      kind: "maintenance",
      status: "scheduled",
      title: "Mantenimiento programado",
      starts_at: parsed.scheduled_at,
      assigned_user_id: parsed.technician_user_id,
      subject_type: "maintenance",
      subject_id: id,
      created_by: session.user_id,
    });
  }
  revalidatePath("/mantenimientos");
}

export async function completeMaintenanceAction(input: unknown) {
  const session = await requireSession();
  const parsed = completeMaintenanceSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date().toISOString();
  await supabase
    .from("maintenance_jobs")
    .update({
      status: "completed",
      completed_at: now,
      notes: parsed.notes ?? null,
    })
    .eq("id", parsed.id);

  // Insertar items reemplazados (descuentan stock vía lógica posterior)
  if (parsed.replaced_items.length > 0) {
    await supabase.from("maintenance_items_replaced").insert(
      parsed.replaced_items.map((it) => ({
        maintenance_job_id: parsed.id,
        company_id: session.company_id,
        product_id: it.product_id,
        quantity: it.quantity,
        was_replaced: true,
      })),
    );
  }

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "maintenance",
    subject_id: parsed.id,
    kind: "maintenance.completed",
    payload: { items_replaced: parsed.replaced_items.length },
    actor_user_id: session.user_id,
  });
  revalidatePath("/mantenimientos");
}
