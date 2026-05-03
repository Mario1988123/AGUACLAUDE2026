"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export interface GlobalCategory {
  id: string;
  key: string;
  parent_key: string | null;
  name_es: string;
  description_es: string | null;
  default_kind: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface GlobalAttribute {
  id: string;
  key: string;
  name_es: string;
  description_es: string | null;
  data_type: string;
  unit: string | null;
  enum_values: string[] | null;
  default_visible: boolean;
  sort_order: number;
}

export interface GlobalExternalModel {
  id: string;
  brand: string;
  model: string;
  notes: string | null;
}

export async function listGlobalCategoriesAdmin(): Promise<GlobalCategory[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_categories_global")
    .select("id, key, parent_key, name_es, description_es, default_kind, icon, sort_order, is_active")
    .order("sort_order");
  return (data ?? []) as GlobalCategory[];
}

export async function listGlobalAttributesAdmin(): Promise<GlobalAttribute[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_attributes_global")
    .select("id, key, name_es, description_es, data_type, unit, enum_values, default_visible, sort_order")
    .order("sort_order");
  return (data ?? []) as GlobalAttribute[];
}

export async function listGlobalExternalModels(): Promise<GlobalExternalModel[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("external_equipment_models")
    .select("id, brand, model, notes")
    .is("company_id", null)
    .order("brand")
    .order("model");
  return (data ?? []) as GlobalExternalModel[];
}

export async function upsertGlobalCategoryAction(input: {
  id?: string;
  key: string;
  name_es: string;
  description_es?: string;
  default_kind?: string;
  sort_order?: number;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    key: input.key.trim(),
    name_es: input.name_es.trim(),
    description_es: input.description_es ?? null,
    default_kind: input.default_kind ?? "equipment",
    sort_order: input.sort_order ?? 0,
  };
  if (input.id) {
    await supabase.from("product_categories_global").update(payload).eq("id", input.id);
  } else {
    await supabase.from("product_categories_global").insert(payload);
  }
  revalidatePath("/superadmin/catalogo");
}

export async function deleteGlobalCategoryAction(id: string): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("product_categories_global")
    .update({ is_active: false })
    .eq("id", id);
  revalidatePath("/superadmin/catalogo");
}

export async function upsertGlobalAttributeAction(input: {
  id?: string;
  key: string;
  name_es: string;
  data_type?: string;
  unit?: string;
  sort_order?: number;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    key: input.key.trim(),
    name_es: input.name_es.trim(),
    data_type: input.data_type ?? "text",
    unit: input.unit ?? null,
    sort_order: input.sort_order ?? 0,
  };
  if (input.id) {
    await supabase.from("product_attributes_global").update(payload).eq("id", input.id);
  } else {
    await supabase.from("product_attributes_global").insert(payload);
  }
  revalidatePath("/superadmin/catalogo");
}

export async function deleteGlobalAttributeAction(id: string): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("product_attributes_global").delete().eq("id", id);
  revalidatePath("/superadmin/catalogo");
}

export async function upsertExternalModelAction(input: {
  id?: string;
  brand: string;
  model: string;
  notes?: string;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    brand: input.brand.trim(),
    model: input.model.trim(),
    notes: input.notes ?? null,
    company_id: null,
  };
  if (input.id) {
    await supabase.from("external_equipment_models").update(payload).eq("id", input.id);
  } else {
    await supabase.from("external_equipment_models").insert(payload);
  }
  revalidatePath("/superadmin/catalogo");
}

export async function deleteExternalModelAction(id: string): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("external_equipment_models").delete().eq("id", id);
  revalidatePath("/superadmin/catalogo");
}
