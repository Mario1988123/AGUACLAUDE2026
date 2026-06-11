"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { maintenanceCreateSchema, completeMaintenanceSchema } from "./schemas";
import { decrementStock } from "@/modules/warehouses/stock-decrement";
import { awardPoints, getPointsSettings } from "@/modules/points/award";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { computeMaintenanceJobAlerts } from "./alerts";

export interface MaintenanceRow {
  id: string;
  status: string;
  kind: string;
  customer_id: string;
  customer_name: string | null;
  technician_user_id: string | null;
  technician_name: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  is_charged: boolean;
  charge_cents: number | null;
  /** Avisos operativos por fila (mismo patrón que instalaciones / clientes).
   *  Frases cortas listas para pintar en el badge ⚠ N o el modal de ficha. */
  alerts: string[];
}


export async function getMaintenance(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("maintenance_jobs")
    .select(
      "id, status, kind, customer_id, customer_equipment_id, contract_id, technician_user_id, scheduled_at, started_at, completed_at, duration_seconds, is_charged, charge_cents, notes, customer_called_at, confirmed_at",
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
    customer_called_at: string | null;
    confirmed_at: string | null;
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
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Pasa un mantenimiento de 'preprogrammed' a 'scheduled', confirmando
 * que la visita es real y se mostrará en la agenda. Admin/TMK/dir
 * técnico pueden ejecutarla.
 *
 * Opcionalmente permite ajustar scheduled_at y asignar técnico.
 */
export async function validateMaintenanceJobAction(input: {
  id: string;
  scheduled_at?: string | null;
  technician_user_id?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("telemarketing_director");
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin / dirección técnica / TMK puede validar visitas.",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: job } = await admin
      .from("maintenance_jobs")
      .select("id, status, company_id, customer_id, scheduled_at")
      .eq("id", input.id)
      .maybeSingle();
    if (!job) return { ok: false, error: "Visita no encontrada" };
    const j = job as {
      id: string;
      status: string;
      company_id: string;
      customer_id: string;
      scheduled_at: string | null;
    };
    if (j.company_id !== session.company_id) {
      return { ok: false, error: "Esta visita pertenece a otra empresa" };
    }
    if (j.status !== "preprogrammed") {
      return { ok: false, error: `La visita ya está en estado ${j.status}` };
    }

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status: "scheduled",
      confirmed_at: nowIso,
      confirmed_by: session.user_id,
      customer_called_at: nowIso,
      customer_called_by: session.user_id,
    };
    if (input.scheduled_at) {
      const dt = new Date(input.scheduled_at);
      if (!isNaN(dt.getTime()) && dt.getTime() < Date.now() - 60 * 1000) {
        return {
          ok: false,
          error: "No puedes agendar una visita en el pasado",
        };
      }
      updates.scheduled_at = dt.toISOString();
    }
    if (input.technician_user_id !== undefined) {
      updates.technician_user_id = input.technician_user_id;
    }

    const { error } = await admin
      .from("maintenance_jobs")
      .update(updates)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "maintenance",
      subject_id: input.id,
      kind: "maintenance.validated",
      payload: {
        previous_scheduled_at: j.scheduled_at,
        new_scheduled_at: updates.scheduled_at ?? null,
      },
      actor_user_id: session.user_id,
    });
    revalidatePath(`/mantenimientos/${input.id}`);
    revalidatePath("/mantenimientos");
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Mueve la fecha propuesta de un mantenimiento preprogrammed sin
 * confirmarlo todavía. Sirve para reagendar rápido cuando el cliente
 * pide otro día pero no se cierra acuerdo en la misma llamada.
 * Permite delta en días (positivo o negativo) o fecha absoluta.
 */
export async function rescheduleMaintenanceProposalAction(input: {
  id: string;
  delta_days?: number;
  new_date?: string;
}): Promise<{ ok: true; new_scheduled_at: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("telemarketing_director");
    if (!allowed)
      return { ok: false, error: "Solo admin / dirección técnica / TMK" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: job } = await admin
      .from("maintenance_jobs")
      .select("id, status, company_id, scheduled_at")
      .eq("id", input.id)
      .maybeSingle();
    if (!job) return { ok: false, error: "Visita no encontrada" };
    const j = job as {
      status: string;
      company_id: string;
      scheduled_at: string | null;
    };
    if (j.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (j.status !== "preprogrammed")
      return {
        ok: false,
        error: "Solo se puede mover una propuesta sin confirmar",
      };

    const base = j.scheduled_at ? new Date(j.scheduled_at) : new Date();
    let next: Date;
    if (input.new_date) {
      next = new Date(input.new_date);
    } else if (typeof input.delta_days === "number") {
      next = new Date(base.getTime() + input.delta_days * 86400_000);
    } else {
      return { ok: false, error: "Falta delta_days o new_date" };
    }
    if (isNaN(next.getTime())) return { ok: false, error: "Fecha inválida" };
    if (next.getTime() < Date.now() - 60_000)
      return { ok: false, error: "No puedes mover al pasado" };

    const nowIso = new Date().toISOString();
    const newIso = next.toISOString();
    const { error } = await admin
      .from("maintenance_jobs")
      .update({
        scheduled_at: newIso,
        customer_called_at: nowIso,
        customer_called_by: session.user_id,
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "maintenance",
      subject_id: input.id,
      kind: "maintenance.proposal_moved",
      payload: {
        previous_scheduled_at: j.scheduled_at,
        new_scheduled_at: newIso,
        delta_days: input.delta_days ?? null,
      },
      actor_user_id: session.user_id,
    });
    revalidatePath("/mantenimientos");
    revalidatePath("/mantenimientos/por-confirmar");
    return { ok: true, new_scheduled_at: newIso };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function startMaintenanceAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Admin client: si el técnico_user_id de este job no coincide con el
  // que está pulsando "Iniciar" (porque fue reasignado), la policy
  // mant_update silenciaría el UPDATE.
  // SEGURIDAD: admin salta RLS → filtrar por company_id para no iniciar
  // mantenimientos de otra empresa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("maintenance_jobs")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", session.company_id)
    .select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Mantenimiento no encontrado o no pertenece a tu empresa");
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
      "id, status, kind, customer_id, technician_user_id, scheduled_at, started_at, completed_at, is_charged, charge_cents, customer_called_at, confirmed_at",
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
  const rows = (data ?? []) as Array<
    Omit<MaintenanceRow, "customer_name" | "technician_name" | "alerts"> & {
      started_at?: string | null;
      customer_called_at?: string | null;
      confirmed_at?: string | null;
    }
  >;
  const ids = Array.from(new Set(rows.map((r) => r.customer_id)));
  const techIds = Array.from(
    new Set(
      rows
        .map((r) => r.technician_user_id)
        .filter((v): v is string => !!v),
    ),
  );
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
  const techMap = new Map<string, string>();
  if (techIds.length > 0) {
    const { data: tprofs } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", techIds);
    for (const t of (tprofs ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      if (t.full_name) techMap.set(t.user_id, t.full_name);
    }
  }
  return rows.map((r) => {
    const alerts = computeMaintenanceJobAlerts({
      status: r.status,
      scheduled_at: r.scheduled_at,
      started_at: r.started_at ?? null,
      technician_user_id: r.technician_user_id,
      customer_called_at: r.customer_called_at ?? null,
      confirmed_at: r.confirmed_at ?? null,
    });
    return {
      id: r.id,
      status: r.status,
      kind: r.kind,
      customer_id: r.customer_id,
      technician_user_id: r.technician_user_id,
      scheduled_at: r.scheduled_at,
      completed_at: r.completed_at,
      is_charged: r.is_charged,
      charge_cents: r.charge_cents,
      customer_name: nameMap.get(r.customer_id) ?? null,
      technician_name: r.technician_user_id
        ? techMap.get(r.technician_user_id) ?? null
        : null,
      alerts,
    };
  });
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
  if (!session.company_id) throw new Error("Sin empresa");
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
    .eq("company_id", session.company_id)
    .maybeSingle();
  // SEGURIDAD: `supabase` aplica RLS → prev null = de otra empresa o inexistente.
  // Abortamos para que el UPDATE admin de abajo (salta RLS) no cierre jobs ajenos.
  if (!prev) throw new Error("Mantenimiento no encontrado o no pertenece a tu empresa");
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
    .eq("id", parsed.id)
    .eq("company_id", session.company_id);
  if (updR.error) throw new Error(updR.error.message);

  // Auto-resolver notificaciones del mantenimiento (ya completado).
  try {
    const { autoResolveNotificationsForSubject } = await import(
      "@/modules/notifications/subject-actions"
    );
    await autoResolveNotificationsForSubject(
      "maintenance",
      parsed.id,
      "Mantenimiento completado",
    );
  } catch {
    /* fail-soft */
  }

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

/**
 * Devuelve true si la visita pasada es la ÚLTIMA visita "contracted"
 * del contrato vinculado (todas las demás están completed o cancelled).
 * Se usa al cerrar mantenimiento para ofrecer renovación al cliente.
 */
export async function isLastContractedMaintenance(
  jobId: string,
): Promise<{
  isLast: boolean;
  contract_id: string | null;
  customer_equipment_id: string | null;
}> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: job } = await admin
      .from("maintenance_jobs")
      .select("id, contract_id, kind, customer_id, customer_equipment_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job)
      return {
        isLast: false,
        contract_id: null,
        customer_equipment_id: null,
      };
    const j = job as {
      id: string;
      contract_id: string | null;
      kind: string;
      customer_id: string;
      customer_equipment_id: string | null;
    };
    if (j.kind !== "contracted" || !j.contract_id) {
      return {
        isLast: false,
        contract_id: null,
        customer_equipment_id: j.customer_equipment_id,
      };
    }
    // ¿Quedan otras visitas contracted del mismo contrato que NO estén
    // completed/cancelled (incluyendo la propia)?
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", j.contract_id)
      .eq("kind", "contracted")
      .not("id", "eq", j.id)
      .in("status", ["preprogrammed", "scheduled", "in_progress"]);
    return {
      isLast: (count ?? 0) === 0,
      contract_id: j.contract_id,
      customer_equipment_id: j.customer_equipment_id,
    };
  } catch {
    return { isLast: false, contract_id: null, customer_equipment_id: null };
  }
}

/**
 * Registra que el cliente RECHAZÓ renovar el contrato de mantenimiento
 * al terminar la última visita. Crea una tarea de seguimiento en la
 * agenda para que TMK lo llame en N días (default 30).
 */
export async function declineRenewalAction(input: {
  contract_id: string;
  call_in_days?: number;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const days = input.call_in_days ?? 30;
    const callAt = new Date(Date.now() + days * 86400000);

    const { data: ct } = await admin
      .from("contracts")
      .select("id, customer_id, reference_code")
      .eq("id", input.contract_id)
      .maybeSingle();
    if (!ct) return { ok: false, error: "Contrato no encontrado" };
    const c = ct as { id: string; customer_id: string; reference_code: string | null };

    // Marcar el contrato como rechazó renovación
    await admin
      .from("contracts")
      .update({
        renewal_offered_at: new Date().toISOString(),
        renewal_declined_at: new Date().toISOString(),
        renewal_call_scheduled_at: callAt.toISOString(),
        renewal_offered_by_user_id: session.user_id,
      })
      .eq("id", input.contract_id);

    // Crear evento de agenda tipo task para TMK
    try {
      await admin.from("agenda_events").insert({
        company_id: session.company_id,
        kind: "task",
        title: `Llamar para reactivar mantenimiento · ${c.reference_code ?? "Contrato"}`,
        description:
          input.notes ??
          "Cliente no aceptó la renovación tras la última visita. Llamar para ofrecer un nuevo contrato de mantenimiento.",
        starts_at: callAt.toISOString(),
        subject_type: "customer",
        subject_id: c.customer_id,
      });
    } catch {
      /* fail-soft: agenda_events puede no existir aún */
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: input.contract_id,
      kind: "contract.renewal_declined",
      payload: { call_scheduled_at: callAt.toISOString() },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/contratos/${input.contract_id}`);
    revalidatePath(`/clientes/${c.customer_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * El cliente acepta la renovación. Crea un nuevo contrato de
 * mantenimiento (kind=maintenance_contract) basado en un plan elegido
 * y genera los siguientes jobs preprogrammed.
 */
export async function acceptRenewalAction(input: {
  contract_id: string;
  maintenance_plan_id: string;
  /** Regla 2026-05-25: contrato POR EQUIPO. Se rellena desde el wizard
   *  con el customer_equipment_id del job que cerró la última visita. */
  customer_equipment_id?: string | null;
}): Promise<
  | { ok: true; new_maintenance_contract_id: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: ct } = await admin
      .from("contracts")
      .select("id, customer_id, reference_code")
      .eq("id", input.contract_id)
      .maybeSingle();
    if (!ct) return { ok: false, error: "Contrato origen no encontrado" };
    const c = ct as { id: string; customer_id: string; reference_code: string | null };

    const { data: plan } = await admin
      .from("maintenance_plans")
      .select("id, tier, monthly_cents, name")
      .eq("id", input.maintenance_plan_id)
      .maybeSingle();
    if (!plan) return { ok: false, error: "Plan de mantenimiento no encontrado" };
    const p = plan as {
      id: string;
      tier: string;
      monthly_cents: number;
      name: string;
    };

    // Crear maintenance_contract activo. Si el job que disparó la
    // renovación venía con customer_equipment_id, lo propagamos para
    // que el contrato quede ligado al equipo concreto (regla 2026-05-25).
    const { data: created, error } = await admin
      .from("maintenance_contracts")
      .insert({
        company_id: session.company_id,
        customer_id: c.customer_id,
        customer_equipment_id: input.customer_equipment_id ?? null,
        plan_id: p.id,
        tier_snapshot: p.tier,
        monthly_cents_snapshot: p.monthly_cents,
        status: "active",
        source_contract_id: c.id,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const newId = (created as { id: string }).id;

    // Marcar contrato origen como renovado
    await admin
      .from("contracts")
      .update({
        renewal_offered_at: new Date().toISOString(),
        renewal_accepted_at: new Date().toISOString(),
        renewal_new_contract_id: newId,
        renewal_offered_by_user_id: session.user_id,
      })
      .eq("id", input.contract_id);

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: input.contract_id,
      kind: "contract.renewal_accepted",
      payload: {
        new_maintenance_contract_id: newId,
        plan_id: p.id,
        plan_name: p.name,
      },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/contratos/${input.contract_id}`);
    revalidatePath(`/clientes/${c.customer_id}`);
    revalidatePath("/mantenimientos");
    return { ok: true, new_maintenance_contract_id: newId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ============================================================================
// Safe wrappers (result pattern) — 2026-05-20
// ============================================================================

export async function completeMaintenanceSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await completeMaintenanceAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function startMaintenanceSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await startMaintenanceAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function createMaintenanceSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createMaintenanceAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
