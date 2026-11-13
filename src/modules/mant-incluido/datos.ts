import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { claveDiaMadrid } from "@/modules/scheduling/fechas-madrid";
import {
  IVA_DEFECTO,
  PRECIOS_VACIOS,
  estadoMantIncluido,
  pagoEfectivo,
  precioAplicado,
  textoEstado,
  type EstadoMantIncluido,
  type Modalidad,
  type OrigenPrecio,
  type PagoEstado,
  type PreciosTarifa,
  type Tarifa,
} from "./logica";

/**
 * Lecturas de «mantenimientos incluidos». TODAS con admin + company_id (el
 * técnico no ve company_settings ni otros clientes por RLS) y TOLERANTES a que
 * la migración 20261113110000_mantenimientos_incluidos.sql no esté aplicada:
 * en ese caso `mantIncluidoDisponible()` da false y la UI esconde la función.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** ¿Está aplicada la migración? (una consulta por petición). */
export const mantIncluidoDisponible = cache(async (): Promise<boolean> => {
  const admin = createAdminClient() as Admin;
  const [a, b, c, d, e] = await Promise.all([
    admin
      .from("customer_equipment")
      .select("mant_incluidos_n, mant_incluido_origen, mant_precio_filtros_cents, mant_precio_filtros_membrana_cents")
      .limit(1),
    admin.from("customers").select("mant_precio_filtros_cents, mant_precio_filtros_membrana_cents").limit(1),
    admin
      .from("company_settings")
      .select("mant_incluidos_n_defecto, mant_precio_filtros_cents, mant_precio_filtros_membrana_cents")
      .limit(1),
    admin
      .from("maintenance_jobs")
      .select("pago_estado, alcance, importe_pendiente_cents, pagado_oficina_tarifa, cobrado_metodo")
      .limit(1),
    admin.from("wallet_entries").select("maintenance_job_id").limit(1),
  ]);
  return !a.error && !b.error && !c.error && !d.error && !e.error;
});

export interface ConfigMant {
  nDefecto: number | null;
  precios: PreciosTarifa;
  iva: number;
}

export const cargarConfigMant = cache(async (companyId: string): Promise<ConfigMant> => {
  const admin = createAdminClient() as Admin;
  const vacia: ConfigMant = { nDefecto: null, precios: PRECIOS_VACIOS, iva: IVA_DEFECTO };
  if (!(await mantIncluidoDisponible())) return vacia;
  const { data, error } = await admin
    .from("company_settings")
    .select("mant_incluidos_n_defecto, mant_precio_filtros_cents, mant_precio_filtros_membrana_cents, invoice_default_iva")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data) return vacia;
  const r = data as Record<string, unknown>;
  const iva = Number(r.invoice_default_iva);
  return {
    nDefecto: (r.mant_incluidos_n_defecto as number | null) ?? null,
    precios: {
      solo_filtros: (r.mant_precio_filtros_cents as number | null) ?? null,
      filtros_membrana: (r.mant_precio_filtros_membrana_cents as number | null) ?? null,
    },
    iva: Number.isFinite(iva) && iva >= 0 ? iva : IVA_DEFECTO,
  };
});

/** Resumen serializable (va a componentes de cliente). */
export interface ResumenMant {
  estado: EstadoMantIncluido;
  texto: string | null;
  seCobra: boolean;
  k: number | null;
  n: number | null;
  anioHasta: number | null;
  anioPaga: number | null;
  origen: string | null;
  modalidad: Modalidad;
  installedAt: string | null;
  iva: number;
  nDefecto: number | null;
  precios: {
    equipo: PreciosTarifa;
    cliente: PreciosTarifa;
    empresa: PreciosTarifa;
  };
  aplicado: Record<Tarifa, { cents: number | null; origen: OrigenPrecio }>;
}

