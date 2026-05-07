/**
 * Sistema de plantillas de email.
 * Las plantillas usan variables tipo `{{customer_name}}` que se sustituyen
 * con renderTemplate() antes del envío.
 *
 * Plantillas pre-creadas (system templates) viven en system-templates.ts
 * y se cargan en BD la primera vez que la empresa abre /configuracion/mailing.
 */

/**
 * Renderiza una plantilla sustituyendo `{{var}}` por los valores de `vars`.
 * Variables sin valor quedan como cadena vacía (no como `{{var}}`).
 * Soporta filtros básicos: `{{name|upper}}`, `{{date|short}}`.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([a-zA-Z]+))?\s*\}\}/g,
    (_match, key: string, filter?: string) => {
      const raw = vars[key];
      if (raw === undefined || raw === null) return "";
      let str = String(raw);
      if (filter === "upper") str = str.toUpperCase();
      if (filter === "lower") str = str.toLowerCase();
      if (filter === "money") {
        const n = Number(raw);
        if (!isNaN(n)) {
          str = new Intl.NumberFormat("es-ES", {
            style: "currency",
            currency: "EUR",
          }).format(n / 100);
        }
      }
      if (filter === "date") {
        const d = raw instanceof Date ? raw : new Date(String(raw));
        if (!isNaN(d.getTime())) {
          str = d.toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
        }
      }
      return str;
    },
  );
}

/**
 * Construye el HTML completo del email envolviendo el body con la firma
 * del usuario y un footer con identificación legal + link de baja
 * (solo para marketing).
 */
export interface BuildEmailHtmlInput {
  body_html: string;
  signature_html?: string | null;
  /** Datos de la empresa para el footer (LSSI). */
  company: {
    legal_name: string;
    tax_id: string;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  /** URL de baja (solo marketing). */
  unsubscribe_url?: string;
  /** Tipo de email. transactional NO lleva link de baja. */
  kind: "transactional" | "marketing";
}

export function buildEmailHtml(input: BuildEmailHtmlInput): string {
  const { body_html, signature_html, company, unsubscribe_url, kind } = input;

  const footerLegal = `
    <p style="margin: 16px 0 4px 0; color: #888; font-size: 11px; line-height: 1.5;">
      <strong>${escapeHtml(company.legal_name)}</strong> · CIF ${escapeHtml(company.tax_id)}<br>
      ${company.address ? escapeHtml(company.address) + "<br>" : ""}
      ${company.email ? `Email: ${escapeHtml(company.email)} · ` : ""}
      ${company.phone ? `Tel: ${escapeHtml(company.phone)}` : ""}
    </p>`;

  const footerUnsub =
    kind === "marketing" && unsubscribe_url
      ? `
    <p style="margin: 12px 0 0 0; color: #999; font-size: 11px; line-height: 1.5;">
      ¿No quieres recibir más correos como este?
      <a href="${unsubscribe_url}" style="color: #4880FF; text-decoration: underline;">Date de baja aquí</a>.
    </p>`
      : "";

  const footerRgpd = `
    <p style="margin: 8px 0 0 0; color: #aaa; font-size: 10px; line-height: 1.4;">
      Conforme al RGPD, sus datos figuran en nuestros ficheros para gestión administrativa.
      Puede ejercer derechos ARCO escribiendo al email indicado arriba.
    </p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #f5f5f7;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table width="600" cellspacing="0" cellpadding="0" border="0" style="background: #ffffff; border-radius: 12px; overflow: hidden; max-width: 600px;">
          <tr>
            <td style="padding: 32px 28px; color: #222; font-size: 15px; line-height: 1.6;">
              ${body_html}
              ${signature_html ? `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">${signature_html}</div>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px 24px 28px; background: #fafafa; border-top: 1px solid #eee;">
              ${footerLegal}
              ${footerUnsub}
              ${footerRgpd}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Escape de strings para HTML (previene XSS si una variable trae HTML). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Genera la firma HTML del comercial. Si tiene foto la mostramos pequeña
 * a la izquierda, datos a la derecha.
 */
export function buildSignatureHtml(input: {
  full_name: string;
  job_title?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  company_name?: string | null;
  company_url?: string | null;
}): string {
  const { full_name, job_title, phone, email, avatar_url, company_name, company_url } = input;
  return `
    <table cellspacing="0" cellpadding="0" border="0" style="margin-top: 12px;">
      <tr>
        ${
          avatar_url
            ? `<td style="padding-right: 12px; vertical-align: top;">
                <img src="${escapeHtml(avatar_url)}" alt="${escapeHtml(full_name)}" width="48" height="48" style="border-radius: 50%; display: block;">
              </td>`
            : ""
        }
        <td style="vertical-align: top; font-size: 13px; color: #444; line-height: 1.5;">
          <strong style="color: #222;">${escapeHtml(full_name)}</strong>
          ${job_title ? `<br><span style="color: #777;">${escapeHtml(job_title)}</span>` : ""}
          ${phone ? `<br>📞 <a href="tel:${escapeHtml(phone.replace(/\s/g, ""))}" style="color: #4880FF; text-decoration: none;">${escapeHtml(phone)}</a>` : ""}
          ${email ? `<br>✉ <a href="mailto:${escapeHtml(email)}" style="color: #4880FF; text-decoration: none;">${escapeHtml(email)}</a>` : ""}
          ${
            company_url
              ? `<br>🌐 <a href="https://${escapeHtml(company_url)}" style="color: #4880FF; text-decoration: none;">${escapeHtml(company_name ?? company_url)}</a>`
              : company_name
                ? `<br>${escapeHtml(company_name)}`
                : ""
          }
        </td>
      </tr>
    </table>`;
}
