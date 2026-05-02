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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("companies")
    .select(
      "id, name, slug, status, max_users, max_storage_mb, monthly_cost_cents, billing_email, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyListItem[];
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
  if (error) throw error;
  return data as CompanyDetail;
}

export async function createCompanyAction(formData: FormData) {
  await ensureSuperadmin();

  const raw = Object.fromEntries(formData.entries());
  const parsed = companyCreateSchema.parse(raw);

  // Las policies "<tabla>_super" permiten todas las operaciones al superadmin.
  // No necesitamos service_role aquí.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Verificación previa de slug duplicado para mostrar mensaje claro
  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", parsed.slug)
    .maybeSingle();
  if (existing) {
    throw new Error(`Ya existe una empresa con el slug "${parsed.slug}". Elige otro.`);
  }

  const insertResult = await supabase
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

  if (insertResult.error) {
    // PostgreSQL 23505 = unique_violation (carrera concurrente con verificación previa)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (insertResult.error as any).code;
    if (code === "23505") {
      throw new Error(`Ya existe una empresa con el slug "${parsed.slug}". Elige otro.`);
    }
    throw insertResult.error;
  }
  const companyId = (insertResult.data as { id: string }).id;

  // Activar módulos por defecto (los is_core + default_active=true)
  const modulesRes = await supabase
    .from("modules_catalog")
    .select("key, default_active, is_core");
  const modules = (modulesRes.data ?? []) as {
    key: string;
    default_active: boolean;
    is_core: boolean;
  }[];
  const toActivate = modules.filter((m) => m.is_core || m.default_active);
  if (toActivate.length > 0) {
    await supabase.from("company_modules").insert(
      toActivate.map((m) => ({
        company_id: companyId,
        module_key: m.key,
        is_active: true,
        settings: {},
      })),
    );
  }

  // Crear company_settings con defaults
  await supabase.from("company_settings").insert({ company_id: companyId });

  revalidatePath("/superadmin");
  redirect(`/superadmin/empresas/${companyId}` as never);
}

export async function updateCompanyAction(id: string, input: CompanyUpdateInput) {
  await ensureSuperadmin();
  const parsed = companyUpdateSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const update: Record<string, unknown> = {};
  if (parsed.name !== undefined) update.name = parsed.name;
  if (parsed.status !== undefined) update.status = parsed.status;
  if (parsed.max_users !== undefined) update.max_users = parsed.max_users;
  if (parsed.max_storage_mb !== undefined) update.max_storage_mb = parsed.max_storage_mb;
  if (parsed.monthly_cost_cents !== undefined) update.monthly_cost_cents = parsed.monthly_cost_cents;
  if (parsed.billing_email !== undefined) update.billing_email = parsed.billing_email || null;
  if (parsed.primary_color !== undefined) update.primary_color = parsed.primary_color;

  const { error } = await supabase.from("companies").update(update).eq("id", id);
  if (error) throw error;
  revalidatePath(`/superadmin/empresas/${id}`);
  revalidatePath("/superadmin");
}

export async function toggleCompanyModule(companyId: string, moduleKey: string, isActive: boolean) {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase
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

/** Genera password temporal segura. */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const len = 16;
  let pwd = "";
  // Asegurar al menos 1 de cada
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];
  for (let i = pwd.length; i < len; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  // Shuffle
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

export interface CreateCompanyAdminInput {
  company_id: string;
  email: string;
  full_name: string;
}

export interface CreateCompanyAdminResult {
  user_id: string;
  email: string;
  temp_password: string;
}

/**
 * Crea el primer administrador (rol company_admin) de una empresa.
 * Genera una contraseña temporal que se devuelve UNA SOLA VEZ al superadmin
 * para que se la entregue al cliente. El admin debe cambiarla al primer login
 * (must_change_password=true).
 */
export async function createCompanyAdminAction(
  input: CreateCompanyAdminInput,
): Promise<CreateCompanyAdminResult> {
  const session = await ensureSuperadmin();
  const email = input.email.trim().toLowerCase();
  const fullName = input.full_name.trim();
  if (!email.includes("@")) throw new Error("Email no válido");
  if (fullName.length < 2) throw new Error("Nombre obligatorio");

  const admin = createAdminClient();

  // Verificar que la empresa existe y aún no tiene admin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: company, error: cErr } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", input.company_id)
    .single();
  if (cErr || !company) throw new Error("Empresa no encontrada");

  const { count: existingAdminCount } = await supabase
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.company_id)
    .eq("role_key", "company_admin")
    .is("revoked_at", null);
  if ((existingAdminCount ?? 0) > 0) {
    throw new Error("Esta empresa ya tiene un administrador (decisión 1.12)");
  }

  const tempPassword = generateTempPassword();

  // Crear usuario en auth ya con password (no usamos invite para devolver pwd al super)
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (uErr) throw new Error(`Auth: ${uErr.message}`);
  const newUserId = created.user.id;

  // user_profile
  const { error: pErr } = await admin.from("user_profiles").insert({
    user_id: newUserId,
    company_id: input.company_id,
    full_name: fullName,
    status: "invited",
    must_change_password: true,
    invited_at: new Date().toISOString(),
  });
  if (pErr) {
    // rollback auth user
    await admin.auth.admin.deleteUser(newUserId);
    throw new Error(`Profile: ${pErr.message}`);
  }

  // role company_admin
  const { error: rErr } = await admin.from("user_roles").insert({
    user_id: newUserId,
    company_id: input.company_id,
    role_key: "company_admin",
    assigned_by: session.user_id,
  });
  if (rErr) {
    await admin.from("user_profiles").delete().eq("user_id", newUserId);
    await admin.auth.admin.deleteUser(newUserId);
    throw new Error(`Role: ${rErr.message}`);
  }

  revalidatePath(`/superadmin/empresas/${input.company_id}`);
  return { user_id: newUserId, email, temp_password: tempPassword };
}

export interface CompanyAdminInfo {
  user_id: string;
  email: string | null;
  full_name: string;
  status: string;
  last_login_at: string | null;
}

/** Devuelve el admin actual de la empresa (o null si aún no hay). */
export async function getCompanyAdmin(companyId: string): Promise<CompanyAdminInfo | null> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role_key", "company_admin")
    .is("revoked_at", null)
    .maybeSingle();
  if (!roleRow) return null;
  const userId = (roleRow as { user_id: string }).user_id;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("user_id, full_name, status, last_login_at")
    .eq("user_id", userId)
    .single();
  if (!profile) return null;
  const p = profile as {
    user_id: string;
    full_name: string;
    status: string;
    last_login_at: string | null;
  };

  // email viene de auth.users → necesita admin
  let email: string | null = null;
  try {
    const adminCli = createAdminClient();
    const { data } = await adminCli.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
  } catch {
    /* ignore */
  }

  return { user_id: p.user_id, email, full_name: p.full_name, status: p.status, last_login_at: p.last_login_at };
}

export async function resetCompanyAdminPassword(userId: string): Promise<{ temp_password: string }> {
  await ensureSuperadmin();
  const tempPassword = generateTempPassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (error) throw new Error(error.message);
  // Forzar cambio password en próximo login
  await admin.from("user_profiles").update({ must_change_password: true }).eq("user_id", userId);
  return { temp_password: tempPassword };
}
