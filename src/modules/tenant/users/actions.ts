"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { userInviteSchema, type RoleKey } from "./schemas";
import type { TenantUser } from "./types";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { generateTempPassword } from "@/shared/lib/auth/temp-password";

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

/**
 * Crea un usuario interno (comercial, instalador, director, etc.) con
 * contraseña temporal de 16 chars. ANTES usaba inviteUserByEmail() que
 * solo manda email — el usuario nunca tenía password y al intentar
 * loguearse veía "Invalid login credentials".
 *
 * Ahora replica el flujo del superadmin:
 *  1. Crea user en auth.users con password + email_confirm=true.
 *  2. Inserta user_profiles con must_change_password=true.
 *  3. Asigna roles.
 *  4. Devuelve { email, temp_password } al cliente para que el admin
 *     se la copie y se la pase al nuevo usuario. Al hacer login el
 *     guard enforcePasswordChange lo redirige a /restablecer-password
 *     para que la cambie por una real.
 */
export async function inviteUserAction(
  formData: FormData,
): Promise<{ email: string; temp_password: string }> {
  const session = await ensureCompanyAdmin();
  const raw = {
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    phone: formData.get("phone") ?? "",
    job_title: formData.get("job_title") ?? "",
    roles: formData.getAll("roles"),
  };
  const parsed = parseOrFriendly(userInviteSchema, raw, "Invitar usuario");

  // (Antes aquí había una validación "1 admin por empresa" — decisión 1.12.
  //  Revertida 2026-06-02: ahora una empresa puede tener N company_admin.
  //  Ver migración 20260602100000_allow_multiple_company_admins.sql)

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
  const tempPassword = generateTempPassword();

  // Comprobar si el email ya existe en auth.users (puede pasar si:
  //  · Hubo un intento previo con inviteUserByEmail() que creó la fila
  //    pero sin password.
  //  · El usuario fue eliminado del tenant pero sigue en auth.users.
  //  · El usuario existe en otra empresa).
  let newUserId: string;
  let isRecovering = false;
  type AuthUser = { id: string; email?: string | null };
  let existingUser: AuthUser | null = null;
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    existingUser =
      ((list?.users ?? []) as AuthUser[]).find(
        (u) => (u.email ?? "").toLowerCase() === parsed.email.toLowerCase(),
      ) ?? null;
  } catch (e) {
    console.error("[inviteUser] listUsers failed:", e);
  }

  if (existingUser) {
    // Verificar si el user existente ya tiene profile en alguna empresa
    const { data: existingProfile } = await admin
      .from("user_profiles")
      .select("user_id, company_id")
      .eq("user_id", existingUser.id)
      .maybeSingle();
    const ep = existingProfile as { user_id: string; company_id: string } | null;
    if (ep && ep.company_id === session.company_id) {
      throw new Error(
        `Ya existe un usuario con el email ${parsed.email} en esta empresa`,
      );
    }
    if (ep && ep.company_id !== session.company_id) {
      throw new Error(
        `El email ${parsed.email} ya pertenece a otra empresa. Usa otro email.`,
      );
    }
    // Existe en auth.users pero SIN profile en ninguna empresa → recuperamos:
    // reseteamos su password y le creamos el profile aquí.
    const { error: updErr } = await admin.auth.admin.updateUserById(existingUser.id, {
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: parsed.full_name },
    });
    if (updErr) {
      console.error("[inviteUser] updateUserById failed:", updErr.message);
      throw new Error(updErr.message);
    }
    newUserId = existingUser.id;
    isRecovering = true;
  } else {
    // Crear user con password — email_confirm: true para que pueda hacer
    // login inmediatamente sin paso de confirmación de email.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: parsed.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: parsed.full_name },
    });
    if (createError) {
      console.error("[inviteUser] createUser failed:", createError.message);
      throw new Error(createError.message);
    }
    newUserId = created.user.id;
  }

  // Crear user_profile (upsert por si quedó residuo huérfano)
  const { error: profileError } = await admin.from("user_profiles").upsert(
    {
      user_id: newUserId,
      company_id: session.company_id!,
      full_name: parsed.full_name,
      phone: parsed.phone || null,
      job_title: parsed.job_title || null,
      status: "invited",
      must_change_password: true,
      invited_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (profileError) {
    console.error("[inviteUser] profile upsert failed:", profileError.message);
    // Rollback del auth user solo si lo creamos en este flow (no en
    // recovery, porque podría borrar un usuario válido).
    if (!isRecovering) {
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch {
        /* fail-soft */
      }
    }
    throw new Error(profileError.message);
  }

  // Asignar roles
  const { error: rolesError } = await admin.from("user_roles").insert(
    parsed.roles.map((role_key) => ({
      user_id: newUserId,
      company_id: session.company_id!,
      role_key,
      assigned_by: session.user_id,
    })),
  );
  if (rolesError) {
    console.error("[inviteUser] roles insert failed:", rolesError.message);
    throw new Error(rolesError.message);
  }

  revalidatePath("/configuracion/usuarios");
  return { email: parsed.email, temp_password: tempPassword };
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

/**
 * Resetea la contraseña de un usuario interno: genera nueva temp password,
 * la pone en auth.users y marca user_profiles.must_change_password=true
 * para que la cambie en su próximo login. Devuelve la temp password al
 * admin para que la copie y se la pase al usuario.
 *
 * Solo company_admin (o superadmin), y solo para usuarios de su misma
 * empresa.
 */
export async function resetUserPasswordAction(
  userId: string,
): Promise<{ email: string; temp_password: string }> {
  const session = await ensureCompanyAdmin();
  const admin = createAdminClient();

  // Validar que el usuario pertenece a la misma empresa que el admin
  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id, company_id, full_name")
    .eq("user_id", userId)
    .maybeSingle();
  const p = profile as
    | { user_id: string; company_id: string; full_name: string }
    | null;
  if (!p) throw new Error("Usuario no encontrado");
  if (!session.is_superadmin && p.company_id !== session.company_id) {
    throw new Error("Ese usuario no pertenece a tu empresa");
  }

  // Email viene de auth.users
  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr) {
    console.error("[resetUserPassword] getUserById failed:", getErr.message);
    throw new Error(getErr.message);
  }
  const email = authUser.user.email ?? "(sin email)";

  const tempPassword = generateTempPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (updErr) {
    console.error("[resetUserPassword] updateUserById failed:", updErr.message);
    throw new Error(updErr.message);
  }

  await admin
    .from("user_profiles")
    .update({ must_change_password: true })
    .eq("user_id", userId);

  revalidatePath("/configuracion/usuarios");
  return { email, temp_password: tempPassword };
}

/**
 * ELIMINA PERMANENTEMENTE al usuario:
 *  · Borra de auth.users → libera el email para reutilizar.
 *  · CASCADE borra user_profiles, user_roles, team_assignments,
 *    permission_overrides, notifications.
 *  · Las FK críticas (contracts.signed_by, contract_payments.collected_by,
 *    installations.installer_user_id, events.actor_user_id, leads.assigned,
 *    etc.) están migradas a ON DELETE SET NULL → los datos históricos
 *    quedan con esos campos en NULL pero no se borran.
 *
 * Solo company_admin (o superadmin) y solo en su propia empresa. No se
 * puede eliminar al propio company_admin (decisión 1.12 — la empresa
 * siempre tiene que tener uno).
 */
export async function deleteUserPermanentlyAction(userId: string): Promise<void> {
  const session = await ensureCompanyAdmin();
  if (userId === session.user_id) {
    throw new Error("No puedes eliminarte a ti mismo");
  }
  const admin = createAdminClient();

  // Validar que el usuario pertenece a la misma empresa
  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id, company_id")
    .eq("user_id", userId)
    .maybeSingle();
  const p = profile as { user_id: string; company_id: string } | null;
  if (!p) {
    // Posible huérfano en auth.users sin profile: dejamos pasar el delete
    // de auth para liberar el email, pero solo si el caller es superadmin.
    if (!session.is_superadmin) {
      throw new Error("Usuario no pertenece a tu empresa");
    }
  } else if (!session.is_superadmin && p.company_id !== session.company_id) {
    throw new Error("Ese usuario no pertenece a tu empresa");
  }

  // No permitir eliminar al último company_admin activo de la empresa.
  // Antes: bloqueaba cualquier eliminación de admin (regla 1 admin por
  // empresa). Ahora con N admins → solo bloquea si dejaría 0 admins activos.
  const { data: targetRolesData } = await admin
    .from("user_roles")
    .select("role_key")
    .eq("user_id", userId)
    .is("revoked_at", null);
  const targetIsAdmin = ((targetRolesData ?? []) as { role_key: string }[]).some(
    (r) => r.role_key === "company_admin",
  );
  if (targetIsAdmin && p?.company_id) {
    const { count: activeAdmins } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", p.company_id)
      .eq("role_key", "company_admin")
      .is("revoked_at", null);
    if ((activeAdmins ?? 0) <= 1) {
      throw new Error(
        "No se puede eliminar al último admin de la empresa. Crea o asigna otro admin antes.",
      );
    }
  }

  // Delete en auth.users dispara CASCADE de user_profiles/user_roles y
  // SET NULL de las FK migradas (contracts, contract_payments, leads...).
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("[deleteUser] auth.admin.deleteUser failed:", delErr.message);
    throw new Error(`No se pudo eliminar: ${delErr.message}`);
  }

  // Limpieza extra defensiva por si la migración SET NULL aún no estuviera
  // aplicada en algún entorno: borramos manualmente lo que sí o sí va.
  try {
    await admin.from("user_profiles").delete().eq("user_id", userId);
    await admin.from("user_roles").delete().eq("user_id", userId);
  } catch {
    /* probablemente ya borrado por CASCADE */
  }

  revalidatePath("/configuracion/usuarios");
}

