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

/** Tipos de aviso que además salen como toast emergente al llegar. */
const KINDS_CON_TOAST = ["free_trial.created"];

export interface AvisoNuevo {
  id: string;
  title: string;
  body: string | null;
  action_url: string | null;
  severity: string;
}

/**
 * Avisos NUEVOS para el toast emergente de la campana (Mario 2026-11-26):
 * alertas sin leer creadas después de `desde` que sean de un tipo con toast
 * (p. ej. «nueva prueba gratuita») o de prioridad alta (warning / error).
 * Sin `desde` (primera llamada) no devuelve nada: solo la hora del servidor,
 * para no sacar de golpe los avisos antiguos al abrir la app.
 */
export async function fetchAvisosNuevos(
  desde: string | null,
): Promise<{ ahora: string; avisos: AvisoNuevo[] }> {
  const ahora = new Date().toISOString();
  if (!desde || Number.isNaN(Date.parse(desde))) return { ahora, avisos: [] };
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const visibles = await idsEmpresasEnServicioOTodas();
  try {
    const { data, error } = await soloVisibles(
      supabase
        .from("notifications")
        .select("id, title, body, action_url, severity, kind, created_at"),
      visibles,
    )
      .eq("recipient_user_id", session.user_id)
      .eq("category", "alert")
      .is("read_at", null)
      .is("auto_resolved_at", null)
      .gt("created_at", desde)
      .or(`kind.in.(${KINDS_CON_TOAST.join(",")}),severity.in.(warning,error)`)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    return {
      ahora,
      avisos: ((data ?? []) as Array<AvisoNuevo>).map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body ?? null,
        action_url: n.action_url ?? null,
        severity: n.severity,
      })),
    };
  } catch {
    return { ahora, avisos: [] };
  }
}
