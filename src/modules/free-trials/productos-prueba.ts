/**
 * Qué productos se pueden elegir en una prueba gratuita (Mario 2026-11-26).
 *
 * El admin marca cada producto con un clic en su ficha («Disponible en prueba
 * gratuita»), que guarda el rol `free_trial_role` en `products.roles`. El
 * selector de la prueba solo ofrece los marcados.
 *
 * Mientras la empresa no haya marcado NINGUNO se ofrecen todos (si no, nadie
 * podría crear pruebas hasta que el admin pase por las fichas); la pantalla
 * avisa de que falta marcarlos.
 *
 * Lógica pura, sin BD: se prueba en productos-prueba.test.ts.
 */

export const ROL_PRUEBA_GRATUITA = "free_trial_role";

/** ¿Lleva el producto la marca de prueba gratuita? */
export function esDePruebaGratuita(roles: readonly string[] | null | undefined): boolean {
  return !!roles?.includes(ROL_PRUEBA_GRATUITA);
}

/** Devuelve los roles con la marca puesta o quitada, sin duplicar ni tocar los demás. */
export function conMarcaPrueba(
  roles: readonly string[] | null | undefined,
  marcar: boolean,
): string[] {
  const sin = (roles ?? []).filter((r) => r !== ROL_PRUEBA_GRATUITA);
  return marcar ? [...sin, ROL_PRUEBA_GRATUITA] : sin;
}

/**
 * Filtra las opciones del selector. `marcados` son los ids de la empresa con
 * la marca. Si no hay ninguno, devuelve todos y `hayMarcados: false`.
 */
export function productosParaPrueba<T extends { id: string }>(
  todos: readonly T[],
  marcados: ReadonlySet<string>,
): { productos: T[]; hayMarcados: boolean } {
  if (marcados.size === 0) return { productos: [...todos], hayMarcados: false };
  return { productos: todos.filter((p) => marcados.has(p.id)), hayMarcados: true };
}

/**
 * Para el servidor: ids pedidos que NO se pueden usar en prueba. Vacío si
 * todos valen o si la empresa aún no ha marcado ninguno.
 */
export function productosNoPermitidos(
  pedidos: readonly string[],
  marcados: ReadonlySet<string>,
): string[] {
  if (marcados.size === 0) return [];
  return Array.from(new Set(pedidos.filter((id) => !marcados.has(id))));
}
