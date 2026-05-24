"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { forwardGeocodeAction } from "@/shared/lib/geocoding/actions";

interface BacklogRow {
  id: string;
  street: string | null;
  street_number: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  notes: string | null;
  geo_retries: number | null;
}

/**
 * Procesa direcciones sin coordenadas (latitude/longitude IS NULL) en
 * lotes pequeños — útil tras importaciones masivas CSV donde el
 * geocode bloquearía la transacción.
 *
 * Reglas:
 *  · Solo procesa filas con calle Y CP (mínimo viable para Nominatim).
 *  · Respeta el rate limit de Nominatim (1 req/seg) → pausa 1100 ms
 *    entre llamadas.
 *  · Tras 3 reintentos fallidos pone `geo_source='none'` con nota para
 *    revisión humana y no vuelve a intentarlo.
 *  · `maxBatch` para no superar `maxDuration` del cron en Vercel.
 *
 * Devuelve resumen de lo procesado.
 */
export async function processGeocodeBacklog(maxBatch = 30): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  exhausted: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: rows } = await admin
    .from("addresses")
    .select(
      "id, street, street_number, postal_code, city, province, notes, geo_retries",
    )
    .is("latitude", null)
    .is("longitude", null)
    .or("geo_source.is.null,geo_source.neq.none")
    .not("street", "is", null)
    .not("postal_code", "is", null)
    .lt("geo_retries", 3)
    .order("created_at", { ascending: true })
    .limit(maxBatch);

  const list = (rows ?? []) as BacklogRow[];
  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const r of list) {
    const query = [
      r.street,
      r.street_number,
      r.postal_code,
      r.city,
      r.province,
      "España",
    ]
      .filter(Boolean)
      .join(", ");
    try {
      const result = await forwardGeocodeAction(query);
      if (result) {
        await admin
          .from("addresses")
          .update({
            latitude: result.lat,
            longitude: result.lng,
            geo_source: "geocoded",
            geo_retries: 0,
          })
          .eq("id", r.id);
        succeeded += 1;
      } else {
        const retries = (r.geo_retries ?? 0) + 1;
        if (retries >= 3) {
          await admin
            .from("addresses")
            .update({
              geo_source: "none",
              geo_retries: retries,
              notes: r.notes
                ? `${r.notes}\n[auto-geocode] No se pudo geocodificar tras 3 intentos.`
                : "[auto-geocode] No se pudo geocodificar tras 3 intentos.",
            })
            .eq("id", r.id);
          exhausted += 1;
        } else {
          await admin
            .from("addresses")
            .update({ geo_retries: retries })
            .eq("id", r.id);
          failed += 1;
        }
      }
    } catch (e) {
      console.error("[geocode-backlog]", r.id, e);
      failed += 1;
    }
    // Respetar 1 req/seg de Nominatim
    await new Promise((res) => setTimeout(res, 1100));
  }

  return {
    processed: list.length,
    succeeded,
    failed,
    exhausted,
  };
}
