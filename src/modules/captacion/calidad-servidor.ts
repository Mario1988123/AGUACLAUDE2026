import "server-only";
import { admin, obtenerToken } from "./servidor";
import { leerNumero } from "./meta";
import { aE164, traducirCalidad, traducirLimite } from "./logica";

/**
 * Refresca desde Meta la calidad y el límite de los números que están
 * enviando (conexión activa con envíos encendidos). Lo llama el cron de
 * envíos antes de revisar las conexiones, para que la pausa por calidad
 * (revisarConexiones en mando-servidor.ts) se base en el dato de ahora y no
 * en el último que alguien refrescó a mano.
 *
 * Un fallo de Meta en una empresa no corta las demás: se devuelve en errores.
 */
export async function refrescarCalidadNumeros(): Promise<{ revisados: number; errores: string[] }> {
  const db = admin();
  const { data, error } = await db
    .from("captacion_conexiones")
    .select("company_id, phone_number_id")
    .eq("estado", "activa")
    .eq("envios_activos", true)
    .not("phone_number_id", "is", null);
  if (error) return { revisados: 0, errores: [`calidad: ${error.message}`] };

  let revisados = 0;
  const errores: string[] = [];
  for (const c of (data ?? []) as Array<{ company_id: string; phone_number_id: string }>) {
    try {
      const token = await obtenerToken(c.company_id);
      if (!token) continue;
      const f = await leerNumero(token, c.phone_number_id);
      const limite = traducirLimite(f.whatsapp_business_manager_messaging_limit);
      const { error: eUp } = await db
        .from("captacion_conexiones")
        .update({
          numero_e164: aE164(f.display_phone_number),
          nombre_visible: f.verified_name ?? null,
          calidad: traducirCalidad(f.quality_rating),
          ...(limite != null ? { limite_diario_meta: limite } : {}),
        })
        .eq("company_id", c.company_id);
      if (eUp) throw new Error(eUp.message);
      revisados++;
    } catch (e) {
      errores.push(`calidad ${c.company_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { revisados, errores };
}
