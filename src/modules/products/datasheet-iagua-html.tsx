/**
 * Ficha técnica "IAGUA" generada con HTML→PDF (satori → sharp → pdf-lib).
 *
 * A diferencia de datasheet-iagua.ts (pdf-lib, formas planas), este motor monta
 * la ficha como una "web" (degradados, esquinas redondeadas, iconos SVG, ✓
 * verdes, tipografía Poppins, fotos reales) y la rasteriza a una imagen nítida
 * que se incrusta en el PDF. Es lo que permite que quede IDÉNTICA al diseño
 * original de infinityaqua.
 *
 * Pipeline 100% serverless (Vercel-safe): satori convierte el árbol a SVG con el
 * texto ya vectorizado (no depende de fuentes del sistema), sharp lo pasa a PNG
 * y pdf-lib lo coloca a página completa A4.
 *
 * MAQUETACIÓN DINÁMICA POR BLOQUES (2026-06-24):
 * El contenido NO está clavado en posiciones fijas ni asume "página 1 / página
 * 2". Se descompone en una lista de bloques (título, hero, cada fila de
 * características, cada fila de la ficha técnica, sello, etc.), se MIDE el alto
 * real de cada bloque con satori (ancho fijo, alto automático) y se reparten uno
 * tras otro: cuando un bloque no cabe en la hoja actual, salta ENTERO a una hoja
 * nueva. Así el número de páginas y dónde empieza cada una salen solos según el
 * tamaño y la cantidad de atributos; nunca se recorta ni se parte un bloque por
 * la mitad. Las cabeceras de sección no se quedan huérfanas al pie de página.
 */

import satori from "satori";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/shared/lib/supabase/admin";

// ===========================================================================
// Escala y página (A4)
// ===========================================================================
const S = 2; // px = pt × 2  → A4 595×842pt = 1190×1684px (~144dpi, nítido)
const PAGE_W = 595 * S;
const PAGE_H = 842 * S;
const s = (n: number) => n * S;

const DEFAULT_NAVY = "#16344E";
const DEFAULT_ACCENT = "#3DA5DD";
const GREEN = "#33B98C";
const TEXT = "#1F2733";
const MUTED = "#6B7682";
const SOFT = "#EAF3FB"; // azul muy claro para tarjetas

// ===========================================================================
// Utilidades de color
// ===========================================================================
function normHex(hex: string | null | undefined, fallback: string): string {
  const v = hex && /^#?[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return v.startsWith("#") ? v : `#${v}`;
}
function shade(hex: string, amount: number): string {
  // amount > 0 aclara, < 0 oscurece. Clamp a [0,255].
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount)));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount)));
  const b = Math.max(0, Math.min(255, (n & 0xff) + Math.round(255 * amount)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ===========================================================================
// Carga de fuentes (Poppins) y de imágenes como data-URI
// ===========================================================================
type FontSpec = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" };
let FONT_CACHE: FontSpec[] | null = null;
async function loadFonts(): Promise<FontSpec[]> {
  if (FONT_CACHE) return FONT_CACHE;
  const dir = path.join(process.cwd(), "src/modules/products/fonts");
  const [r, m, sb, b] = await Promise.all([
    readFile(path.join(dir, "Poppins-Regular.ttf")),
    readFile(path.join(dir, "Poppins-Medium.ttf")),
    readFile(path.join(dir, "Poppins-SemiBold.ttf")),
    readFile(path.join(dir, "Poppins-Bold.ttf")),
  ]);
  FONT_CACHE = [
    { name: "Poppins", data: r, weight: 400, style: "normal" },
    { name: "Poppins", data: m, weight: 500, style: "normal" },
    { name: "Poppins", data: sb, weight: 600, style: "normal" },
    { name: "Poppins", data: b, weight: 700, style: "normal" },
  ];
  return FONT_CACHE;
}

// SEGURIDAD (audit 2026-07-06): las URLs (logo/imagen) vienen de la BD y las
// edita un admin de tenant. Antes de hacer el fetch server-side bloqueamos SSRF
// a endpoints internos (metadata cloud 169.254.169.254, localhost, rangos
// privados). No cubre DNS rebinding (hostname que resuelve a IP privada), pero
// el vector real —IP literal interna en la URL— sí queda bloqueado.
function isSafeRemoteUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1"
  )
    return false;
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
    return false;
  return true;
}

