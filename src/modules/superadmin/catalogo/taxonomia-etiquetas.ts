/**
 * Etiquetas y utilidades de las pestañas «Categorías» y «Atributos».
 * Sin "server-only": lo leen los componentes de cliente.
 */

/** Enum app.product_kind (20260501121100_products.sql). */
export const TIPOS_PRODUCTO: Array<{ valor: string; label: string }> = [
  { valor: "equipment", label: "Equipo" },
  { valor: "spare_part", label: "Recambio" },
  { valor: "consumable", label: "Consumible" },
  { valor: "accessory", label: "Accesorio" },
  { valor: "service", label: "Servicio" },
];

/** Enum app.attribute_data_type. */
export const TIPOS_DATO: Array<{ valor: string; label: string }> = [
  { valor: "text", label: "Texto" },
  { valor: "number", label: "Número" },
  { valor: "boolean", label: "Sí / No" },
  { valor: "enum", label: "Lista de valores" },
  { valor: "dimension", label: "Medida" },
  { valor: "date", label: "Fecha" },
];

/** CHECK product_attributes_global_grupo_check. Null se pinta en «Técnicas». */
export const GRUPOS_ATRIBUTO: Array<{
  valor: "fisicas" | "electricas" | "tecnicas" | "extra";
  label: string;
}> = [
  { valor: "fisicas", label: "Físicas" },
  { valor: "electricas", label: "Eléctricas" },
  { valor: "tecnicas", label: "Técnicas" },
  { valor: "extra", label: "Extra" },
];

export function etiquetaTipoProducto(v: string): string {
  return TIPOS_PRODUCTO.find((t) => t.valor === v)?.label ?? v;
}

export function etiquetaTipoDato(v: string): string {
  return TIPOS_DATO.find((t) => t.valor === v)?.label ?? v;
}

/** «Ósmosis inversa» → «osmosis_inversa». Para proponer la clave al crear. */
export function claveDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export const RE_CLAVE = /^[A-Za-z0-9_-]{2,60}$/;

/** Clase común de los <select> nativos (text-base en móvil: evita el zoom de iOS). */
export const CLASE_SELECT =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm disabled:opacity-60";

export function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString("es-ES")} ${n === 1 ? uno : varios}`;
}