interface FilaEquipo {
  id: string;
  customer_id: string;
  installed_at: string | null;
  is_active: boolean;
  acquisition_type: Modalidad;
  mant_incluidos_n: number | null;
  mant_incluido_origen: string | null;
  mant_precio_filtros_cents: number | null;
  mant_precio_filtros_membrana_cents: number | null;
}

const COLS_EQUIPO =
  "id, customer_id, installed_at, is_active, acquisition_type, mant_incluidos_n, mant_incluido_origen, mant_precio_filtros_cents, mant_precio_filtros_membrana_cents";

function precios(r: { mant_precio_filtros_cents: number | null; mant_precio_filtros_membrana_cents: number | null }): PreciosTarifa {
  return {
    solo_filtros: r.mant_precio_filtros_cents ?? null,
    filtros_membrana: r.mant_precio_filtros_membrana_cents ?? null,
  };
}

function resumir(
  eq: FilaEquipo,
  cliente: PreciosTarifa,
  cfg: ConfigMant,
  fechaVisitaIso: string | null,
  hoy: string,
): ResumenMant {
  const installedAt = eq.installed_at ? String(eq.installed_at).slice(0, 10) : null;
  const r = estadoMantIncluido({
    modalidad: eq.acquisition_type,
    activo: !!eq.is_active,
    n: eq.mant_incluidos_n,
    installedAt,
    fechaVisita: fechaVisitaIso ? claveDiaMadrid(fechaVisitaIso) : null,
    hoy,
  });
  const pe = precios(eq);
  return {
    estado: r.estado,
    texto: textoEstado(r, eq.acquisition_type),
    seCobra: r.seCobra,
    k: r.k,
    n: r.n,
    anioHasta: r.anioHasta,
    anioPaga: r.anioPaga,
    origen: eq.mant_incluido_origen,
    modalidad: eq.acquisition_type,
    installedAt,
    iva: cfg.iva,
    nDefecto: cfg.nDefecto,
    precios: { equipo: pe, cliente, empresa: cfg.precios },
    aplicado: {
      solo_filtros: precioAplicado("solo_filtros", pe, cliente, cfg.precios),
      filtros_membrana: precioAplicado("filtros_membrana", pe, cliente, cfg.precios),
    },
  };
}

async function preciosClientes(
  admin: Admin,
  companyId: string,
  customerIds: string[],
): Promise<Map<string, PreciosTarifa>> {
  const out = new Map<string, PreciosTarifa>();
  if (customerIds.length === 0) return out;
  const { data, error } = await admin
    .from("customers")
    .select("id, mant_precio_filtros_cents, mant_precio_filtros_membrana_cents")
    .eq("company_id", companyId)
    .in("id", customerIds);
  if (error) return out;
  for (const c of (data ?? []) as Array<{
    id: string;
    mant_precio_filtros_cents: number | null;
    mant_precio_filtros_membrana_cents: number | null;
  }>) {
    out.set(c.id, precios(c));
  }
  return out;
}

/**
 * Resumen por equipo. `proximaVisita` = fecha ISO de la próxima visita de cada
 * equipo (si no hay, se usa el próximo aniversario de la instalación).
 * Devuelve un Map vacío si la migración no está aplicada.
 */
export async function cargarMantEquipos(
  companyId: string,
  equipoIds: string[],
  proximaVisita: Record<string, string | null | undefined> = {},
): Promise<Map<string, ResumenMant>> {
  const out = new Map<string, ResumenMant>();
  if (equipoIds.length === 0 || !(await mantIncluidoDisponible())) return out;
  const admin = createAdminClient() as Admin;
  const { data, error } = await admin
    .from("customer_equipment")
    .select(COLS_EQUIPO)
    .eq("company_id", companyId)
    .in("id", equipoIds);
  if (error) {
    console.error("[mant-incluido] equipos:", error.message);
    return out;
  }
  const filas = (data ?? []) as FilaEquipo[];
  const [cfg, porCliente] = await Promise.all([
    cargarConfigMant(companyId),
    preciosClientes(admin, companyId, Array.from(new Set(filas.map((f) => f.customer_id)))),
  ]);
  const hoy = claveDiaMadrid(new Date());
  for (const f of filas) {
    out.set(
      f.id,
      resumir(f, porCliente.get(f.customer_id) ?? PRECIOS_VACIOS, cfg, proximaVisita[f.id] ?? null, hoy),
    );
  }
  return out;
}