async function fetchDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || !isSafeRemoteUrl(url)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
async function fileDataUri(rel: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), rel));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ===========================================================================
// Tipos de datos
// ===========================================================================
interface AttrValue {
  name: string;
  unit: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  data_type: string;
  is_featured: boolean;
}
interface DatasheetExtra {
  title_accent?: string;
  hero_heading?: string;
  hero_text?: string;
  features?: Array<{ title?: string; desc?: string }>;
  badge?: { label?: string; desc?: string };
  page2_title?: string;
  why?: string[];
  ideal?: Array<{ title?: string; desc?: string }>;
}

function attrValue(a: AttrValue): string {
  if (a.data_type === "boolean") return a.value_boolean ? "Sí" : "No";
  if (a.data_type === "number" || a.data_type === "dimension") {
    if (a.value_number == null) return "—";
    const n = new Intl.NumberFormat("es-ES").format(a.value_number);
    return `${n}${a.unit ? " " + a.unit : ""}`;
  }
  return a.value_text ?? "—";
}
function attrHasValue(a: AttrValue): boolean {
  if (a.data_type === "boolean") return a.value_boolean != null;
  if (a.data_type === "number" || a.data_type === "dimension") return a.value_number != null;
  return !!a.value_text && a.value_text.trim().length > 0;
}

// ===========================================================================
// Iconos SVG (como data-URI para satori)
// ===========================================================================
function svgUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
function checkIcon(color: string): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  );
}

