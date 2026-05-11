"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

/**
 * Configuración GENERAL de la empresa: horario, tolerancias instalación y
 * color PDF. Los datos fiscales (razón social, CIF, dirección fiscal,
 * teléfono, email, IBAN) se gestionan en /configuracion/fiscal — fuente
 * única para evitar duplicación.
 */
export interface CompanySettings {
  business_hours: Record<string, { open: string; close: string } | null>;
  installation_geo_tolerance_m: number;
  installation_time_tolerance_min: number;
  pdf_brand_color: string;
}

const settingsSchema = z.object({
  business_hours: z.any().optional(),
  installation_geo_tolerance_m: z.coerce.number().int().min(50).max(5000).optional(),
  installation_time_tolerance_min: z.coerce.number().int().min(0).max(240).optional(),
  pdf_brand_color: z.string().optional(),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select(
      "business_hours, installation_geo_tolerance_m, installation_time_tolerance_min, pdf_brand_color",
    )
    .eq("company_id", session.company_id!)
    .maybeSingle();
  return {
    business_hours: data?.business_hours ?? {
      mon: { open: "09:00", close: "18:00" },
      tue: { open: "09:00", close: "18:00" },
      wed: { open: "09:00", close: "18:00" },
      thu: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "18:00" },
      sat: null,
      sun: null,
    },
    installation_geo_tolerance_m: data?.installation_geo_tolerance_m ?? 300,
    installation_time_tolerance_min: data?.installation_time_tolerance_min ?? 60,
    pdf_brand_color: data?.pdf_brand_color ?? "#4880FF",
  };
}

export async function updateCompanySettingsAction(input: unknown) {
  const session = await ensureAdmin();
  const parsed = parseOrFriendly(settingsSchema, input, "Configuración empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("company_settings")
      .update(parsed)
      .eq("company_id", session.company_id!);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id!,
      ...parsed,
    });
  }
  revalidatePath("/configuracion");
}

/**
 * Action específica para actualizar SOLO el horario comercial. Se usa
 * desde /configuracion/horarios donde se ha integrado la edición del
 * horario general (antes vivía en /configuracion → CompanySettingsForm).
 */
export async function updateBusinessHoursAction(
  hours: Record<string, { open: string; close: string } | null>,
): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ business_hours: hours })
      .eq("company_id", session.company_id!);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id!,
      business_hours: hours,
    });
  }
  revalidatePath("/configuracion/horarios");
}
