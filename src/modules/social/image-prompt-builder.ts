/**
 * Constructor de prompts de imagen IA enriquecidos para posts de RRSS.
 *
 * El image_prompt de la plantilla de contenido (content-templates.ts) es
 * genérico — sirve igual para 50 empresas. Este builder lo enriquece con
 * 6 fuentes de contexto para que el resultado sea ESPECÍFICO de la empresa
 * y del topic concreto del post:
 *
 *   1. Plantilla base ............ post.image_prompt
 *   2. Estilo visual marca ....... social_settings.image_style + paleta
 *   3. Localización .............. social_settings.brand_location_hint
 *   4. Keywords visuales libres .. social_settings.brand_visual_keywords
 *   5. Restricciones duras ....... forbidden_visual_elements + reglas globales
 *   6. Tópico + canal + formato .. post.topic, post.channel, image_format
 *
 * Resultado: un prompt denso (~150-300 palabras) en español pensado para
 * Gemini 2.5 Flash Image que entiende español nativamente.
 */

import type {
  ImageOverrides,
  ImageStyle,
  ImageVisualSettings,
  PostForPromptBuilder,
} from "./image-types";

/**
 * Mezcla defaults + overrides. Para cada campo:
 *   - si el override viene con valor (incluido string vacío explícito), gana
 *   - si no, queda el default.
 * Para arrays, override REEMPLAZA (no concatena) para que el admin pueda
 * limitar elementos prohibidos puntualmente.
 */
function mergeVisualSettings(
  defaults: ImageVisualSettings,
  overrides: ImageOverrides | null | undefined,
): ImageVisualSettings {
  if (!overrides) return defaults;
  return {
    ...defaults,
    image_style: (overrides.image_style ?? defaults.image_style) as ImageStyle | null,
    brand_palette_primary:
      overrides.brand_palette_primary ?? defaults.brand_palette_primary,
    brand_palette_secondary:
      overrides.brand_palette_secondary ?? defaults.brand_palette_secondary,
    brand_palette_accent:
      overrides.brand_palette_accent ?? defaults.brand_palette_accent,
    brand_visual_keywords:
      overrides.brand_visual_keywords ?? defaults.brand_visual_keywords,
    brand_location_hint:
      overrides.brand_location_hint ?? defaults.brand_location_hint,
    forbidden_visual_elements:
      overrides.forbidden_visual_elements ?? defaults.forbidden_visual_elements,
    preferred_visual_elements:
      overrides.preferred_visual_elements ?? defaults.preferred_visual_elements,
  };
}

const STYLE_GUIDES: Record<string, string> = {
  photoreal:
    "Fotografía profesional realista, tipo reportaje editorial. Iluminación natural cálida. Profundidad de campo cinematográfica. Sin filtros artificiales.",
  flat:
    "Ilustración vectorial flat moderna, sin sombras complejas. Líneas limpias y formas geométricas simples. Estética tipo Behance/Dribbble 2026.",
  illustration:
    "Ilustración dibujada con estética cuidada, colores planos con sombras suaves, línea de contorno fina. Tipo libro infantil premium o editorial moderno.",
  "3d":
    "Render 3D estilo isométrico, materiales suaves tipo claymorphism, iluminación de estudio difusa, paleta limitada.",
  editorial:
    "Estética editorial limpia tipo revista de arquitectura/diseño. Composición minimalista, mucho espacio negativo, tipografía ausente. Iluminación natural difusa.",
  minimalist:
    "Minimalismo extremo. Composición simétrica o regla de tercios. Un solo sujeto central. Fondo plano o gradiente sutil. Sin elementos decorativos.",
};

