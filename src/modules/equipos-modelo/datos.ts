import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import {
  esTipoEquipo,
  estadoIdentificacion,
  etiquetaModelo,
  tipoEfectivoProducto,
  type CatalogoModelo,
  type EstadoIdentificacion,
  type ProductoModelo,
  type TipoEquipo,
} from "./logica";

/**
 * Lecturas del modelo de equipo. TODAS con admin + company_id (regla del
 * proyecto: el técnico no ve products/almacenes por RLS) y TOLERANTES a que la
 * migración 20261113090000_modelo_equipo_cliente.sql no esté aplicada: en ese
 * caso `modeloEquipoDisponible()` da false y la UI esconde la función.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** ¿Está aplicada la migración? (una consulta por petición). */
export const modeloEquipoDisponible = cache(async (): Promise<boolean> => {
  const admin = createAdminClient() as Admin;
  const [a, b, c] = await Promise.all([
    admin.from("customer_equipment").select("pendiente_identificar, tipo_equipo").limit(1),
    admin.from("products").select("gama_id, tipo_equipo, rasgos_identificacion").limit(1),
    admin.from("maintenance_jobs").select("alcance").limit(1),
  ]);
  return !a.error && !b.error && !c.error;
});

/** Catálogo de la empresa (productos no borrados + tipo de categorías). */
export const cargarCatalogoModelo = cache(
  async (companyId: string): Promise<CatalogoModelo> => {
    const admin = createAdminClient() as Admin;
    const disponible = await modeloEquipoDisponible();
    const cols = disponible
      ? "id, name, category_id, main_image_url, is_active, tipo_equipo, gama_id, rasgos_identificacion"
      : "id, name, category_id, main_image_url, is_active";
    const rows = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("products")
          .select(cols)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("name")
          .order("id")
          .range(from, to),
      { label: "catalogo-modelo-equipo" },
    );
    const productos: ProductoModelo[] = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      category_id: (r.category_id as string | null) ?? null,
      main_image_url: (r.main_image_url as string | null) ?? null,
      is_active: r.is_active !== false,
      tipo_equipo: esTipoEquipo(r.tipo_equipo) ? r.tipo_equipo : null,
      gama_id: (r.gama_id as string | null) ?? null,
      rasgos_identificacion: (r.rasgos_identificacion as string | null) ?? null,
    }));
    const tipoCategoria: Record<string, TipoEquipo | null> = {};
    if (disponible) {
      const { data } = await admin
        .from("product_categories")
        .select("id, tipo_equipo")
        .eq("company_id", companyId);
      for (const c of (data ?? []) as Array<{ id: string; tipo_equipo: unknown }>) {
        tipoCategoria[c.id] = esTipoEquipo(c.tipo_equipo) ? c.tipo_equipo : null;
      }
    }
    return { productos, tipoCategoria };
  },
);

/** Solo lo que es equipo principal (tiene tipo efectivo): para los selectores. */
export function catalogoSoloEquipos(cat: CatalogoModelo): CatalogoModelo {
  return {
    tipoCategoria: cat.tipoCategoria,
    productos: cat.productos.filter((p) => tipoEfectivoProducto(p.id, cat) !== null),
  };
}

export interface EquipoConModelo {
  id: string;
  customer_id: string;
  product_id: string | null;
  external_equipment_model_id: string | null;
  address_id: string | null;
  serial_number: string | null;
  is_active: boolean;
  nombre_externo: string | null;
  estado: EstadoIdentificacion;
  etiqueta: string;
}

const COLS_BASE =
  "id, customer_id, product_id, external_equipment_model_id, address_id, serial_number, is_active";

