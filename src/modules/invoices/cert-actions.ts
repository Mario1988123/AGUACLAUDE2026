"use server";

import { revalidatePath } from "next/cache";
import forge from "node-forge";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  encryptBuffer,
  encryptString,
  isMasterKeyConfigured,
} from "@/shared/lib/crypto/aes-gcm";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede gestionar el certificado");
  }
  return session;
}

export interface CertInfo {
  alias: string;
  subject: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
  serial_number: string;
  expires_in_days: number;
}

/**
 * Sube y cifra el certificado FNMT (.p12 o .pfx) de la empresa.
 *
 * Flujo:
 *  1. Recibe el archivo .p12 + password de protección.
 *  2. Lo parsea con node-forge para validar que es válido y extraer
 *     metadata (alias, subject, issuer, fechas).
 *  3. Cifra el contenido binario completo con AES-256-GCM.
 *  4. Cifra el password con AES-256-GCM.
 *  5. Persiste en company_settings.
 *
 * El certificado SOLO se descifra dentro del cron de envío AEAT, nunca
 * se devuelve al cliente.
 */
export async function uploadCertificateAction(
  formData: FormData,
): Promise<{ success: true; info: CertInfo }> {
  const session = await ensureAdmin();
  if (!isMasterKeyConfigured()) {
    throw new Error(
      "VERIFACTU_MASTER_KEY no configurada en el servidor. Pide al equipo técnico que la añada antes de subir el certificado.",
    );
  }

  const file = formData.get("file");
  const password = String(formData.get("password") ?? "");
  if (!(file instanceof Blob))
    throw new Error("Archivo no recibido. Selecciona un .p12 o .pfx.");
  if (!password.trim())
    throw new Error("Password del certificado obligatorio.");
  if (file.size > 200 * 1024) {
    throw new Error("El certificado parece demasiado grande (máx 200 KB).");
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  // Parse PKCS#12
  let info: CertInfo;
  try {
    const p12Asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(fileBuffer.toString("binary")),
    );
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Extraer el primer certificado (cliente)
    const certOid = forge.pki.oids.certBag as string;
    const certBags = p12.getBags({ bagType: certOid });
    const certBag = certBags[certOid]?.[0];
    if (!certBag || !certBag.cert) {
      throw new Error("El archivo no contiene certificado válido.");
    }
    const cert = certBag.cert;
    const subject = cert.subject.attributes
      .map((a) => `${a.shortName ?? a.name}=${a.value}`)
      .join(", ");
    const issuer = cert.issuer.attributes
      .map((a) => `${a.shortName ?? a.name}=${a.value}`)
      .join(", ");

    const validTo = cert.validity.notAfter;
    const expiresInDays = Math.floor(
      (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    if (expiresInDays < 0) {
      throw new Error(
        `El certificado caducó el ${validTo.toLocaleDateString("es-ES")}. Renuévalo en sede FNMT.`,
      );
    }

    // Alias: CN del subject o el primer atributo legible
    const cn = cert.subject.getField("CN");
    const alias = (cn?.value as string) ?? subject.slice(0, 100);

    info = {
      alias,
      subject,
      issuer,
      valid_from: cert.validity.notBefore.toISOString(),
      valid_to: validTo.toISOString(),
      serial_number: cert.serialNumber,
      expires_in_days: expiresInDays,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/MAC|Invalid|password/i.test(msg)) {
      throw new Error(
        "Password incorrecto o archivo .p12 corrupto. Verifica los datos.",
      );
    }
    throw new Error(`No se pudo leer el certificado: ${msg}`);
  }

  // Cifrar contenido + password
  const certEncrypted = encryptBuffer(fileBuffer);
  const passwordEncrypted = encryptString(password);

  // Persistir
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();

  const payload = {
    verifactu_cert_alias: info.alias,
    verifactu_cert_encrypted: certEncrypted,
    verifactu_cert_password_encrypted: passwordEncrypted,
    verifactu_cert_expires_at: info.valid_to.slice(0, 10),
  };

  if (existing) {
    const { error } = await admin
      .from("company_settings")
      .update(payload)
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("company_settings")
      .insert({ company_id: session.company_id, ...payload });
    if (error) throw new Error(error.message);
  }

  // Audit log Verifactu
  try {
    await admin.from("invoice_verifactu_events").insert({
      company_id: session.company_id,
      event_type: "config_change",
      severity: "info",
      payload: {
        field: "certificate_uploaded",
        alias: info.alias,
        expires_at: info.valid_to,
      },
      user_id: session.user_id,
    });
  } catch {
    /* fail-soft */
  }

  revalidatePath("/configuracion/facturacion");
  return { success: true, info };
}

/**
 * Elimina el certificado almacenado (no se puede recuperar).
 */
export async function deleteCertificateAction(): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("company_settings")
    .update({
      verifactu_cert_alias: null,
      verifactu_cert_encrypted: null,
      verifactu_cert_password_encrypted: null,
      verifactu_cert_expires_at: null,
      verifactu_mode: "no_envio", // forzar a no_envio para no quedarse colgado
    })
    .eq("company_id", session.company_id);

  try {
    await admin.from("invoice_verifactu_events").insert({
      company_id: session.company_id,
      event_type: "config_change",
      severity: "warning",
      payload: { field: "certificate_deleted" },
      user_id: session.user_id,
    });
  } catch {
    /* fail-soft */
  }

  revalidatePath("/configuracion/facturacion");
}

// =================== Safe wrappers ===================

export async function uploadCertificateSafeAction(
  formData: FormData,
): Promise<{ ok: true; info: CertInfo } | { ok: false; error: string }> {
  try {
    const r = await uploadCertificateAction(formData);
    return { ok: true, info: r.info };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteCertificateSafeAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    await deleteCertificateAction();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
