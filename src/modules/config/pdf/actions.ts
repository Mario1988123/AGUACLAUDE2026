"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export type DatasheetTemplate = "standard" | "iagua";

export interface PdfSettings {
  datasheet_template: DatasheetTemplate;
  /** Color base/cabecera (azul marino en IAGUA). */
  pdf_brand_color: string;
  /** Color de acento (dorado/azul en IAGUA). Se puede sobreescribir por producto. */
  pdf_accent_color: string;
}

const DEFAULTS: PdfSettings = {
  datasheet_template: "standard",
  pdf_brand_color: "#1F3A5F",
  pdf_accent_color: "#C9A227",
};

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo el administrador puede cambiar la configuración");
  return session;
}

export async function getPdfSettings(): Promise<PdfSettings> {
  const session = await ensureAdmin();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data } = await supabase
      .from("company_settings")
      .select("datasheet_template, pdf_brand_color, pdf_accent_color")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    if (!data) return DEFAULTS;
    const tpl = data.datasheet_template === "iagua" ? "iagua" : "standard";
    return {
      datasheet_template: tpl as DatasheetTemplate,
      pdf_brand_color: data.pdf_brand_color ?? DEFAULTS.pdf_brand_color,
      pdf_accent_color: data.pdf_accent_color ?? DEFAULTS.pdf_accent_color,
    };
  } catch {
    // Migración no aplicada todavía → devolver defaults sin romper.
    return DEFAULTS;
  }
}

const schema = z.object({
  datasheet_template: z.enum(["standard", "iagua"]),
  pdf_brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color base no válido")
    .nullish(),
  pdf_accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color de acento no válido")
    .nullish(),
});

export async function updatePdfSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const parsed = parseOrFriendly(schema, input, "Configuración PDF");
    const payload: Record<string, unknown> = {
      datasheet_template: parsed.datasheet_template,
    };
    if (parsed.pdf_brand_color) payload.pdf_brand_color = parsed.pdf_brand_color;
    if (parsed.pdf_accent_color) payload.pdf_accent_color = parsed.pdf_accent_color;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data: existing } = await supabase
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    if (existing) {
      const r = await supabase
        .from("company_settings")
        .update(payload)
        .eq("company_id", session.company_id!);
      if (r.error) return { ok: false, error: r.error.message };
    } else {
      const r = await supabase
        .from("company_settings")
        .insert({ company_id: session.company_id!, ...payload });
      if (r.error) return { ok: false, error: r.error.message };
    }
    revalidatePath("/configuracion/pdf");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
