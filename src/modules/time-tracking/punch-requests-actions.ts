"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export type PunchRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

const PUNCH_KIND_LABEL: Record<PunchKind, string> = {
  clock_in: "entrada",
  clock_out: "salida",
  break_start: "inicio de descanso",
  break_end: "fin de descanso",
};

export interface PunchRequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  requested_at: string;
  punch_kind: PunchKind;
  reason: string | null;
  status: PunchRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

const createSchema = z.object({
  requested_at: z.string().min(1, "Fecha y hora obligatorias"),
  punch_kind: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
  reason: z.string().min(3, "Indica el motivo"),
});

function isAdminOrDirector(roles: string[], isSuperadmin: boolean) {
  if (isSuperadmin) return true;
  return [
    "company_admin",
    "commercial_director",
    "technical_director",
    "telemarketing_director",
  ].some((r) => roles.includes(r));
}

/** El empleado crea una solicitud (olvido de fichar / corrección). */
export async function createPunchRequestAction(input: unknown): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(createSchema, input, "Solicitud de fichaje");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin.from("time_punch_requests").insert({
    company_id: session.company_id,
    user_id: session.user_id,
    requested_at: new Date(parsed.requested_at).toISOString(),
    punch_kind: parsed.punch_kind,
    reason: parsed.reason,
    status: "pending",
  });
  if (r.error) throw new Error(r.error.message);

  // Notificar a admins
  try {
    const { data: admins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id)
      .in("role_key", ["company_admin", "technical_director"])
      .is("revoked_at", null);
    for (const a of (admins ?? []) as Array<{ user_id: string }>) {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: a.user_id,
        kind: "punch_request",
        severity: "info",
        title: "Solicitud de fichaje",
        body: `${session.full_name ?? session.email} pide fichar ${PUNCH_KIND_LABEL[parsed.punch_kind]} el ${new Date(parsed.requested_at).toLocaleString("es-ES")}`,
      });
    }
  } catch {
    /* fail-soft */
  }
  revalidatePath("/fichajes");
}

/** Devuelve las solicitudes del usuario actual (todos los estados). */
export async function listMyPunchRequests(): Promise<PunchRequestRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("time_punch_requests")
    .select(
      "id, user_id, requested_at, punch_kind, reason, status, reviewed_by, reviewed_at, review_notes, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const rows = ((data ?? []) as Array<Omit<PunchRequestRow, "user_name">>);
  return rows.map((r) => ({
    ...r,
    user_name: session.full_name ?? session.email ?? null,
  }));
}

/** Solicitudes pendientes del equipo (admin/director). */
export async function listPendingPunchRequests(): Promise<PunchRequestRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!isAdminOrDirector(session.roles, session.is_superadmin)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("time_punch_requests")
    .select(
      "id, user_id, requested_at, punch_kind, reason, status, reviewed_by, reviewed_at, review_notes, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  const rows = ((data ?? []) as Array<Omit<PunchRequestRow, "user_name">>);
  if (rows.length === 0) return [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name, email")
    .in("user_id", userIds);
  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as Array<{
    user_id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    nameMap.set(p.user_id, p.full_name || p.email || "Usuario");
  }
  return rows.map((r) => ({
    ...r,
    user_name: nameMap.get(r.user_id) ?? null,
  }));
}

/** Admin aprueba: crea time_punches is_manual=true con la hora solicitada. */
export async function approvePunchRequestAction(
  id: string,
  notes?: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isAdminOrDirector(session.roles, session.is_superadmin)) {
    throw new Error("Solo admin / director puede aprobar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: req } = await admin
    .from("time_punch_requests")
    .select(
      "id, company_id, user_id, requested_at, punch_kind, status",
    )
    .eq("id", id)
    .maybeSingle();
  const r = req as {
    id: string;
    company_id: string;
    user_id: string;
    requested_at: string;
    punch_kind: PunchKind;
    status: PunchRequestStatus;
  } | null;
  if (!r) throw new Error("Solicitud no encontrada");
  if (r.status !== "pending") throw new Error("La solicitud ya está resuelta");

  // Insertar el fichaje manual
  const insertRes = await admin
    .from("time_punches")
    .insert({
      company_id: r.company_id,
      user_id: r.user_id,
      punch_kind: r.punch_kind,
      punched_at: r.requested_at,
      geo_latitude: null,
      geo_longitude: null,
      needs_geo_review: false, // ya validado por admin
      is_manual: true,
      edited_by_admin: session.user_id,
      edited_reason: notes ?? "Solicitud aprobada",
    })
    .select("id")
    .single();
  if (insertRes.error) throw new Error(insertRes.error.message);
  const newPunchId = (insertRes.data as { id: string } | null)?.id ?? null;

  // Marcar la solicitud como aprobada
  await admin
    .from("time_punch_requests")
    .update({
      status: "approved",
      reviewed_by: session.user_id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
      resulting_punch_id: newPunchId,
    })
    .eq("id", id);

  // Notificar al empleado
  try {
    await admin.from("notifications").insert({
      company_id: r.company_id,
      recipient_user_id: r.user_id,
      kind: "punch_request_resolved",
      severity: "success",
      title: "Fichaje aprobado",
      body: `Tu solicitud de ${PUNCH_KIND_LABEL[r.punch_kind]} ha sido aprobada`,
    });
  } catch {
    /* fail-soft */
  }
  revalidatePath("/fichajes");
  revalidatePath("/fichajes/admin");
}

/** Admin rechaza la solicitud. */
export async function rejectPunchRequestAction(
  id: string,
  notes?: string,
): Promise<void> {
  const session = await requireSession();
  if (!isAdminOrDirector(session.roles, session.is_superadmin)) {
    throw new Error("Solo admin / director puede rechazar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: req } = await admin
    .from("time_punch_requests")
    .select("user_id, company_id, punch_kind, status")
    .eq("id", id)
    .maybeSingle();
  const r = req as
    | { user_id: string; company_id: string; punch_kind: string; status: string }
    | null;
  if (!r) throw new Error("Solicitud no encontrada");
  if (r.status !== "pending") throw new Error("Ya resuelta");

  await admin
    .from("time_punch_requests")
    .update({
      status: "rejected",
      reviewed_by: session.user_id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq("id", id);

  try {
    await admin.from("notifications").insert({
      company_id: r.company_id,
      recipient_user_id: r.user_id,
      kind: "punch_request_resolved",
      severity: "warning",
      title: "Fichaje rechazado",
      body: `Tu solicitud de ${PUNCH_KIND_LABEL[r.punch_kind as PunchKind]} ha sido rechazada${notes ? ": " + notes : ""}`,
    });
  } catch {
    /* fail-soft */
  }
  revalidatePath("/fichajes");
  revalidatePath("/fichajes/admin");
}

/** El empleado cancela su propia solicitud (solo si está pending). */
export async function cancelPunchRequestAction(id: string): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("time_punch_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("user_id", session.user_id)
    .eq("status", "pending");
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/fichajes");
}
