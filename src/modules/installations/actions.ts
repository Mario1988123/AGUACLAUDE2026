"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  installationCreateFromContractSchema,
  installationUpdateSchema,
  startInstallationSchema,
  installationStepSchema,
  completeInstallationSchema,
} from "./schemas";
import { notifyInstallationCompleted } from "@/modules/notifications/notifier";
import { autoScheduleMaintenanceForContract } from "@/modules/maintenance/auto-schedule";
import { decrementStockForInstallation } from "@/modules/warehouses/stock-decrement";

/**
 * Reasigna instalador. Solo admin/director técnico.
 */
export async function reassignInstallationAction(
  installationId: string,
  installerUserId: string | null,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isUpper) throw new Error("Solo admin o director técnico");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("installations")
    .update({ installer_user_id: installerUserId })
    .eq("id", installationId);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.reassigned",
    payload: { to_user_id: installerUserId },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/instalaciones/${installationId}`);
  revalidatePath("/instalaciones");
}

export interface InstallationRow {
  id: string;
  reference_code: string | null;
  status: string;
  kind: string;
  installer_user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  contract_id: string | null;
  address_id: string | null;
}

export async function listInstallations(filters?: {
  installer_user_id?: string;
  status?: string;
}): Promise<InstallationRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("installations")
    .select(
      "id, reference_code, status, kind, installer_user_id, customer_id, scheduled_at, started_at, completed_at, created_at, contract_id, address_id",
    )
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);

  // Si es nivel 3 instalador → forzar a sus instalaciones
  if (
    session.roles.includes("installer") &&
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    query = query
      .eq("installer_user_id", session.user_id)
      .not("status", "in", "(completed,cancelled)");
  } else if (filters?.installer_user_id) {
    query = query.eq("installer_user_id", filters.installer_user_id);
  }
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<InstallationRow, "customer_name">>;
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
  );
  let nameMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
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
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer_id ? nameMap.get(r.customer_id) ?? null : null,
  }));
}

export async function getInstallation(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("installations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function getInstallationItems(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_items")
    .select("id, product_id, quantity, serial_number, notes")
    .eq("installation_id", installationId);
  return (data ?? []) as Array<{
    id: string;
    product_id: string;
    quantity: number;
    serial_number: string | null;
    notes: string | null;
  }>;
}

export async function getInstallationPhotos(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_photos")
    .select("id, storage_path, category, caption, taken_at")
    .eq("installation_id", installationId)
    .order("taken_at");
  return (data ?? []) as Array<{
    id: string;
    storage_path: string;
    category: string;
    caption: string | null;
    taken_at: string;
  }>;
}

export async function getInstallationSignatures(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_signatures")
    .select("id, signer_role, signer_name, context, signed_at")
    .eq("installation_id", installationId)
    .order("signed_at");
  return (data ?? []) as Array<{
    id: string;
    signer_role: string;
    signer_name: string;
    context: string | null;
    signed_at: string;
  }>;
}

/**
 * Crea instalación a partir de un contrato firmado/activo.
 * Copia items del contrato y deja en estado unscheduled.
 */
export async function createInstallationFromContract(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = installationCreateFromContractSchema.parse(input);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, status, customer_id")
    .eq("id", parsed.contract_id)
    .single();
  if (!contract) throw new Error("Contrato no encontrado");
  const c = contract as { id: string; status: string; customer_id: string };
  if (!["signed", "active"].includes(c.status)) {
    throw new Error("El contrato debe estar firmado o activo");
  }

  // Verificar que no hay ya instalación para este contrato
  const { count } = await supabase
    .from("installations")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", parsed.contract_id)
    .is("deleted_at", null);
  if ((count ?? 0) > 0) throw new Error("Ya existe una instalación para este contrato");

  const { data: created, error } = await supabase
    .from("installations")
    .insert({
      company_id: session.company_id,
      kind: "normal",
      status: parsed.scheduled_at ? "scheduled" : "unscheduled",
      contract_id: c.id,
      customer_id: c.customer_id,
      scheduled_at: parsed.scheduled_at || null,
      installer_user_id: parsed.installer_user_id || null,
      source_warehouse_id: parsed.source_warehouse_id || null,
      assigned_at: parsed.installer_user_id ? new Date().toISOString() : null,
      assigned_by: parsed.installer_user_id ? session.user_id : null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const installationId = (created as { id: string }).id;

  // Copiar items del contrato
  const { data: items } = await supabase
    .from("contract_items")
    .select("product_id, quantity, display_order, notes")
    .eq("contract_id", c.id);
  type CI = { product_id: string; quantity: number; display_order: number; notes: string | null };
  const list = (items ?? []) as CI[];
  if (list.length > 0) {
    await supabase.from("installation_items").insert(
      list.map((it) => ({
        installation_id: installationId,
        company_id: session.company_id,
        product_id: it.product_id,
        quantity: it.quantity,
        display_order: it.display_order,
        notes: it.notes,
      })),
    );
  }

  // Si tiene scheduled_at + installer, crear evento agenda
  if (parsed.scheduled_at && parsed.installer_user_id) {
    await supabase.from("agenda_events").insert({
      company_id: session.company_id,
      kind: "installation",
      status: "scheduled",
      title: "Instalación programada",
      starts_at: parsed.scheduled_at,
      assigned_user_id: parsed.installer_user_id,
      subject_type: "installation",
      subject_id: installationId,
      created_by: session.user_id,
    });
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.scheduled",
    payload: { contract_id: c.id, scheduled_at: parsed.scheduled_at || null },
    actor_user_id: session.user_id,
  });

  revalidatePath("/instalaciones");
  revalidatePath(`/contratos/${c.id}`);
  redirect(`/instalaciones/${installationId}` as never);
}

export async function updateInstallationAction(input: unknown) {
  const session = await requireSession();
  const parsed = installationUpdateSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const update: Record<string, unknown> = {};
  if (parsed.scheduled_at !== undefined) update.scheduled_at = parsed.scheduled_at || null;
  if (parsed.installer_user_id !== undefined) {
    update.installer_user_id = parsed.installer_user_id || null;
    update.assigned_at = parsed.installer_user_id ? new Date().toISOString() : null;
    update.assigned_by = parsed.installer_user_id ? session.user_id : null;
  }
  if (parsed.preferred_time_slot !== undefined)
    update.preferred_time_slot = parsed.preferred_time_slot || null;
  if (Object.keys(update).length === 0) return;
  if (update.scheduled_at && update.installer_user_id) update.status = "scheduled";

  const { error } = await supabase.from("installations").update(update).eq("id", parsed.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/instalaciones/${parsed.id}`);
}

