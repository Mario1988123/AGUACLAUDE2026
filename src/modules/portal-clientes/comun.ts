// =============================================================================
// Portal de clientes — utilidades sin dependencias de servidor ni de cliente.
// =============================================================================

import { randomInt } from "node:crypto";
import {
  isPlaceholderTaxId,
  validateCIF,
  validateDNIorNIE,
} from "@/shared/lib/validations/spanish";

/** DNI/NIE/CIF en mayúsculas, sin espacios, puntos ni guiones. */
export function normalizarDni(valor: string | null | undefined): string {
  return (valor ?? "").trim().toUpperCase().replace(/[\s.\-]/g, "");
}

/**
 * ¿Sirve este documento como usuario del portal? Tiene que ser un DNI, NIE o
 * CIF válido y no el DNI comodín de venta al contado (se repite en muchos
 * clientes).
 */
export function dniValidoParaPortal(valor: string | null | undefined): boolean {
  const v = normalizarDni(valor);
  if (!v || isPlaceholderTaxId(v)) return false;
  if (!/^[A-Z0-9]{8,10}$/.test(v)) return false;
  return validateDNIorNIE(v).valid || validateCIF(v);
}

/**
 * Contraseña para el cliente: tres bloques de cuatro separados por guiones
 * (p. ej. «Kx7m-Qp4r-Zt9w»). Fácil de dictar por teléfono y de copiar; sin
 * caracteres que se confunden (I/l/1, O/0). 12 caracteres aleatorios ≈ 70 bits.
 */
export function generarClavePortal(): string {
  const mayus = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const minus = "abcdefghjkmnpqrstuvwxyz";
  const digitos = "23456789";
  const todos = mayus + minus + digitos;
  const elegir = (set: string) => set[randomInt(0, set.length)]!;
  const chars = [elegir(mayus), elegir(minus), elegir(digitos)];
  while (chars.length < 12) chars.push(elegir(todos));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Email interno del usuario de Auth. No recibe correo: solo identifica. */
export function emailSinteticoPortal(cuentaId: string): string {
  return `cliente-${cuentaId}@clientes.hidromanager.es`;
}

/** Intentos fallidos antes de bloquear y minutos de bloqueo. */
export const PORTAL_MAX_INTENTOS = 5;
export const PORTAL_MINUTOS_BLOQUEO = 15;