const CHANNEL_HINTS: Record<string, string> = {
  instagram:
    "Pensada para Instagram feed: composición cuadrada, sujeto centrado, alto contraste, captable a 200px de miniatura.",
  facebook:
    "Pensada para Facebook feed: composición cuadrada o ligeramente horizontal, legible en móvil pequeño.",
  linkedin:
    "Pensada para LinkedIn: tono profesional sobrio, evitar colorido infantil, transmitir autoridad técnica.",
  tiktok:
    "Pensada para TikTok cover: composición vertical, alto contraste, foco en un objeto reconocible.",
  google_business:
    "Pensada para Google Business Profile: foto que demuestre el servicio en contexto real.",
  blog:
    "Pensada como hero de artículo de blog: composición horizontal apaisada, espacio negativo a un lado para texto si se sobreimprime después.",
  newsletter:
    "Pensada como cabecera de email newsletter: apaisada 16:9, legible al 60% por compresión.",
};

const FORMAT_HINTS: Record<string, string> = {
  "1080x1080": "Formato cuadrado 1:1 (1080×1080 px).",
  "1080x1350": "Formato vertical 4:5 (1080×1350 px, Instagram portrait).",
  "1080x1920": "Formato vertical 9:16 (Stories/Reel cover).",
  "1200x630": "Formato horizontal 1.91:1 (1200×630 px, Open Graph/LinkedIn).",
  "1920x1080": "Formato horizontal 16:9 (1920×1080 px).",
};

const GLOBAL_HARD_RULES = [
  "NO incluir logos de marcas comerciales reconocibles (Coca-Cola, Apple, BSH, Bosch, Whirlpool, etc.).",
  "NO incluir texto, palabras, números ni letras de ningún tipo dentro de la imagen — el copy lo añade el editor de RRSS después.",
  "NO incluir caras de personas reconocibles. Si aparecen personas, deben ser de espaldas, en sombra o en plano detalle (manos, torso) — nunca primer plano facial.",
  "NO incluir banderas ni símbolos políticos o religiosos.",
  "NO inventar productos con nombres ficticios visibles.",
  "La imagen debe ser ÚNICA y reconocible — evitar composiciones genéricas de banco de imágenes.",
];

/**
 * Construye el prompt final que se envía al proveedor IA.
 *
 * @param overrides — overrides puntuales por imagen (de social_posts.image_overrides).
 *                    Si vienen, ganan a los defaults de social_settings.
 */
