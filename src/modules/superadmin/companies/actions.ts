"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { companyCreateSchema, companyUpdateSchema, type CompanyUpdateInput } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { generateTempPassword } from "@/shared/lib/auth/temp-password";
import type { CompanyDetail, CompanyListItem } from "./types";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export async function listCompanies(filters?: { status?: string }): Promise<CompanyListItem[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("companies")
    .select(
      "id, name, slug, status, max_users, max_storage_mb, monthly_cost_cents, billing_email, created_at",
    )
    .order("created_at", { ascending: false });
  if (filters?.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CompanyListItem[];
}

export interface CompanyMetric {
  company_id: string;
  users_count: number;
  leads_count: number;
  customers_count: number;
  contracts_active_count: number;
}

/**
 * Métricas agregadas por empresa para el panel superadmin.
 */
export async function getCompaniesMetrics(companyIds: string[]): Promise<Map<string, CompanyMetric>> {
  await ensureSuperadmin();
  const map = new Map<string, CompanyMetric>();
  if (companyIds.length === 0) return map;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const [users, leads, customers, contracts] = await Promise.all([
    supabase.from("user_profiles").select("company_id").in("company_id", companyIds),
    supabase
      .from("leads")
      .select("company_id")
      .in("company_id", companyIds)
      .is("deleted_at", null),
    supabase
      .from("customers")
      .select("company_id")
      .in("company_id", companyIds)
      .is("deleted_at", null),
    supabase
      .from("contracts")
      .select("company_id")
      .in("company_id", companyIds)
      .eq("status", "active")
      .is("deleted_at", null),
  ]);

  for (const id of companyIds) {
    map.set(id, {
      company_id: id,
      users_count: 0,
      leads_count: 0,
      customers_count: 0,
      contracts_active_count: 0,
    });
  }
  function bump(rows: Array<{ company_id: string }>, key: keyof CompanyMetric) {
    for (const r of rows) {
      const m = map.get(r.company_id);
      if (m && typeof m[key] === "number") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m as any)[key] = (m[key] as number) + 1;
      }
    }
  }
  bump((users.data ?? []) as Array<{ company_id: string }>, "users_count");
  bump((leads.data ?? []) as Array<{ company_id: string }>, "leads_count");
  bump((customers.data ?? []) as Array<{ company_id: string }>, "customers_count");
  bump((contracts.data ?? []) as Array<{ company_id: string }>, "contracts_active_count");
  return map;
}

export async function getCompany(id: string): Promise<CompanyDetail> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
  if (error) throw error;
  return data as CompanyDetail;
}

/** Slugify defensivo en server: aunque el front sanee, esto cubre el
 *  caso de creación por API directa o request malformada. */
function serverSlugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);
}

export async function createCompanyAction(formData: FormData) {
  await ensureSuperadmin();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  // Normalizamos slug en server por si viene "OSMO FILTER S.L." o vacío.
  // Si llega vacío, lo derivamos del name. Antes Zod throwaba con mensaje
  // opaco "Solo minúsculas, números y guiones" como digest 3731663788.
  const nameStr = raw.name?.trim() ?? "";
  let slug = raw.slug?.trim() ?? "";
  if (!slug && nameStr) slug = serverSlugify(nameStr);
  else slug = serverSlugify(slug);
  raw.slug = slug;

  const result = companyCreateSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") ?? "campo";
    const msg = first?.message ?? "Datos inválidos";
    console.error("[createCompany] Zod failed:", JSON.stringify(result.error.issues));
    throw new Error(`${path}: ${msg}`);
  }
  const parsed = result.data;

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

  // Audit log
  try {
    const { logSuperadminAction } = await import("@/modules/superadmin/audit-actions");
    await logSuperadminAction({
      action: "company.created",
      affected_company_id: companyId,
      payload: { name: parsed.name, slug: parsed.slug },
    });
  } catch { /* fail-soft */ }

  revalidatePath("/superadmin");
  redirect(`/superadmin/empresas/${companyId}` as never);
}

export async function updateCompanyAction(id: string, input: CompanyUpdateInput) {
  await ensureSuperadmin();
  const parsed = parseOrFriendly(companyUpdateSchema, input, "Empresa");
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

  try {
    const { logSuperadminAction } = await import("@/modules/superadmin/audit-actions");
    await logSuperadminAction({
      action: "company.updated",
      affected_company_id: id,
      payload: update,
    });
  } catch { /* fail-soft */ }

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

  try {
    const { logSuperadminAction } = await import("@/modules/superadmin/audit-actions");
    await logSuperadminAction({
      action: "module.toggled",
      affected_company_id: companyId,
      payload: { module_key: moduleKey, is_active: isActive },
    });
  } catch { /* fail-soft */ }

  revalidatePath(`/superadmin/empresas/${companyId}`);
}

export interface ResetUserPasswordInput {
  user_id: string;
  new_password: string;
}

export async function resetUserPassword({ user_id, new_password }: ResetUserPasswordInput) {
  await ensureSuperadmin();
  if (!new_password) throw new Error("Escribe una contraseña");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user_id, {
    password: new_password,
  });
  if (error) throw error;

  try {
    const { logSuperadminAction } = await import("@/modules/superadmin/audit-actions");
    await logSuperadminAction({
      action: "user.password_reset",
      subject_type: "user",
      subject_id: user_id,
      payload: { method: "manual" },
    });
  } catch { /* fail-soft */ }
}

