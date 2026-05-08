/**
 * Scrapers de precio de agua embotellada en supermercados.
 *
 * Estrategia (decisión usuario 2026-05-08):
 *  - Mercadona: API no-oficial de su tienda online (estable últimos años).
 *  - Carrefour: scraping HTML del buscador (más frágil — uso fetch + regex).
 *
 * Ambos extraen el primer resultado que coincida con el término y devuelven
 * precio €/L. Si falla → null (el caller incrementa consecutive_failures).
 */

interface ScrapeResult {
  ok: boolean;
  price_per_liter_cents: number | null;
  raw: unknown;
  error?: string;
}

/**
 * Mercadona — API no-oficial.
 * Endpoint search por código postal de Madrid (28001) por defecto.
 */
export async function scrapeMercadona(query: string): Promise<ScrapeResult> {
  try {
    const url = `https://7uzjkl1dj0-dsn.algolia.net/1/indexes/products_prod_4315_es/query`;
    const body = {
      params: `query=${encodeURIComponent(query)}&clickAnalytics=true&analyticsTags=%5B%22web%22%5D&getRankingInfo=true`,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Estos appId/apiKey son públicos (Mercadona los expone en su web).
        "X-Algolia-Application-Id": "7UZJKL1DJ0",
        "X-Algolia-API-Key": "9d8f2e39e90df472b4f2e559a116fe17",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, price_per_liter_cents: null, raw: null, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      hits?: Array<{
        display_name?: string;
        thumbnail?: string;
        packaging?: string;
        price_instructions?: {
          unit_price?: number; // €/L o €/Kg
          unit_size?: number;
          size_format?: string;
        };
      }>;
    };
    const hit = json.hits?.find(
      (h) =>
        h.display_name &&
        /agua|water/i.test(h.display_name) &&
        h.price_instructions?.unit_price != null,
    );
    if (!hit?.price_instructions?.unit_price) {
      return { ok: false, price_per_liter_cents: null, raw: json, error: "No matching product" };
    }
    return {
      ok: true,
      price_per_liter_cents: Math.round(hit.price_instructions.unit_price * 100),
      raw: hit,
    };
  } catch (e) {
    return {
      ok: false,
      price_per_liter_cents: null,
      raw: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Carrefour — scraping HTML del search.
 * Endpoint público devuelve JSON con productos.
 */
export async function scrapeCarrefour(query: string): Promise<ScrapeResult> {
  try {
    const url = `https://www.carrefour.es/search-api/query/v1/search?query=${encodeURIComponent(query)}&offset=0&limit=10&priceMin=0&priceMax=0&scope=desktop`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      return { ok: false, price_per_liter_cents: null, raw: null, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      results?: Array<{
        title?: string;
        unitPrice?: number; // €/L
        unitMeasure?: string;
        price?: number;
        size?: string;
      }>;
    };
    const hit = json.results?.find(
      (h) => h.unitPrice && /agua|water|botella|garrafa/i.test(h.title ?? ""),
    );
    if (!hit?.unitPrice) {
      return { ok: false, price_per_liter_cents: null, raw: json, error: "No matching product" };
    }
    return {
      ok: true,
      price_per_liter_cents: Math.round(hit.unitPrice * 100),
      raw: hit,
    };
  } catch (e) {
    return {
      ok: false,
      price_per_liter_cents: null,
      raw: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Refresca todas las marcas con scraper configurado en la empresa.
 * Llamado por el cron mensual. Actualiza last_scraped_at, consecutive_failures
 * y log en savings_price_scrape_log.
 */
export async function refreshAllScraperPrices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId?: string,
): Promise<{ ok: number; failed: number; total: number }> {
  let q = admin
    .from("savings_water_brands")
    .select("id, company_id, name, price_source, scrape_query, consecutive_failures")
    .eq("kind", "supermarket")
    .eq("is_active", true)
    .neq("price_source", "manual");
  if (companyId) q = q.eq("company_id", companyId);
  const { data: brands } = await q;
  const list = (brands as Array<{
    id: string;
    company_id: string;
    name: string;
    price_source: string;
    scrape_query: string | null;
    consecutive_failures: number;
  }> | null) ?? [];

  let ok = 0;
  let failed = 0;

  for (const b of list) {
    const query = b.scrape_query || b.name;
    const r =
      b.price_source === "scraper_mercadona"
        ? await scrapeMercadona(query)
        : b.price_source === "scraper_carrefour"
          ? await scrapeCarrefour(query)
          : { ok: false, price_per_liter_cents: null, raw: null, error: "unknown source" };

    // Log
    await admin.from("savings_price_scrape_log").insert({
      company_id: b.company_id,
      brand_id: b.id,
      source: b.price_source.replace("scraper_", ""),
      query,
      found_price_cents: r.price_per_liter_cents,
      ok: r.ok,
      error_message: r.error ?? null,
      raw_response: r.raw ?? null,
    });

    if (r.ok && r.price_per_liter_cents != null) {
      await admin
        .from("savings_water_brands")
        .update({
          price_per_liter_cents: r.price_per_liter_cents,
          last_scraped_at: new Date().toISOString(),
          consecutive_failures: 0,
        })
        .eq("id", b.id);
      ok++;
    } else {
      await admin
        .from("savings_water_brands")
        .update({
          last_scrape_failed_at: new Date().toISOString(),
          consecutive_failures: (b.consecutive_failures ?? 0) + 1,
        })
        .eq("id", b.id);
      failed++;
    }
  }

  return { ok, failed, total: list.length };
}
