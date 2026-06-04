import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import {
  generateProductCatalogV2,
  type CatalogPricingVisibility,
} from "@/modules/products/catalog-pdf-v2";

export const dynamic = "force-dynamic";

/**
 * /api/pdf/catalog-v2/{token}
 *
 * Endpoint público (sin login) que sirve el PDF del catálogo según los datos
 * guardados en `product_public_shares`. Valida caducidad y revocación.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Token no válido" }, { status: 400 });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("product_public_shares")
      .select(
        "id, share_type, product_ids, pricing_visibility, show_company_branding, show_company_contact, custom_title, custom_intro, expires_at, revoked_at, company_id",
      )
      .eq("share_token", token)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 });
    }
    const row = data as {
      id: string;
      share_type: string;
      product_ids: string[] | null;
      pricing_visibility: CatalogPricingVisibility | null;
      show_company_branding: boolean;
      show_company_contact: boolean;
      custom_title: string | null;
      custom_intro: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      company_id: string;
    };
    if (row.revoked_at) {
      return NextResponse.json({ error: "Enlace revocado" }, { status: 410 });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Enlace caducado" }, { status: 410 });
    }
    if (row.share_type === "product_datasheet") {
      return NextResponse.json(
        { error: "Este enlace no es un catálogo." },
        { status: 400 },
      );
    }

    const bytes = await generateProductCatalogV2({
      companyId: row.company_id,
      productIds: row.product_ids ?? [],
      pricingVisibility: row.pricing_visibility ?? {},
      title: row.custom_title ?? undefined,
      intro: row.custom_intro ?? undefined,
      showCompanyBranding: row.show_company_branding,
      showCompanyContact: row.show_company_contact,
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="catalogo-${token}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando catálogo" },
      { status: 500 },
    );
  }
}
