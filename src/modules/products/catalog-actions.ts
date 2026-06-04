"use server";
/**
 * Server actions del catálogo de productos (Fase 4):
 *   - createCatalogShareAction → genera URL pública del catálogo con
 *     configuración de precios y caducidad (60 días por defecto).
 *   - sendCatalogEmailAction → envía un email con la URL pública del
 *     catálogo (decisión usuario: catálogo entero NO se adjunta como PDF,
 *     solo URL en el cuerpo del email).
 *
 * El PDF se genera bajo demanda en /api/pdf/catalog-v2 (server-side, no
 * adjunto al email).
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";
import { sendEmailViaResend } from "@/modules/mailing/resend";
import type {
  CatalogPricingVisibility,
} from "./catalog-pdf-v2";
import type { ProductShareItem } from "./share-actions";

function buildCatalogUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/catalogo/${token}`;
}

function renderTemplate(text: string, vars: Record<string, string | null>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => {
    const v = vars[k];
    return v == null ? "" : v;
  });
}

// =============================================================================
// 1) Crear share del catálogo
// =============================================================================

export type CreateCatalogShareResult =
  | { ok: true; share: ProductShareItem; public_url: string }
  | { ok: false; error: string };

export async function createCatalogShareAction(input: {
  productIds: string[];
  categoryIds?: string[];
  pricingVisibility: CatalogPricingVisibility;
  customTitle?: string;
  customIntro?: string;
  showBranding?: boolean;
  showContact?: boolean;
  noExpiry?: boolean;
}): Promise<CreateCatalogShareResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    if (input.productIds.length === 0) {
      return { ok: false, error: "Selecciona al menos un producto." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Validar que TODOS los productos pertenecen a la empresa
    const { data: prods } = await admin
      .from("products")
      .select("id, company_id")
      .in("id", input.productIds);
    const valid = ((prods ?? []) as Array<{ id: string; company_id: string }>).filter(
      (p) => p.company_id === session.company_id,
    );
    if (valid.length !== input.productIds.length) {
      return {
        ok: false,
        error: "Hay productos que no pertenecen a tu empresa.",
      };
    }

    const shareType =
      input.categoryIds && input.categoryIds.length > 0
        ? "category_catalog"
        : "custom_catalog";

    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      share_type: shareType,
      product_ids: input.productIds,
      category_ids: input.categoryIds && input.categoryIds.length > 0 ? input.categoryIds : null,
      pricing_visibility: input.pricingVisibility,
      show_company_branding: input.showBranding !== false,
      show_company_contact: input.showContact !== false,
      created_by: session.user_id,
    };
    if (input.customTitle?.trim()) payload.custom_title = input.customTitle.trim();
    if (input.customIntro?.trim()) payload.custom_intro = input.customIntro.trim();
    if (input.noExpiry) payload.expires_at = null;

    const { data, error } = await admin
      .from("product_public_shares")
      .insert(payload)
      .select(
        "id, share_type, product_ids, category_ids, pricing_visibility, show_company_branding, show_company_contact, custom_title, custom_intro, share_token, expires_at, view_count, last_viewed_at, revoked_at, created_by, created_at",
      )
      .single();
    if (error) return { ok: false, error: error.message };

    const share = data as ProductShareItem;
    const publicUrl = buildCatalogUrl(share.share_token);

    revalidatePath("/productos");
    return { ok: true, share, public_url: publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// 2) Enviar catálogo por email (solo URL en el cuerpo, sin PDF adjunto)
// =============================================================================

export type SendCatalogEmailResult =
  | { ok: true; resend_id: string | null; share_token: string }
  | { ok: false; error: string };

export async function sendCatalogEmailAction(input: {
  recipientEmail: string;
  recipientName?: string;
  customerId?: string | null;
  leadId?: string | null;
  customMessage?: string;
  reuseShareId?: string | null;
  catalogConfig?: {
    productIds: string[];
    pricingVisibility: CatalogPricingVisibility;
    customTitle?: string;
    customIntro?: string;
    showBranding?: boolean;
    showContact?: boolean;
  };
}): Promise<SendCatalogEmailResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const email = input.recipientEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Email del destinatario no válido" };
    }

    // 1) Obtener / crear share
    let share: ProductShareItem | null = null;
    let publicUrl = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    if (input.reuseShareId) {
      const { data } = await admin
        .from("product_public_shares")
        .select(
          "id, share_type, product_ids, category_ids, pricing_visibility, show_company_branding, show_company_contact, custom_title, custom_intro, share_token, expires_at, view_count, last_viewed_at, revoked_at, created_by, created_at",
        )
        .eq("id", input.reuseShareId)
        .eq("company_id", session.company_id)
        .maybeSingle();
      if (data && !(data as { revoked_at: string | null }).revoked_at) {
        share = data as ProductShareItem;
        publicUrl = buildCatalogUrl(share.share_token);
      }
    }
    if (!share) {
      if (!input.catalogConfig) {
        return {
          ok: false,
          error: "Falta configuración del catálogo (productos y precios).",
        };
      }
      const created = await createCatalogShareAction({
        productIds: input.catalogConfig.productIds,
        pricingVisibility: input.catalogConfig.pricingVisibility,
        customTitle: input.catalogConfig.customTitle,
        customIntro: input.catalogConfig.customIntro,
        showBranding: input.catalogConfig.showBranding,
        showContact: input.catalogConfig.showContact,
      });
      if (!created.ok) return { ok: false, error: created.error };
      share = created.share;
      publicUrl = created.public_url;
    }

    // 2) Cargar plantilla
    let tpl: { subject: string; body_html: string; body_text: string | null } | null = null;
    {
      const { data: custom } = await admin
        .from("email_templates")
        .select("subject, body_html, body_text, is_active")
        .eq("company_id", session.company_id)
        .eq("key", "product_catalog_share")
        .maybeSingle();
      if (custom && (custom as { is_active: boolean }).is_active) {
        tpl = custom as { subject: string; body_html: string; body_text: string | null };
      }
      if (!tpl) {
        const { data: sys } = await admin
          .from("email_templates")
          .select("subject, body_html, body_text, is_active")
          .is("company_id", null)
          .eq("key", "product_catalog_share")
          .maybeSingle();
        if (sys && (sys as { is_active: boolean }).is_active) {
          tpl = sys as { subject: string; body_html: string; body_text: string | null };
        }
      }
    }
    if (!tpl) return { ok: false, error: "Plantilla 'product_catalog_share' no encontrada." };

    // 3) Variables
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
      (company as { trade_name: string | null; legal_name: string | null } | null)?.trade_name ??
      (company as { legal_name: string | null } | null)?.legal_name ??
      "Empresa";

    const catalogName = share.custom_title ?? "Nuestro catálogo";

    const vars: Record<string, string | null> = {
      customer_name: input.recipientName ?? "",
      catalog_name: catalogName,
      share_url: publicUrl,
      user_name: session.full_name ?? "",
      company_name: companyName,
    };
    const subject = renderTemplate(tpl.subject, vars);
    const bodyHtml = input.customMessage
      ? renderTemplate(input.customMessage, vars)
      : renderTemplate(tpl.body_html, vars);
    const bodyText = tpl.body_text ? renderTemplate(tpl.body_text, vars) : undefined;

    // 4) Sender (mismo helper usado para datasheet)
    const { data: userSettings } = await admin
      .from("email_user_settings")
      .select("from_email, from_name")
      .eq("user_id", session.user_id)
      .maybeSingle();
    let fromEmail =
      (userSettings as { from_email: string | null } | null)?.from_email ?? null;
    let fromName =
      (userSettings as { from_name: string | null } | null)?.from_name ?? null;
    if (!fromEmail) {
      const { data: cs } = await admin
        .from("company_settings")
        .select("fiscal_email, fiscal_legal_name")
        .eq("company_id", session.company_id)
        .maybeSingle();
      fromEmail =
        (cs as { fiscal_email: string | null } | null)?.fiscal_email ??
        process.env.RESEND_DEFAULT_FROM ??
        "noreply@example.com";
      fromName =
        (cs as { fiscal_legal_name: string | null } | null)?.fiscal_legal_name ?? null;
    }

    // 5) Enviar (SIN PDF adjunto — decisión usuario 2026-06-04)
    const result = await sendEmailViaResend({
      from_email: fromEmail!,
      from_name: fromName ?? session.full_name ?? "",
      reply_to: fromEmail!,
      to_email: email,
      to_name: input.recipientName,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      metadata: {
        share_id: share.id,
        kind: "catalog",
      },
    });

    // 6) Auditoría
    try {
      await admin.from("product_catalog_emails").insert({
        company_id: session.company_id,
        kind: "catalog",
        sent_by: session.user_id,
        recipient_email: email,
        recipient_name: input.recipientName ?? null,
        customer_id: input.customerId ?? null,
        lead_id: input.leadId ?? null,
        product_ids: share.product_ids ?? [],
        category_ids: share.category_ids ?? null,
        pricing_visibility: share.pricing_visibility ?? null,
        public_share_token: share.share_token,
        custom_title: share.custom_title ?? null,
        resend_email_id: result.resend_id,
      });
    } catch {
      /* fail-soft */
    }

    if (!result.ok) {
      return { ok: false, error: result.error_message ?? "Resend devolvió error" };
    }

    revalidatePath("/productos");
    return {
      ok: true,
      resend_id: result.resend_id,
      share_token: share.share_token,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
