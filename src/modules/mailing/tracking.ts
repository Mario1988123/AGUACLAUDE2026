/**
 * Tracking de aperturas y clics PROVIDER-AGNOSTIC para envíos SMTP.
 *
 * - Apertura: se inyecta un píxel 1x1 transparente al final del HTML que
 *   apunta a /api/track/open/[outbox_id]. Cuando el cliente abre el email
 *   y su cliente carga la imagen, el endpoint registra opened_at + opens_count
 *   en email_outbox. NO 100% fiable (algunos clientes bloquean imágenes),
 *   pero es el estándar de la industria.
 *
 * - Clic: cada enlace <a href="X"> del HTML se reescribe a
 *   /api/track/click/[outbox_id]?u=<base64url(X)>. El endpoint registra el
 *   clic y redirige al destino real. FIABLE (todos los clics pasan por el
 *   redirect).
 *
 * Solo se aplica cuando el camino real fue SMTP (no Resend). Resend ya
 * trackea aperturas/clics por webhook y duplicarlo confundiría las métricas.
 */

/** Codifica una URL para pasarla como ?u= sin romper caracteres especiales. */
function encodeUrlSafe(url: string): string {
  return Buffer.from(url, "utf8").toString("base64url");
}

/** Decodifica el ?u= devolviendo null si la URL no es válida o no es http/https.
 *  Protege contra open-redirect a esquemas peligrosos (javascript:, data:, etc.). */
export function decodeUrlSafe(encoded: string): string | null {
  try {
    const url = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** Devuelve la URL base (NEXT_PUBLIC_APP_URL o vercel). Vacío si no hay. */
function trackingBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  );
}

/**
 * Envuelve un HTML añadiendo píxel de apertura + reescritura de enlaces para
 * tracking. Si no hay outboxId o baseUrl, devuelve el HTML sin tocar.
 *
 * Diseño email-safe:
 *  - Píxel: `<img>` 1x1 transparente al final del body con `alt=""` y estilos
 *    inline. Algunos clientes lo cachean (apertura "falsa") pero es el límite
 *    del pixel-tracking; no podemos hacer más sin servidor de imágenes proxy.
 *  - Reescritura: solo `<a href="http..."` (no mailto:, tel:, anchors). Mantiene
 *    el resto de atributos del `<a>` intactos.
 */
export function wrapWithTracking(
  html: string,
  outboxId: string,
  baseUrl?: string,
): string {
  const base = (baseUrl ?? trackingBaseUrl()).replace(/\/+$/, "");
  if (!base || !outboxId) return html;

  // 1) Reescribir enlaces. Regex tolerante con orden de atributos y comillas.
  //    Solo http/https para no romper mailto: / tel: / anchors internos.
  const rewritten = html.replace(
    /<a\b([^>]*?)href\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    (_match, pre: string, quote: string, url: string, post: string) => {
      const trackUrl = `${base}/api/track/click/${outboxId}?u=${encodeUrlSafe(url)}`;
      return `<a${pre}href=${quote}${trackUrl}${quote}${post}>`;
    },
  );

  // 2) Inyectar píxel. Si hay </body> lo metemos justo antes; si no, al final.
  const pixel = `<img src="${base}/api/track/open/${outboxId}" width="1" height="1" alt="" style="display:block;border:0;outline:none;text-decoration:none;height:1px;width:1px;" />`;
  if (/<\/body>/i.test(rewritten)) {
    return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return rewritten + pixel;
}
