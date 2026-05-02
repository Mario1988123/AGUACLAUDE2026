"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { maintenanceCreateSchema, completeMaintenanceSchema } from "./schemas";
import { decrementStock } from "@/modules/warehouses/stock-decrement";

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

export async function getMaintenance(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("maintenance_jobs")
    .select(
      "id, status, kind, customer_id, customer_equipment_id, contract_id, technician_user_id, scheduled_at, started_at, completed_at, duration_seconds, is_charged, charge_cents, notes",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    status: string;
    kind: string;
    customer_id: string;
    customer_equipment_id: string | null;
    contract_id: string | null;
    technician_user_id: string | null;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    is_charged: boolean;
    charge_cents: number | null;
    notes: string | null;
  };
}

export async function startMaintenanceAction(id: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("maintenance_jobs")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "maintenance",
    subject_id: id,
    kind: "maintenance.started",
    payload: {},
    actor_user_id: session.user_id,
  });
  revalidatePath(`/mantenimientos/${id}`);
  revalidatePath("/mantenimientos");
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
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: prev } = await supabase
    .from("maintenance_jobs")
    .select("started_at, technician_user_id, company_id")
    .eq("id", parsed.id)
    .single();
  const startTs = (prev as { started_at: string | null } | null)?.started_at;
  const durationSec = startTs
    ? Math.floor((now.getTime() - new Date(startTs).getTime()) / 1000)
    : null;

  await supabase
    .from("maintenance_jobs")
    .update({
      status: "completed",
      completed_at: nowIso,
      duration_seconds: durationSec,
      notes: parsed.notes ?? null,
    })
    .eq("id", parsed.id);

  // Insertar items reemplazados + descontar stock del almacén del técnico
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

    // Buscar warehouse vehículo asignado al técnico
    const technicianId =
      (prev as { technician_user_id: string | null } | null)?.technician_user_id ?? null;
    let warehouseId: string | null = null;
    if (technicianId) {
      const { data: wh } = await supabase
        .from("warehouses")
        .select("id")
        .eq("company_id", session.company_id)
        .eq("assigned_user_id", technicianId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      warehouseId = (wh as { id: string } | null)?.id ?? null;
    }
    // Fallback: primer almacén main de la empresa
    if (!warehouseId) {
      const { data: wh } = await supabase
        .from("warehouses")
        .select("id")
        .eq("company_id", session.company_id)
        .eq("kind", "main")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      warehouseId = (wh as { id: string } | null)?.id ?? null;
    }

    if (warehouseId) {
      for (const it of parsed.replaced_items) {
        try {
          await decrementStock({
            company_id: session.company_id!,
            warehouse_id: warehouseId,
            product_id: it.product_id,
            quantity: it.quantity,
            movement_type: "outbound_maintenance",
            maintenance_id: parsed.id,
            performed_by: session.user_id,
            notes: "Recambio mantenimiento",
          });
        } catch {
          /* no-op */
        }
      }
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "maintenance",
    subject_id: parsed.id,
    kind: "maintenance.completed",
    payload: { items_replaced: parsed.replaced_items.length, duration_seconds: durationSec },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/mantenimientos/${parsed.id}`);
  revalidatePath("/mantenimientos");
}
