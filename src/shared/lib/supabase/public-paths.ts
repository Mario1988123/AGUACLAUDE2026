/**
 * Rutas que el middleware deja pasar SIN sesión (solo afecta a GET; los POST
 * nunca se redirigen al login, ver middleware.ts).
 *
 * Fichero aparte para poder probarlo sin montar el middleware de Next.
 */

// Rutas públicas (solo aplica a GET):
//  · /login + recuperación de contraseña
//  · /api/health para uptime checks
//  · /m/[token] — confirmación pública de mantenimiento por cliente
//  · /i/[token] — confirmación pública de instalación por cliente
//  · /firmar-contrato — firma remota de contrato
export const PUBLIC_PATHS: readonly string[] = [
  "/login",
  "/recuperar-password",
  "/restablecer-password",
  "/api/health",
  "/m/",
  "/i/",
  "/firmar-contrato",
  "/baja", // baja de comunicaciones comerciales (link en emails de campaña)
  // Enlaces que la empresa manda al cliente (auditoría 2026-10-01 I19: hasta
  // ahora redirigían al login del CRM). Todas validan un token de
  // product_public_shares / contract_remote_signatures (caducidad y
  // revocación) ANTES de leer nada; ninguna enseña datos sin token válido.
  // Van con barra final para no abrir rutas hermanas por prefijo.
  "/catalogo/", //            /catalogo/[token]  (página del catálogo)
  "/datasheet/", //           /datasheet/[token] y /datasheet/[token]/pdf
  "/api/pdf/catalog-v2/", //  /api/pdf/catalog-v2/[token] (PDF del catálogo)
  "/api/pdf/contract/public/", // PDF del contrato desde la firma remota
  "/api/webhooks/", // webhooks externos (Resend, GoCardless) verifican su propia firma
  "/api/track/", // tracking de aperturas/clics SMTP (pixel + redirect)
  // Crons de Vercel: llegan sin cookie de sesión, así que el middleware los
  // redirigía a /login con un 307 y el handler NUNCA llegaba a ejecutarse
  // (cron_runs vacía, VeriFactu sin enviar, recordatorios sin salir).
  // No abre ningún agujero: cada ruta empieza por verifyCronAuth(), que exige
  // el CRON_SECRET y es fail-closed si la variable no está definida.
  "/api/cron/",
];

/** ¿Se puede abrir esta ruta sin sesión? Comparación por prefijo. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}
