/**
 * Packs con COMPLEMENTO (plan docs/PLAN_HORECA_COMPLEMENTO.md, opción A).
 * Lógica pura, sin Supabase, con tests.
 *
 * Un pack es un equipo principal y lo que cuelga de él (parent_item_id /
 * parent_equipment_id). Lo que cuelga tiene un rol (`pack_role`):
 *   - null          = como hoy (lo existente: se lee como «extra» si cuelga).
 *   - "extra"       = accesorio (grifo, enfriador…).
 *   - "complemento" = el otro equipo del pack: la ósmosis/UF que da el agua a
 *                     un Horeca, o el Horeca de una ósmosis. Va INCLUIDO en el
 *                     precio del principal (sin cuota), suma puntos, y se retira
 *                     y se traspasa con él. Respuestas de Mario del 2026-11-25.
 *
 * Mantenimiento: el Horeca NO tiene mantenimiento propio. Las visitas van a la
 * parte del pack que lo lleva (la ósmosis/UF).
 */

export type PackRole = "extra" | "complemento";

export function esPackRole(v: unknown): v is PackRole {
  return v === "extra" || v === "complemento";
}

/** Rol efectivo de una línea: sin padre no hay rol; con padre, extra salvo complemento. */
export function rolDeLinea(
  parentIndex: number | null | undefined,
  rol: unknown,
): PackRole | null {
  if (parentIndex == null) return null;
  return rol === "complemento" ? "complemento" : "extra";
}

export interface LineaPackEntrada {
  parent_index?: number | null;
  pack_role?: PackRole | null;
  unit_price_cents: number;
}

/**
 * Normaliza las líneas de una propuesta antes de guardar:
 *  - el padre tiene que existir, no ser la propia línea y ser un principal
 *    (un solo nivel); si no, la línea queda suelta;
 *  - el rol se deduce del padre (rolDeLinea);
 *  - el complemento va a precio incluido: su cuota es 0.
 */
export function normalizarLineasPack<T extends LineaPackEntrada>(items: T[]): T[] {
  const padreValido = (i: number, p: number | null | undefined): p is number =>
    p != null &&
    Number.isInteger(p) &&
    p >= 0 &&
    p < items.length &&
    p !== i &&
    items[p]?.parent_index == null;
  return items.map((it, i) => {
    const p = padreValido(i, it.parent_index) ? it.parent_index : null;
    const rol = rolDeLinea(p, it.pack_role);
    return {
      ...it,
      parent_index: p,
      pack_role: rol,
      unit_price_cents: rol === "complemento" ? 0 : it.unit_price_cents,
    };
  });
}

/** Líneas que cuentan para los suelos de precio (el complemento no tiene cuota). */
export function lineasConPrecio<T extends { pack_role?: PackRole | null }>(items: T[]): T[] {
  return items.filter((it) => it.pack_role !== "complemento");
}

// -----------------------------------------------------------------------------
// Compatibilidad (cualquier Horeca con cualquier ósmosis/UF, por categoría)
// -----------------------------------------------------------------------------

export interface InfoComplemento {
  id: string;
  category_id: string | null;
  /** Tipo de equipo efectivo: fuente | osmosis | horeca | null. */
  tipo: string | null;
  /** Claves globales de su categoría y de sus antecesoras. */
  claves: string[];
  /** complementa_keys de esas categorías globales (comodín * al final). */
  complementa_claves: string[];
  /** product_extra_targets con relacion='complemento' de este producto. */
  complemento_de_productos: string[];
  complemento_de_categorias: string[];
}

/** «osmosis*» casa con osmosis y osmosis_compact; sin comodín, igualdad exacta. */
export function claveCoincide(patron: string, clave: string): boolean {
  const p = patron.trim().toLowerCase();
  const c = clave.trim().toLowerCase();
  if (!p || !c) return false;
  if (p.endsWith("*")) return c.startsWith(p.slice(0, -1));
  return p === c;
}

function reglaCategoria(a: InfoComplemento, b: InfoComplemento): boolean {
  return a.complementa_claves.some((pat) => b.claves.some((k) => claveCoincide(pat, k)));
}

function reglaProducto(a: InfoComplemento, b: InfoComplemento): boolean {
  return (
    a.complemento_de_productos.includes(b.id) ||
    (b.category_id != null && a.complemento_de_categorias.includes(b.category_id))
  );
}