// Reparte un array en grupos de n (para filas de 2 columnas).
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ===========================================================================
// Generador principal
// ===========================================================================
export async function generateProductDatasheetIaguaHtml(productId: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ---- Producto (defensivo) ----
  let prod: Record<string, unknown> | null = null;
  {
    const cols =
      "id, company_id, name, short_description, long_description, internal_reference, main_image_url, category_id, marketing_claim, datasheet_color_accent, datasheet_extra";
    const basic =
      "id, company_id, name, short_description, long_description, internal_reference, main_image_url, category_id";
    const r1 = await admin.from("products").select(cols).eq("id", productId).maybeSingle();
    if (r1.error) {
      const r2 = await admin.from("products").select(basic).eq("id", productId).maybeSingle();
      prod = r2.data ?? null;
    } else {
      prod = r1.data ?? null;
    }
  }
  if (!prod) throw new Error("Producto no encontrado");
  const p = prod as {
    company_id: string;
    name: string;
    short_description: string | null;
    long_description: string | null;
    internal_reference: string | null;
    main_image_url: string | null;
    category_id: string | null;
    marketing_claim: string | null;
    datasheet_color_accent: string | null;
    datasheet_extra: DatasheetExtra | null;
  };
  const extra: DatasheetExtra = (p.datasheet_extra as DatasheetExtra | null) ?? {};

  // ---- Ajustes de empresa ----
  const { data: cs } = await admin
    .from("company_settings")
    .select("pdf_brand_color, pdf_accent_color, fiscal_logo_url, fiscal_legal_name")
    .eq("company_id", p.company_id)
    .maybeSingle();
  const settings = (cs ?? {}) as {
    pdf_brand_color: string | null;
    pdf_accent_color: string | null;
    fiscal_logo_url: string | null;
    fiscal_legal_name: string | null;
  };
  let companyName = settings.fiscal_legal_name ?? "";
  if (!companyName) {
    const { data: comp } = await admin
      .from("companies")
      .select("name")
      .eq("id", p.company_id)
      .maybeSingle();
    companyName = (comp as { name: string } | null)?.name ?? "Empresa";
  }

  const NAVY = normHex(settings.pdf_brand_color, DEFAULT_NAVY);
  const ACCENT = normHex(p.datasheet_color_accent ?? settings.pdf_accent_color, DEFAULT_ACCENT);

  // ---- Atributos visibles ----
  let attrs: AttrValue[] = [];
  try {
    const { data: rows } = await admin
      .from("product_attribute_values")
      .select(
        "is_featured, value_text, value_number, value_boolean, data_type, display_order, product_attributes ( name, unit )",
      )
      .eq("product_id", productId)
      .eq("is_visible", true)
      .order("display_order");
    type Row = {
      is_featured: boolean;
      value_text: string | null;
      value_number: number | null;
      value_boolean: boolean | null;
      data_type: string;
      product_attributes: { name: string; unit: string | null } | null;
    };
    attrs = ((rows ?? []) as Row[])
      .map<AttrValue>((r) => ({
        name: r.product_attributes?.name ?? "",
        unit: r.product_attributes?.unit ?? null,
        value_text: r.value_text,
        value_number: r.value_number,
        value_boolean: r.value_boolean,
        data_type: r.data_type,
        is_featured: r.is_featured,
      }))
      .filter((a) => a.name && attrHasValue(a));
  } catch {
    /* fail-soft */
  }

  // ---- Certificación (badge) ----
  let certName: string | null = null;
  let certKey: string | null = null;
  try {
    const { data: rows } = await admin
      .from("product_certifications")
      .select("certification_key, certifications_catalog ( name_es )")
      .eq("product_id", productId)
      .order("display_order")
      .limit(1);
    const first = ((rows ?? []) as Array<{
      certification_key: string;
      certifications_catalog: { name_es: string } | null;
    }>)[0];
    if (first) {
      certKey = first.certification_key;
      certName = first.certifications_catalog?.name_es ?? first.certification_key;
    }
  } catch {
    /* fail-soft */
  }

  // ---- Imágenes ----
  const [logoUri, photoUri, heroP2Uri] = await Promise.all([
    fetchDataUri(settings.fiscal_logo_url),
    fetchDataUri(p.main_image_url),
    fileDataUri("src/modules/products/assets/iagua-hero-p2.png"),
  ]);

  // ---- Derivados de contenido ----
  const accentWord =
    extra.title_accent && p.name.includes(extra.title_accent) ? extra.title_accent : null;
  const titleBefore = accentWord ? p.name.slice(0, p.name.indexOf(accentWord)).trim() : p.name;
  const heroHeading = (extra.hero_heading ?? p.marketing_claim ?? "AGUA DE CALIDAD").toUpperCase();
  const heroBody = extra.hero_text ?? p.long_description ?? p.short_description ?? "";
  const features =
    extra.features && extra.features.length > 0
      ? extra.features.slice(0, 4).map((f) => ({ title: f.title ?? "", desc: f.desc ?? "" }))
      : attrs
          .filter((a) => a.is_featured)
          .slice(0, 4)
          .map((a) => ({ title: a.name, desc: attrValue(a) }));
  const badgeLabel = extra.badge?.label ?? (certKey ? certKey.toUpperCase().slice(0, 14) : null);
  const badgeDesc =
    extra.badge?.desc ??
    (certName ? `Producto certificado ${certName}.` : p.long_description ?? p.short_description ?? null);
  const why = (extra.why ?? []).slice(0, 12);
  const ideal = (extra.ideal ?? []).slice(0, 8);
  const hasExtra = why.length > 0 || ideal.length > 0;

  const navyDark = shade(NAVY, -0.05);
  const navyLight = shade(NAVY, 0.12);

  // =========================================================================
  // Sub-bloques (cada uno es un nodo JSX independiente, ancho 100% del área de
  // contenido, que satori puede medir por separado)
  // =========================================================================
  /* eslint-disable @typescript-eslint/no-explicit-any */
  type Block = { el: any; gap: number; keepWithNext?: boolean };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const headerEl = (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", height: s(40) }}>
        {logoUri ? (
          <img src={logoUri} height={s(34)} style={{ objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: s(15), fontWeight: 700, color: NAVY }}>
            {companyName.toUpperCase()}
          </div>
        )}
      </div>
      <div style={{ display: "flex", height: s(3), background: NAVY, marginTop: s(8), borderRadius: s(2) }} />
    </div>
  );

  const footer = (pageNo: number, total: number) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop: "auto",
      }}
    >
      <div style={{ display: "flex", height: 1, background: "#DCE3EC", width: "100%" }} />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          fontSize: s(7.5),
          color: MUTED,
          marginTop: s(6),
        }}
      >
        {`${p.name} · Página ${pageNo} de ${total}`}
      </div>
    </div>
  );

  const sectionHeaderEl = (label: string) => (
    <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
      <div style={{ display: "flex", width: s(5), height: s(15), background: ACCENT, borderRadius: s(2), marginRight: s(10) }} />
      <div style={{ display: "flex", fontSize: s(12), fontWeight: 700, color: NAVY, letterSpacing: s(0.4), flex: 1 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );

  const titleEl = (
    <div style={{ display: "flex", flexWrap: "wrap", width: "100%" }}>
      <div style={{ display: "flex", fontSize: s(23), fontWeight: 700, color: NAVY }}>{titleBefore}</div>
      {accentWord && (
        <div style={{ display: "flex", fontSize: s(23), fontWeight: 700, color: ACCENT, marginLeft: s(8) }}>
          {accentWord}
        </div>
      )}
    </div>
  );

  const subtitleEl = (
    <div style={{ display: "flex", width: "100%" }}>
      <div style={{ display: "flex", fontSize: s(10.5), color: MUTED, lineHeight: 1.35, maxWidth: s(420) }}>
        {p.marketing_claim ?? ""}
      </div>
    </div>
  );

  const heroEl = (
    <div style={{ display: "flex", width: "100%", height: s(150) }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: photoUri ? "62%" : "100%",
          borderRadius: s(14),
          padding: s(18),
          backgroundImage: `linear-gradient(135deg, ${navyDark}, ${navyLight})`,
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: s(12.5), fontWeight: 700, color: "#FFFFFF", lineHeight: 1.25 }}>
          {heroHeading}
        </div>
        <div style={{ display: "flex", fontSize: s(9), color: "#C8DCEC", marginTop: s(8), lineHeight: 1.4 }}>
          {heroBody.slice(0, 320)}
        </div>
      </div>
      {photoUri && (
        <div
          style={{
            display: "flex",
            width: "36%",
            marginLeft: "2%",
            borderRadius: s(14),
            background: "#F1F6FB",
            alignItems: "center",
            justifyContent: "center",
            padding: s(10),
          }}
        >
          <img src={photoUri} style={{ maxWidth: "100%", maxHeight: s(130), objectFit: "contain" }} />
        </div>
      )}
    </div>
  );

  const featureCard = (f: { title: string; desc: string }, key: number) => (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "48.5%",
        background: SOFT,
        borderRadius: s(10),
        padding: s(12),
      }}
    >
      <div style={{ display: "flex", fontSize: s(9), fontWeight: 700, color: NAVY, letterSpacing: s(0.3) }}>
        {(f.title || "").toUpperCase()}
      </div>
      <div style={{ display: "flex", fontSize: s(8.5), color: MUTED, marginTop: s(4), lineHeight: 1.3 }}>{f.desc}</div>
    </div>
  );

  const featureRowEl = (pair: Array<{ title: string; desc: string }>) => (
    <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
      {pair.map((f, i) => featureCard(f, i))}
      {pair.length === 1 && <div style={{ display: "flex", width: "48.5%" }} />}
    </div>
  );

  const attrCell = (a: AttrValue, rowIdx: number, key: number) => (
    <div
      key={key}
      style={{
        display: "flex",
        width: "48%",
        justifyContent: "space-between",
        alignItems: "center",
        padding: `${s(5)}px ${s(8)}px`,
        background: rowIdx % 2 === 0 ? "#F4F8FC" : "transparent",
        borderRadius: s(4),
      }}
    >
      <div style={{ display: "flex", fontSize: s(8.5), fontWeight: 600, color: NAVY }}>{a.name}</div>
      <div style={{ display: "flex", fontSize: s(8.5), color: TEXT }}>{attrValue(a)}</div>
    </div>
  );

  const attrRowEl = (pair: AttrValue[], rowIdx: number) => (
    <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
      {pair.map((a, i) => attrCell(a, rowIdx, i))}
      {pair.length === 1 && <div style={{ display: "flex", width: "48%" }} />}
    </div>
  );

  const badgeEl = (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        background: SOFT,
        borderRadius: s(12),
        padding: s(14),
      }}
    >
      {badgeLabel && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: s(60),
            height: s(46),
            background: NAVY,
            borderRadius: s(8),
            marginRight: s(14),
            padding: s(4),
          }}
        >
          <div style={{ display: "flex", fontSize: s(8), fontWeight: 700, color: "#FFFFFF", textAlign: "center", lineHeight: 1.15 }}>
            {badgeLabel}
          </div>
        </div>
      )}
      {badgeDesc && (
        <div style={{ display: "flex", fontSize: s(8.8), color: TEXT, lineHeight: 1.4, flex: 1 }}>
          {badgeDesc}
        </div>
      )}
    </div>
  );

  const heroP2El = (
    <div style={{ display: "flex", width: "100%" }}>
      <img src={heroP2Uri ?? ""} style={{ width: "100%", borderRadius: s(14), objectFit: "contain" }} />
    </div>
  );

  const whyRowEl = (pair: string[]) => (
    <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
      {pair.map((w, i) => (
        <div key={i} style={{ display: "flex", width: "48%" }}>
          <img src={checkIcon(GREEN)} width={s(12)} height={s(12)} style={{ marginTop: s(2), marginRight: s(8) }} />
          <div style={{ display: "flex", fontSize: s(9.5), color: TEXT, lineHeight: 1.4, flex: 1 }}>{w}</div>
        </div>
      ))}
      {pair.length === 1 && <div style={{ display: "flex", width: "48%" }} />}
    </div>
  );

  const idealCard = (it: { title?: string; desc?: string }, key: number) => (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "48.5%",
        background: SOFT,
        borderRadius: s(10),
        padding: s(12),
      }}
    >
      <div style={{ display: "flex", fontSize: s(9), fontWeight: 700, color: NAVY, letterSpacing: s(0.3) }}>
        {(it.title ?? "").toUpperCase()}
      </div>
      <div style={{ display: "flex", fontSize: s(8.5), color: MUTED, marginTop: s(4), lineHeight: 1.3 }}>
        {it.desc ?? ""}
      </div>
    </div>
  );

  const idealRowEl = (pair: Array<{ title?: string; desc?: string }>) => (
    <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
      {pair.map((it, i) => idealCard(it, i))}
      {pair.length === 1 && <div style={{ display: "flex", width: "48.5%" }} />}
    </div>
  );

  // =========================================================================
  // Lista ordenada de bloques (el flujo continuo de la ficha)
  // =========================================================================
  const blocks: Block[] = [];
  blocks.push({ el: titleEl, gap: 0 });
  if (p.marketing_claim) blocks.push({ el: subtitleEl, gap: s(6) });
  blocks.push({ el: heroEl, gap: s(16) });

  if (features.length > 0) {
    blocks.push({ el: sectionHeaderEl("Características del equipo"), gap: s(20), keepWithNext: true });
    chunk(features, 2).forEach((pair) => blocks.push({ el: featureRowEl(pair), gap: s(10) }));
  }

  if (attrs.length > 0) {
    blocks.push({
      el: sectionHeaderEl(
        `Ficha técnica${p.internal_reference ? ` — ${p.internal_reference} · ${p.name}` : ""}`,
      ),
      gap: s(20),
      keepWithNext: true,
    });
    chunk(attrs, 2).forEach((pair, ri) =>
      blocks.push({ el: attrRowEl(pair, ri), gap: ri === 0 ? s(8) : s(3) }),
    );
  }

  if (badgeLabel || badgeDesc) blocks.push({ el: badgeEl, gap: s(18) });

  if (hasExtra && heroP2Uri) blocks.push({ el: heroP2El, gap: s(18), keepWithNext: true });

  if (why.length > 0) {
    blocks.push({
      el: sectionHeaderEl(extra.page2_title ?? `Por qué elegir ${p.name}`),
      gap: s(20),
      keepWithNext: true,
    });
    chunk(why, 2).forEach((pair) => blocks.push({ el: whyRowEl(pair), gap: s(10) }));
  }

  if (ideal.length > 0) {
    blocks.push({ el: sectionHeaderEl("Ideal para"), gap: s(20), keepWithNext: true });
    chunk(ideal, 2).forEach((pair) => blocks.push({ el: idealRowEl(pair), gap: s(10) }));
  }

  // =========================================================================
  // Medir alto real de cada bloque (satori con ancho fijo, alto automático)
  // =========================================================================
  const PAGE_PAD = s(44);
  const CONTENT_W = PAGE_W - PAGE_PAD * 2;
  const HEADER_TO_CONTENT = s(20); // hueco cabecera → primer bloque
  const CONTENT_TO_FOOTER = s(12); // hueco último bloque → pie
  const SAFETY = s(6); // margen de seguridad para no rozar el borde
  const fonts = await loadFonts();

  const measure = async (node: Block["el"]): Promise<number> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svg = await satori(node as any, { width: CONTENT_W, fonts: fonts as any });
      const m = svg.match(/<svg[^>]*\bheight="([\d.]+)"/);
      return m && m[1] ? Math.ceil(parseFloat(m[1])) : 0;
    } catch {
      return 0;
    }
  };

  const [headerH, footerH, ...blockHeights] = await Promise.all([
    measure(headerEl),
    measure(footer(1, 1)),
    ...blocks.map((b) => measure(b.el)),
  ]);

  const innerH = PAGE_H - PAGE_PAD * 2;
  const budget = Math.max(
    s(100),
    innerH - headerH - HEADER_TO_CONTENT - footerH - CONTENT_TO_FOOTER - SAFETY,
  );

  // =========================================================================
  // Reparto por bloques (greedy): cuando un bloque no cabe, salta a hoja nueva.
  // keepWithNext evita cabeceras de sección huérfanas al pie de la página.
  // =========================================================================
  type Placed = { el: Block["el"]; gap: number };
  const pages: Placed[][] = [];
  let cur: Placed[] = [];
  let used = 0;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    const h = blockHeights[i] ?? 0;
    const isFirst = cur.length === 0;
    const need = (isFirst ? 0 : b.gap) + h;

    // ¿Cabe en la hoja actual?
    if (!isFirst && used + need > budget) {
      pages.push(cur);
      cur = [];
      used = 0;
      continue; // reevaluar este bloque como primero de la hoja nueva
    }

    // Antihuérfanos: si es cabecera "pegada al siguiente" y el siguiente no
    // cabría tras ella en esta hoja, bajamos la cabecera a la hoja siguiente.
    if (b.keepWithNext && !isFirst && i + 1 < blocks.length) {
      const nextNeed = (blocks[i + 1]?.gap ?? 0) + (blockHeights[i + 1] ?? 0);
      if (used + need + nextNeed > budget) {
        pages.push(cur);
        cur = [];
        used = 0;
        continue;
      }
    }

    cur.push({ el: b.el, gap: isFirst ? 0 : b.gap });
    used += need;
    i++;
  }
  if (cur.length > 0) pages.push(cur);
  const totalPages = Math.max(1, pages.length);

  // =========================================================================
  // Render de cada hoja → PNG
  // =========================================================================
  const renderPage = (pageBlocks: Placed[], pageNo: number) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: PAGE_W,
        height: PAGE_H,
        background: "#FFFFFF",
        fontFamily: "Poppins",
        padding: PAGE_PAD,
        position: "relative",
      }}
    >
      {headerEl}
      <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: HEADER_TO_CONTENT }}>
        {pageBlocks.map((pb, idx) => (
          <div key={idx} style={{ display: "flex", width: "100%", marginTop: pb.gap }}>
            {pb.el}
          </div>
        ))}
      </div>
      {footer(pageNo, totalPages)}
    </div>
  );

  const pngBuffers: Uint8Array[] = [];
  for (let pageNo = 1; pageNo <= pages.length; pageNo++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svg = await satori(renderPage(pages[pageNo - 1] ?? [], pageNo) as any, {
      width: PAGE_W,
      height: PAGE_H,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fonts: fonts as any,
    });
    pngBuffers.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  // ----- Ensamblar PDF -----
  const pdf = await PDFDocument.create();
  for (const png of pngBuffers) {
    const page = pdf.addPage([595, 842]);
    const img = await pdf.embedPng(png);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return pdf.save();
}
