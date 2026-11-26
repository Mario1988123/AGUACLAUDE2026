/**
 * Elige el generador de ficha técnica según la plantilla configurada por la
 * empresa (company_settings.datasheet_template):
 * - «tarifa», «escaparate», «placa» → ficha nueva (ficha/generar-ficha.ts);
 * - «iagua» → IAGUA;
 * - cualquier otra cosa → estándar (v2).
 * Fail-soft: ante cualquier problema cae al estándar.
 *
 * Las plantillas nuevas solo se pueden guardar con la migración
 * 20261129100000 aplicada; sin ella nadie las tiene y esto no cambia nada.
 */
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { generateProductDatasheetV2 } from "./datasheet-pdf-v2";
import { generateProductDatasheetIagua } from "./datasheet-iagua";
import { generarFichaConCliente, type OpcionesGenerar } from "./ficha/generar-ficha";
import { esPlantillaNueva, type PlantillaNueva } from "./ficha/modelo";

/** Ficha nueva con el admin client (el llamador ya comprobó la empresa). */
export async function generarFichaNueva(
  productId: string,
  opciones: OpcionesGenerar = {},
): Promise<Uint8Array> {
  const r = await generarFichaConCliente(createAdminClient(), productId, opciones);
  return r.bytes;
}

export async function generateProductDatasheetAuto(
  productId: string,
): Promise<Uint8Array> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prod } = await admin
      .from("products")
      .select("company_id")
      .eq("id", productId)
      .maybeSingle();
    const companyId = (prod as { company_id?: string } | null)?.company_id;
    if (companyId) {
      const { data: cs } = await admin
        .from("company_settings")
        .select("datasheet_template")
        .eq("company_id", companyId)
        .maybeSingle();
      const plantilla = (cs as { datasheet_template?: string } | null)?.datasheet_template;
      if (plantilla === "iagua") {
        return await generateProductDatasheetIagua(productId);
      }
      if (esPlantillaNueva(plantilla)) {
        return await generarFichaNueva(productId, { plantilla: plantilla as PlantillaNueva });
      }
    }
  } catch (e) {
    console.error("[datasheet-pick] cae a la estándar:", e instanceof Error ? e.message : e);
  }
  return await generateProductDatasheetV2(productId);
}
