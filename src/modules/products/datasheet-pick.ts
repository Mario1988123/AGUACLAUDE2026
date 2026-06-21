/**
 * Elige el generador de ficha técnica según la plantilla configurada por la
 * empresa (company_settings.datasheet_template). Por defecto, estándar (v2).
 * Fail-soft: ante cualquier problema cae al estándar.
 */
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { generateProductDatasheetV2 } from "./datasheet-pdf-v2";
import { generateProductDatasheetIagua } from "./datasheet-iagua";

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
      if ((cs as { datasheet_template?: string } | null)?.datasheet_template === "iagua") {
        return await generateProductDatasheetIagua(productId);
      }
    }
  } catch {
    /* fail-soft → estándar */
  }
  return await generateProductDatasheetV2(productId);
}
