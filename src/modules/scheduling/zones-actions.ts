"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const CONFIG_ROLES = [
  "company_admin",
  "technical_director",
  "commercial_director",
];

async function ensureSchedAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.some((r) => CONFIG_ROLES.includes(r))) {
    throw new Error("No tienes permiso para configurar zonas");
  }
  return session;
}

export interface ServiceZoneRow {
  id: string;
  name: string;
  postal_prefixes: string[];
  weekdays: number[];
  active: boolean;
  notes: string | null;
}

export async function listServiceZones(): Promise<ServiceZoneRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("service_zones")
      .select("id, name, postal_prefixes, weekdays, active, notes")
      .eq("company_id", session.company_id)
      .order("name");
    return ((data ?? []) as ServiceZoneRow[]).map((z) => ({
      ...z,
      postal_prefixes: z.postal_prefixes ?? [],
      weekdays: z.weekdays ?? [],
    }));
  } catch {
    return [];
  }
}

const zoneSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "Ponle un nombre a la zona"),
  postal_prefixes: z
    .array(z.string().trim().regex(/^\d{1,5}$/, "Prefijos de CP: solo dígitos (1-5)"))
    .min(1, "Añade al menos un código postal o prefijo"),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Elige al menos un día de la semana"),
  active: z.boolean().nullish(),
  notes: z.string().trim().nullish(),
});

export async function upsertServiceZoneAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureSchedAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(zoneSchema, input, "Zona");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const payload = {
      company_id: session.company_id,
      name: parsed.name,
      postal_prefixes: Array.from(new Set(parsed.postal_prefixes)),
      weekdays: Array.from(new Set(parsed.weekdays)).sort((a, b) => a - b),
      active: parsed.active ?? true,
      notes: parsed.notes || null,
    };

    if (parsed.id) {
      const { error } = await admin
        .from("service_zones")
        .update(payload)
        .eq("id", parsed.id)
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/configuracion/zonas");
      return { ok: true, id: parsed.id };
    }
    const { data, error } = await admin
      .from("service_zones")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/zonas");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteServiceZoneAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureSchedAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("service_zones")
      .delete()
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/zonas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export interface SchedulingSettings {
  jobs_per_slot: number;
  offer_weeks: number;
  radius_km: number;
}

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  const def: SchedulingSettings = { jobs_per_slot: 2, offer_weeks: 4, radius_km: 15 };
  const session = await requireSession();
  if (!session.company_id) return def;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("company_settings")
      .select(
        "scheduling_jobs_per_slot, scheduling_offer_weeks, scheduling_max_route_radius_km",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!data) return def;
    return {
      jobs_per_slot: data.scheduling_jobs_per_slot ?? 2,
      offer_weeks: data.scheduling_offer_weeks ?? 4,
      radius_km: data.scheduling_max_route_radius_km ?? 15,
    };
  } catch {
    return def;
  }
}

const settingsSchema = z.object({
  jobs_per_slot: z.number().int().min(1).max(20),
  offer_weeks: z.number().int().min(1).max(12),
  radius_km: z.number().int().min(1).max(200),
});

export async function setSchedulingSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureSchedAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(settingsSchema, input, "Ajustes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // company_settings tiene PK company_id; aseguramos fila.
    const { data: existing } = await admin
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const payload = {
      scheduling_jobs_per_slot: parsed.jobs_per_slot,
      scheduling_offer_weeks: parsed.offer_weeks,
      scheduling_max_route_radius_km: parsed.radius_km,
    };
    if (existing) {
      const { error } = await admin
        .from("company_settings")
        .update(payload)
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin
        .from("company_settings")
        .insert({ company_id: session.company_id, ...payload });
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/configuracion/zonas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