// generateTempPassword vive ahora en src/shared/lib/auth/temp-password.ts
// para reusarse desde el invite-user del company admin.

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

  // Verificar que la empresa existe
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: company, error: cErr } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", input.company_id)
    .single();
  if (cErr || !company) throw new Error("Empresa no encontrada");

  // (Antes aquí había una validación "1 admin por empresa" — decisión 1.12.
  //  Revertida 2026-06-02: una empresa puede tener N company_admin. El
  //  superadmin puede usar esta acción tanto para el primer admin como
  //  para añadir más después.)

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

/**
 * Devuelve el admin principal (el más antiguo) de la empresa, o null si
 * no hay ninguno. Antes usaba .maybeSingle() asumiendo 1 admin/empresa
 * (decisión 1.12). Tras revertir a N admins (2026-06-02), eso fallaba con
 * "más de una fila" cuando había 2+ admins — la empresa salía como "sin
 * admin activo" en el panel superadmin. Ahora coge el primero por fecha
 * de asignación.
 */
export async function getCompanyAdmin(companyId: string): Promise<CompanyAdminInfo | null> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("user_id, assigned_at")
    .eq("company_id", companyId)
    .eq("role_key", "company_admin")
    .is("revoked_at", null)
    .order("assigned_at", { ascending: true })
    .limit(1);
  const first = ((roleRows ?? []) as Array<{ user_id: string }>)[0];
  if (!first) return null;
  const userId = first.user_id;

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

// =================== Safe wrappers ===================

export async function updateCompanySafeAction(
  id: string,
  input: CompanyUpdateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateCompanyAction(id, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function toggleCompanyModuleSafeAction(
  companyId: string,
  moduleKey: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await toggleCompanyModule(companyId, moduleKey, isActive);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function createCompanyAdminSafeAction(
  input: CreateCompanyAdminInput,
): Promise<{ ok: true; result: CreateCompanyAdminResult } | { ok: false; error: string }> {
  try {
    const result = await createCompanyAdminAction(input);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function resetCompanyAdminPasswordSafeAction(
  userId: string,
): Promise<{ ok: true; temp_password: string } | { ok: false; error: string }> {
  try {
    const r = await resetCompanyAdminPassword(userId);
    return { ok: true, temp_password: r.temp_password };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =================== Google Maps Tools (superadmin) ===================

export async function setCompanyGmapsSafeAction(input: {
  company_id: string;
  mode: "disabled" | "shared_key" | "own_key";
  monthly_cap_usd: number;
  daily_cap_usd: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    if (!input.company_id) return { ok: false, error: "Sin empresa" };
    if (!["disabled", "shared_key", "own_key"].includes(input.mode)) {
      return { ok: false, error: "Modo inválido" };
    }
    const monthly = Number(input.monthly_cap_usd);
    const daily = Number(input.daily_cap_usd);
    if (!Number.isFinite(monthly) || monthly < 0 || monthly > 100000) {
      return { ok: false, error: "Cap mensual inválido" };
    }
    if (!Number.isFinite(daily) || daily < 0 || daily > 100000) {
      return { ok: false, error: "Cap diario inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    // Defensivo: si la migración 20260524160000 no se ha aplicado todavía
    // (o el schema cache de PostgREST está stale), el update con los caps
    // falla con "could not find column". Reintentamos con solo gmaps_mode
    // para que el toggle de modo no se quede atascado.
    let updateError: { message: string } | null = null;
    const fullUpdate = await supabase
      .from("companies")
      .update({
        gmaps_mode: input.mode,
        gmaps_monthly_cap_usd: monthly,
        gmaps_daily_cap_usd: daily,
      })
      .eq("id", input.company_id);
    if (fullUpdate.error) {
      const msg = fullUpdate.error.message ?? "";
      const isMissingCol =
        /could not find.*column|column .* does not exist/i.test(msg);
      if (isMissingCol) {
        const fallback = await supabase
          .from("companies")
          .update({ gmaps_mode: input.mode })
          .eq("id", input.company_id);
        if (fallback.error) updateError = fallback.error;
      } else {
        updateError = fullUpdate.error;
      }
    }
    if (updateError) return { ok: false, error: updateError.message };

    try {
      const { logSuperadminAction } = await import(
        "@/modules/superadmin/audit-actions"
      );
      await logSuperadminAction({
        action: "company.gmaps_mode_changed",
        affected_company_id: input.company_id,
        payload: { mode: input.mode, monthly, daily },
      });
    } catch {
      /* fail-soft */
    }
    try {
      const { invalidateGoogleMapsConfig } = await import(
        "@/shared/lib/google-maps/config"
      );
      await invalidateGoogleMapsConfig(input.company_id);
    } catch {
      /* fail-soft */
    }

    revalidatePath(`/superadmin/empresas/${input.company_id}`);
    revalidatePath("/configuracion/google-maps");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =================== Proveedor de email (superadmin) ===================

export async function setCompanyEmailProviderSafeAction(input: {
  company_id: string;
  provider: "smtp" | "resend";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    if (!input.company_id) return { ok: false, error: "Sin empresa" };
    if (!["smtp", "resend"].includes(input.provider)) {
      return { ok: false, error: "Proveedor inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { error } = await supabase
      .from("companies")
      .update({ email_provider: input.provider })
      .eq("id", input.company_id);
    if (error) return { ok: false, error: error.message };

    try {
      const { logSuperadminAction } = await import(
        "@/modules/superadmin/audit-actions"
      );
      await logSuperadminAction({
        action: "company.email_provider_changed",
        affected_company_id: input.company_id,
        payload: { provider: input.provider },
      });
    } catch {
      /* fail-soft */
    }

    revalidatePath(`/superadmin/empresas/${input.company_id}`);
    revalidatePath("/configuracion/mailing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
