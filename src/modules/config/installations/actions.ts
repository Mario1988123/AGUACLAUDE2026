"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) throw new Error("Solo admin");
  return session;
}

export async function saveInstallationsConfigAction(input: {
  installation_geo_tolerance_m?: number;
  installation_time_tolerance_min?: number;
}): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("company_settings")
      .update(input)
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("company_settings")
      .insert({ company_id: session.company_id, ...input });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/configuracion/instalaciones");
}
