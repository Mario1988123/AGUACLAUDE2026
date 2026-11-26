"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { leerAjustesFicha } from "@/modules/products/ficha/cargar-ficha";
import { esPlantillaNueva, type OpcionesFicha } from "@/modules/products/ficha/modelo";
import type { PaletaGuardada } from "@/modules/products/ficha/paleta";

export type DatasheetTemplate = "standard" | "iagua" | "tarifa" | "escaparate" | "placa";

export interface PdfSettings {
  datasheet_template: DatasheetTemplate;
  /** «Color base» de las plantillas anteriores (Estándar e IAGUA). */
  pdf_brand_color: string;
  /** Acento de las plantillas anteriores. Se puede sobreescribir por producto. */
  pdf_accent_color: string;
  /** Paleta de las plantillas nuevas (null = se deriva del color de la empresa). */
  paleta: PaletaGuardada | null;
  opciones: OpcionesFicha;
  /** companies.primary_color: el color de la empresa. */
  colorEmpresa: string | null;
  logoUrl: string | null;
  /** ¿Está aplicada la migración 20261129100000? Sin ella solo se guardan las anteriores. */
  hayMigracion: boolean;
}

const DEFAULTS_ANTERIORES = {
  pdf_brand_color: "#1F3A5F",
  pdf_accent_color: "#C9A227",
};

const MIGRACION_PENDIENTE =
  "Las plantillas nuevas necesitan la migración 20261129100000_fichas_plantillas_paleta, que aún no está aplicada. Avisa al administrador de la plataforma.";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo el administrador puede cambiar la configuración");
  return session;
}

export async function getPdfSettings(): Promise<PdfSettings> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const a = await leerAjustesFicha(supabase, session.company_id!);
  return {
    datasheet_template: a.plantilla,
    pdf_brand_color: a.colorBaseAnterior ?? DEFAULTS_ANTERIORES.pdf_brand_color,
    pdf_accent_color: a.acentoAnterior ?? DEFAULTS_ANTERIORES.pdf_accent_color,
    paleta: a.paleta,
    opciones: a.opciones,
    colorEmpresa: a.colorEmpresa,
    logoUrl: a.logoUrl,
    hayMigracion: a.hayMigracion,
  };
}

const hex = (msg: string) => z.string().regex(/^#[0-9a-fA-F]{6}$/, msg);
const textoCorto = z
  .string()
  .trim()
  .max(120, "Máximo 120 caracteres")
  .nullish()
  .transform((v) => (v ? v : null));

const schema = z.object({
  datasheet_template: z.enum(["standard", "iagua", "tarifa", "escaparate", "placa"]),
  pdf_brand_color: hex("Color base no válido").nullish(),
  pdf_accent_color: hex("Color de acento no válido").nullish(),
  paleta: z
    .object({
      propuesta: z.enum(["marca_sola", "contrapunto", "sobria", "manual"]),
      base: hex("Color de marca no válido"),
      primario: hex("Color principal no válido"),
      acento: hex("Color de acento no válido"),
    })
    .nullish(),
  opciones: z
    .object({
      telefono: textoCorto,
      correo: textoCorto,
      web: textoCorto,
      mostrar_recambios: z.boolean(),
      mostrar_ventajas: z.boolean(),
    })
    .nullish(),
});

export async function updatePdfSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const parsed = parseOrFriendly(schema, input, "Configuración PDF");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const ajustes = await leerAjustesFicha(supabase, session.company_id!);
    if (!ajustes.hayMigracion && esPlantillaNueva(parsed.datasheet_template)) {
      return { ok: false, error: MIGRACION_PENDIENTE };
    }

    const payload: Record<string, unknown> = {
      datasheet_template: parsed.datasheet_template,
    };
    // Los colores de las plantillas anteriores solo se tocan si se mandan
    // (la pantalla nueva no escribe en ellos salvo desde «Plantillas anteriores»).
    if (parsed.pdf_brand_color) payload.pdf_brand_color = parsed.pdf_brand_color;
    if (parsed.pdf_accent_color) payload.pdf_accent_color = parsed.pdf_accent_color;
    if (ajustes.hayMigracion) {
      if (parsed.paleta !== undefined) {
        payload.datasheet_palette = parsed.paleta
          ? {
              propuesta: parsed.paleta.propuesta,
              base: parsed.paleta.base.toLowerCase(),
              primario: parsed.paleta.primario.toLowerCase(),
              acento: parsed.paleta.acento.toLowerCase(),
            }
          : null;
      }
      if (parsed.opciones) payload.datasheet_opciones = parsed.opciones;
    }

    const { data: existing, error: eE } = await supabase
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    if (eE) return { ok: false, error: eE.message };
    const r = existing
      ? await supabase.from("company_settings").update(payload).eq("company_id", session.company_id!)
      : await supabase.from("company_settings").insert({ company_id: session.company_id!, ...payload });
    if (r.error) {
      // 23514: el CHECK aún no admite las plantillas nuevas; 42703: faltan las columnas.
      if (r.error.code === "23514" || r.error.code === "42703") return { ok: false, error: MIGRACION_PENDIENTE };
      return { ok: false, error: r.error.message };
    }
    revalidatePath("/configuracion/pdf");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
