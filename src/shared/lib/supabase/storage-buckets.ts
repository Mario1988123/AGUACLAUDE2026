/**
 * Helpers para garantizar que los buckets de Storage existen ANTES
 * de subir/leer archivos. El usuario no crea buckets manualmente —
 * deben auto-crearse en producción la primera vez que se necesitan.
 *
 * Antes los buckets como `contract-photos` se documentaban como
 * "crear manualmente" y al deployar se rompía con `Bucket not found`
 * digest 3556820431. Ahora cualquier upload es idempotente: si el
 * bucket no existe, se crea con la visibilidad correcta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_BUCKETS = {
  /** Foto de perfil del usuario. Público para que se sirva por URL directa. */
  avatars: { public: true },
  /** Fotos del proceso de firma de contrato (DNI, IBAN, firmas, etc.). Privadas. */
  "contract-photos": { public: false },
  /** Fotos del parte de instalación (equipo, conexión, daños, etc.). Privadas. */
  "installation-photos": { public: false },
  /** Firmas digitalizadas (canvas) de instalaciones. Privadas. */
  "installation-signatures": { public: false },
  /** Adjuntos de incidencias. Privadas. */
  "incident-attachments": { public: false },
  /** Datasheets / hojas técnicas de productos. Públicas. */
  "product-datasheets": { public: true },
  /** Logos de empresa para PDF. Públicos. */
  "company-logos": { public: true },
  /** Tickets/recibos de gastos comerciales. Privados. */
  expenses: { public: false },
  /** Firmas digitalizadas del albarán de prueba gratuita. Privadas. */
  "free-trial-signatures": { public: false },
  /** Imágenes generadas por IA para posts de RRSS. Públicas (URL directa
   *  en preview del panel y en publicación). */
  "social-images": { public: true },
} as const;

export type BucketName = keyof typeof STORAGE_BUCKETS;

/**
 * Deriva la extensión correcta del archivo. Antes el código miraba
 * solo `file.type === "image/png" | "image/webp"` y por defecto ponía
 * "jpg" — esto rompía con HEIC del iPhone (el archivo se subía pero
 * con extensión .jpg y contentType heic, y luego no se renderizaba).
 *
 * Estrategia:
 *   1. Si `file.name` tiene extensión legible (heic, heif, png, webp,
 *      jpg, jpeg, gif), la usamos.
 *   2. Si no, miramos el MIME type del file.
 *   3. Fallback: jpg.
 */
export function pickImageExt(file: { name?: string; type?: string }): string {
  const fromName = file.name?.toLowerCase().match(/\.(heic|heif|png|webp|jpe?g|gif|bmp)$/);
  if (fromName) return fromName[1] === "jpeg" ? "jpg" : fromName[1]!;
  const t = (file.type ?? "").toLowerCase();
  if (t.includes("heic")) return "heic";
  if (t.includes("heif")) return "heif";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("bmp")) return "bmp";
  return "jpg";
}

/**
 * Garantiza que el bucket existe. Si ya existe (por nombre), no
 * hace nada. Si no, lo crea con la visibilidad declarada.
 *
 * Devuelve `true` si el bucket está listo (existía o se creó),
 * `false` si hubo un error inesperado (no de duplicado).
 *
 * Diseñado para ser idempotente y barato. No tira excepciones —
 * los callers comprueban el bool y deciden si seguir.
 */
export async function ensureBucket(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient | any,
  name: BucketName | (string & {}),
): Promise<boolean> {
  const cfg =
    name in STORAGE_BUCKETS
      ? STORAGE_BUCKETS[name as BucketName]
      : { public: false };
  try {
    // Listar buckets es más barato que createBucket cuando ya existe
    // (no recibimos error de duplicate, es un GET).
    const { data: list } = await admin.storage.listBuckets();
    type Item = { name: string };
    if (Array.isArray(list) && (list as Item[]).some((b) => b.name === name)) {
      return true;
    }
  } catch (e) {
    console.error(`[ensureBucket] listBuckets falló para ${name}:`, e);
    // Continuamos al createBucket de todos modos
  }
  try {
    const { error } = await admin.storage.createBucket(name, {
      public: cfg.public,
    });
    if (!error) return true;
    const msg = error.message ?? "";
    // Si ya existe (race con otra petición) lo tratamos como éxito.
    if (/already exists|duplicate/i.test(msg)) return true;
    console.error(`[ensureBucket] createBucket ${name} falló:`, msg);
    return false;
  } catch (e) {
    console.error(`[ensureBucket] createBucket ${name} threw:`, e);
    return false;
  }
}
