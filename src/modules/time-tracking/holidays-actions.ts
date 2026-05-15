"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface HolidayRow {
  id: string;
  scope: "national" | "region" | "company";
  region_code: string | null;
  holiday_date: string;
  name: string;
  is_workable: boolean;
  is_global: boolean; // company_id null
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function listHolidaysForYear(year: number): Promise<HolidayRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const filter = session.company_id
    ? `company_id.is.null,company_id.eq.${session.company_id}`
    : `company_id.is.null`;
  const { data } = await admin
    .from("holidays")
    .select("id, company_id, scope, region_code, holiday_date, name, is_workable")
    .gte("holiday_date", start)
    .lte("holiday_date", end)
    .or(filter)
    .order("holiday_date");
  type R = {
    id: string;
    company_id: string | null;
    scope: "national" | "region" | "company";
    region_code: string | null;
    holiday_date: string;
    name: string;
    is_workable: boolean;
  };
  return ((data ?? []) as R[]).map((r) => ({
    id: r.id,
    scope: r.scope,
    region_code: r.region_code,
    holiday_date: r.holiday_date,
    name: r.name,
    is_workable: r.is_workable,
    is_global: r.company_id === null,
  }));
}

export async function addHolidayAction(input: {
  date: string;
  name: string;
  region_code?: string;
}): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("holidays").insert({
    company_id: session.company_id,
    scope: input.region_code ? "region" : "company",
    region_code: input.region_code ?? null,
    holiday_date: input.date,
    name: input.name,
  });
  revalidatePath("/configuracion/festivos");
}

export async function deleteHolidayAction(id: string): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Solo permitimos borrar los de la propia empresa, no los nacionales
  await admin
    .from("holidays")
    .delete()
    .eq("id", id)
    .eq("company_id", session.company_id);
  revalidatePath("/configuracion/festivos");
}

export async function setCompanyRegionAction(regionCode: string): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("company_settings")
    .update({ region_code: regionCode })
    .eq("company_id", session.company_id);
  revalidatePath("/configuracion/festivos");
}

/** Setea CCAA y ciudad simultáneamente. Defensivo si city_code no
 *  está en cache aún. */
export async function setCompanyLocalityAction(input: {
  ccaa: string | null;
  city_code: string | null;
}): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload: Record<string, unknown> = {
    region_code: input.ccaa ?? null,
    city_code: input.city_code ?? null,
  };
  let r = await admin
    .from("company_settings")
    .update(payload)
    .eq("company_id", session.company_id);
  if (r.error && /city_code|schema cache|Could not find/i.test(r.error.message ?? "")) {
    delete payload.city_code;
    r = await admin
      .from("company_settings")
      .update(payload)
      .eq("company_id", session.company_id);
  }
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/configuracion/festivos");
}

export async function getCompanyRegion(): Promise<string | null> {
  try {
    const session = await requireSession();
    if (!session.company_id) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("company_settings")
      .select("region_code")
      .eq("company_id", session.company_id)
      .maybeSingle();
    return (data as { region_code: string | null } | null)?.region_code ?? null;
  } catch {
    return null;
  }
}

export async function getCompanyLocality(): Promise<{
  ccaa: string | null;
  city_code: string | null;
}> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ccaa: null, city_code: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    let res = await admin
      .from("company_settings")
      .select("region_code, city_code")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (
      res.error &&
      /city_code|schema cache|Could not find/i.test(res.error.message ?? "")
    ) {
      res = await admin
        .from("company_settings")
        .select("region_code")
        .eq("company_id", session.company_id)
        .maybeSingle();
    }
    const r = res.data as {
      region_code: string | null;
      city_code?: string | null;
    } | null;
    return {
      ccaa: r?.region_code ?? null,
      city_code: r?.city_code ?? null,
    };
  } catch {
    return { ccaa: null, city_code: null };
  }
}
