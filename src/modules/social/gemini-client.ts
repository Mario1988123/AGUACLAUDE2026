/**
 * Cliente directo a la API de Google Generative Language (Gemini) para
 * generación de imágenes. Hablado vía fetch — no añade dependencia de
 * `@google/genai` al bundle.
 *
 * Modelo: gemini-2.5-flash-image-preview (multimodal nativo, ~$0.039/imagen).
 * Auth: GOOGLE_GENAI_API_KEY (env Vercel, una clave global del SaaS).
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 *
 * Si la env var no está configurada, devuelve un error claro al admin
 * SIN consumir cuota ni gasto.
 */

import type {
  ImageGenerationResult,
  ImageGenerationMetadata,
} from "./image-types";

// Nombre del modelo en GA (sin sufijo -preview, ese era el rename pre-lanzamiento).
// Override opcional via env GEMINI_IMAGE_MODEL por si Google renombra otra vez.
// Modelos válidos hoy: gemini-3.1-flash-image (primary), gemini-3-pro-image,
// gemini-2.5-flash-image (older estable).
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Coste estimado por imagen en céntimos. Ajustar cuando Google publique
 *  precio definitivo del 2.5 Flash Image. Hoy ~$0.039 → 4 cént. */
const COST_PER_IMAGE_CENTS = 4;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inline_data?: {
          mime_type?: string;
          data?: string; // base64
        };
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/** Imagen de referencia que se manda a Gemini junto al prompt textual. */
export interface GeminiReferenceImage {
  data: Buffer;
  mimeType: string; // "image/jpeg" | "image/png" | "image/webp"
}

export async function generateImageWithGemini(
  finalPrompt: string,
  referenceImages?: GeminiReferenceImage[],
): Promise<ImageGenerationResult> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error_code: "NO_API_KEY",
      error_message:
        "GOOGLE_GENAI_API_KEY no está configurada en el servidor. Pide al admin que la añada en Vercel (puedes obtenerla en aistudio.google.com/apikey).",
    };
  }
  if (!finalPrompt || finalPrompt.trim().length < 50) {
    return {
      ok: false,
      error_code: "PROMPT_TOO_SHORT",
      error_message:
        "El prompt es demasiado corto. Para una imagen decente Gemini necesita al menos 50 caracteres con contexto.",
    };
  }

  try {
    // Construir parts: imágenes de referencia PRIMERO, prompt textual al final
    // (convención multimodal recomendada por Google).
    const refs = referenceImages ?? [];
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = refs.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data.toString("base64"),
      },
    }));
    parts.push({ text: finalPrompt });

    const body = {
      contents: [{ parts }],
      generationConfig: {
        // Gemini exige pedir TEXT+IMAGE aunque solo quieras la imagen:
        // si pides solo ["IMAGE"] la API devuelve respuesta vacía sin error.
        // El parser de abajo descarta el texto y se queda con la imagen.
        responseModalities: ["TEXT", "IMAGE"],
      },
    };

    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      const errMsg =
        json.error?.message ??
        `Gemini devolvió ${res.status}. Revisa la API key y el estado del servicio.`;
      return {
        ok: false,
        error_code: json.error?.status ?? `HTTP_${res.status}`,
        error_message: errMsg,
      };
    }

    if (json.promptFeedback?.blockReason) {
      return {
        ok: false,
        error_code: "BLOCKED",
        error_message: `Gemini bloqueó la generación por motivo de política: ${json.promptFeedback.blockReason}. Revisa el prompt (puede contener algo sensible o ambiguo).`,
      };
    }

    const candidate = json.candidates?.[0];
    if (!candidate) {
      return {
        ok: false,
        error_code: "NO_CANDIDATE",
        error_message:
          "Gemini no devolvió ninguna imagen. Reintenta con un prompt más concreto.",
      };
    }

    // El payload puede venir con inline_data o inlineData (snake/camel)
    const part = (candidate.content?.parts ?? []).find(
      (p) =>
        (p.inline_data?.data || p.inlineData?.data) &&
        (p.inline_data?.mime_type?.startsWith("image/") ||
          p.inlineData?.mimeType?.startsWith("image/")),
    );
    const dataB64 = part?.inline_data?.data ?? part?.inlineData?.data;
    const mimeType =
      part?.inline_data?.mime_type ?? part?.inlineData?.mimeType ?? "image/png";
    if (!dataB64) {
      return {
        ok: false,
        error_code: "NO_IMAGE_PART",
        error_message:
          "La respuesta de Gemini no contenía imagen. Posible bloqueo silente o cambio de schema.",
      };
    }

    const imageBytes = Buffer.from(dataB64, "base64");
    const metadata: ImageGenerationMetadata = {
      provider: "gemini",
      model: MODEL,
      prompt_chars: finalPrompt.length,
      dimensions: "1024x1024", // gemini-2.5-flash-image devuelve 1024 por defecto
      cost_cents: COST_PER_IMAGE_CENTS,
      generated_at: new Date().toISOString(),
      reference_images_count: (referenceImages ?? []).length,
    };

    return {
      ok: true,
      image_bytes: imageBytes,
      mime_type: mimeType,
      metadata,
    };
  } catch (e) {
    return {
      ok: false,
      error_code: "NETWORK",
      error_message:
        "Fallo de red al contactar con Gemini: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}
