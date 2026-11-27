import "server-only";
import { notify, notifyByRoles } from "@/modules/notifications/notifier";
import { admin } from "./servidor";

/**
 * Avisos del módulo (plan §4.8). Van al responsable de la campaña; si la
 * campaña no tiene, a los directores y al administrador. Sin sujeto
 * (`app.subject_type` no tiene valor para prospecto) y con action_url a la
 * conversación. Nunca lanzan: un aviso no tumba el flujo principal.
 */

const ROLES_SIN_RESPONSABLE = ["company_admin", "commercial_director", "telemarketing_director"];

export interface Aviso {
  kind: "captacion.dijo_si" | "captacion.propuesta_leida" | "captacion.pide_persona" | "captacion.interes";
  category: "alert" | "event";
  /** Fase 5: el paso a persona va como aviso (por defecto, info). */
  severity?: "info" | "warning";
  title: string;
  body: string | null;
  actionUrl: string | null;
  /** Para que notifyByRoles no repita el mismo aviso (prospecto o propuesta). */
  sujetoId: string | null;
}

export async function avisarResponsable(companyId: string, campanaId: string | null, a: Aviso): Promise<void> {
  try {
    let responsable: string | null = null;
    if (campanaId) {
      const { data, error } = await admin()
        .from("captacion_campanas")
        .select("responsable_user_id")
        .eq("company_id", companyId)
        .eq("id", campanaId)
        .maybeSingle();
      if (error) console.error("[captacion/avisos] responsable:", error.message);
      responsable = (data as { responsable_user_id: string | null } | null)?.responsable_user_id ?? null;
    }
    const carga = {
      kind: a.kind,
      category: a.category,
      severity: a.severity ?? ("info" as const),
      title: a.title,
      body: a.body,
      subject_id: a.sujetoId,
      action_url: a.actionUrl,
    };
    if (responsable) await notify({ company_id: companyId, recipient_user_id: responsable, ...carga });
    else await notifyByRoles(companyId, ROLES_SIN_RESPONSABLE, carga);
  } catch (e) {
    console.error("[captacion/avisos] no se pudo avisar", e instanceof Error ? e.message : e);
  }
}

// -----------------------------------------------------------------------------
// Fase 7: avisos de gestión (cortacircuitos, conexión, gasto)
// -----------------------------------------------------------------------------

export const ROLES_GESTION = ["company_admin", "commercial_director", "telemarketing_director"];

export interface AvisoGestion {
  kind: "captacion.campana_pausada" | "captacion.gasto_aviso" | "captacion.gasto_tope";
  severity: "warning" | "error";
  title: string;
  body: string | null;
  actionUrl: string | null;
  /** Campaña, si va de una (para que notifyByRoles no lo repita en 2 h). */
  sujetoId: string | null;
}

/**
 * A los roles dados (por defecto admin y directores). Es alerta: lleva push.
 * El «una sola vez» lo garantiza quien llama (actualización condicionada);
 * aquí solo se manda. Nunca lanza.
 */
export async function avisarGestion(companyId: string, a: AvisoGestion, roles: string[] = ROLES_GESTION): Promise<void> {
  try {
    await notifyByRoles(companyId, roles, {
      kind: a.kind,
      category: "alert",
      severity: a.severity,
      title: a.title,
      body: a.body,
      subject_id: a.sujetoId,
      action_url: a.actionUrl,
    });
  } catch (e) {
    console.error("[captacion/avisos] no se pudo avisar a gestión", e instanceof Error ? e.message : e);
  }
}
