"use server";
/**
 * Envío por email de fichas técnicas y catálogos vía Resend.
 *
 * Flujo:
 *   1. Verificar permisos: solo admin (regla feedback_productos_permisos).
 *   2. Generar URL pública (si no se pasa una existente).
 *   3. Renderizar plantilla `product_datasheet_share` (o `product_catalog_share`)
 *      reemplazando variables.
 *   4. Generar PDF (solo para fichas técnicas sueltas).
 *   5. Enviar vía sendEmailViaResend con adjunto + tracking en
 *      product_catalog_emails.
 *
 * Nota: para catálogos completos NO se adjunta PDF — solo URL pública en el
 * cuerpo (decisión usuario 2026-06-04).
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";
import {
  createProductDatasheetShareAction,
  type ProductShareItem,
} from "./share-actions";
import { generateProductDatasheetAuto } from "./datasheet-pick";
import { sendEmailViaResend } from "@/modules/mailing/resend";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTemplate(text: string, vars: Record<string, string | null>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => {
    const v = vars[k];
    return v == null ? "" : v;
  });
}

interface SystemTemplate {
  subject: string;
  body_html: string;
  body_text: string | null;
}

async function loadSystemTemplate(key: string): Promise<SystemTemplate | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Buscar primero plantilla custom de la empresa, fallback al sistema (company_id null)
  const session = await requireSession();
  if (session.company_id) {
    const { data: custom } = await admin
      .from("email_templates")
      .select("subject, body_html, body_text, is_active")
      .eq("company_id", session.company_id)
      .eq("key", key)
      .maybeSingle();
    if (custom && (custom as { is_active: boolean }).is_active) {
      return custom as SystemTemplate;
    }
  }
  const { data: sys } = await admin
    .from("email_templates")
    .select("subject, body_html, body_text, is_active")
    .is("company_id", null)
    .eq("key", key)
    .maybeSingle();
  if (sys && (sys as { is_active: boolean }).is_active) {
    return sys as SystemTemplate;
  }
  return null;
}

async function getSenderInfo(): Promise<{
  from_email: string;
  from_name: string;
  reply_to: string | null;
}> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Usuario actual
  const { data: userSettings } = await admin
    .from("email_user_settings")
    .select("from_email, from_name")
    .eq("user_id", session.user_id)
    .maybeSingle();

  if (userSettings && (userSettings as { from_email: string | null }).from_email) {
    const u = userSettings as { from_email: string; from_name: string | null };
    return {
      from_email: u.from_email,
      from_name: u.from_name ?? session.full_name ?? "",
      reply_to: u.from_email,
    };
  }

  // 2) Fallback empresa
  if (session.company_id) {
    const { data: settings } = await admin
      .from("company_settings")
      .select("fiscal_email, fiscal_legal_name")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (settings) {
      const s = settings as { fiscal_email: string | null; fiscal_legal_name: string | null };
      if (s.fiscal_email) {
        return {
          from_email: s.fiscal_email,
          from_name: s.fiscal_legal_name ?? "",
          reply_to: s.fiscal_email,
        };
      }
    }
  }

  // 3) Último fallback (no se podrá enviar pero al menos no rompemos el flujo)
  return {
    from_email: process.env.RESEND_DEFAULT_FROM ?? "noreply@example.com",
    from_name: session.full_name ?? "",
    reply_to: null,
  };
}

export type SendEmailResult =
  | { ok: true; resend_id: string | null; share_token: string }
  | { ok: false; error: string };

/**
 * Envía la ficha técnica de un producto por email. Genera o reutiliza una
 * URL pública, adjunta el PDF generado y guarda traza en
 * product_catalog_emails.
 */
