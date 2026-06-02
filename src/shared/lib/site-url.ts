/**
 * Devuelve la URL base del sitio (CRM) para construir enlaces absolutos en
 * emails, webhooks salientes, etc.
 *
 * Orden de prioridad:
 *  1) NEXT_PUBLIC_SITE_URL     (lo que el admin configura en Vercel)
 *  2) NEXT_PUBLIC_APP_URL      (nombre antiguo de la variable)
 *  3) VERCEL_URL               (URL preview de Vercel, ej. aguaclaude2026.vercel.app)
 *  4) http://localhost:3000    (dev)
 *
 * Protección: si la URL acaba siendo de Vercel preview (*.vercel.app), la
 * sustituimos por el dominio público del CRM. El cliente nunca debe llegar
 * a la URL preview porque Vercel le pide login.
 */
export function siteBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";

  // Sanea: si ha caído al preview de Vercel, devolver el dominio real.
  if (/\.vercel\.app$/i.test(new URL(raw).hostname)) {
    return "https://crm.hidromanager.es";
  }
  return raw.replace(/\/+$/, ""); // sin trailing slash
}
