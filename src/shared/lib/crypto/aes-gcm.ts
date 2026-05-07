/**
 * Cifrado AES-256-GCM con clave maestra de entorno.
 * Usado para guardar el certificado FNMT (.p12) y su password en BD.
 *
 * Formato del payload cifrado: [12 bytes IV][16 bytes tag][N bytes ciphertext]
 * concatenados en un único Buffer.
 *
 * Clave maestra: variable de entorno `VERIFACTU_MASTER_KEY` (64 hex chars
 * = 32 bytes). Configurar en Vercel → Environment Variables.
 *
 * Si la clave maestra no está configurada, las funciones lanzan error
 * claro en lugar de fallar silenciosamente.
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recomendado
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const hex = process.env.VERIFACTU_MASTER_KEY;
  if (!hex) {
    throw new Error(
      "VERIFACTU_MASTER_KEY no configurada en variables de entorno. Genera una con `openssl rand -hex 32` y añádela en Vercel.",
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      "VERIFACTU_MASTER_KEY debe ser exactamente 64 caracteres hex (32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Cifra un buffer con AES-256-GCM. Devuelve `[IV][tag][ciphertext]`.
 */
export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  const key = getMasterKey();
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Cifra un string (UTF-8) y devuelve la representación base64. */
export function encryptString(plaintext: string): string {
  return encryptBuffer(Buffer.from(plaintext, "utf-8")).toString("base64");
}

/** Descifra una cadena base64 a string UTF-8. */
export function decryptString(payloadBase64: string): string {
  return decryptBuffer(Buffer.from(payloadBase64, "base64")).toString("utf-8");
}

/**
 * Comprueba si la clave maestra está configurada (sin lanzar).
 * Útil para mostrar warning en UI antes de pedirle al usuario que suba
 * el certificado.
 */
export function isMasterKeyConfigured(): boolean {
  const hex = process.env.VERIFACTU_MASTER_KEY;
  return Boolean(hex && hex.length === 64);
}
