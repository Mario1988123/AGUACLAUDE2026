import "server-only";

import { decryptString, encryptString } from "@/shared/lib/crypto/aes-gcm";

/**
 * Las columnas `company_settings.external_invoicing_*_encrypted` son BYTEA.
 * Antes se escribía el base64 de encryptString() a pelo: Postgres guarda los
 * bytes ASCII de ese texto y PostgREST lo devuelve como "\x6162…" (hex), que
 * decryptString() no sabía leer → la API key guardada era ilegible.
 *
 * Ahora se escribe en hex explícito ("\x" + hex del base64) y se lee
 * aceptando las dos formas (hex de PostgREST o base64 directo).
 */
export function cifrarParaBytea(texto: string): string {
  const b64 = encryptString(texto);
  return "\\x" + Buffer.from(b64, "utf-8").toString("hex");
}

export function descifrarDeBytea(valor: unknown): string {
  if (typeof valor !== "string" || !valor) {
    throw new Error("Credencial cifrada vacía o con formato desconocido");
  }
  const b64 = valor.startsWith("\\x")
    ? Buffer.from(valor.slice(2), "hex").toString("utf-8")
    : valor;
  return decryptString(b64);
}
