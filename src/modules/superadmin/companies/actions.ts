"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { companyCreateSchema, companyUpdateSchema, type CompanyUpdateInput } from "./schemas";
import type { CompanyDetail, CompanyListItem } from "./types";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export async function listCompanies(): Promise<CompanyListItem[]> {
  await ensureSuperadmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, slug, status, max_users, max_storage_mb, monthly_cost_cents, billing_email, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyListItem[];
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  await ensureSuperadmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
  if (error) throw error;
  return data as CompanyDetail;
}

export async function createCompanyAction(formData: FormData) {
  await ensureSuperadmin();

  const raw = Object.fromEntries(formData.entries());
  const parsed = companyCreateSchema.parse(raw);

  const admin = createAdminClient();
  const insertResult = await admin
    .from("companies")
    .insert({
      name: parsed.name,
      slug: parsed.slug,
      status: parsed.status,
      max_users: parsed.max_users,
      max_storage_mb: parsed.max_storage_mb,
      monthly_cost_cents: parsed.monthly_cost_cents,
      billing_email: parsed.billing_email || null,
      primary_color: parsed.primary_color,
      fiscal_data: {
        legal_name: parsed.fiscal_legal_name,
        tax_id: parsed.fiscal_tax_id,
        address: parsed.fiscal_address,
      },
    })
    .select("id")
    .single();

  if (insertResult.error) throw insertResult.error;
  const companyId = (insertResult.data as { id: string }).id;

  // Activar módulos por defecto (los is_core + default_active=true)
  const modulesRes = await admin.from("modules_catalog").select("key, default_active, is_core");
  const modules = (modulesRes.data ?? []) as { key: string; default_active: boolean; is_core: boolean }[];
  const toActivate = modules.filter((m) => m.is_core || m.default_active);
  if (toActivate.length > 0) {
    await admin.from("company_modules").insert(
      toActivate.map((m) => ({
        company_id: companyId,
        module_key: m.key,
        is_active: true,
        settings: {},
      })),
    );
  }

  // Crear company_settings con defaults
  await admin.from("company_settings").insert({ company_id: companyId });

  revalidatePath("/superadmin");
  redirect(`/superadmin/empresas/${companyId}` as never);
}

export async function updateCompanyAction(id: string, input: CompanyUpdateInput) {
  await ensureSuperadmin();
  const parsed = companyUpdateSchema.parse(input);
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (parsed.name !== undefined) update.name = parsed.name;
  if (parsed.status !== undefined) update.status = parsed.status;
  if (parsed.max_users !== undefined) update.max_users = parsed.max_users;
  if (parsed.max_storage_mb !== undefined) update.max_storage_mb = parsed.max_storage_mb;
  if (parsed.monthly_cost_cents !== undefined) update.monthly_cost_cents = parsed.monthly_cost_cents;
  if (parsed.billing_email !== undefined) update.billing_email = parsed.billing_email || null;
  if (parsed.primary_color !== undefined) update.primary_color = parsed.primary_color;

  const { error } = await supabase
    .from("companies")
    .update(update as never)
    .eq("id", id);
  if (error) throw error;
  revalidatePath(`/superadmin/empresas/${id}`);
  revalidatePath("/superadmin");
}

export async function toggleCompanyModule(companyId: string, moduleKey: string, isActive: boolean) {
  await ensureSuperadmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("company_modules")
    .upsert({ company_id: companyId, module_key: moduleKey, is_active: isActive });
  if (error) throw error;
  revalidatePath(`/superadmin/empresas/${companyId}`);
}

export interface ResetUserPasswordInput {
  user_id: string;
  new_password: string;
}

export async function resetUserPassword({ user_id, new_password }: ResetUserPasswordInput) {
  await ensureSuperadmin();
  if (new_password.length < 12) throw new Error("Mínimo 12 caracteres");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user_id, {
    password: new_password,
  });
  if (error) throw error;
}
