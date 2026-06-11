/**
 * Genera contraseña temporal segura (16 chars con mayús/minús/dígitos/
 * símbolos, asegurando al menos uno de cada). Compartida entre
 * superadmin (crear admin de empresa) y company admin (invitar
 * comerciales/instaladores) para que el flujo sea uniforme.
 *
 * Caracteres ambiguos excluidos (I/O/1/0/l) para que no se confundan
 * al copiarla.
 */
import { randomInt } from "node:crypto";

export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const len = 16;
  // crypto.randomInt: seguro criptográficamente (Math.random NO lo es).
  const pick = (set: string) => set[randomInt(0, set.length)]!;
  const chars: string[] = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(symbols),
  ];
  for (let i = chars.length; i < len; i++) {
    chars.push(pick(all));
  }
  // Shuffle Fisher-Yates con índices criptográficos.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
