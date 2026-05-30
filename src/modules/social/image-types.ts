/**
 * Tipos compartidos para generación de imagen IA de RRSS.
 */

export type ImageProvider = "none" | "gemini";

export type ImageStyle =
  | "photoreal"
  | "flat"
  | "illustration"
  | "3d"
  | "editorial"
  | "minimalist";

export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type WatermarkPosition = OverlayPosition | "bottom-center";

/** Lo que vive en social_settings (parte visual). */
export interface ImageVisualSettings {
  image_provider: ImageProvider;
  image_style: ImageStyle | null;
  brand_palette_primary: string | null;
  brand_palette_secondary: string | null;
  brand_palette_accent: string | null;
  brand_visual_keywords: string | null;
  brand_location_hint: string | null;
  forbidden_visual_elements: string[];
  preferred_visual_elements: string[];
  monthly_image_budget_cents: number;
  images_used_this_month: number;
  images_used_period_start: string | null;
  // Defaults de marca de agua (logo/texto) — overlay post-generación.
  logo_overlay_enabled_default: boolean;
  logo_position_default: OverlayPosition;
  logo_size_pct_default: number;
  watermark_text_enabled_default: boolean;
  watermark_text_default: string | null;
  watermark_text_position_default: WatermarkPosition;
  watermark_text_color_default: string;
}

/**
 * Overrides por imagen — todos opcionales. Si vienen, ganan al default
 * de social_settings. Se persisten en social_posts.image_overrides (JSONB).
 */
export interface ImageOverrides {
  image_style?: ImageStyle | null;
  brand_palette_primary?: string | null;
  brand_palette_secondary?: string | null;
  brand_palette_accent?: string | null;
  brand_visual_keywords?: string | null;
  brand_location_hint?: string | null;
  forbidden_visual_elements?: string[];
  preferred_visual_elements?: string[];
  logo_overlay_enabled?: boolean;
  logo_position?: OverlayPosition;
  logo_size_pct?: number;
  watermark_text_enabled?: boolean;
  watermark_text?: string | null;
  watermark_text_position?: WatermarkPosition;
  watermark_text_color?: string | null;
}

/** Producto del catálogo a inyectar en el prompt (y opcionalmente foto). */
export interface ProductReference {
  id: string;
  name: string;
  description: string | null;
  main_image_url: string | null;
}

/** Configuración resuelta de overlay (defaults + overrides aplicados). */
export interface ResolvedOverlaySettings {
  logo_enabled: boolean;
  logo_url: string | null;
  logo_position: OverlayPosition;
  logo_size_pct: number;
  watermark_text_enabled: boolean;
  watermark_text: string | null;
  watermark_text_position: WatermarkPosition;
  watermark_text_color: string;
}

/** Subset de social_posts que necesita el builder de prompts. */
export interface PostForPromptBuilder {
  id: string;
  topic: string;
  content_type: string;
  channel: string;
  target_segment: string | null;
  image_prompt: string | null;
  image_format: string | null;
  product_refs?: ProductReference[];
}

/** Metadata que se guarda en social_posts.image_generation_metadata. */
export interface ImageGenerationMetadata {
  provider: ImageProvider;
  model: string;
  prompt_chars: number;
  dimensions: string;
  cost_cents: number;
  generated_at: string;
  seed?: string | number;
  /** Cuántas fotos de productos se enviaron como referencia visual. */
  reference_images_count?: number;
  /** Si se aplicó overlay (logo o texto) en post-procesado. */
  overlay_applied?: boolean;
  /** IDs de productos inyectados en el prompt. */
  product_ids?: string[];
}

/** Resultado de una llamada al proveedor. */
export interface ImageGenerationResult {
  ok: boolean;
  /** Bytes de la imagen (PNG o JPG). */
  image_bytes?: Buffer;
  mime_type?: string;
  metadata?: ImageGenerationMetadata;
  error_code?: string;
  error_message?: string;
}