export async function sendProductDatasheetEmailAction(input: {
  productId: string;
  recipientEmail: string;
  recipientName?: string;
  customMessage?: string;
  customerId?: string | null;
  leadId?: string | null;
  reuseShareId?: string | null;
}): Promise<SendEmailResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const email = input.recipientEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Email del destinatario no válido" };
    }

    // 1) URL pública: reutilizar la pasada o crear una nueva.
    let share: ProductShareItem | null = null;
    let publicUrl = "";
    if (input.reuseShareId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const { data } = await admin
        .from("product_public_shares")
        .select(
          "id, share_type, product_ids, share_token, expires_at, revoked_at, company_id",
        )
        .eq("id", input.reuseShareId)
        .eq("company_id", session.company_id)
        .maybeSingle();
      if (data && !(data as { revoked_at: string | null }).revoked_at) {
        share = data as ProductShareItem;
        const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
        publicUrl = `${base}/datasheet/${share.share_token}`;
      }
    }
    if (!share) {
      const created = await createProductDatasheetShareAction({
        productId: input.productId,
      });
      if (!created.ok) return { ok: false, error: created.error };
      share = created.share;
      publicUrl = created.public_url;
    }

    // 2) Cargar plantilla
    const tpl = await loadSystemTemplate("product_datasheet_share");
    if (!tpl) {
      return { ok: false, error: "Plantilla 'product_datasheet_share' no encontrada." };
    }

    // 3) Cargar nombre del producto + empresa para variables
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prod } = await admin
      .from("products")
      .select("name")
      .eq("id", input.productId)
      .maybeSingle();
    const productName = (prod as { name: string } | null)?.name ?? "Producto";

    const { data: company } = await admin
      .from("companies")
      .select("legal_name, trade_name")
      .eq("id", session.company_id)
      .maybeSingle();
    const { data: companySettings } = await admin
      .from("company_settings")
      .select("fiscal_legal_name")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const companyName =
      (companySettings as { fiscal_legal_name: string | null } | null)?.fiscal_legal_name ??
      (company as { trade_name: string | null; legal_name: string | null } | null)
        ?.trade_name ??
      (company as { legal_name: string | null } | null)?.legal_name ??
      "Empresa";

    const vars: Record<string, string | null> = {
      customer_name: input.recipientName ?? "",
      product_name: productName,
      share_url: publicUrl,
      user_name: session.full_name ?? "",
      company_name: companyName,
    };

    const subject = renderTemplate(tpl.subject, vars);
    const bodyHtml = input.customMessage
      ? renderTemplate(input.customMessage, vars)
      : renderTemplate(tpl.body_html, vars);
    const bodyText = tpl.body_text ? renderTemplate(tpl.body_text, vars) : undefined;

    // 4) Generar PDF y convertirlo a base64
    const pdfBytes = await generateProductDatasheetAuto(input.productId);
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // 5) Sender
    const sender = await getSenderInfo();

    // 6) Enviar vía Resend
    const result = await sendEmailViaResend({
      from_email: sender.from_email,
      from_name: sender.from_name,
      reply_to: sender.reply_to ?? undefined,
      to_email: email,
      to_name: input.recipientName,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      attachments: [
        {
          filename: `ficha-tecnica-${productName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.pdf`,
          content: pdfBase64,
        },
      ],
      metadata: {
        product_id: input.productId,
        share_id: share.id,
        kind: "product_datasheet",
      },
    });

    // 7) Auditoría en product_catalog_emails (defensiva: si la tabla no existe
    // no rompemos el envío).
    try {
      await admin.from("product_catalog_emails").insert({
        company_id: session.company_id,
        kind: "product_datasheet",
        sent_by: session.user_id,
        recipient_email: email,
        recipient_name: input.recipientName ?? null,
        customer_id: input.customerId ?? null,
        lead_id: input.leadId ?? null,
        product_ids: [input.productId],
        public_share_token: share.share_token,
        resend_email_id: result.resend_id,
      });
    } catch {
      /* fail-soft */
    }

    if (!result.ok) {
      return { ok: false, error: result.error_message ?? "Resend devolvió error" };
    }

    revalidatePath(`/productos/${input.productId}`);
    return {
      ok: true,
      resend_id: result.resend_id,
      share_token: share.share_token,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
