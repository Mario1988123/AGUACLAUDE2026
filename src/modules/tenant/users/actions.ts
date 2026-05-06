"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { userInviteSchema, type RoleKey } from "./schemas";
import type { TenantUser } from "./types";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

async function ensureCompanyAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Usuario sin empresa");
  if (!session.roles.includes("company_admin")) throw new Error("Solo admin");
  return session;
}

export async function listTenantUsers(): Promise<TenantUser[]> {
  const session = await ensureCompanyAdmin();
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("user_id, full_name, phone, job_title, status, last_login_at, created_at")
    .eq("company_id", session.company_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const profileList = (profiles ?? []) as Array<{
    user_id: string;
    full_name: string;
    phone: string | null;
    job_title: string | null;
    status: TenantUser["status"];
    last_login_at: string | null;
    created_at: string;
  }>;

  if (profileList.length === 0) return [];

  const ids = profileList.map((p) => p.user_id);

  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("user_id, role_key")
    .eq("company_id", session.company_id!)
    .is("revoked_at", null)
    .in("user_id", ids);

  const rolesByUser = new Map<string, RoleKey[]>();
  for (const r of (rolesData ?? []) as { user_id: string; role_key: RoleKey }[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role_key);
    rolesByUser.set(r.user_id, arr);
  }

  // Email viene de auth.users — necesitamos admin para leer
  const admin = createAdminClient();
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailById = new Map(authUsers.map((u) => [u.id, u.email ?? null]));

  return profileList.map((p) => ({
    user_id: p.user_id,
    email: emailById.get(p.user_id) ?? null,
    full_name: p.full_name,
    phone: p.phone,
    job_title: p.job_title,
    status: p.status,
    roles: rolesByUser.get(p.user_id) ?? [],
    last_login_at: p.last_login_at,
    created_at: p.created_at,
  }));
}

export async function inviteUserAction(formData: FormData) {
  const session = await ensureCompanyAdmin();
  const raw = {
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    phone: formData.get("phone") ?? "",
    job_title: formData.get("job_title") ?? "",
    roles: formData.getAll("roles"),
  };
  const parsed = parseOrFriendly(userInviteSchema, raw, "Invitar usuario");

  // Validar que no se intenta crear un segundo company_admin
  if (parsed.roles.includes("company_admin")) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id!)
      .eq("role_key", "company_admin")
      .is("revoked_at", null);
    if ((count ?? 0) > 0) {
      throw new Error("Esta empresa ya tiene un company_admin (decisión 1.12)");
    }
  }

  // Validar límite de usuarios
  const supabase = await createClient();
  const [{ count: currentUsers }, { data: company }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("company_id", session.company_id!),
    supabase
      .from("companies")
      .select("max_users")
      .eq("id", session.company_id!)
      .single(),
  ]);
  const maxUsers = (company as { max_users: number } | null)?.max_users ?? 0;
  if ((currentUsers ?? 0) >= maxUsers) {
    throw new Error(`Has alcanzado el límite de ${maxUsers} usuarios`);
  }

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    parsed.email,
    {
      data: { full_name: parsed.full_name },
    },
  );
  if (inviteError) throw inviteError;
  const newUserId = invited.user.id;

  // Crear user_profile
  const { error: profileError } = await admin.from("user_profiles").insert({
    user_id: newUserId,
    company_id: session.company_id!,
    full_name: parsed.full_name,
    phone: parsed.phone || null,
    job_title: parsed.job_title || null,
    status: "invited",
    must_change_password: true,
    invited_at: new Date().toISOString(),
  });
  if (profileError) throw profileError;

  // Asignar roles
  const { error: rolesError } = await admin.from("user_roles").insert(
    parsed.roles.map((role_key) => ({
      user_id: newUserId,
      company_id: session.company_id!,
      role_key,
      assigned_by: session.user_id,
    })),
  );
  if (rolesError) throw rolesError;

  revalidatePath("/configuracion/usuarios");
}

export async function setUserStatus(userId: string, status: "active" | "inactive" | "suspended") {
  const session = await ensureCompanyAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_profiles")
    .update({ status })
    .eq("user_id", userId)
    .eq("company_id", session.company_id!);
  if (error) throw error;
  revalidatePath("/configuracion/usuarios");
}

export async function updateUserRoles(userId: string, roles: RoleKey[]) {
  const session = await ensureCompanyAdmin();
  const admin = createAdminClient();

  // Validar único admin
  if (roles.includes("company_admin")) {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id!)
      .eq("role_key", "company_admin")
      .is("revoked_at", null);
    const owners = (existing ?? []) as { user_id: string }[];
    if (owners.some((o) => o.user_id !== userId)) {
      throw new Error("Ya hay otro company_admin en la empresa");
    }
  }

  // Revocar todos los roles actuales y crear los nuevos
  await admin
    .from("user_roles")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("company_id", session.company_id!)
    .is("revoked_at", null);

  if (roles.length > 0) {
    await admin.from("user_roles").insert(
      roles.map((role_key) => ({
        user_id: userId,
        company_id: session.company_id!,
        role_key,
        assigned_by: session.user_id,
      })),
    );
  }

  revalidatePath("/configuracion/usuarios");
}
