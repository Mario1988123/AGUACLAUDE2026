"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { maintenanceCreateSchema, completeMaintenanceSchema } from "./schemas";
import { decrementStock } from "@/modules/warehouses/stock-decrement";
import { awardPoints, getPointsSettings } from "@/modules/points/award";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

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

/**
 * Reasigna un mantenimiento a otro técnico. Solo nivel 1/2 técnico.
 */
export async function reassignMaintenanceAction(
  id: string,
  newTechnicianUserId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Solo admin o director técnico" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prev } = await admin
      .from("maintenance_jobs")
      .select("technician_user_id, company_id")
      .eq("id", id)
      .maybeSingle();
    const p = prev as
      | { technician_user_id: string | null; company_id: string }
      | null;
    if (!p) return { ok: false, error: "Mantenimiento no encontrado" };
    if (p.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };

    const { error } = await admin
      .from("maintenance_jobs")
      .update({ technician_user_id: newTechnicianUserId })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    await admin.from("events").insert({
      company_id: session.company_id!,
      subject_type: "maintenance",
      subject_id: id,
      kind: "maintenance.reassigned",
      payload: {
        previous_user_id: p.technician_user_id,
        new_user_id: newTechnicianUserId,
      },
      actor_user_id: session.user_id,
    });

    // Notificar al nuevo técnico si lo hay
    if (newTechnicianUserId) {
      try {
        await admin.from("notifications").insert({
          company_id: session.company_id,
          recipient_user_id: newTechnicianUserId,
          kind: "maintenance.assigned",
          severity: "info",
          title: "Mantenimiento asignado",
          body: "Se te ha asignado un mantenimiento. Revisa /mantenimientos.",
          subject_type: "maintenance",
          subject_id: id,
          action_url: `/mantenimientos/${id}`,
        });
      } catch {
        /* fail-soft */
      }
    }

    revalidatePath(`/mantenimientos/${id}`);
    revalidatePath("/mantenimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function startMaintenanceAction(id: string) {
  const session = await requireSession();
  // Admin client: si el técnico_user_id de este job no coincide con el
  // que está pulsando "Iniciar" (porque fue reasignado), la policy
  // mant_update silenciaría el UPDATE.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("maintenance_jobs")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
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

export async function listMaintenance(filters?: {
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<MaintenanceRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("maintenance_jobs")
    .select(
      "id, status, kind, customer_id, technician_user_id, scheduled_at, completed_at, is_charged, charge_cents",
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);
  const isLevel1 =
    session.is_superadmin || session.roles.includes("company_admin");
  const isTechDirector = session.roles.includes("technical_director");
  const isInstaller = session.roles.includes("installer");

  // Comercial / telemarketer no acceden al módulo de mantenimientos.
  if (!isLevel1 && !isTechDirector && !isInstaller) {
    return [];
  }

  if (isInstaller && !isLevel1 && !isTechDirector) {
    query = query.eq("technician_user_id", session.user_id);
  }
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.fromDate) query = query.gte("scheduled_at", filters.fromDate);
  if (filters?.toDate) query = query.lte("scheduled_at", filters.toDate);
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
  const parsed = parseOrFriendly(maintenanceCreateSchema, input, "Mantenimiento");
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

  // Crear evento agenda si hay técnico asignado. El título incluye
  // el nombre del cliente para que el técnico lo vea sin abrir el job.
  if (parsed.technician_user_id) {
    let customerLabel: string | null = null;
    if (parsed.customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("trade_name, legal_name, first_name, last_name")
        .eq("id", parsed.customer_id)
        .maybeSingle();
      const cu = cust as
        | {
            trade_name: string | null;
            legal_name: string | null;
            first_name: string | null;
            last_name: string | null;
          }
        | null;
      if (cu) {
        customerLabel =
          cu.trade_name ||
          cu.legal_name ||
          `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() ||
          null;
      }
    }
    await supabase.from("agenda_events").insert({
      company_id: session.company_id,
      kind: "maintenance",
      status: "scheduled",
      title: customerLabel
        ? `Mantenimiento · ${customerLabel}`
        : "Mantenimiento programado",
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
  const parsed = parseOrFriendly(completeMaintenanceSchema, input, "Cerrar mantenimiento");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: prev } = await supabase
    .from("maintenance_jobs")
    .select(
      "started_at, technician_user_id, company_id, customer_equipment_id, customer_id",
    )
    .eq("id", parsed.id)
    .single();
  const startTs = (prev as { started_at: string | null } | null)?.started_at;
  const durationSec = startTs
    ? Math.floor((now.getTime() - new Date(startTs).getTime()) / 1000)
    : null;

  // Admin client por mismo motivo que startMaintenanceAction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const updR = await admin
    .from("maintenance_jobs")
    .update({
      status: "completed",
      completed_at: nowIso,
      duration_seconds: durationSec,
      notes: parsed.notes ?? null,
    })
    .eq("id", parsed.id);
  if (updR.error) throw new Error(updR.error.message);

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

  // Nota: customer_equipment.last_maintenance_at NO es columna real;
  // se calcula como max(maintenance_jobs.completed_at) en
  // equipment-actions.ts → no hace falta update extra.

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "maintenance",
    subject_id: parsed.id,
    kind: "maintenance.completed",
    payload: { items_replaced: parsed.replaced_items.length, duration_seconds: durationSec },
    actor_user_id: session.user_id,
  });

  // Puntos al técnico
  if (session.company_id) {
    try {
      const technicianId =
        (prev as { technician_user_id: string | null } | null)?.technician_user_id ??
        session.user_id;
      const cfg = await getPointsSettings(session.company_id);
      if (technicianId && cfg.points_per_maintenance > 0) {
        await awardPoints({
          company_id: session.company_id,
          user_id: technicianId,
          points: cfg.points_per_maintenance,
          reason: "maintenance_completed",
          subject_type: "maintenance",
          subject_id: parsed.id,
        });
      }
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/mantenimientos/${parsed.id}`);
  revalidatePath("/mantenimientos");
}
