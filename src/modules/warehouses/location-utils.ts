/**
 * Compone el código compacto de ubicación a partir de estantería/altura/hueco.
 * Si los 3 son de un solo carácter se concatenan ("2", "2", "C" → "22C");
 * si alguno es más largo, se separan con guion para evitar ambigüedad
 * ("10", "A", "3" → "10-A-3").
 */
export function composeLocationCode(
  shelf: string | null | undefined,
  level: string | null | undefined,
  slot: string | null | undefined,
): string {
  const parts = [shelf, level, slot]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const allShort = parts.every((p) => p.length <= 1);
  return allShort ? parts.join("") : parts.join("-");
}
