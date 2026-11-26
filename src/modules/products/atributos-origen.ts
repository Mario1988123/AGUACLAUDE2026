/**
 * ¿Está la columna `product_attribute_values.origen`? (migración
 * 20261129110000, aditiva y quizá aún sin aplicar). Módulo PLANO: recibe el
 * cliente por parámetro.
 *
 * Solo se recuerda el «sí»: mientras la migración no esté, se vuelve a mirar
 * (una consulta de cabecera, barata) y en cuanto se aplique se empieza a usar
 * sin redesplegar.
 */

let confirmada = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function hayColumnaOrigen(client: any): Promise<boolean> {
  if (confirmada) return true;
  const { error } = await client
    .from("product_attribute_values")
    .select("origen", { head: true, count: "exact" })
    .limit(1);
  if (!error) {
    confirmada = true;
    return true;
  }
  return false;
}
