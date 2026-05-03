"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface ModuleRow {
  key: string;
  label_es: string;
  description_es: string | null;
  icon: string | null;
  is_core: boolean;
  is_parked: boolean;
  sort_order: number;
  is_active: boolean;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Lista módulos del catálogo cruzado con company_modules. Cada uno indica
 * si está activo para esta empresa o no.
 */
export async function listCompanyModules(): Promise<ModuleRow[]> {
  const session = await ensureAdmin();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [{ data: catalog }, { data: company }] = await Promise.all([
    supabase
      .from("modules_catalog")
      .select("key, label_es, description_es, icon, is_core, is_parked, sort_order, default_active")
      .order("sort_order"),
    supabase
      .from("company_modules")
      .select("module_key, is_active")
      .eq("company_id", session.company_id),
  ]);
  type Cat = {
    key: string;
    label_es: string;
    description_es: string | null;
    icon: string | null;
    is_core: boolean;
    is_parked: boolean;
    sort_order: number;
    default_active: boolean;
  };
  const cats = (catalog ?? []) as Cat[];
  const activeMap = new Map<string, boolean>();
  for (const c of (company ?? []) as Array<{ module_key: string; is_active: boolean }>) {
    activeMap.set(c.module_key, c.is_active);
  }
  return cats.map((c) => ({
    key: c.key,
    label_es: c.label_es,
    description_es: c.description_es,
    icon: c.icon,
    is_core: c.is_core,
    is_parked: c.is_parked,
    sort_order: c.sort_order,
    is_active: activeMap.get(c.key) ?? c.default_active,
  }));
}

/**
 * Activa/desactiva un módulo para la empresa actual. Si no existe la fila
 * en company_modules la crea. is_core no se puede desactivar.
 */
export async function toggleCompanyModule(moduleKey: string, isActive: boolean): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: cat } = await admin
    .from("modules_catalog")
    .select("is_core")
    .eq("key", moduleKey)
    .single();
  if ((cat as { is_core: boolean } | null)?.is_core && !isActive) {
    throw new Error("Este módulo es core y no puede desactivarse");
  }

  const { data: existing } = await admin
    .from("company_modules")
    .select("module_key")
    .eq("company_id", session.company_id)
    .eq("module_key", moduleKey)
    .maybeSingle();

  if (existing) {
    await admin
      .from("company_modules")
      .update({ is_active: isActive })
      .eq("company_id", session.company_id)
      .eq("module_key", moduleKey);
  } else {
    await admin.from("company_modules").insert({
      company_id: session.company_id,
      module_key: moduleKey,
      is_active: isActive,
    });
  }

  revalidatePath("/configuracion/modulos");
}
