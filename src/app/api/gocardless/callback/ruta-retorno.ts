/**
 * Validación del `return_path` del callback de GoCardless (auditoría
 * 2026-10-01, I20). Solo se aceptan rutas internas relativas: empiezan por
 * una única "/" seguida de algo que no sea "/" ni "\" (así se rechazan
 * "//evil.com", "/\evil.com" y URLs absolutas). Tampoco se aceptan
 * caracteres de control (un "\t" o "\n" en medio los ignora el parser de URL).
 */
export const RUTA_RETORNO_POR_DEFECTO = "/clientes";

export function rutaRetornoSegura(valor: string | null | undefined): string {
  if (!valor) return RUTA_RETORNO_POR_DEFECTO;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(valor)) return RUTA_RETORNO_POR_DEFECTO;
  if (!/^\/[^/\\]/.test(valor)) return RUTA_RETORNO_POR_DEFECTO;
  return valor;
}

/** Une la ruta de retorno con un parámetro de query respetando un "?" previo. */
export function conParametro(ruta: string, clave: string, valor: string): string {
  const sep = ruta.includes("?") ? "&" : "?";
  return `${ruta}${sep}${encodeURIComponent(clave)}=${encodeURIComponent(valor)}`;
}
