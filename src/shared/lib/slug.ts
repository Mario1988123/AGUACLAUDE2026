/**
 * Convierte un texto humano ("Caudal máximo") a snake_case técnico
 * ("caudal_maximo"). Quita acentos y caracteres especiales. Sirve para
 * generar automáticamente la "key" de un atributo a partir de su label,
 * para que el usuario no tenga que pensar en programación.
 */
export function toSnakeCase(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
