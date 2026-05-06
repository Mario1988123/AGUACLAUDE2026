"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface TeamMemberRow {
  user_id: string;
  full_name: string;
  roles: string[];
  manager_user_id: string | null;
}

const DIRECTOR_ROLES = [
  "technical_director",
  "commercial_director",
  "telemarketing_director",
] as const;

const OPERATIVE_ROLES = ["sales_rep", "telemarketer", "installer"] as const;

async function ensureCompanyAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede gestionar equipos");
  }
  return session;
}

/**
 * Devuelve TODOS los directores de la empresa con la lista de
 * miembros que tienen asignados. Un usuario puede ser director de
 * cero o varios miembros.
 */
export async function listTeams(): Promise<
  Array<{
    director_user_id: string;
    director_full_name: string;
    director_roles: string[];
    members: TeamMemberRow[];
  }>
> {
  const session = await ensureCompanyAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Profiles + roles activos
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name, status")
    .eq("company_id", session.company_id);
  type Profile = { user_id: string; full_name: string; status: string };
  const profileList = (profiles ?? []) as Profile[];

  const { data: rolesData } = await admin
    .from("user_roles")
    .select("user_id, role_key")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  type RoleRow = { user_id: string; role_key: string };
  const rolesByUser = new Map<string, string[]>();
  for (const r of (rolesData ?? []) as RoleRow[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role_key);
    rolesByUser.set(r.user_id, arr);
  }

  const { data: assignmentsData } = await admin
    .from("team_assignments")
    .select("manager_user_id, member_user_id")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  type Assignment = { manager_user_id: string; member_user_id: string };
  const memberToManager = new Map<string, string>();
  for (const a of (assignmentsData ?? []) as Assignment[]) {
    memberToManager.set(a.member_user_id, a.manager_user_id);
  }

  // Localizar directores
  const directors = profileList.filter((p) => {
    const r = rolesByUser.get(p.user_id) ?? [];
    return r.some((role) => (DIRECTOR_ROLES as readonly string[]).includes(role));
  });

  // Operativos = sales_rep / telemarketer / installer
  const operatives = profileList.filter((p) => {
    const r = rolesByUser.get(p.user_id) ?? [];
    return r.some((role) => (OPERATIVE_ROLES as readonly string[]).includes(role));
  });

  return directors.map((d) => {
    const myMembers = operatives.filter(
      (o) => memberToManager.get(o.user_id) === d.user_id,
    );
    return {
      director_user_id: d.user_id,
      director_full_name: d.full_name,
      director_roles: rolesByUser.get(d.user_id) ?? [],
      members: myMembers.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        roles: rolesByUser.get(m.user_id) ?? [],
        manager_user_id: d.user_id,
      })),
    };
  });
}

/** Devuelve operativos sin manager (huérfanos), para ofrecerlos al
 *  asignar a un director. */
export async function listUnassignedOperatives(): Promise<TeamMemberRow[]> {
  const session = await ensureCompanyAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id);
  type Profile = { user_id: string; full_name: string };
  const profileList = (profiles ?? []) as Profile[];

  const { data: rolesData } = await admin
    .from("user_roles")
    .select("user_id, role_key")
    .eq("company_id", session.company_id)
    .is("revoked_at", null)
    .in("role_key", OPERATIVE_ROLES as unknown as string[]);
  type RoleRow = { user_id: string; role_key: string };
  const operativeMap = new Map<string, string[]>();
  for (const r of (rolesData ?? []) as RoleRow[]) {
    const arr = operativeMap.get(r.user_id) ?? [];
    arr.push(r.role_key);
    operativeMap.set(r.user_id, arr);
  }

  const { data: assignmentsData } = await admin
    .from("team_assignments")
    .select("member_user_id")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  const assignedSet = new Set(
    ((assignmentsData ?? []) as Array<{ member_user_id: string }>).map(
      (a) => a.member_user_id,
    ),
  );

  return profileList
    .filter(
      (p) => operativeMap.has(p.user_id) && !assignedSet.has(p.user_id),
    )
    .map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      roles: operativeMap.get(p.user_id) ?? [],
      manager_user_id: null,
    }));
}

/** Asigna un operativo a un director. Si el operativo ya tenía
 *  manager, se revoca el asignamiento previo. */
export async function assignToTeamAction(
  managerUserId: string,
  memberUserId: string,
): Promise<void> {
  const session = await ensureCompanyAdmin();
  if (managerUserId === memberUserId) {
    throw new Error("Un usuario no puede ser su propio manager");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Revocar asignamientos previos del member
  await admin
    .from("team_assignments")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", session.company_id)
    .eq("member_user_id", memberUserId)
    .is("revoked_at", null);

  // Determinar for_role_key: el rol operativo del miembro. Si tiene
  // varios cogemos el primero del set OPERATIVE_ROLES.
  const { data: roles } = await admin
    .from("user_roles")
    .select("role_key")
    .eq("user_id", memberUserId)
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  type R = { role_key: string };
  const memberRoles = ((roles ?? []) as R[]).map((r) => r.role_key);
  const forRole = memberRoles.find((r) =>
    (OPERATIVE_ROLES as readonly string[]).includes(r),
  );
  if (!forRole) {
    throw new Error("El usuario no tiene ningún rol operativo asignado");
  }

  const { error } = await admin.from("team_assignments").insert({
    company_id: session.company_id,
    manager_user_id: managerUserId,
    member_user_id: memberUserId,
    for_role_key: forRole,
    created_by: session.user_id,
  });
  if (error) {
    console.error("[assignToTeam] insert failed:", error.message);
    throw new Error(error.message);
  }
  revalidatePath("/configuracion/usuarios");
}

/** Quita al miembro de su director (revoca el assignment). El usuario
 *  queda como huérfano y vuelve a la lista de no asignados. */
export async function removeFromTeamAction(memberUserId: string): Promise<void> {
  const session = await ensureCompanyAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("team_assignments")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", session.company_id)
    .eq("member_user_id", memberUserId)
    .is("revoked_at", null);
  if (error) {
    console.error("[removeFromTeam] update failed:", error.message);
    throw new Error(error.message);
  }
  revalidatePath("/configuracion/usuarios");
}
