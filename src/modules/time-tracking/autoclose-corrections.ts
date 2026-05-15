"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface AutoClosedPunch {
  id: string;
  punched_at: string;
  /** Hora propuesta por el sistema al autocerrar (la del fin de turno
   *  por defecto). El empleado puede proponer otra hora si trabajó más
   *  (horas extras) o menos. */
  has_pending_correction: boolean;
}

/** Devuelve los clock_out auto_closed=true del usuario actual en los
 *  últimos 14 días, indicando si ya hay una solicitud de corrección
 *  pendiente o aprobada para ese mismo día. */
export async function listMyAutoClosedPunches(): Promise<AutoClosedPunch[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const since = new Date();
  since.setDate(since.getDate() - 14);

  const { data: punches } = await admin
    .from("time_punches")
    .select("id, punched_at, auto_closed")
    .eq("user_id", session.user_id)
    .eq("auto_closed", true)
    .eq("punch_kind", "clock_out")
    .gte("punched_at", since.toISOString())
    .order("punched_at", { ascending: false })
    .limit(30);
  type P = { id: string; punched_at: string; auto_closed: boolean };
  const list = (punches ?? []) as P[];
  if (list.length === 0) return [];

  // Detectar si ya hay solicitudes para ese mismo día
  const { data: reqs } = await admin
    .from("time_punch_requests")
    .select("requested_at, status, punch_kind")
    .eq("user_id", session.user_id)
    .eq("punch_kind", "clock_out")
    .in("status", ["pending", "approved"])
    .gte("requested_at", since.toISOString());
  type R = { requested_at: string; status: string; punch_kind: string };
  const reqDates = new Set(
    ((reqs ?? []) as R[]).map((r) => r.requested_at.slice(0, 10)),
  );

  return list.map((p) => ({
    id: p.id,
    punched_at: p.punched_at,
    has_pending_correction: reqDates.has(p.punched_at.slice(0, 10)),
  }));
}
