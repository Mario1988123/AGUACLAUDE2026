/**
 * Página pública /datasheet/{token}
 *
 * URL hasheada sin login que muestra la ficha técnica de un producto + datos
 * de la empresa. Generada con createProductDatasheetShareAction. Caducidad
 * por defecto 60 días.
 *
 * Server component: resuelve el token con admin client, render HTML elegante
 * y botón "Descargar PDF" que apunta al endpoint existente.
 */

import { notFound } from "next/navigation";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { resolvePublicShareToken } from "@/modules/products/share-actions";

export const dynamic = "force-dynamic";

interface CompanyView {
  legal_name: string | null;
  trade_name: string | null;
  pdf_brand_color: string | null;
}

interface FiscalView {
  fiscal_legal_name: string | null;
  fiscal_logo_url: string | null;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
}

interface ProductView {
  id: string;
  name: string;
  short_description: string | null;
  long_description: string | null;
  marketing_claim: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  main_image_url: string | null;
  internal_reference: string | null;
  tags: string[] | null;
  warranty_months_general: number | null;
  warranty_months_electronics: number | null;
  warranty_months_body: number | null;
  category_name: string | null;
}

function isValidHex(s: string | null | undefined): s is string {
  return Boolean(s && /^#?[0-9a-f]{6}$/i.test(s));
}

export default async function PublicDatasheetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolvePublicShareToken(token);

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6 text-center">
        <h1 className="mb-2 text-2xl font-bold">Enlace no disponible</h1>
        <p className="text-sm text-gray-600">{resolved.error}</p>
        <p className="mt-4 text-xs text-gray-400">
          Si necesitas la ficha técnica, pide a la empresa que te envíe un enlace nuevo.
        </p>
      </main>
    );
  }

  const data = resolved.data;
  if (data.share_type !== "product_datasheet" || data.product_ids.length !== 1) {
    notFound();
  }

  const productId = data.product_ids[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Producto (defensivo con columnas nuevas)
  let prod: ProductView | null = null;
  {
    const cols =
      "id, name, short_description, long_description, marketing_claim, manufacturer_name, manufacturer_model, main_image_url, internal_reference, tags, warranty_months_general, warranty_months_electronics, warranty_months_body, category_id";
    const r1 = await admin.from("products").select(cols).eq("id", productId).maybeSingle();
    if (r1.error && /column .* does not exist|schema cache/i.test(r1.error.message ?? "")) {
      const r2 = await admin
        .from("products")
        .select(
          "id, name, short_description, long_description, main_image_url, internal_reference, category_id",
        )
        .eq("id", productId)
        .maybeSingle();
      prod = r2.data
        ? {
            ...(r2.data as Record<string, unknown>),
            marketing_claim: null,
            manufacturer_name: null,
            manufacturer_model: null,
            tags: null,
            warranty_months_general: null,
            warranty_months_electronics: null,
            warranty_months_body: null,
            category_name: null,
          } as unknown as ProductView
        : null;
    } else if (r1.data) {
      const raw = r1.data as ProductView & { category_id: string | null };
      prod = { ...raw, category_name: null };
    }
  }

  if (!prod) notFound();

  // Categoría
  const rawProd = prod as unknown as { category_id?: string | null };
  if (rawProd.category_id) {
    const { data: cat } = await admin
      .from("product_categories")
      .select("name")
      .eq("id", rawProd.category_id)
      .maybeSingle();
    prod.category_name = (cat as { name: string } | null)?.name ?? null;
  }

  // Empresa
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, pdf_brand_color")
    .eq("id", data.company_id)
    .maybeSingle();
  const co = (company ?? {}) as CompanyView;

  const { data: fiscal } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_logo_url, fiscal_email, fiscal_phone, fiscal_city, fiscal_province",
    )
    .eq("company_id", data.company_id)
    .maybeSingle();
  const fi = (fiscal ?? {}) as FiscalView;
  const companyName = fi.fiscal_legal_name || co.trade_name || co.legal_name || "Empresa";

  const brandColor = isValidHex(co.pdf_brand_color) ? co.pdf_brand_color : "#2563EB";

  // Atributos visibles
  const { data: rawAttrs } = await admin
    .from("product_attribute_values")
    .select(
      "is_visible, is_featured, value_text, value_number, value_boolean, data_type, display_order, product_attributes ( name, unit )",
    )
    .eq("product_id", productId)
    .eq("is_visible", true)
    .order("display_order");
  type AttrRow = {
    is_visible: boolean;
    is_featured: boolean;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    data_type: string;
    product_attributes: { name: string; unit: string | null } | null;
  };
  const attrs = ((rawAttrs ?? []) as AttrRow[])
    .map((r) => {
      const unit = r.product_attributes?.unit ?? null;
      return {
        name: r.product_attributes?.name ?? "",
        unit,
        value:
          r.data_type === "boolean"
            ? r.value_boolean
              ? "Sí"
              : "No"
            : r.data_type === "number" || r.data_type === "dimension"
              ? r.value_number != null
                ? `${new Intl.NumberFormat("es-ES").format(r.value_number)}${unit ? " " + unit : ""}`
                : null
              : r.value_text,
        featured: r.is_featured,
      };
    })
    .filter((a) => a.value != null && a.name);

  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const expiresText = expiresAt
    ? `Enlace válido hasta el ${expiresAt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}`
    : "Enlace sin caducidad";

  const warranties: Array<[string, number]> = [];
  if (prod.warranty_months_general)
    warranties.push(["General", prod.warranty_months_general]);
  if (prod.warranty_months_electronics)
    warranties.push(["Electrónica", prod.warranty_months_electronics]);
  if (prod.warranty_months_body) warranties.push(["Carcasa", prod.warranty_months_body]);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Cabecera */}
      <header
        className="px-6 py-8 text-white"
        style={{ backgroundColor: brandColor }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {data.show_company_branding && fi.fiscal_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fi.fiscal_logo_url}
                alt={companyName}
                className="h-12 w-auto rounded bg-white p-1"
              />
            ) : (
              <div className="text-lg font-bold">{companyName}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider opacity-80">
              Ficha técnica
            </div>
            {prod.internal_reference && (
              <div className="font-mono text-sm">Ref. {prod.internal_reference}</div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Producto */}
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <div className="overflow-hidden rounded-2xl border bg-white p-4 shadow-sm">
            {prod.main_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={prod.main_image_url}
                alt={prod.name}
                className="aspect-square w-full rounded-xl object-contain"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-400">
                Sin imagen
              </div>
            )}
          </div>
          <div>
            <h1 className="mb-1 text-3xl font-extrabold text-gray-900">
              {prod.name}
            </h1>
            {(prod.manufacturer_name || prod.manufacturer_model) && (
              <div className="mb-2 text-sm text-gray-500">
                {[prod.manufacturer_name, prod.manufacturer_model]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {prod.marketing_claim && (
              <p
                className="mb-3 text-lg font-semibold"
                style={{ color: brandColor }}
              >
                {prod.marketing_claim}
              </p>
            )}
            {(prod.short_description || prod.long_description) && (
              <p className="mb-4 text-gray-700">
                {prod.short_description || prod.long_description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {prod.category_name && (
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  {prod.category_name}
                </span>
              )}
              {prod.tags?.map((t) => (
                <span
                  key={t}
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor: `${brandColor}55`,
                    color: brandColor,
                    backgroundColor: `${brandColor}10`,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`/api/pdf/product-datasheet/${prod.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl px-5 py-3 text-sm font-semibold text-white shadow"
                style={{ backgroundColor: brandColor }}
              >
                Descargar PDF
              </a>
              <a
                href={`/api/pdf/product-datasheet/${prod.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                Ver impresión
              </a>
            </div>
          </div>
        </div>

        {/* Atributos */}
        {attrs.length > 0 && (
          <section className="mt-10 rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-500">
              Especificaciones técnicas
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              {attrs.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <dt className="text-xs uppercase tracking-wide text-gray-500">
                    {a.name}
                  </dt>
                  <dd className="text-sm font-semibold text-gray-900">
                    {a.value as string}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Garantías */}
        {warranties.length > 0 && (
          <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-500">
              Garantía
            </h2>
            <div className="flex flex-wrap gap-3">
              {warranties.map(([label, months]) => (
                <span
                  key={label}
                  className="rounded-full bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 ring-1 ring-green-200"
                >
                  {label}: {months} meses
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Pie */}
        <footer className="mt-12 border-t pt-6 text-center text-xs text-gray-500">
          {data.show_company_contact && (
            <p className="mb-1">
              {companyName}
              {fi.fiscal_city && ` · ${fi.fiscal_city}`}
              {fi.fiscal_phone && ` · ${fi.fiscal_phone}`}
              {fi.fiscal_email && ` · ${fi.fiscal_email}`}
            </p>
          )}
          <p>{expiresText}</p>
        </footer>
      </div>
    </main>
  );
}
