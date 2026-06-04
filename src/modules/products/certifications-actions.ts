"use server";
/**
 * Certificaciones del producto (product_certifications).
 *
 * Catálogo global en certifications_catalog (seed sector agua). El producto
 * puede asociar varias certificaciones con nº de certificado, fechas y URL
 * al documento escaneado.
 *
 * Reglas:
 *   - Lectura: cualquier rol.
 *   - Escritura: solo admin.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export interface CertificationCatalogItem {
  key: string;
  name_es: string;
  category: string;
  description_es: string | null;
  logo_url: string | null;
  sort_order: number;
}

export interface ProductCertificationItem {
  id: string;
  certification_key: string;
  name_es: string;
  category: string;
  certificate_number: string | null;
  issued_at: string | null;
  valid_until: string | null;
  issuer_name: string | null;
  document_url: string | null;
  notes: string | null;
  display_order: number;
}

export async function listCertificationsCatalog(): Promise<CertificationCatalogItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("certifications_catalog")
    .select("key, name_es, category, description_es, logo_url, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as CertificationCatalogItem[];
}

export async function listProductCertifications(
  productId: string,
): Promise<ProductCertificationItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_certifications")
    .select(
      "id, certification_key, certificate_number, issued_at, valid_until, issuer_name, document_url, notes, display_order, certifications_catalog ( name_es, category )",
    )
    .eq("product_id", productId)
    .order("display_order");
  type Row = {
    id: string;
    certification_key: string;
    certificate_number: string | null;
    issued_at: string | null;
    valid_until: string | null;
    issuer_name: string | null;
    document_url: string | null;
    notes: string | null;
    display_order: number;
    certifications_catalog: { name_es: string; category: string } | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    certification_key: r.certification_key,
    name_es: r.certifications_catalog?.name_es ?? r.certification_key,
    category: r.certifications_catalog?.category ?? "other",
    certificate_number: r.certificate_number,
    issued_at: r.issued_at,
    valid_until: r.valid_until,
    issuer_name: r.issuer_name,
    document_url: r.document_url,
    notes: r.notes,
    display_order: r.display_order,
  }));
}

export async function addProductCertificationAction(input: {
  productId: string;
  certificationKey: string;
  certificateNumber?: string | null;
  issuedAt?: string | null;
  validUntil?: string | null;
  issuerName?: string | null;
  documentUrl?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("product_certifications")
      .insert({
        company_id: session.company_id,
        product_id: input.productId,
        certification_key: input.certificationKey,
        certificate_number: input.certificateNumber ?? null,
        issued_at: input.issuedAt ?? null,
        valid_until: input.validUntil ?? null,
        issuer_name: input.issuerName ?? null,
        document_url: input.documentUrl ?? null,
        notes: input.notes ?? null,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          ok: false,
          error: "Esa certificación ya está añadida al producto.",
        };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath(`/productos/${input.productId}`);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function removeProductCertificationAction(
  certId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_certifications")
      .delete()
      .eq("id", certId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