/** Equipos (activos por defecto) de unos clientes, con su estado de identificación. */
export async function cargarEquiposConModelo(
  companyId: string,
  filtro: { customerIds?: string[]; equipoIds?: string[]; incluirInactivos?: boolean },
): Promise<EquipoConModelo[]> {
  const admin = createAdminClient() as Admin;
  const disponible = await modeloEquipoDisponible();
  const cols = disponible ? `${COLS_BASE}, pendiente_identificar, tipo_equipo` : COLS_BASE;
  const ids = filtro.customerIds ?? filtro.equipoIds ?? [];
  if (ids.length === 0) return [];
  const rows: Array<Record<string, unknown>> = [];
  // Tramos de 200 ids para no pasarse de URL.
  for (let i = 0; i < ids.length; i += 200) {
    const tramo = ids.slice(i, i + 200);
    let q = admin.from("customer_equipment").select(cols).eq("company_id", companyId);
    q = filtro.customerIds ? q.in("customer_id", tramo) : q.in("id", tramo);
    if (!filtro.incluirInactivos) q = q.eq("is_active", true);
    const { data, error } = await q.order("created_at").order("id");
    if (error) {
      console.error("[cargarEquiposConModelo]", error.message);
      continue;
    }
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  if (rows.length === 0) return [];
  const cat = await cargarCatalogoModelo(companyId);
  const extIds = Array.from(
    new Set(rows.map((r) => r.external_equipment_model_id as string | null).filter(Boolean)),
  ) as string[];
  const extName = new Map<string, string>();
  if (extIds.length > 0) {
    const { data } = await admin
      .from("external_equipment_models")
      .select("id, brand, model")
      .in("id", extIds);
    for (const e of (data ?? []) as Array<{ id: string; brand: string | null; model: string | null }>) {
      extName.set(e.id, `${e.brand ?? ""} ${e.model ?? ""}`.trim());
    }
  }
  return rows.map((r) => {
    const estado = estadoIdentificacion(
      {
        product_id: (r.product_id as string | null) ?? null,
        external_equipment_model_id: (r.external_equipment_model_id as string | null) ?? null,
        pendiente_identificar: disponible ? Boolean(r.pendiente_identificar) : undefined,
        tipo_equipo: esTipoEquipo(r.tipo_equipo) ? r.tipo_equipo : null,
      },
      cat,
    );
    const nombreExterno = r.external_equipment_model_id
      ? (extName.get(r.external_equipment_model_id as string) ?? null)
      : null;
    return {
      id: String(r.id),
      customer_id: String(r.customer_id),
      product_id: (r.product_id as string | null) ?? null,
      external_equipment_model_id: (r.external_equipment_model_id as string | null) ?? null,
      address_id: (r.address_id as string | null) ?? null,
      serial_number: (r.serial_number as string | null) ?? null,
      is_active: r.is_active !== false,
      nombre_externo: nombreExterno,
      estado,
      etiqueta: etiquetaModelo(estado, nombreExterno),
    };
  });
}

/** Modelos de otra marca disponibles para la empresa (los suyos + globales). */
export async function cargarModelosExternos(
  companyId: string,
): Promise<Array<{ id: string; nombre: string }>> {
  const admin = createAdminClient() as Admin;
  const { data } = await admin
    .from("external_equipment_models")
    .select("id, brand, model, company_id")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("brand")
    .order("model")
    .limit(500);
  return ((data ?? []) as Array<{ id: string; brand: string | null; model: string | null }>).map(
    (e) => ({ id: e.id, nombre: `${e.brand ?? ""} ${e.model ?? ""}`.trim() || "Sin nombre" }),
  );
}

/** Datos que necesita la hoja «Identificar» (se serializan al cliente). */
export interface DatosHojaIdentificar {
  productos: ProductoModelo[];
  tipoCategoria: Record<string, TipoEquipo | null>;
  externos: Array<{ id: string; nombre: string }>;
  equipos: Array<{
    id: string;
    etiqueta: string;
    pendiente: boolean;
    tipo: TipoEquipo | null;
    serial_number: string | null;
  }>;
}

export async function cargarDatosHojaIdentificar(
  companyId: string,
  customerId: string,
): Promise<DatosHojaIdentificar> {
  const [cat, externos, equipos] = await Promise.all([
    cargarCatalogoModelo(companyId),
    cargarModelosExternos(companyId),
    cargarEquiposConModelo(companyId, { customerIds: [customerId] }),
  ]);
  const solo = catalogoSoloEquipos(cat);
  return {
    productos: solo.productos,
    tipoCategoria: solo.tipoCategoria,
    externos,
    equipos: equipos.map((e) => ({
      id: e.id,
      etiqueta: e.etiqueta,
      pendiente: e.estado.pendiente,
      tipo: e.estado.tipo,
      serial_number: e.serial_number,
    })),
  };
}

/** Panel «Modelo de equipo» de la ficha de producto. Null = sin migración. */
export interface PanelModeloProducto {
  producto: {
    id: string;
    name: string;
    tipo_equipo: TipoEquipo | null;
    tipo_efectivo: TipoEquipo | null;
    gama_id: string | null;
    gama_nombre: string | null;
    rasgos_identificacion: string | null;
  };
  categoria: { id: string; name: string; tipo_equipo: TipoEquipo | null } | null;
  /** Productos que pueden ser su gama (sin gama, distintos de él). */
  gamasPosibles: Array<{ id: string; name: string }>;
  /** Si es gama: sus variantes con su stock. */
  variantes: Array<{ id: string; name: string; rasgos: string | null; activo: boolean; stock: number }>;
  stockGama: number;
}

export async function cargarPanelModeloProducto(
  companyId: string,
  productId: string,
): Promise<PanelModeloProducto | null> {
  if (!(await modeloEquipoDisponible())) return null;
  const admin = createAdminClient() as Admin;
  const cat = await cargarCatalogoModelo(companyId);
  const p = cat.productos.find((x) => x.id === productId);
  if (!p) return null;
  const variantes = cat.productos
    .filter((x) => x.gama_id === productId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const ids = [productId, ...variantes.map((v) => v.id)];
  const stock = new Map<string, number>();
  const { data: ws } = await admin
    .from("warehouse_stock")
    .select("product_id, quantity")
    .eq("company_id", companyId)
    .in("product_id", ids);
  for (const s of (ws ?? []) as Array<{ product_id: string; quantity: number | null }>) {
    stock.set(s.product_id, (stock.get(s.product_id) ?? 0) + (s.quantity ?? 0));
  }
  let categoria: PanelModeloProducto["categoria"] = null;
  if (p.category_id) {
    const { data: c } = await admin
      .from("product_categories")
      .select("id, name, tipo_equipo")
      .eq("id", p.category_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (c) {
      const cc = c as { id: string; name: string; tipo_equipo: unknown };
      categoria = { id: cc.id, name: cc.name, tipo_equipo: esTipoEquipo(cc.tipo_equipo) ? cc.tipo_equipo : null };
    }
  }
  const gama = p.gama_id ? cat.productos.find((x) => x.id === p.gama_id) : undefined;
  return {
    producto: {
      id: p.id,
      name: p.name,
      tipo_equipo: p.tipo_equipo,
      tipo_efectivo: tipoEfectivoProducto(p.id, cat),
      gama_id: p.gama_id,
      gama_nombre: gama?.name ?? null,
      rasgos_identificacion: p.rasgos_identificacion,
    },
    categoria,
    gamasPosibles:
      variantes.length > 0
        ? []
        : cat.productos
            .filter((x) => !x.gama_id && x.id !== p.id && x.is_active)
            .map((x) => ({ id: x.id, name: x.name })),
    variantes: variantes.map((v) => ({
      id: v.id,
      name: v.name,
      rasgos: v.rasgos_identificacion,
      activo: v.is_active,
      stock: stock.get(v.id) ?? 0,
    })),
    stockGama: stock.get(productId) ?? 0,
  };
}

/** Ids de las variantes (productos con gama). Vacío si no hay migración. */
export async function idsDeVariantes(companyId: string): Promise<Set<string>> {
  if (!(await modeloEquipoDisponible())) return new Set();
  const cat = await cargarCatalogoModelo(companyId);
  return new Set(cat.productos.filter((p) => p.gama_id).map((p) => p.id));
}

/** variante → gama. Vacío si no hay migración. */
export async function mapaVarianteGama(companyId: string): Promise<Map<string, string>> {
  if (!(await modeloEquipoDisponible())) return new Map();
  const cat = await cargarCatalogoModelo(companyId);
  return new Map(
    cat.productos.filter((p) => p.gama_id).map((p) => [p.id, p.gama_id as string]),
  );
}