export async function startInstallation(input: unknown) {
  const session = await requireSession();
  const parsed = startInstallationSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("installations")
    .update({
      status: "in_progress",
      started_at: now,
      geo_started_lat: parsed.geo_lat ?? null,
      geo_started_lng: parsed.geo_lng ?? null,
    })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  await supabase.from("installation_steps_log").insert({
    installation_id: parsed.id,
    company_id: session.company_id,
    event_type: "start",
    event_user_id: session.user_id,
    geo_latitude: parsed.geo_lat ?? null,
    geo_longitude: parsed.geo_lng ?? null,
  });

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "installation",
    subject_id: parsed.id,
    kind: "installation.started",
    payload: {},
    actor_user_id: session.user_id,
  });

  revalidatePath(`/instalaciones/${parsed.id}`);
}

export async function pauseInstallation(id: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("installations").update({ status: "paused" }).eq("id", id);
  await supabase.from("installation_steps_log").insert({
    installation_id: id,
    company_id: session.company_id,
    event_type: "pause",
    event_user_id: session.user_id,
  });
  revalidatePath(`/instalaciones/${id}`);
}

export async function resumeInstallation(id: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("installations").update({ status: "in_progress" }).eq("id", id);
  await supabase.from("installation_steps_log").insert({
    installation_id: id,
    company_id: session.company_id,
    event_type: "resume",
    event_user_id: session.user_id,
  });
  revalidatePath(`/instalaciones/${id}`);
}