/**
 * ¿Pueden ir juntos como principal + complemento? Vale en las dos direcciones.
 * Fuentes, por orden: complementa_keys de la categoría global, reglas
 * product_extra_targets con relacion='complemento' y, mientras no estén
 * sembradas (fase F1), el tipo de equipo: horeca ↔ osmosis.
 */
export function sonComplementarios(
  a: InfoComplemento | null | undefined,
  b: InfoComplemento | null | undefined,
): boolean {
  if (!a || !b || a.id === b.id) return false;
  if (reglaCategoria(a, b) || reglaCategoria(b, a)) return true;
  if (reglaProducto(a, b) || reglaProducto(b, a)) return true;
  return (
    (a.tipo === "horeca" && b.tipo === "osmosis") ||
    (a.tipo === "osmosis" && b.tipo === "horeca")
  );
}

/** Texto del botón que ofrece el complemento según lo que se haya elegido primero. */
export function textoOfertaComplemento(tipoPrincipal: string | null | undefined): string {
  if (tipoPrincipal === "horeca") return "Añade el equipo que da el agua (ósmosis / UF)";
  if (tipoPrincipal === "osmosis") return "Equipo complementario: Horeca";
  return "Equipo complementario";
}

/** Etiqueta de una parte del pack en la ficha del cliente. */
export function etiquetaParteDelPack(rol: PackRole | null | undefined): string {
  return rol === "complemento" ? "Equipo complementario" : "Extra del pack";
}

// -----------------------------------------------------------------------------
// Mantenimiento: qué parte del pack lo lleva
// -----------------------------------------------------------------------------

export interface EquipoCandidatoMant {
  id: string;
  parent_equipment_id: string | null;
  pack_role: PackRole | null;
  /** Tipo efectivo: fuente | osmosis | horeca | null (desconocido). */
  tipo: string | null;
}

/** El Horeca no lleva mantenimiento propio (Mario 2026-11-25). */
export function tipoSinMantenimiento(tipo: string | null | undefined): boolean {
  return tipo === "horeca";
}

/** ¿Esta parte recibe las visitas? Ni el Horeca ni los extras. */
export function llevaMantenimiento(e: EquipoCandidatoMant): boolean {
  if (tipoSinMantenimiento(e.tipo)) return false;
  if (e.pack_role === "complemento") return true;
  return e.parent_equipment_id == null && e.pack_role !== "extra";
}

/**
 * Equipo del que se cuelgan las visitas de un contrato o instalación:
 *  1. una parte que lleva mantenimiento con tipo conocido (ósmosis/fuente),
 *  2. si no, cualquier parte que lo lleve,
 *  3. si no hay ninguna pero hay algo que no sea Horeca, el primero de ellos
 *     (comportamiento de antes: un extra huérfano mejor que nada),
 *  4. si todo es Horeca: ninguno, y `sinMantenimiento` = true (no se crean
 *     visitas).
 * Sin candidatos: id null y se crean como hasta ahora (sin equipo).
 */
export function elegirEquipoMantenimiento(
  candidatos: EquipoCandidatoMant[],
): { id: string | null; sinMantenimiento: boolean } {
  if (candidatos.length === 0) return { id: null, sinMantenimiento: false };
  const lleva = candidatos.filter(llevaMantenimiento);
  const conTipo = lleva.find((e) => e.tipo === "osmosis" || e.tipo === "fuente");
  if (conTipo) return { id: conTipo.id, sinMantenimiento: false };
  if (lleva[0]) return { id: lleva[0].id, sinMantenimiento: false };
  const noHoreca = candidatos.find((e) => !tipoSinMantenimiento(e.tipo));
  if (noHoreca) return { id: noHoreca.id, sinMantenimiento: false };
  return { id: null, sinMantenimiento: true };
}

/**
 * Periodicidad del contrato: la de la línea que lleva el mantenimiento (no la
 * del primer producto con mantenimiento, que podía ser el Horeca).
 */
export function lineaQueLlevaMantenimiento<
  T extends {
    maintenance_included: boolean;
    pack_role?: PackRole | null;
    parent_item_id?: string | null;
    tipo?: string | null;
  },
>(lineas: T[]): T | null {
  // Datos de siempre (sin complemento ni Horeca): exactamente como antes,
  // la primera línea con mantenimiento.
  const hayPackNuevo = lineas.some(
    (l) => l.pack_role === "complemento" || tipoSinMantenimiento(l.tipo),
  );
  if (!hayPackNuevo) return lineas.find((l) => l.maintenance_included) ?? null;
  // Cuelga de otra línea y no es complemento => es un extra.
  const esExtra = (l: T) =>
    l.pack_role === "extra" || (l.parent_item_id != null && l.pack_role !== "complemento");
  const validas = lineas.filter(
    (l) => l.maintenance_included && !tipoSinMantenimiento(l.tipo) && !esExtra(l),
  );
  return (
    validas.find((l) => l.tipo === "osmosis" || l.tipo === "fuente") ??
    validas[0] ??
    lineas.find((l) => l.maintenance_included && !tipoSinMantenimiento(l.tipo)) ??
    null
  );
}

