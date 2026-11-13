import "server-only";
import { ROLES_CON_LEADS, elegirDuenoCliente } from "./inactividad-logica";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * De `userIds`, los que en `companyId` tienen un rol comercial vigente y el
 * perfil activo. Cliente admin, filtrado a mano por empresa.
 */
export async function comercialesActivos(
  admin: Admin,
  companyId: string,
  userIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter((u): u is string => !!u)));
  if (ids.length === 0) return new Set();
  const [{ data: roles }, { data: perfiles }] = await Promise.all([
    admin
      .from("user_roles")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", ids)
      .in("role_key", ROLES_CON_LEADS as unknown as string[])
      .is("revoked_at", null),
    admin
      .from("user_profiles")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", ids)
      .eq("status", "active"),
  ]);
  const conRol = new Set(((roles ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  const out = new Set<string>();
  for (const p of (perfiles ?? []) as Array<{ user_id: string }>) {
    if (conRol.has(p.user_id)) out.add(p.user_id);
  }
  return out;
}

/**
 * Dueño del cliente que nace de un lead (ver elegirDuenoCliente). Lee el
 * último comercial que tuvo el lead del evento lead.unassigned_by_expiry.
 * Fail-soft: ante cualquier error, el dueño del lead o quien convierte.
 */
export async function resolverDuenoCliente(
  admin: Admin,
  input: {
    leadId: string;
    companyId: string;
    asignado: string | null;
    creador: string | null;
    convierte: string;
  },
): Promise<string> {
  if (input.asignado) return input.asignado;
  try {
    const { data: ev } = await admin
      .from("events")
      .select("payload")
      .eq("company_id", input.companyId)
      .eq("subject_type", "lead")
      .eq("subject_id", input.leadId)
      .eq("kind", "lead.unassigned_by_expiry")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prev =
      (ev as { payload?: { previous_assigned_user_id?: string | null } } | null)?.payload
        ?.previous_assigned_user_id ?? null;
    const activos = await comercialesActivos(admin, input.companyId, [prev, input.creador]);
    return elegirDuenoCliente({
      asignado: null,
      ultimoDueno: prev,
      creador: input.creador,
      convierte: input.convierte,
      esComercialActivo: (u) => activos.has(u),
    });
  } catch (e) {
    console.error("[leads/dueno-cliente] no se pudo resolver el dueño:", e);
    return input.convierte;
  }
}
