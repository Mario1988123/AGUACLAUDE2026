/**
 * Modelo de equipo del cliente — lógica pura (sin Supabase), con tests.
 * Plan docs/PLAN_MODELO_EQUIPO_CLIENTE.md (decisiones de Mario 12-11).
 *
 * - Solo hay dos tipos: fuente y ósmosis (los dispensadores son fuentes).
 * - Tipo efectivo de un producto: el suyo → el de su gama → el de su categoría
 *   (regla 0: el producto manda, no se mueve nada de categoría).
 * - Variante = producto hijo de la gama (`products.gama_id`, un nivel).
 * - Un equipo está PENDIENTE si lo dice su marca, si no tiene modelo, o si
 *   apunta a una gama que tiene variantes (falta saber cuál).
 */

export type TipoEquipo = "fuente" | "osmosis";
export type AlcanceMantenimiento = "solo_filtros" | "filtros_membrana";

export const TIPO_LABEL: Record<TipoEquipo, string> = {
  fuente: "Fuente",
  osmosis: "Ósmosis",
};

export const ALCANCE_LABEL: Record<AlcanceMantenimiento, string> = {
  solo_filtros: "Solo filtros",
  filtros_membrana: "Filtros + membrana",
};

export function esTipoEquipo(v: unknown): v is TipoEquipo {
  return v === "fuente" || v === "osmosis";
}

export interface ProductoModelo {
  id: string;
  name: string;
  tipo_equipo: TipoEquipo | null;
  gama_id: string | null;
  category_id: string | null;
  rasgos_identificacion: string | null;
  main_image_url: string | null;
  is_active: boolean;
}

export interface CatalogoModelo {
  productos: ProductoModelo[];
  /** category_id → tipo de la categoría. */
  tipoCategoria: Record<string, TipoEquipo | null>;
}

function porId(cat: CatalogoModelo): Map<string, ProductoModelo> {
  return new Map(cat.productos.map((p) => [p.id, p]));
}

/** Tipo efectivo: producto → gama → categoría del producto → categoría de la gama. */
export function tipoEfectivoProducto(
  productId: string | null,
  cat: CatalogoModelo,
): TipoEquipo | null {
  if (!productId) return null;
  const byId = porId(cat);
  const p = byId.get(productId);
  if (!p) return null;
  if (p.tipo_equipo) return p.tipo_equipo;
  const g = p.gama_id ? byId.get(p.gama_id) : undefined;
  if (g?.tipo_equipo) return g.tipo_equipo;
  const tc = p.category_id ? cat.tipoCategoria[p.category_id] : null;
  if (tc) return tc;
  const tg = g?.category_id ? cat.tipoCategoria[g.category_id] : null;
  return tg ?? null;
}

/** Variantes activas de una gama, por nombre. */
export function variantesDe(gamaId: string, cat: CatalogoModelo): ProductoModelo[] {
  return cat.productos
    .filter((p) => p.gama_id === gamaId && p.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Gamas (productos sin gama_id) activas de ese tipo efectivo, por nombre. */
export function gamasDeTipo(tipo: TipoEquipo, cat: CatalogoModelo): ProductoModelo[] {
  return cat.productos
    .filter((p) => !p.gama_id && p.is_active && tipoEfectivoProducto(p.id, cat) === tipo)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export interface EquipoModeloEntrada {
  product_id: string | null;
  external_equipment_model_id: string | null;
  /** undefined = la migración no está aplicada. */
  pendiente_identificar?: boolean | null;
  tipo_equipo?: TipoEquipo | null;
}

export interface EstadoIdentificacion {
  tipo: TipoEquipo | null;
  gama: ProductoModelo | null;
  variante: ProductoModelo | null;
  externo: boolean;
  pendiente: boolean;
  /** Qué falta: el modelo entero, o solo la variante. */
  falta: "modelo" | "variante" | null;
}

export function estadoIdentificacion(
  e: EquipoModeloEntrada,
  cat: CatalogoModelo,
): EstadoIdentificacion {
  const byId = porId(cat);
  if (e.external_equipment_model_id && !e.product_id) {
    return {
      tipo: esTipoEquipo(e.tipo_equipo) ? e.tipo_equipo : null,
      gama: null,
      variante: null,
      externo: true,
      pendiente: false,
      falta: null,
    };
  }
  if (!e.product_id) {
    return {
      tipo: esTipoEquipo(e.tipo_equipo) ? e.tipo_equipo : null,
      gama: null,
      variante: null,
      externo: false,
      pendiente: true,
      falta: "modelo",
    };
  }
  const p = byId.get(e.product_id) ?? null;
  const tipo =
    tipoEfectivoProducto(e.product_id, cat) ?? (esTipoEquipo(e.tipo_equipo) ? e.tipo_equipo : null);
  if (!p) {
    return {
      tipo,
      gama: null,
      variante: null,
      externo: false,
      pendiente: !!e.pendiente_identificar,
      falta: e.pendiente_identificar ? "modelo" : null,
    };
  }
  if (p.gama_id) {
    return {
      tipo,
      gama: byId.get(p.gama_id) ?? null,
      variante: p,
      externo: false,
      pendiente: false,
      falta: null,
    };
  }
  const tieneVariantes = variantesDe(p.id, cat).length > 0;
  const pendiente = tieneVariantes || !!e.pendiente_identificar;
  return {
    tipo,
    gama: p,
    variante: null,
    externo: false,
    pendiente,
    falta: pendiente ? (tieneVariantes ? "variante" : "modelo") : null,
  };
}

/** Texto corto para chips: «Ósmosis · Infinity Direct basic · SMART». */
export function etiquetaModelo(est: EstadoIdentificacion, nombreExterno?: string | null): string {
  const partes: string[] = [];
  partes.push(est.tipo ? TIPO_LABEL[est.tipo] : "Tipo desconocido");
  if (est.externo) {
    partes.push(nombreExterno || "Otra marca");
    return partes.join(" · ");
  }
  if (est.gama) partes.push(est.gama.name);
  if (est.variante) partes.push(est.variante.name);
  if (est.pendiente) partes.push(est.falta === "variante" ? "falta la variante" : "pendiente de identificar");
  return partes.join(" · ");
}

/**
 * Valida el modelo elegido al identificar o corregir. Devuelve el mensaje de
 * error para el usuario o null si vale. Si la gama tiene variantes, solo se
 * acepta una variante (decisión 4: sin «no sé»).
 */
export function validarModeloElegido(
  productId: string,
  cat: CatalogoModelo,
): string | null {
  const p = porId(cat).get(productId);
  if (!p) return "Ese modelo no existe en tu catálogo";
  if (!p.gama_id && variantesDe(p.id, cat).length > 0) {
    return `Elige cuál de las variantes de ${p.name} es`;
  }
  if (!tipoEfectivoProducto(p.id, cat)) {
    return `${p.name} no está marcado como fuente ni como ósmosis`;
  }
  return null;
}

/**
 * Producto del que se leen los filtros (filtros_efectivos): si la variante
 * tiene filtros propios, los suyos (sustituyen, no suman); si no, los de la
 * gama. Para una gama o un producto suelto, él mismo.
 */
export function productoDeFiltros(
  productId: string,
  gamaId: string | null | undefined,
  conFiltrosPropios: (id: string) => boolean,
): string {
  if (!gamaId) return productId;
  return conFiltrosPropios(productId) ? productId : gamaId;
}

/** El alcance es obligatorio solo en ósmosis. */
export function alcanceObligatorio(tipo: TipoEquipo | null): boolean {
  return tipo === "osmosis";
}
