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
