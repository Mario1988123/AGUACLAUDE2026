import "server-only";
import crypto from "node:crypto";
import { serverEnv } from "@/shared/lib/env";

/**
 * Cifrado/descifrado simétrico AES-256-GCM para secretos guardados en BD
 * (principalmente contraseñas SMTP). La clave vive en process.env.ENCRYPTION_KEY
 * (32 bytes en hex, 64 caracteres) y NO se commitea.
 *
 * Formato de salida (string compacto, fácil de guardar en una columna text):
 *   v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * - v1 → versión del esquema. Si en el futuro cambiamos algoritmo, podemos
 *        coexistir leyendo "v1:" o "v2:" sin migración masiva.
 * - iv  → 12 bytes aleatorios (NUNCA reutilizar con la misma clave).
 * - authTag → 16 bytes que garantizan integridad (impiden modificaciones).
 * - ciphertext → utf-8 cifrado.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1";

function getKey(): Buffer {
  const env = serverEnv();
  const hex = env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY no configurada. Genera con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" y añádela a .env.local y a Vercel.",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(encrypted: string | null | undefined): string {
  if (!encrypted) return "";
  const parts = encrypted.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Formato de secreto cifrado inválido o versión desconocida");
  }
  const [, ivPart, tagPart, ctPart] = parts as [string, string, string, string];
  const key = getKey();
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(ctPart, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Helper: enmascarar para mostrar en UI sin revelar la real. */
export function maskSecret(encrypted: string | null | undefined): string {
  return encrypted ? "••••••••" : "";
}
