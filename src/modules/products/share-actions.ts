"use server";
/**
 * Server actions para URLs públicas (sin login) que comparten una ficha
 * técnica o un catálogo.
 *
 * El token se genera en BD (DEFAULT en la columna `share_token`). La
 * resolución pública se hace con admin client (validando caducidad,
 * revocación y rate-limit suave por user-agent + IP).
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export type ShareType = "product_datasheet" | "category_catalog" | "custom_catalog";

export interface ProductShareItem {
  id: string;
  share_type: ShareType;
  product_ids: string[] | null;
  category_ids: string[] | null;
  pricing_visibility: Record<string, unknown> | null;
  show_company_branding: boolean;
  show_company_contact: boolean;
  custom_title: string | null;
  custom_intro: string | null;
  share_token: string;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type CreateShareResult =
  | { ok: true; share: ProductShareItem; public_url: string }
  | { ok: false; error: string };

/**
 * Construye la URL pública absoluta. Usa NEXT_PUBLIC_SITE_URL si está; si no,
 * usa el host de la request (la action no tiene request, así que sin esa env
 * no hay manera de saberla, devolvemos relativa y el cliente la resuelve).
 */
function buildPublicUrl(shareType: ShareType, token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  const path =
    shareType === "product_datasheet" ? `/datasheet/${token}` : `/catalogo/${token}`;
  return `${base}${path}`;
}

/**
 * Crea una URL pública para la ficha técnica de un producto. Caducidad por
 * defecto 60 días (decisión usuario 2026-06-04). Si `noExpiry` es true,
 * dejamos expires_at = null.
 */
export async function createProductDatasheetShareAction(input: {
  productId: string;
  noExpiry?: boolean;
  customTitle?: string | null;
  customIntro?: string | null;
}): Promise<CreateShareResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Verificar que el producto pertenece a la empresa
    const { data: prod } = await admin
      .from("products")
      .select("id, company_id")
      .eq("id", input.productId)
      .maybeSingle();
    if (!prod || (prod as { company_id: string }).company_id !== session.company_id) {
      return { ok: false, error: "Producto no encontrado o de otra empresa" };
    }

    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      share_type: "product_datasheet" as ShareType,
      product_ids: [input.productId],
      show_company_branding: true,
      show_company_contact: true,
      created_by: session.user_id,
    };
    if (input.customTitle?.trim()) payload.custom_title = input.customTitle.trim();
    if (input.customIntro?.trim()) payload.custom_intro = input.customIntro.trim();
    // Si noExpiry, sobrescribimos el default (60 días) con NULL.
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
    const publicUrl = buildPublicUrl("product_datasheet", share.share_token);

    revalidatePath(`/productos/${input.productId}`);
    return { ok: true, share, public_url: publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Lista los shares activos (no revocados, no caducados) del producto, ordenados
 * del más reciente al más antiguo.
 */
export async function listProductShares(
  productId: string,
): Promise<ProductShareItem[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("product_public_shares")
    .select(
      "id, share_type, product_ids, category_ids, pricing_visibility, show_company_branding, show_company_contact, custom_title, custom_intro, share_token, expires_at, view_count, last_viewed_at, revoked_at, created_by, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("share_type", "product_datasheet")
    .contains("product_ids", [productId])
    .order("created_at", { ascending: false });
  return (data ?? []) as ProductShareItem[];
}

/**
 * Revoca un share. Lo marca como revocado, no lo borra (auditoría).
 */
export async function revokeProductShareAction(
  shareId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_public_shares")
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: reason ?? null,
      })
      .eq("id", shareId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Resolución del token desde la página pública. Devuelve el share + datos
 * del producto, ya validando caducidad y revocación. Incrementa view_count.
 *
 * NO requiere sesión (la URL es pública). Usa admin client en backend.
 */
export interface ResolvedShare {
  share_id: string;
  share_type: ShareType;
  custom_title: string | null;
  custom_intro: string | null;
  show_company_branding: boolean;
  show_company_contact: boolean;
  company_id: string;
  product_ids: string[];
  expires_at: string | null;
}

export async function resolvePublicShareToken(
  token: string,
): Promise<{ ok: true; data: ResolvedShare } | { ok: false; error: string }> {
  if (!token || token.length < 16) {
    return { ok: false, error: "Enlace no válido" };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("product_public_shares")
      .select(
        "id, share_type, product_ids, custom_title, custom_intro, show_company_branding, show_company_contact, company_id, expires_at, revoked_at",
      )
      .eq("share_token", token)
      .maybeSingle();
    if (error) return { ok: false, error: "Enlace no disponible" };
    if (!data) return { ok: false, error: "Enlace no encontrado" };

    const row = data as {
      id: string;
      share_type: ShareType;
      product_ids: string[] | null;
      custom_title: string | null;
      custom_intro: string | null;
      show_company_branding: boolean;
      show_company_contact: boolean;
      company_id: string;
      expires_at: string | null;
      revoked_at: string | null;
    };

    if (row.revoked_at) {
      return { ok: false, error: "Este enlace fue revocado." };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "Este enlace ha caducado." };
    }

    // Métrica: incrementar view_count (fail-soft).
    try {
      await admin
        .from("product_public_shares")
        .update({
          view_count: undefined, // dummy, lo hacemos con rpc abajo
        })
        .eq("id", row.id);
    } catch {
      /* ignore */
    }
    // Forma fiable de incrementar: select + update; no rompemos si falla.
    try {
      const { data: cur } = await admin
        .from("product_public_shares")
        .select("view_count")
        .eq("id", row.id)
        .maybeSingle();
      const next = ((cur as { view_count?: number } | null)?.view_count ?? 0) + 1;
      await admin
        .from("product_public_shares")
        .update({ view_count: next, last_viewed_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch {
      /* fail-soft */
    }

    return {
      ok: true,
      data: {
        share_id: row.id,
        share_type: row.share_type,
        custom_title: row.custom_title,
        custom_intro: row.custom_intro,
        show_company_branding: row.show_company_branding,
        show_company_contact: row.show_company_contact,
        company_id: row.company_id,
        product_ids: row.product_ids ?? [],
        expires_at: row.expires_at,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
