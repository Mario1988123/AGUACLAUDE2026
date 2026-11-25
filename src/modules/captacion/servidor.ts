import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { decryptSecret } from "@/modules/mailing/encryption";
import { listarPlantillas } from "./meta";
import { traducirCategoria, traducirEstadoPlantilla } from "./logica";

/**
 * Operaciones del módulo con el cliente de servicio. Siempre con company_id
 * explícito en el filtro: el cliente de servicio se salta la RLS.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export function admin(): Admin {
  return createAdminClient() as Admin;
}

/** Token de negocio en claro. Solo para llamar a Meta desde el servidor. */
export async function obtenerToken(companyId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from("captacion_conexion_secretos")
    .select("token_cifrado")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el token: ${error.message}`);
  const cifrado = (data as { token_cifrado: string | null } | null)?.token_cifrado;
  return cifrado ? decryptSecret(cifrado) : null;
}

/**
 * Trae las plantillas de la WABA y las guarda. Las que ya no están en Meta
 * pasan a `desactivada` (no se borran: una campaña puede apuntar a ellas).
 * Devuelve cuántas hay.
 */
export async function sincronizarPlantillas(companyId: string): Promise<number> {
  const db = admin();
  const { data: con, error } = await db
    .from("captacion_conexiones")
    .select("waba_id, estado")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const wabaId = (con as { waba_id: string | null } | null)?.waba_id;
  if (!wabaId) throw new Error("La empresa no tiene WhatsApp conectado.");
  const token = await obtenerToken(companyId);
  if (!token) throw new Error("No hay token guardado: vuelve a conectar WhatsApp.");

  const plantillas = await listarPlantillas(token, wabaId);
  const ahora = new Date().toISOString();
  const filas = plantillas
    .map((p) => {
      const categoria = traducirCategoria(p.category);
      if (!categoria || !p.name || !p.language) return null;
      return {
        company_id: companyId,
        nombre: p.name,
        idioma: p.language,
        categoria,
        estado: traducirEstadoPlantilla(p.status),
        estado_meta: p.status ?? null,
        motivo_rechazo: p.rejected_reason && p.rejected_reason !== "NONE" ? p.rejected_reason : null,
        componentes: p.components ?? [],
        meta_template_id: p.id,
        sincronizada_at: ahora,
      };
    })
    .filter(Boolean);

  if (filas.length > 0) {
    const { error: e2 } = await db
      .from("captacion_plantillas")
      .upsert(filas, { onConflict: "company_id,nombre,idioma" });
    if (e2) throw new Error(`No se pudieron guardar las plantillas: ${e2.message}`);
  }

  // Lo que no ha venido en esta sincronización ya no existe en Meta.
  const { error: e3 } = await db
    .from("captacion_plantillas")
    .update({ estado: "desactivada", estado_meta: "NO_ENCONTRADA", sincronizada_at: ahora })
    .eq("company_id", companyId)
    .or(`sincronizada_at.is.null,sincronizada_at.lt.${ahora}`);
  if (e3) throw new Error(e3.message);

  return filas.length;
}
