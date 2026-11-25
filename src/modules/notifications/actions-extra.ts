"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { idsEmpresasEnServicioOTodas, soloVisibles } from "@/shared/lib/empresas/en-servicio";

/**
 * Cuenta para el badge del bell del header.
 * SOLO cuenta category='alert' — los eventos informativos (nuevo lead,
 * contrato firmado, etc.) no ensucian la campana. Quedan accesibles en
 * /notificaciones pestaña "Eventos".
 *
 * Fail-soft con la columna category: si la migración aún no ha corrido
 * en este entorno, el filtro `.eq("category","alert")` puede fallar.
 * Capturamos y reintentamos sin filtro para no romper el header.
 */
export async function fetchUnreadCount(): Promise<number> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Sin avisos de empresas pausadas o de baja (Mario 2026-11-28).
  const visibles = await idsEmpresasEnServicioOTodas();
  try {
    const { count, error } = await soloVisibles(
      supabase.from("notifications").select("id", { count: "exact", head: true }),
      visibles,
    )
      .eq("recipient_user_id", session.user_id)
      .eq("category", "alert")
      .is("read_at", null)
      .is("auto_resolved_at", null);
    if (error) throw error;
    return count ?? 0;
  } catch {
    // fallback defensivo si category aún no existe
    const { count } = await soloVisibles(
      supabase.from("notifications").select("id", { count: "exact", head: true }),
      visibles,
    )
      .eq("recipient_user_id", session.user_id)
      .is("read_at", null);
    return count ?? 0;
  }
}