export function buildEnrichedImagePrompt(
  post: PostForPromptBuilder,
  rawSettings: ImageVisualSettings,
  companyName: string,
  overrides?: ImageOverrides | null,
): string {
  const sections: string[] = [];
  const settings = mergeVisualSettings(rawSettings, overrides);

  // ── Sección 1: contexto del negocio ────────────────────────────────────────
  sections.push(
    `# Contexto del negocio\n` +
      `Empresa: "${companyName}" (sector: tratamiento de agua doméstico — descalcificadores, ósmosis inversa, ablandadores, filtros, dispensadores).\n` +
      (settings.brand_location_hint
        ? `Ubicación / ambiente: ${settings.brand_location_hint}.\n`
        : "") +
      (settings.brand_visual_keywords
        ? `Identidad visual: ${settings.brand_visual_keywords}.\n`
        : ""),
  );

  // ── Sección 2: tópico concreto del post ────────────────────────────────────
  sections.push(
    `# Tópico del post\n` +
      `Tema: ${post.topic}.\n` +
      `Tipo de contenido: ${humanizeContentType(post.content_type)}.\n` +
      (post.target_segment
        ? `Audiencia: ${humanizeAudience(post.target_segment)}.\n`
        : "") +
      `Canal de publicación: ${post.channel}.\n`,
  );

  // ── Sección 3: prompt de la plantilla (idea visual base) ───────────────────
  sections.push(
    `# Idea visual de partida\n${post.image_prompt ?? "(sin prompt base)"}\n`,
  );

  // ── Sección 4: estilo + paleta + canal + formato ───────────────────────────
  const styleGuide =
    STYLE_GUIDES[settings.image_style ?? "editorial"] ??
    STYLE_GUIDES.editorial!;
  const paletteParts = [
    settings.brand_palette_primary && `primario ${settings.brand_palette_primary}`,
    settings.brand_palette_secondary && `secundario ${settings.brand_palette_secondary}`,
    settings.brand_palette_accent && `acento ${settings.brand_palette_accent}`,
  ].filter(Boolean) as string[];
  const formatHint =
    FORMAT_HINTS[post.image_format ?? "1080x1080"] ??
    `Formato ${post.image_format ?? "1080x1080"}.`;
  const channelHint = CHANNEL_HINTS[post.channel] ?? "";

  sections.push(
    `# Estilo visual\n` +
      `${styleGuide}\n` +
      (paletteParts.length > 0
        ? `Paleta de marca: ${paletteParts.join(", ")} (úsala dominante, no decorativa).\n`
        : "Paleta: tonos azul agua + blanco + verde acento (sector agua).\n") +
      `${formatHint} ${channelHint}\n`,
  );

  // ── Sección 5: elementos preferidos / prohibidos ──────────────────────────
  const preferred = settings.preferred_visual_elements ?? [];
  const forbidden = settings.forbidden_visual_elements ?? [];
  if (preferred.length > 0) {
    sections.push(
      `# Elementos preferidos (intenta incluir si encaja)\n- ${preferred.join(
        "\n- ",
      )}\n`,
    );
  }
  const allForbidden = [...GLOBAL_HARD_RULES, ...forbidden.map((f) => `NO ${f}.`)];
  sections.push(
    `# Reglas duras (cumplir SIEMPRE)\n- ${allForbidden.join("\n- ")}\n`,
  );

  // ── Sección 5b: productos del catálogo a destacar ──────────────────────────
  // Solo si el post viene con product_refs cargados desde DB.
  const products = post.product_refs ?? [];
  if (products.length > 0) {
    const productLines = products
      .map((p) => {
        const desc = p.description ? ` — ${p.description.slice(0, 200)}` : "";
        const hasPhoto = p.main_image_url ? " (foto adjunta como referencia visual)" : "";
        return `- "${p.name}"${desc}${hasPhoto}`;
      })
      .join("\n");
    sections.push(
      `# Productos a destacar en la imagen\n` +
        `Se adjuntan ${products.length === 1 ? "el siguiente producto" : "los siguientes productos"} del catálogo de la empresa. ` +
        `Si hay fotos adjuntas como referencia visual, RESPETA el diseño industrial real del producto (forma, color, proporción, color del display). ` +
        `Integra el producto en la escena de forma natural, no como un catálogo recortado.\n${productLines}\n`,
    );
  }

  // ── Sección 6: instrucción final al modelo ────────────────────────────────
  sections.push(
    `# Instrucción\n` +
      `Genera UNA imagen que cumpla TODO lo anterior. Si hay conflicto entre la idea base y el estilo, prioriza el estilo de marca. ` +
      `La imagen debe parecer hecha a medida para "${companyName}", no un stock genérico. ` +
      `Salida: solo la imagen, sin marcos ni bordes.`,
  );

  return sections.join("\n");
}

function humanizeContentType(t: string): string {
  switch (t) {
    case "educational":
      return "educativo (explica una idea o resuelve duda común)";
    case "ephemeris":
      return "efeméride (día internacional / fecha señalada)";
    case "commercial_soft":
      return "comercial suave (presenta un beneficio sin venta dura)";
    case "technical_authority":
      return "autoridad técnica (demuestra conocimiento técnico real)";
    case "local":
      return "cercanía / local (humaniza la marca con contexto local)";
    case "visual_reel":
      return "visual reel (impacto visual rápido, pocas palabras)";
    default:
      return t;
  }
}

function humanizeAudience(t: string): string {
  switch (t) {
    case "hogar":
      return "familias residenciales españolas";
    case "empresa":
      return "responsables de instalaciones de empresas (oficinas, fábricas)";
    case "hosteleria":
      return "bares, restaurantes, hoteles (HORECA)";
    case "comunidad":
      return "comunidades de vecinos / presidentes";
    case "administradores":
      return "administradores de fincas";
    case "general":
      return "público amplio español";
    default:
      return t;
  }
}
