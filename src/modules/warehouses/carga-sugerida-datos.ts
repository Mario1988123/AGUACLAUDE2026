import "server-only";

import { rangoDiaMadridUtc } from "@/modules/scheduling/fechas-madrid";
import { productoDeFiltros } from "@/modules/equipos-modelo/logica";
import {
  calcularCargaSugerida,
  claveArticulo,
  esMomentoCarga,
  filtrosDeMantenimiento,
  resolverReserva,
  type AsignacionFiltro,
  type CantidadArticulo,
  type MomentoCarga,
  type TipoArticulo,
} from "./carga-sugerida-logica";
import { esTablaQueFalta, filtrosEnAlmacen } from "./filtros-carga";

/**
 * Datos de la carga sugerida (servidor). Todo con admin + company_id + el
 * técnico: lo usan la pantalla «Mi furgoneta» y el cron de la tarde.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Nota con la que se marcan las órdenes que salen de la sugerencia. */
export const NOTA_SUGERENCIA = "Sugerencia de carga";

export const ESTADOS_ABIERTOS = ["requested", "preparing", "prepared", "in_transit"] as const;

export interface Furgoneta {
  id: string;
  nombre: string;
}

export async function leerFurgonetaDe(admin: Admin, companyId: string, userId: string): Promise<Furgoneta | null> {
  const { data } = await admin
    .from("warehouses")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("kind", "vehicle")
    .eq("assigned_user_id", userId)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const w = data as { id: string; name: string };
  return { id: w.id, nombre: w.name };
}

/** Almacén de origen: el principal (o el primer secundario), como en «Registrar carga». */
export async function leerAlmacenOrigen(admin: Admin, companyId: string): Promise<Furgoneta | null> {
  const { data } = await admin
    .from("warehouses")
    .select("id, name, kind")
    .eq("company_id", companyId)
    .in("kind", ["main", "secondary"])
    .is("deleted_at", null)
    .order("kind")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const w = data as { id: string; name: string };
  return { id: w.id, nombre: w.name };
}

export interface PreferenciaCarga {
  momento: MomentoCarga;
  sugerencia_auto: boolean;
  /** false = la migración no está aplicada: no se puede guardar. */
  disponible: boolean;
}

export async function leerPreferencia(admin: Admin, companyId: string, userId: string): Promise<PreferenciaCarga> {
  const { data, error } = await admin
    .from("preferencias_carga_tecnico")
    .select("momento, sugerencia_auto")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { momento: "tarde", sugerencia_auto: false, disponible: false };
  const p = data as { momento: string; sugerencia_auto: boolean } | null;
  return {
    momento: p && esMomentoCarga(p.momento) ? p.momento : "tarde",
    sugerencia_auto: !!p?.sugerencia_auto,
    disponible: true,
  };
}

async function productosNuevosEn(admin: Admin, companyId: string, warehouseId: string): Promise<Map<string, number>> {
  const { data } = await admin
    .from("warehouse_stock")
    .select("product_id, quantity")
    .eq("company_id", companyId)
    .eq("warehouse_id", warehouseId)
    .eq("state", "new")
    .gt("quantity", 0)
    .limit(1000);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ product_id: string; quantity: number }>) {
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + (r.quantity ?? 0));
  }
  return m;
}

/** Reserva de la empresa (warehouse_id null) y la propia de la furgoneta. */
export async function leerReserva(
  admin: Admin,
  companyId: string,
  furgonetaId: string,
): Promise<{ reserva: Map<string, CantidadArticulo>; definida: boolean }> {
  const { data, error } = await admin
    .from("reservas_furgoneta")
    .select("warehouse_id, product_id, filter_id, cantidad")
    .eq("company_id", companyId)
    .or(`warehouse_id.is.null,warehouse_id.eq.${furgonetaId}`)
    .limit(1000);
  if (error) {
    if (!esTablaQueFalta(error)) console.error("[leerReserva]", error.message);
    return { reserva: new Map(), definida: false };
  }
  const filas = (data ?? []) as Array<{
    warehouse_id: string | null;
    product_id: string | null;
    filter_id: string | null;
    cantidad: number;
  }>;
  const aArticulo = (r: (typeof filas)[number]): CantidadArticulo =>
    r.product_id
      ? { tipo: "producto", id: r.product_id, cantidad: r.cantidad }
      : { tipo: "filtro", id: r.filter_id as string, cantidad: r.cantidad };
  const reserva = resolverReserva(
    filas.filter((r) => !r.warehouse_id).map(aArticulo),
    filas.filter((r) => r.warehouse_id).map(aArticulo),
  );
  return { reserva, definida: filas.length > 0 };
}

