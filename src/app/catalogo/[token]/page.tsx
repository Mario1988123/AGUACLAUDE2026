/**
 * Página pública /catalogo/{token}
 *
 * URL hasheada sin login que muestra un catálogo de productos con la
 * configuración guardada en `product_public_shares` (qué precios mostrar,
 * branding, mensaje de portada, etc.). Caducidad 60 días por defecto.
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { resolvePublicShareToken } from "@/modules/products/share-actions";
import type { CatalogPricingVisibility } from "@/modules/products/catalog-pdf-v2";

export const dynamic = "force-dynamic";

interface ProductCard {
  id: string;
  name: string;
  short_description: string | null;
  marketing_claim: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  main_image_url: string | null;
  internal_reference: string | null;
  category_name: string | null;
  tags: string[] | null;
  priceLines: Array<{ label: string; value: string }>;
}

interface PricingPlanRow {
  product_id: string;
  plan_type: "cash" | "renting" | "rental";
  duration_months: number | null;
  total_price_cents: number;
  monthly_price_cents: number | null;
  total_price_individual_cents: number | null;
  total_price_business_cents: number | null;
  monthly_price_individual_cents: number | null;
}

function isValidHex(s: string | null | undefined): s is string {
  return Boolean(s && /^#?[0-9a-f]{6}$/i.test(s));
}

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

function buildPriceLines(
  plans: PricingPlanRow[],
  vis: CatalogPricingVisibility,
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const cash = plans.find((p) => p.plan_type === "cash");
  if (cash) {
    if (vis.cash_individual) {
      const v = cash.total_price_individual_cents ?? cash.total_price_cents;
      out.push({ label: "Particular (IVA inc.)", value: eur(v) });
    }
    if (vis.cash_business) {
      const v = cash.total_price_business_cents ?? cash.total_price_cents;
      out.push({ label: "Empresa (base)", value: eur(v) });
    }
  }
  const checks: Array<[number, keyof CatalogPricingVisibility]> = [
    [24, "renting_24"],
    [36, "renting_36"],
    [48, "renting_48"],
    [60, "renting_60"],
  ];
  for (const [months, flag] of checks) {
    if (!vis[flag]) continue;
    const plan = plans.find((p) => p.plan_type === "renting" && p.duration_months === months);
    if (!plan) continue;
    const monthly =
      plan.monthly_price_individual_cents ??
      plan.monthly_price_cents ??
      (plan.total_price_cents && plan.duration_months
        ? Math.round(plan.total_price_cents / plan.duration_months)
        : null);
    out.push({ label: `Renting ${months}m`, value: `${eur(monthly)}/mes` });
  }
  if (vis.rental) {
    const rental = plans.find((p) => p.plan_type === "rental");
    if (rental) {
      const monthly =
        rental.monthly_price_individual_cents ??
        rental.monthly_price_cents ??
        rental.total_price_cents;
      out.push({ label: "Alquiler", value: `${eur(monthly)}/mes` });
    }
  }
  return out;
}

export default async function PublicCatalogPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolvePublicShareToken(token);

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6 text-center">
        <h1 className="mb-2 text-2xl font-bold">Catálogo no disponible</h1>
        <p className="text-sm text-gray-600">{resolved.error}</p>
        <p className="mt-4 text-xs text-gray-400">
          Si necesitas el catálogo, pide a la empresa que te envíe un enlace nuevo.
        </p>
      </main>
    );
  }

  const data = resolved.data;
  if (
    data.share_type === "product_datasheet" ||
    !data.product_ids ||
    data.product_ids.length === 0
  ) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6 text-center">
        <h1 className="mb-2 text-2xl font-bold">Catálogo vacío</h1>
        <p className="text-sm text-gray-600">
          Este enlace no apunta a un catálogo con productos.
        </p>
      </main>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Empresa
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, pdf_brand_color")
    .eq("id", data.company_id)
    .maybeSingle();
  const co = (company ?? {}) as {
    legal_name: string | null;
    trade_name: string | null;
    pdf_brand_color: string | null;
  };

  const { data: fiscal } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_logo_url, fiscal_email, fiscal_phone, fiscal_city",
    )
    .eq("company_id", data.company_id)
    .maybeSingle();
  const fi = (fiscal ?? {}) as {
    fiscal_legal_name: string | null;
    fiscal_logo_url: string | null;
    fiscal_email: string | null;
    fiscal_phone: string | null;
    fiscal_city: string | null;
  };
  const companyName = fi.fiscal_legal_name || co.trade_name || co.legal_name || "Empresa";
  const brandColor = isValidHex(co.pdf_brand_color) ? co.pdf_brand_color : "#2563EB";

  // pricing_visibility del share
  // resolvePublicShareToken devuelve un subset; vuelvo a leer pricing_visibility.
  const { data: shareFull } = await admin
    .from("product_public_shares")
    .select("pricing_visibility")
    .eq("id", data.share_id)
    .maybeSingle();
  const pricingVisibility = ((shareFull as { pricing_visibility: CatalogPricingVisibility | null } | null)
    ?.pricing_visibility ?? {}) as CatalogPricingVisibility;

  // Productos
  const colsFull =
    "id, name, short_description, marketing_claim, manufacturer_name, manufacturer_model, main_image_url, internal_reference, tags, category_id";
  const colsBasic =
    "id, name, short_description, main_image_url, internal_reference, category_id";
  let rawProducts: Array<Record<string, unknown>> = [];
  const r1 = await admin
    .from("products")
    .select(colsFull)
    .in("id", data.product_ids)
    .is("deleted_at", null);
  if (r1.error && /column .* does not exist|schema cache/i.test(r1.error.message ?? "")) {
    const r2 = await admin
      .from("products")
      .select(colsBasic)
      .in("id", data.product_ids)
      .is("deleted_at", null);
    rawProducts = (r2.data ?? []) as Array<Record<string, unknown>>;
  } else {
    rawProducts = (r1.data ?? []) as Array<Record<string, unknown>>;
  }

  // Categorías
  const catIds = Array.from(
    new Set(
      rawProducts
        .map((p) => p.category_id as string | null)
        .filter((v): v is string => !!v),
    ),
  );
  let catMap = new Map<string, string>();
  if (catIds.length > 0) {
    const { data: cats } = await admin
      .from("product_categories")
      .select("id, name")
      .in("id", catIds);
    catMap = new Map(
      ((cats ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );
  }

  // Planes de precio
  const { data: rawPlans } = await admin
    .from("product_pricing_plans")
    .select(
      "product_id, plan_type, duration_months, total_price_cents, monthly_price_cents, total_price_individual_cents, total_price_business_cents, monthly_price_individual_cents, is_active",
    )
    .in(
      "product_id",
      rawProducts.map((p) => p.id as string),
    )
    .eq("is_active", true);
  const plans = (rawPlans ?? []) as PricingPlanRow[];

  // Reordenar y armar cards
  const orderMap = new Map(data.product_ids.map((id, i) => [id, i]));
  const cards: ProductCard[] = rawProducts
    .map((p) => {
      const id = p.id as string;
      const productPlans = plans.filter((pl) => pl.product_id === id);
      return {
        id,
        name: p.name as string,
        short_description: (p.short_description as string | null) ?? null,
        marketing_claim: (p.marketing_claim as string | null) ?? null,
        manufacturer_name: (p.manufacturer_name as string | null) ?? null,
        manufacturer_model: (p.manufacturer_model as string | null) ?? null,
        main_image_url: (p.main_image_url as string | null) ?? null,
        internal_reference: (p.internal_reference as string | null) ?? null,
        category_name: p.category_id ? catMap.get(p.category_id as string) ?? null : null,
        tags: (p.tags as string[] | null) ?? null,
        priceLines: buildPriceLines(productPlans, pricingVisibility),
      };
    })
    .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const expiresText = expiresAt
    ? `Catálogo válido hasta el ${expiresAt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}`
    : "Sin caducidad";

  const showBranding = data.show_company_branding;
  const showContact = data.show_company_contact;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Cabecera */}
      <header className="px-6 py-8 text-white" style={{ backgroundColor: brandColor }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          {showBranding && fi.fiscal_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fi.fiscal_logo_url}
              alt={companyName}
              className="h-12 w-auto rounded bg-white p-1"
            />
          ) : (
            <div className="text-lg font-bold">{companyName}</div>
          )}
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider opacity-80">Catálogo</div>
            <div className="text-sm">{cards.length} {cards.length === 1 ? "producto" : "productos"}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Portada */}
        <div className="mb-8 text-center">
          <h1
            className="mb-2 text-4xl font-extrabold"
            style={{ color: brandColor }}
          >
            {data.custom_title ?? "Catálogo de productos"}
          </h1>
          {data.custom_intro && (
            <p className="mx-auto max-w-2xl text-gray-700">{data.custom_intro}</p>
          )}
          <div className="mt-3">
            <a
              href={`/api/pdf/catalog-v2/${token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl px-5 py-3 text-sm font-semibold text-white shadow"
              style={{ backgroundColor: brandColor }}
            >
              Descargar PDF
            </a>
          </div>
        </div>

        {/* Grid de productos */}
        <div className="grid gap-6 sm:grid-cols-2">
          {cards.map((p) => (
            <article
              key={p.id}
              className="overflow-hidden rounded-2xl border bg-white shadow-sm"
            >
              <div className="aspect-square w-full bg-gray-50">
                {p.main_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.main_image_url}
                    alt={p.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                    Sin imagen
                  </div>
                )}
              </div>
              <div className="space-y-2 p-5">
                {p.category_name && (
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    {p.category_name}
                  </span>
                )}
                <h2 className="text-lg font-bold text-gray-900">{p.name}</h2>
                {(p.manufacturer_name || p.manufacturer_model) && (
                  <div className="text-xs text-gray-500">
                    {[p.manufacturer_name, p.manufacturer_model]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {p.marketing_claim && (
                  <p
                    className="text-sm font-semibold"
                    style={{ color: brandColor }}
                  >
                    {p.marketing_claim}
                  </p>
                )}
                {p.short_description && (
                  <p className="text-sm text-gray-700">{p.short_description}</p>
                )}
                {p.tags && p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.tags.slice(0, 6).map((t) => (
                      <span
                        key={t}
                        className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
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
                )}
                {p.priceLines.length > 0 && (
                  <div className="mt-2 space-y-1 border-t pt-3">
                    {p.priceLines.map((pl, i) => (
                      <div
                        key={i}
                        className="flex items-baseline justify-between text-sm"
                      >
                        <span className="text-gray-500">{pl.label}</span>
                        <span
                          className="font-bold"
                          style={{ color: brandColor }}
                        >
                          {pl.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        {/* Pie */}
        <footer className="mt-12 border-t pt-6 text-center text-xs text-gray-500">
          {showContact && (
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