/** Precios propios del cliente (para la hoja de edición). */
export async function cargarPreciosCliente(companyId: string, customerId: string): Promise<PreciosTarifa> {
  if (!(await mantIncluidoDisponible())) return PRECIOS_VACIOS;
  const admin = createAdminClient() as Admin;
  const m = await preciosClientes(admin, companyId, [customerId]);
  return m.get(customerId) ?? PRECIOS_VACIOS;
}

// ---------------------------------------------------------------------------
// Visita
// ---------------------------------------------------------------------------

export interface MantVisita {
  resumen: ResumenMant | null;
  pagoGuardado: PagoEstado;
  pagoEfectivo: PagoEstado;
  alcance: Tarifa | null;
  importeBaseCents: number | null;
  importePendienteCents: number | null;
  pagadoOficina: {
    tarifa: Tarifa | null;
    cents: number | null;
    metodo: string | null;
    at: string | null;
  } | null;
  cobrado: { metodo: string | null; cents: number | null; at: string | null } | null;
  noCobradoMotivo: string | null;
}

const COLS_VISITA =
  "id, customer_equipment_id, scheduled_at, completed_at, status, pago_estado, alcance, importe_base_cents, importe_pendiente_cents, pagado_marcado_at, pagado_oficina_tarifa, pagado_oficina_cents, pagado_oficina_metodo, cobrado_metodo, cobrado_cents, cobrado_at, no_cobrado_motivo";