export interface LineaVista {
  tipo: TipoArticulo;
  id: string;
  nombre: string;
  referencia: string | null;
  aCargar: number;
  paraTrabajos: number;
  paraReserva: number;
  /** Hay algo en el almacén de origen (sin cifras, como en «Registrar carga»). */
  hayEnAlmacen: boolean;
}

export interface SugerenciaCarga {
  dia: string;
  furgoneta: Furgoneta;
  origen: Furgoneta;
  lineas: LineaVista[];
  /** Lo que lleva de más sobre trabajos + reserva (solo si hay reserva). Sin cifras. */
  sobrantes: Array<{ tipo: TipoArticulo; id: string; nombre: string }>;
  trabajos: { instalaciones: number; mantenimientos: number };
  avisos: string[];
  reservaDefinida: boolean;
}

export async function nombresDeArticulos(
  admin: Admin,
  companyId: string,
  articulos: Array<{ tipo: TipoArticulo; id: string }>,
): Promise<Map<string, { nombre: string; referencia: string | null }>> {
  const m = new Map<string, { nombre: string; referencia: string | null }>();
  const pIds = Array.from(new Set(articulos.filter((a) => a.tipo === "producto").map((a) => a.id)));
  const fIds = Array.from(new Set(articulos.filter((a) => a.tipo === "filtro").map((a) => a.id)));
  const [pr, fr] = await Promise.all([
    pIds.length
      ? admin.from("products").select("id, name, internal_reference").eq("company_id", companyId).in("id", pIds)
      : Promise.resolve({ data: [] }),
    fIds.length
      ? admin.from("product_filters").select("id, name, internal_reference").eq("company_id", companyId).in("id", fIds)
      : Promise.resolve({ data: [] }),
  ]);
  for (const p of (pr.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>) {
    m.set(claveArticulo({ tipo: "producto", id: p.id }), { nombre: p.name, referencia: p.internal_reference });
  }
  for (const f of (fr.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>) {
    m.set(claveArticulo({ tipo: "filtro", id: f.id }), { nombre: f.name, referencia: f.internal_reference });
  }
  return m;
}

/** Necesidad de los trabajos del técnico ese día (instalaciones + mantenimientos). */
async function necesidadDelDia(
  admin: Admin,
  companyId: string,
  userId: string,
  dia: string,
): Promise<{ necesidad: CantidadArticulo[]; instalaciones: number; mantenimientos: number; sinModelo: number; conMembrana: number }> {
  const { desde, hasta } = rangoDiaMadridUtc(dia);
  const [iRes, mRes] = await Promise.all([
    // Solo las que MONTAN equipo: la retirada trae material y la reubicación
    // mueve el que ya está instalado.
    admin
      .from("installations")
      .select("id")
      .eq("company_id", companyId)
      .eq("installer_user_id", userId)
      .in("kind", ["normal", "free_trial"])
      .in("status", ["scheduled", "in_progress", "paused"])
      .gte("scheduled_at", desde)
      .lt("scheduled_at", hasta)
      .is("deleted_at", null)
      .limit(200),
    admin
      .from("maintenance_jobs")
      .select("id, customer_equipment_id")
      .eq("company_id", companyId)
      .eq("technician_user_id", userId)
      .in("status", ["scheduled", "in_progress", "preprogrammed"])
      .gte("scheduled_at", desde)
      .lt("scheduled_at", hasta)
      .limit(200),
  ]);
  if (iRes.error) throw new Error(iRes.error.message);
  if (mRes.error) throw new Error(mRes.error.message);
  const insts = (iRes.data ?? []) as Array<{ id: string }>;
  const jobs = (mRes.data ?? []) as Array<{ id: string; customer_equipment_id: string | null }>;
  const necesidad: CantidadArticulo[] = [];

  if (insts.length > 0) {
    const { data: items, error } = await admin
      .from("installation_items")
      .select("product_id, quantity")
      .eq("company_id", companyId)
      .in("installation_id", insts.map((i) => i.id));
    if (error) throw new Error(error.message);
    for (const it of (items ?? []) as Array<{ product_id: string | null; quantity: number | null }>) {
      if (it.product_id) necesidad.push({ tipo: "producto", id: it.product_id, cantidad: it.quantity ?? 1 });
    }
  }

  let sinModelo = 0;
  let conMembrana = 0;
  if (jobs.length > 0) {
    const eqIds = Array.from(new Set(jobs.map((j) => j.customer_equipment_id).filter(Boolean))) as string[];
    const [eqRes, asRes, fRes] = await Promise.all([
      eqIds.length
        ? admin.from("customer_equipment").select("id, product_id").eq("company_id", companyId).in("id", eqIds)
        : Promise.resolve({ data: [] }),
      admin
        .from("product_filter_assignments")
        .select("product_id, filter_id, quantity_per_change, is_required")
        .eq("company_id", companyId)
        .limit(1000),
      admin
        .from("product_filters")
        .select("id, filter_type, is_active, deleted_at")
        .eq("company_id", companyId)
        .limit(1000),
    ]);
    const productoDeEquipo = new Map(
      ((eqRes.data ?? []) as Array<{ id: string; product_id: string | null }>).map((e) => [e.id, e.product_id]),
    );
    const asignaciones = (asRes.data ?? []) as AsignacionFiltro[];
    const filtros = (fRes.data ?? []) as Array<{
      id: string;
      filter_type: string | null;
      is_active: boolean | null;
      deleted_at: string | null;
    }>;
    const membranas = new Set(filtros.filter((f) => f.filter_type === "membrane").map((f) => f.id));
    const vivos = new Set(filtros.filter((f) => !f.deleted_at && f.is_active !== false).map((f) => f.id));
    const asignVivas = asignaciones.filter((a) => vivos.has(a.filter_id));
    const conFiltrosPropios = new Set(asignVivas.map((a) => a.product_id));
    const { mapaVarianteGama } = await import("@/modules/equipos-modelo/datos");
    const gamaDe = await mapaVarianteGama(companyId).catch(() => new Map<string, string>());

    for (const j of jobs) {
      const productId = j.customer_equipment_id ? productoDeEquipo.get(j.customer_equipment_id) ?? null : null;
      if (!productId) {
        sinModelo += 1;
        continue;
      }
      const pf = productoDeFiltros(productId, gamaDe.get(productId), (id) => conFiltrosPropios.has(id));
      necesidad.push(...filtrosDeMantenimiento(pf, asignVivas, (id) => membranas.has(id)));
      if (asignVivas.some((a) => a.product_id === pf && membranas.has(a.filter_id))) conMembrana += 1;
    }
  }

  return { necesidad, instalaciones: insts.length, mantenimientos: jobs.length, sinModelo, conMembrana };
}

/**
 * Sugerencia de carga de un técnico para un día (clave YYYY-MM-DD de Madrid).
 * No escribe nada. Null si no tiene furgoneta o la empresa no tiene almacén.
 */
export async function calcularSugerencia(
  admin: Admin,
  companyId: string,
  userId: string,
  dia: string,
): Promise<SugerenciaCarga | { error: string }> {
  const furgoneta = await leerFurgonetaDe(admin, companyId, userId);
  if (!furgoneta) return { error: "No tienes furgoneta asignada; habla con la oficina." };
  const origen = await leerAlmacenOrigen(admin, companyId);
  if (!origen) return { error: "La empresa no tiene almacén principal; habla con la oficina." };

  const [dem, prodVan, filVan, prodAlm, filAlm, res] = await Promise.all([
    necesidadDelDia(admin, companyId, userId, dia),
    productosNuevosEn(admin, companyId, furgoneta.id),
    filtrosEnAlmacen(admin, companyId, furgoneta.id),
    productosNuevosEn(admin, companyId, origen.id),
    filtrosEnAlmacen(admin, companyId, origen.id),
    leerReserva(admin, companyId, furgoneta.id),
  ]);

  const lleva: CantidadArticulo[] = [
    ...Array.from(prodVan, ([id, cantidad]) => ({ tipo: "producto" as const, id, cantidad })),
    ...Array.from(filVan, ([id, cantidad]) => ({ tipo: "filtro" as const, id, cantidad })),
  ];
  const calc = calcularCargaSugerida({ necesidad: dem.necesidad, reserva: res.reserva, lleva });
  // Sin reserva definida no se sabe qué «sobra»: lo que lleva puede ser su
  // reserva de hecho. Solo se enseña con reserva.
  const sobrantes = res.definida ? calc.sobrantes : [];
  const nombres = await nombresDeArticulos(admin, companyId, [...calc.aCargar, ...sobrantes]);

  const lineas: LineaVista[] = calc.aCargar.map((l) => {
    const n = nombres.get(claveArticulo(l));
    const hay = (l.tipo === "producto" ? prodAlm.get(l.id) : filAlm.get(l.id)) ?? 0;
    return {
      tipo: l.tipo,
      id: l.id,
      nombre: n?.nombre ?? (l.tipo === "filtro" ? "Filtro" : "Producto"),
      referencia: n?.referencia ?? null,
      aCargar: l.aCargar,
      paraTrabajos: l.paraTrabajos,
      paraReserva: l.paraReserva,
      hayEnAlmacen: hay > 0,
    };
  });

  const avisos: string[] = [];
  if (dem.sinModelo > 0) {
    avisos.push(
      `${dem.sinModelo} mantenimiento${dem.sinModelo === 1 ? "" : "s"} con el equipo sin identificar: no suma${dem.sinModelo === 1 ? "" : "n"} filtros, se atiende${dem.sinModelo === 1 ? "" : "n"} con la reserva.`,
    );
  }
  if (dem.conMembrana > 0) {
    avisos.push(
      `${dem.conMembrana} ósmosis podría${dem.conMembrana === 1 ? "" : "n"} necesitar membrana: no se cuenta${dem.conMembrana === 1 ? "" : "n"}, se lleva${dem.conMembrana === 1 ? "" : "n"} de la reserva.`,
    );
  }
  if (!res.definida) avisos.push("La oficina aún no ha definido la carga de reserva: solo se cuentan los trabajos.");
  if (lineas.some((l) => !l.hayEnAlmacen)) avisos.push("Hay artículos que no quedan en el almacén: avisa a la oficina.");

  return {
    dia,
    furgoneta,
    origen,
    lineas,
    sobrantes: sobrantes.map((s) => ({
      tipo: s.tipo,
      id: s.id,
      nombre: nombres.get(claveArticulo(s))?.nombre ?? (s.tipo === "filtro" ? "Filtro" : "Producto"),
    })),
    trabajos: { instalaciones: dem.instalaciones, mantenimientos: dem.mantenimientos },
    avisos,
    reservaDefinida: res.definida,
  };
}

export interface OrdenPendiente {
  id: string;
  status: string;
  dia: string | null;
  esSugerencia: boolean;
  lineas: Array<{ tipo: TipoArticulo; nombre: string; cantidad: number }>;
}

/** Órdenes de carga abiertas hacia la furgoneta (las que aún no mueven stock). */
export async function leerOrdenesAbiertas(admin: Admin, companyId: string, furgonetaId: string): Promise<OrdenPendiente[]> {
  const { data } = await admin
    .from("loading_requests")
    .select("id, status, needed_for, notes")
    .eq("company_id", companyId)
    .eq("destination_warehouse_id", furgonetaId)
    .in("status", ESTADOS_ABIERTOS as unknown as string[])
    .order("needed_for", { ascending: true, nullsFirst: false })
    .limit(10);
  const ordenes = (data ?? []) as Array<{ id: string; status: string; needed_for: string | null; notes: string | null }>;
  if (ordenes.length === 0) return [];
  const ids = ordenes.map((o) => o.id);
  const [pi, fi] = await Promise.all([
    admin.from("loading_request_items").select("loading_request_id, product_id, quantity_requested").eq("company_id", companyId).in("loading_request_id", ids),
    admin.from("loading_request_filtros").select("loading_request_id, filter_id, cantidad_pedida").eq("company_id", companyId).in("loading_request_id", ids),
  ]);
  const prods = (pi.data ?? []) as Array<{ loading_request_id: string; product_id: string; quantity_requested: number }>;
  const fils = fi.error ? [] : ((fi.data ?? []) as Array<{ loading_request_id: string; filter_id: string; cantidad_pedida: number }>);
  const nombres = await nombresDeArticulos(admin, companyId, [
    ...prods.map((p) => ({ tipo: "producto" as const, id: p.product_id })),
    ...fils.map((f) => ({ tipo: "filtro" as const, id: f.filter_id })),
  ]);
  return ordenes.map((o) => ({
    id: o.id,
    status: o.status,
    dia: o.needed_for,
    esSugerencia: (o.notes ?? "").startsWith(NOTA_SUGERENCIA),
    lineas: [
      ...prods
        .filter((p) => p.loading_request_id === o.id)
        .map((p) => ({
          tipo: "producto" as const,
          nombre: nombres.get(claveArticulo({ tipo: "producto", id: p.product_id }))?.nombre ?? "Producto",
          cantidad: p.quantity_requested,
        })),
      ...fils
        .filter((f) => f.loading_request_id === o.id)
        .map((f) => ({
          tipo: "filtro" as const,
          nombre: nombres.get(claveArticulo({ tipo: "filtro", id: f.filter_id }))?.nombre ?? "Filtro",
          cantidad: f.cantidad_pedida,
        })),
    ],
  }));
}

/**
 * Crea la orden de carga de la sugerencia en estado «solicitada»: NO mueve
 * stock. El stock se mueve al confirmar la carga (deliverLoadingRequestAction),
 * la confirme el técnico o el almacén. Devuelve si los filtros se pudieron
 * guardar (sin la migración, la orden lleva solo productos).
 */
export async function crearOrdenSugerida(
  admin: Admin,
  p: {
    companyId: string;
    userId: string | null;
    furgonetaId: string;
    origenId: string;
    dia: string;
    lineas: CantidadArticulo[];
    automatica: boolean;
  },
): Promise<{ id: string; filtrosOmitidos: number }> {
  const productos = p.lineas.filter((l) => l.tipo === "producto" && l.cantidad > 0);
  const filtros = p.lineas.filter((l) => l.tipo === "filtro" && l.cantidad > 0);
  if (productos.length + filtros.length === 0) throw new Error("No hay nada que cargar");

  const { data: lr, error } = await admin
    .from("loading_requests")
    .insert({
      company_id: p.companyId,
      source_warehouse_id: p.origenId,
      destination_warehouse_id: p.furgonetaId,
      status: "requested",
      needed_for: p.dia,
      requested_by: p.userId,
      notes: p.automatica ? `${NOTA_SUGERENCIA} (automática de la tarde)` : `${NOTA_SUGERENCIA} (pedida por el técnico)`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (lr as { id: string }).id;

  try {
    if (productos.length > 0) {
      const { error: e1 } = await admin.from("loading_request_items").insert(
        productos.map((l) => ({
          loading_request_id: id,
          company_id: p.companyId,
          product_id: l.id,
          quantity_requested: l.cantidad,
        })),
      );
      if (e1) throw new Error(e1.message);
    }
    let filtrosOmitidos = 0;
    if (filtros.length > 0) {
      const { error: e2 } = await admin.from("loading_request_filtros").insert(
        filtros.map((l) => ({
          loading_request_id: id,
          company_id: p.companyId,
          filter_id: l.id,
          cantidad_pedida: l.cantidad,
        })),
      );
      if (e2) {
        if (!esTablaQueFalta(e2)) throw new Error(e2.message);
        filtrosOmitidos = filtros.length;
        if (productos.length === 0) throw new Error("Las órdenes de carga aún no admiten filtros; avisa a la oficina.");
      }
    }
    return { id, filtrosOmitidos };
  } catch (e) {
    // Sin líneas la orden no sirve: se borra (aún no ha movido nada).
    await admin.from("loading_requests").delete().eq("id", id).eq("company_id", p.companyId);
    throw e;
  }
}

/** Lo que pinta el panel de «Mi furgoneta». Null si no tiene furgoneta. */
export async function datosPanelCarga(
  companyId: string,
  userId: string,
): Promise<{ preferencia: PreferenciaCarga; pendientes: OrdenPendiente[] } | null> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const admin = createAdminClient() as Admin;
  const furgoneta = await leerFurgonetaDe(admin, companyId, userId);
  if (!furgoneta) return null;
  const [preferencia, pendientes] = await Promise.all([
    leerPreferencia(admin, companyId, userId),
    leerOrdenesAbiertas(admin, companyId, furgoneta.id),
  ]);
  return { preferencia, pendientes };
}