export async function reportDamageOrDrilling(input: unknown) {
  const session = await requireSession();
  const parsed = installationStepSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const update: Record<string, unknown> = {};
  if (parsed.has_previous_damage !== undefined)
    update.has_previous_damage = parsed.has_previous_damage;
  if (parsed.needs_countertop_drilling !== undefined)
    update.needs_countertop_drilling = parsed.needs_countertop_drilling;
  if (Object.keys(update).length > 0) {
    await supabase.from("installations").update(update).eq("id", parsed.installation_id);
  }
  if (parsed.has_previous_damage) {
    await supabase.from("installation_steps_log").insert({
      installation_id: parsed.installation_id,
      company_id: session.company_id,
      event_type: "damage_report",
      event_user_id: session.user_id,
      payload: { notes: parsed.notes ?? null },
    });
  }
  if (parsed.needs_countertop_drilling) {
    await supabase.from("installation_steps_log").insert({
      installation_id: parsed.installation_id,
      company_id: session.company_id,
      event_type: "drilling_report",
      event_user_id: session.user_id,
      payload: { notes: parsed.notes ?? null },
    });
  }

  revalidatePath(`/instalaciones/${parsed.installation_id}`);
}

export async function completeInstallation(input: unknown) {
  const session = await requireSession();
  const parsed = completeInstallationSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const nowIso = now.toISOString();

  // Calcular duración si tenemos started_at
  const { data: inst } = await supabase
    .from("installations")
    .select("started_at, contract_id, customer_id, address_id")
    .eq("id", parsed.id)
    .single();
  const startTs = (inst as { started_at: string | null })?.started_at;
  const durationSec = startTs
    ? Math.floor((now.getTime() - new Date(startTs).getTime()) / 1000)
    : null;

  await supabase
    .from("installations")
    .update({
      status: "completed",
      completed_at: nowIso,
      duration_seconds: durationSec,
      geo_completed_lat: parsed.geo_lat ?? null,
      geo_completed_lng: parsed.geo_lng ?? null,
      notes: parsed.notes ?? null,
    })
    .eq("id", parsed.id);

  await supabase.from("installation_steps_log").insert({
    installation_id: parsed.id,
    company_id: session.company_id,
    event_type: "complete",
    event_user_id: session.user_id,
    geo_latitude: parsed.geo_lat ?? null,
    geo_longitude: parsed.geo_lng ?? null,
  });

  // Decrementar stock del almacén origen (no falla si no hay warehouse)
  try {
    await decrementStockForInstallation(parsed.id);
  } catch {
    /* no-op: stock no debe tumbar finalización */
  }

  // Crear customer_equipment para cada item instalado (si hay contract)
  const i = inst as { contract_id: string | null; customer_id: string | null; address_id: string | null };
  if (i.customer_id) {
    const { data: items } = await supabase
      .from("installation_items")
      .select("product_id, serial_number")
      .eq("installation_id", parsed.id);
    type II = { product_id: string; serial_number: string | null };
    const list = (items ?? []) as II[];
    if (list.length > 0) {
      await supabase.from("customer_equipment").insert(
        list.map((it) => ({
          company_id: session.company_id,
          customer_id: i.customer_id,
          product_id: it.product_id,
          installation_id: parsed.id,
          address_id: i.address_id,
          serial_number: it.serial_number,
          installed_at: now.toISOString().slice(0, 10),
        })),
      );
    }
  }

  // Persistir service_start_date en el contrato (fecha de inicio del servicio).
  // Si es hoy o pasada → activar; si es futura → dejar en signed (lo activará el cron).
  if (i.contract_id) {
    const todayIso = now.toISOString().slice(0, 10);
    const startIso = parsed.service_start_date ?? todayIso;
    const isFuture = startIso > todayIso;

    const update: Record<string, unknown> = { service_start_date: startIso };
    if (!isFuture) update.status = "active";

    const { data: updated } = await supabase
      .from("contracts")
      .update(update)
      .eq("id", i.contract_id)
      .in("status", ["signed", "active"])
      .select("id, status");
    const wasActivatedNow =
      !isFuture &&
      ((updated ?? []) as Array<{ id: string; status: string }>).some((r) => r.status === "active");
    if (wasActivatedNow) {
      await autoScheduleMaintenanceForContract(i.contract_id);
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "installation",
    subject_id: parsed.id,
    kind: "installation.completed",
    payload: { duration_seconds: durationSec },
    actor_user_id: session.user_id,
  });

  const { data: instRef } = await supabase
    .from("installations")
    .select("reference_code")
    .eq("id", parsed.id)
    .single();
  await notifyInstallationCompleted(
    session.company_id!,
    parsed.id,
    (instRef as { reference_code: string | null } | null)?.reference_code ?? null,
  );

  revalidatePath(`/instalaciones/${parsed.id}`);
  revalidatePath("/instalaciones");
}