/** Estado de cobro de una visita. Null si la migración no está aplicada. */
export async function cargarMantVisita(companyId: string, jobId: string): Promise<MantVisita | null> {
  if (!(await mantIncluidoDisponible())) return null;
  const admin = createAdminClient() as Admin;
  const { data, error } = await admin
    .from("maintenance_jobs")
    .select(COLS_VISITA)
    .eq("company_id", companyId)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  const j = data as Record<string, unknown>;
  const eqId = (j.customer_equipment_id as string | null) ?? null;
  // La fecha que cuenta: la de cierre si ya está hecha; si no, la programada; si no, hoy.
  const fecha =
    (j.completed_at as string | null) ?? (j.scheduled_at as string | null) ?? new Date().toISOString();
  const resumen = eqId ? ((await cargarMantEquipos(companyId, [eqId], { [eqId]: fecha })).get(eqId) ?? null) : null;
  const guardado = ((j.pago_estado as string | null) ?? "incluido") as PagoEstado;
  return {
    resumen,
    pagoGuardado: guardado,
    pagoEfectivo: pagoEfectivo(
      guardado,
      !!resumen?.seCobra,
      j.status === "completed" || j.status === "cancelled",
    ),
    alcance: (j.alcance as Tarifa | null) ?? null,
    importeBaseCents: (j.importe_base_cents as number | null) ?? null,
    importePendienteCents: (j.importe_pendiente_cents as number | null) ?? null,
    pagadoOficina: j.pagado_marcado_at
      ? {
          tarifa: (j.pagado_oficina_tarifa as Tarifa | null) ?? null,
          cents: (j.pagado_oficina_cents as number | null) ?? null,
          metodo: (j.pagado_oficina_metodo as string | null) ?? null,
          at: (j.pagado_marcado_at as string | null) ?? null,
        }
      : null,
    cobrado: j.cobrado_at
      ? {
          metodo: (j.cobrado_metodo as string | null) ?? null,
          cents: (j.cobrado_cents as number | null) ?? null,
          at: (j.cobrado_at as string | null) ?? null,
        }
      : null,
    noCobradoMotivo: (j.no_cobrado_motivo as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Dashboard: «Empiezan a pagar»
// ---------------------------------------------------------------------------

export interface ResumenEmpiezanPagar {
  /** Equipos activos cuya próxima visita ya se cobra. */
  aPagar: number;
  /** Equipos cuyo año de «empieza a pagar» es el año actual (Madrid). */
  empiezanEsteAnio: number;
  /** Equipos cuya próxima visita es la última incluida (avisar al cliente). */
  ultimaIncluida: number;
  /** Equipos de venta activos sin N. */
  sinDato: number;
  /** Visitas cerradas sin cobrar (no cobrado o diferencia de membrana pendiente). */
  visitasPorCobrar: number;
}

/**
 * Cuentas para el dashboard. Barre los equipos activos con N o de venta (pocos
 * cientos en Infinity) con fetchAllRows y calcula el estado en código.
 */
export async function contarEmpiezanPagar(companyId: string): Promise<ResumenEmpiezanPagar | null> {
  if (!(await mantIncluidoDisponible())) return null;
  const admin = createAdminClient() as Admin;
  const filas = await fetchAllRows<FilaEquipo>(
    (from, to) =>
      admin
        .from("customer_equipment")
        .select(COLS_EQUIPO)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .or("mant_incluidos_n.not.is.null,acquisition_type.eq.cash")
        .order("id")
        .range(from, to),
    { label: "mant-incluido-dashboard" },
  );
  const cfg = await cargarConfigMant(companyId);
  const hoy = claveDiaMadrid(new Date());
  const out: ResumenEmpiezanPagar = {
    aPagar: 0,
    empiezanEsteAnio: 0,
    ultimaIncluida: 0,
    sinDato: 0,
    visitasPorCobrar: 0,
  };
  const anioActual = Number(hoy.slice(0, 4));
  for (const f of filas) {
    const r = resumir(f, PRECIOS_VACIOS, cfg, null, hoy);
    if (r.anioPaga === anioActual && r.estado !== "incluido_alquiler") out.empiezanEsteAnio++;
    if (r.estado === "a_pagar") out.aPagar++;
    else if (r.estado === "ultima_incluida") out.ultimaIncluida++;
    else if (r.estado === "sin_dato" && f.acquisition_type === "cash") out.sinDato++;
  }
  const { count } = await admin
    .from("maintenance_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "completed")
    .in("pago_estado", ["pendiente", "no_cobrado"]);
  out.visitasPorCobrar = count ?? 0;
  return out;
}

/** Lista para la página «Empiezan a pagar». */
export interface FilaEmpiezanPagar {
  equipoId: string;
  customerId: string;
  estado: EstadoMantIncluido;
  texto: string | null;
  n: number | null;
  anioPaga: number | null;
  installedAt: string | null;
  modalidad: Modalidad;
}

export async function listarEmpiezanPagar(companyId: string): Promise<FilaEmpiezanPagar[]> {
  if (!(await mantIncluidoDisponible())) return [];
  const admin = createAdminClient() as Admin;
  const filas = await fetchAllRows<FilaEquipo>(
    (from, to) =>
      admin
        .from("customer_equipment")
        .select(COLS_EQUIPO)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .or("mant_incluidos_n.not.is.null,acquisition_type.eq.cash")
        .order("id")
        .range(from, to),
    { label: "mant-incluido-lista" },
  );
  const cfg = await cargarConfigMant(companyId);
  const hoy = claveDiaMadrid(new Date());
  const out: FilaEmpiezanPagar[] = [];
  for (const f of filas) {
    const r = resumir(f, PRECIOS_VACIOS, cfg, null, hoy);
    if (r.estado !== "a_pagar" && r.estado !== "ultima_incluida" && r.estado !== "sin_dato") continue;
    if (r.estado === "sin_dato" && f.acquisition_type !== "cash") continue;
    out.push({
      equipoId: f.id,
      customerId: f.customer_id,
      estado: r.estado,
      texto: r.texto,
      n: r.n,
      anioPaga: r.anioPaga,
      installedAt: r.installedAt,
      modalidad: f.acquisition_type,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Listas de visitas: estado de pago efectivo por visita
// ---------------------------------------------------------------------------

export interface VisitaParaPago {
  id: string;
  customer_equipment_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  status: string;
}

function trozos<T>(xs: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Pago efectivo de cada visita (lo guardado por una persona manda; si no, k > N).
 * Map vacío si la migración no está aplicada → las listas pintan lo de antes.
 */
export async function estadosPagoVisitas(
  companyId: string,
  visitas: VisitaParaPago[],
): Promise<Map<string, PagoEstado>> {
  const out = new Map<string, PagoEstado>();
  if (visitas.length === 0 || !(await mantIncluidoDisponible())) return out;
  const admin = createAdminClient() as Admin;
  const guardado = new Map<string, PagoEstado>();
  for (const t of trozos(visitas.map((v) => v.id))) {
    const { data, error } = await admin
      .from("maintenance_jobs")
      .select("id, pago_estado")
      .eq("company_id", companyId)
      .in("id", t);
    if (error) return out;
    for (const r of (data ?? []) as Array<{ id: string; pago_estado: PagoEstado }>) {
      guardado.set(r.id, r.pago_estado);
    }
  }
  const eqIds = Array.from(new Set(visitas.map((v) => v.customer_equipment_id).filter(Boolean))) as string[];
  const equipos = new Map<string, FilaEquipo>();
  for (const t of trozos(eqIds)) {
    const { data, error } = await admin
      .from("customer_equipment")
      .select(COLS_EQUIPO)
      .eq("company_id", companyId)
      .in("id", t);
    if (error) break;
    for (const f of (data ?? []) as FilaEquipo[]) equipos.set(f.id, f);
  }
  const hoy = claveDiaMadrid(new Date());
  for (const v of visitas) {
    const eq = v.customer_equipment_id ? equipos.get(v.customer_equipment_id) : undefined;
    let seCobra = false;
    if (eq) {
      const fecha = v.completed_at ?? v.scheduled_at;
      const r = estadoMantIncluido({
        modalidad: eq.acquisition_type,
        activo: !!eq.is_active,
        n: eq.mant_incluidos_n,
        installedAt: eq.installed_at ? String(eq.installed_at).slice(0, 10) : null,
        fechaVisita: fecha ? claveDiaMadrid(fecha) : null,
        hoy,
      });
      seCobra = r.seCobra;
    }
    out.set(
      v.id,
      pagoEfectivo(guardado.get(v.id) ?? null, seCobra, v.status === "completed" || v.status === "cancelled"),
    );
  }
  return out;
}

export interface VisitaPorCobrar {
  id: string;
  customerId: string;
  completedAt: string | null;
  pago: PagoEstado;
  pendienteCents: number | null;
  motivo: string | null;
}

/** Visitas cerradas que siguen por cobrar (sin cobrar o diferencia de membrana). */
export async function listarVisitasPorCobrar(companyId: string): Promise<VisitaPorCobrar[]> {
  if (!(await mantIncluidoDisponible())) return [];
  const admin = createAdminClient() as Admin;
  const filas = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .from("maintenance_jobs")
        .select("id, customer_id, completed_at, pago_estado, importe_pendiente_cents, no_cobrado_motivo")
        .eq("company_id", companyId)
        .eq("status", "completed")
        .in("pago_estado", ["pendiente", "no_cobrado"])
        .order("completed_at", { ascending: false })
        .order("id")
        .range(from, to),
    { label: "mant-incluido-visitas-por-cobrar" },
  );
  return filas.map((r) => ({
    id: String(r.id),
    customerId: String(r.customer_id),
    completedAt: (r.completed_at as string | null) ?? null,
    pago: r.pago_estado as PagoEstado,
    pendienteCents: (r.importe_pendiente_cents as number | null) ?? null,
    motivo: (r.no_cobrado_motivo as string | null) ?? null,
  }));
}
