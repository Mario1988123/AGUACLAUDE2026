"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  validateSpanishPhone,
  validateSpanishPostalCode,
} from "@/shared/lib/validations/spanish";
import { isPendingIban } from "@/shared/lib/validations/iban-partial";

export interface FiscalSettings {
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_street: string | null;
  fiscal_postal_code: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  fiscal_country: string;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_iban: string | null;
  fiscal_mercantile_reg: string | null;
  fiscal_logo_url: string | null;
  invoice_default_iva: number;
  invoice_default_due_days: number;
  invoice_footer_text: string | null;
}

const DEFAULTS: FiscalSettings = {
  fiscal_legal_name: null,
  fiscal_tax_id: null,
  fiscal_street: null,
  fiscal_postal_code: null,
  fiscal_city: null,
  fiscal_province: null,
  fiscal_country: "España",
  fiscal_email: null,
  fiscal_phone: null,
  fiscal_iban: null,
  fiscal_mercantile_reg: null,
  fiscal_logo_url: null,
  invoice_default_iva: 21,
  invoice_default_due_days: 30,
  invoice_footer_text: null,
};

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getFiscalSettings(): Promise<FiscalSettings> {
  try {
    const session = await requireSession();
    if (!session.company_id) return DEFAULTS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, fiscal_email, fiscal_phone, fiscal_iban, fiscal_mercantile_reg, fiscal_logo_url, invoice_default_iva, invoice_default_due_days, invoice_footer_text",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return { ...DEFAULTS, ...(data as Partial<FiscalSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Persiste la configuración fiscal de la empresa con UPSERT atómico
 * + verificación post-write. Si tras escribir el SELECT no devuelve
 * los valores enviados, lanza error explícito (algo intermedio está
 * pisando los datos: trigger, schema cache, RLS, etc.).
 *
 * Si una columna no existe en BD, la quita y reintenta para guardar
 * lo demás, y avisa al usuario qué quedó fuera.
 */
/** Validación de formato de los campos críticos antes de persistir.
 *  Lanza Error con mensaje legible si algo no cumple. */
function validateFiscalFormat(input: Partial<FiscalSettings>): void {
  const errs: string[] = [];

  if (input.fiscal_tax_id != null && input.fiscal_tax_id !== "") {
    // Validación LAXA de CIF/DNI/NIE de empresa: solo formato, no
    // dígito de control. La letra de control real depende de un
    // algoritmo que puede dar falsos negativos para CIFs reales
    // (SL, SA, CB, etc.) — bloquearíamos a empresas válidas. Igual
    // para DNI: validar la letra obligaría al usuario a saberse el
    // algoritmo. El admin se hace responsable de meter su propio
    // CIF correcto.
    const taxId = input.fiscal_tax_id.trim().toUpperCase().replace(/[\s\-./()]/g, "");
    const cifFormat = /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[A-Z0-9]$/.test(taxId);
    const dniFormat = /^\d{8}[A-Z]$/.test(taxId);
    const nieFormat = /^[XYZ]\d{7}[A-Z]$/.test(taxId);
    if (!cifFormat && !dniFormat && !nieFormat) {
      errs.push(
        "CIF/NIF de empresa con formato inválido (debe ser CIF tipo A1234567B/J, DNI 12345678X o NIE X1234567L)",
      );
    }
  }

  if (input.fiscal_iban != null && input.fiscal_iban !== "") {
    // IBAN LAXO: aceptamos formato (2 letras + 2 dígitos + 11-30 alfanum)
    // sin obligar a que cuadre el módulo 97. Algunos bancos cambian sus
    // DC al renombrar / fusionar y el algoritmo bloquearía IBANs reales.
    // El admin es responsable de meter el suyo correcto.
    const iban = input.fiscal_iban.trim().toUpperCase().replace(/[\s\-./()]/g, "");
    const okFormat = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
    const okPending = isPendingIban(input.fiscal_iban);
    if (!okFormat && !okPending) {
      errs.push(
        "IBAN con formato inválido (debe empezar por país tipo ES seguido de 22 caracteres, o ES00 si está pendiente)",
      );
    }
  }

  if (input.fiscal_phone != null && input.fiscal_phone !== "") {
    if (!validateSpanishPhone(input.fiscal_phone)) {
      errs.push("Teléfono con formato inválido (móvil/fijo español de 9 dígitos)");
    }
  }

  if (input.fiscal_postal_code != null && input.fiscal_postal_code !== "") {
    if (!validateSpanishPostalCode(input.fiscal_postal_code)) {
      errs.push("Código postal inválido");
    }
  }

  if (input.fiscal_email != null && input.fiscal_email !== "") {
    // Validación básica
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.fiscal_email)) {
      errs.push("Email con formato inválido");
    }
  }

  if (errs.length > 0) {
    throw new Error(errs.join(" · "));
  }
}