export async function updateUserRoles(userId: string, roles: RoleKey[]) {
  const session = await ensureCompanyAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const admin = createAdminClient();

  // Decisión N-admins: se permiten VARIOS company_admin por empresa (antes esta
  // función rechazaba el 2º, contradiciendo a invite/createCompanyAdmin). Por eso
  // ya NO bloqueamos crear otro admin. PERO sí impedimos el lockout: si a un admin
  // se le quitan TODOS los roles de admin y es el único, la empresa quedaría sin
  // ningún administrador.
  if (!roles.includes("company_admin")) {
    const { data: curAdmins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id)
      .eq("role_key", "company_admin")
      .is("revoked_at", null);
    const adminIds = new Set(
      ((curAdmins ?? []) as { user_id: string }[]).map((a) => a.user_id),
    );
    if (adminIds.has(userId) && adminIds.size <= 1) {
      throw new Error(
        "No se puede quitar el rol de administrador al último admin de la empresa. Asigna otro admin primero.",
      );
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

// =================== Safe wrappers ===================

export async function inviteUserSafeAction(
  formData: FormData,
): Promise<{ ok: true; email: string; temp_password: string } | { ok: false; error: string }> {
  try {
    const r = await inviteUserAction(formData);
    return { ok: true, email: r.email, temp_password: r.temp_password };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setUserStatusSafeAction(
  userId: string,
  status: "active" | "inactive" | "suspended",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setUserStatus(userId, status);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function resetUserPasswordSafeAction(
  userId: string,
): Promise<{ ok: true; email: string; temp_password: string } | { ok: false; error: string }> {
  try {
    const r = await resetUserPasswordAction(userId);
    return { ok: true, email: r.email, temp_password: r.temp_password };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteUserPermanentlySafeAction(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteUserPermanentlyAction(userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function updateUserRolesSafeAction(
  userId: string,
  roles: RoleKey[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateUserRoles(userId, roles);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