// -----------------------------------------------------------------------------
// Retirada, baja y traspaso: el pack con complemento va entero
// -----------------------------------------------------------------------------

export interface FilaPack {
  id: string;
  parent_equipment_id: string | null;
  pack_role: PackRole | null;
}

/**
 * Amplía una selección de equipos con las otras partes de su pack cuando el
 * pack tiene complemento: si se elige el principal o el complemento, va el
 * principal y TODO lo que cuelga de él (complementos y extras), igual que la
 * baja (removeCustomerEquipmentAction) arrastra los hijos del principal. Un
 * extra elegido solo se queda solo, también como en la baja. Los packs sin complemento no se tocan (comportamiento de hoy).
 * Conserva el orden y no duplica.
 */
export function idsPackCompleto(ids: string[], filas: FilaPack[]): string[] {
  const porId = new Map(filas.map((f) => [f.id, f]));
  const salida: string[] = [];
  const meter = (id: string) => {
    if (!salida.includes(id)) salida.push(id);
  };
  const tieneComplemento = (raiz: string) =>
    filas.some((h) => h.parent_equipment_id === raiz && h.pack_role === "complemento");
  for (const id of ids) {
    meter(id);
    const f = porId.get(id);
    // Un extra suelto se retira solo, como en la baja (que solo arrastra
    // desde el principal). El principal y el complemento arrastran el pack.
    if (f?.parent_equipment_id && f.pack_role !== "complemento") continue;
    const raiz = f?.parent_equipment_id ?? id;
    if (!tieneComplemento(raiz)) continue;
    if (porId.has(raiz)) meter(raiz);
    for (const h of filas) {
      if (h.parent_equipment_id === raiz) meter(h.id);
    }
  }
  return salida;
}

/**
 * El servidor no se fía del rol que manda el navegador: un «complemento» solo
 * vale si la migración está aplicada (`disponible`) y si de verdad es
 * compatible con su principal. Si no, baja a «extra» y CONSERVA su precio.
 * Hay que llamarla ANTES de normalizarLineasPack (que pone el 0).
 */
export function validarComplementos<
  T extends { product_id: string; parent_index?: number | null; pack_role?: PackRole | null },
>(
  items: T[],
  disponible: boolean,
  compatibles: (padreProductId: string, hijoProductId: string) => boolean,
): T[] {
  return items.map((it) => {
    if (it.pack_role !== "complemento") return it;
    const padre = it.parent_index != null ? items[it.parent_index] : undefined;
    const ok = disponible && !!padre && compatibles(padre.product_id, it.product_id);
    return ok ? it : { ...it, pack_role: "extra" as PackRole };
  });
}

/**
 * Alta documental de un pack con complemento: la parte que lleva las fechas y
 * la periodicidad del mantenimiento. Si el principal es un Horeca, se las
 * queda el complemento (la ósmosis/UF).
 */
export function parteConMantenimiento(
  tipoPrincipal: string | null | undefined,
  hayComplemento: boolean,
): "principal" | "complemento" {
  return hayComplemento && tipoSinMantenimiento(tipoPrincipal) ? "complemento" : "principal";
}

/**
 * Partes del pack con complemento que NO se han elegido y que irían si se
 * retira el pack entero. Vacío = la selección ya es el pack completo o no hay
 * pack con complemento. Mario 2026-11-28: una parte puede retirarse sola
 * («pueden entrar por partes, no todo el pack»), así que esto solo sirve para
 * avisar y dejar elegir entre «solo esta parte» y «el pack entero».
 */
export function partesDelPackNoElegidas(ids: string[], filas: FilaPack[]): string[] {
  const elegidos = ids.map((x) => x.toLowerCase());
  const normal = filas.map((f) => ({
    id: f.id.toLowerCase(),
    parent_equipment_id: f.parent_equipment_id ? f.parent_equipment_id.toLowerCase() : null,
    pack_role: f.pack_role,
  }));
  return idsPackCompleto(elegidos, normal).filter((id) => !elegidos.includes(id));
}