export async function updateFiscalSettingsAction(
  input: Partial<FiscalSettings>,
): Promise<{ saved: Partial<FiscalSettings>; skipped: string[] }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  validateFiscalFormat(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Trabajamos sobre una copia mutable del payload
  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    ...input,
  };
  const skipped: string[] = [];

  // UPSERT con onConflict = company_id. Más robusto que SELECT-then-
  // INSERT/UPDATE: evita race conditions y sortea casos donde el
  // SELECT devuelve null por schema cache pero la fila SÍ existe
  // (haciendo que el INSERT tirara por unique constraint).
  for (let i = 0; i < 30; i++) {
    const r = await admin
      .from("company_settings")
      .upsert(payload, { onConflict: "company_id" });
    if (!r.error) break;
    const msg = r.error.message ?? "";
    console.error(`[updateFiscal] upsert attempt ${i} error:`, msg);
    const m =
      msg.match(/column "?([a-z_]+)"? .* does not exist/i) ??
      msg.match(/'([a-z_]+)' column .* schema cache/i) ??
      msg.match(/Could not find the '([a-z_]+)' column/i);
    if (m && m[1] && m[1] in payload && m[1] !== "company_id") {
      skipped.push(m[1]);
      delete payload[m[1]];
      continue;
    }
    throw new Error(`No se pudo guardar: ${msg}`);
  }

  // Verificación post-write: leemos lo que quedó realmente en BD
  // y comparamos con los campos significativos enviados. Si algo
  // que enviamos NO está en la BD tras el upsert, lanzamos error
  // explícito en vez de mentirle al usuario.
  const requested = Object.keys(input).filter((k) => k !== "company_id");
  const { data: verify, error: vErr } = await admin
    .from("company_settings")
    .select(requested.join(", "))
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (vErr) {
    console.error("[updateFiscal] verify SELECT failed:", vErr.message);
  } else if (verify && requested.length > 0) {
    const v = verify as Record<string, unknown>;
    const mismatched: string[] = [];
    for (const k of requested) {
      if (skipped.includes(k)) continue;
      const sent = (input as Record<string, unknown>)[k];
      const got = v[k];
      // Normalizamos null vs "" porque el form puede enviar "" pero la
      // BD lo guarda como NULL.
      const norm = (x: unknown) =>
        x === "" || x === undefined ? null : x;
      if (JSON.stringify(norm(sent)) !== JSON.stringify(norm(got))) {
        console.error(
          `[updateFiscal] mismatch ${k}: sent=`,
          sent,
          "got=",
          got,
        );
        mismatched.push(k);
      }
    }
    if (mismatched.length > 0) {
      throw new Error(
        `Algunos campos no se persistieron correctamente: ${mismatched.join(", ")}. Posible trigger o schema cache. Avisa al admin.`,
      );
    }
  }

  if (skipped.length > 0) {
    throw new Error(
      `Datos guardados parcialmente. Columnas inexistentes en BD: ${skipped.join(", ")}.`,
    );
  }

  revalidatePath("/configuracion/fiscal");
  return { saved: payload as Partial<FiscalSettings>, skipped };
}
