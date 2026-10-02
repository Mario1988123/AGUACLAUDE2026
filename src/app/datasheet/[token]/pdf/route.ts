import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { generateProductDatasheetAuto } from "@/modules/products/datasheet-pick";

export const dynamic = "force-dynamic";

/**
 * /datasheet/{token}/pdf — PDF PÚBLICO de la ficha técnica compartida.
 *
 * Auditoría 2026-10-01 (I19): la página pública /datasheet/{token} enlazaba a
 * /api/pdf/product-datasheet/{id}, que exige sesión del CRM (y debe seguir
 * exigiéndola: con el id de producto no hay credencial). El cliente que
 * recibía la ficha por correo acababa en el login.
 *
 * Aquí la credencial es el token de `product_public_shares`, con las mismas
 * comprobaciones que /api/pdf/catalog-v2/{token}: existe, no revocado, no
 * caducado, es una ficha (no un catálogo) de UN producto, y el producto
 * pertenece a la empresa que compartió el enlace.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Enlace no válido" }, { status: 400 });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("product_public_shares")
      .select("share_type, product_ids, expires_at, revoked_at, company_id")
      .eq("share_token", token)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ error: "Enlace no encontrado" }, { status: 404 });
    }
    const row = data as {
      share_type: string;
      product_ids: string[] | null;
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
    const ids = row.product_ids ?? [];
    if (row.share_type !== "product_datasheet" || ids.length !== 1) {
      return NextResponse.json({ error: "Este enlace no es una ficha técnica." }, { status: 400 });
    }
    const productId = ids[0]!;

    // El generador lee el producto con admin client sin filtrar empresa:
    // comprobamos aquí que es de la empresa que compartió el enlace.
    const { data: owned } = await admin
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("company_id", row.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!owned) {
      return NextResponse.json({ error: "Producto no disponible" }, { status: 404 });
    }

    const bytes = await generateProductDatasheetAuto(productId);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ficha-tecnica.pdf"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    // Sin el texto interno: es una ruta pública.
    console.error("[datasheet/pdf] error generando la ficha:", err);
    return NextResponse.json({ error: "No se ha podido generar la ficha técnica" }, { status: 500 });
  }
}
