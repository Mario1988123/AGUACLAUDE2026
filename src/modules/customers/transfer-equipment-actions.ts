"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  bloqueoPorContratoCompartido,
  contratosConCuotas,
  faltanDatosFacturacion,
  resumenTraspasoEquipo,
  validarMotivo,
  type ContratoLigado,
  type ResumenTraspaso,
} from "./traspaso-equipo-logica";

/**
 * TRASPASO DE UN EQUIPO A OTRO CLIENTE ("nos equivocamos de ficha")
 *
 * El equipo no se mueve de sitio; se arrastra TODO lo que cuelga de él al
 * cliente destino (de la misma empresa usuaria): el contrato de
 * alquiler/renting/venta, la instalación, todos los mantenimientos y
 * contratos de mantenimiento, las incidencias y los cobros pendientes que
 * aún no se han facturado. La dirección se copia en la ficha destino porque
 * `addresses.customer_id` va en CASCADE.
 *
 * NO se mueve nunca lo ya facturado: las facturas (y sus cobros) son de quien
 * las recibió; con VeriFactu reasignar una factura emitida no es una
 * corrección. Tampoco el snapshot, el PDF ni las firmas del contrato, que
 * quedan como registro de quién firmó (el traspaso se anota en el contrato).
 *
 * El mandato SEPA del origen se revoca (no se borra) y el destino firma el
 * suyo; mientras no lo haga, sus cuotas no entran en la remesa.
 *
 * Todo el movimiento va en UNA transacción: la función SQL
 * `traspasar_equipo_a_cliente` (migración 20261110090000). Aquí solo se
 * valida, se calcula qué se mueve y se copia la dirección (si la función
 * falla, la copia se borra).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;
type Sesion = Awaited<ReturnType<typeof requireSession>>;

export interface TransferEquipmentResult {
  equipment_moved: number;
  contracts_moved: number;
  installations_moved: number;
  jobs_moved: number;
  maintenance_contracts_moved: number;
  incidents_moved: number;
  wallet_moved: number;
  sepa_mandates_revoked: number;
  address_cloned: boolean;
}

interface EquipmentRow {
  id: string;
  company_id: string;
  customer_id: string;
  address_id: string | null;
  parent_equipment_id: string | null;
  serial_number: string | null;
}

interface CustomerRow {
  id: string;
  company_id: string;
  party_kind: "individual" | "company";
  is_autonomo: boolean | null;
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
  tax_id: string | null;
  deleted_at: string | null;
}

const CUSTOMER_COLS =
  "id, company_id, party_kind, is_autonomo, legal_name, trade_name, first_name, last_name, tax_id, deleted_at";

function customerLabel(c: CustomerRow): string {
  if (c.party_kind === "company") {
    return c.trade_name || c.legal_name || "Empresa sin nombre";
  }
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre";
}

/** [decide] Solo admin de empresa (y superadmin): cambia a quién se factura. */
function puedeTraspasar(s: Sesion): boolean {
  return s.is_superadmin || s.roles.includes("company_admin");
}

function err(e: { message: string } | null | undefined, que: string): void {
  if (e) throw new Error(`${que}: ${e.message}`);
}

interface Plan {
  equipment: EquipmentRow;
  origin: CustomerRow;
  target: CustomerRow;
  ids: string[];
  directChildren: string[];
  includeChildren: boolean;
  contratos: ContratoLigado[];
  bloqueo: string | null;
  resumen: ResumenTraspaso;
  /** Dirección del equipo a copiar (null si no tiene o ya es del destino). */
  addressToClone: Record<string, unknown> | null;
  /** Dirección igual que el destino ya tiene. */
  twinAddressId: string | null;
}

/**
 * Lee todo lo necesario y decide qué se mueve. No escribe nada: lo usan la
 * vista previa y el traspaso.
 */
async function planificar(
  admin: Admin,
  companyId: string,
  input: { equipment_id: string; target_customer_id: string; include_children?: boolean },
): Promise<{ ok: true; plan: Plan } | { ok: false; error: string }> {
  // --- Equipo y fichas ----------------------------------------------------
  const { data: eqData, error: eqErr } = await admin
    .from("customer_equipment")
    .select("id, company_id, customer_id, address_id, parent_equipment_id, serial_number")
    .eq("id", input.equipment_id)
    .eq("company_id", companyId)
    .maybeSingle();
  err(eqErr, "Leer el equipo");
  const equipment = eqData as EquipmentRow | null;
  if (!equipment) return { ok: false, error: "Equipo no encontrado o no pertenece a tu empresa" };
  if (equipment.customer_id === input.target_customer_id) {
    return { ok: false, error: "El equipo ya es de ese cliente" };
  }

  const { data: bothData, error: bothErr } = await admin
    .from("customers")
    .select(CUSTOMER_COLS)
    .in("id", [equipment.customer_id, input.target_customer_id])
    .eq("company_id", companyId);
  err(bothErr, "Leer los clientes");
  const both = (bothData ?? []) as CustomerRow[];
  const origin = both.find((c) => c.id === equipment.customer_id);
  const target = both.find((c) => c.id === input.target_customer_id);
  if (!origin || !target) return { ok: false, error: "Cliente de origen o destino no encontrado en tu empresa" };
  if (target.deleted_at) return { ok: false, error: "El cliente destino está borrado" };

  // --- Equipos que viajan (descendencia completa, acotada) ---------------
  const includeChildren = input.include_children !== false;
  const childrenOf = async (parents: string[]): Promise<string[]> => {
    const { data, error } = await admin
      .from("customer_equipment")
      .select("id")
      .in("parent_equipment_id", parents)
      .eq("company_id", companyId);
    err(error, "Leer los accesorios");
    return ((data ?? []) as Array<{ id: string }>).map((k) => k.id);
  };
  const ids = [equipment.id];
  const directChildren = await childrenOf([equipment.id]);
  if (includeChildren) {
    let frontier = directChildren;
    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      for (const id of frontier) if (!ids.includes(id)) ids.push(id);
      frontier = (await childrenOf(frontier)).filter((id) => !ids.includes(id));
    }
  }

  // --- Contratos de esos equipos (vía instalación o equipo de origen) -----
  const { data: eqs, error: eqsErr } = await admin
    .from("customer_equipment")
    .select("id, installation_id")
    .eq("company_id", companyId)
    .in("id", ids);
  err(eqsErr, "Leer las instalaciones de los equipos");
  const instIds = Array.from(
    new Set(((eqs ?? []) as Array<{ installation_id: string | null }>).map((e) => e.installation_id).filter(Boolean)),
  ) as string[];
  const contractIds = new Set<string>();
  if (instIds.length > 0) {
    const { data, error } = await admin
      .from("installations")
      .select("contract_id")
      .eq("company_id", companyId)
      .in("id", instIds);
    err(error, "Leer los contratos de las instalaciones");
    for (const r of (data ?? []) as Array<{ contract_id: string | null }>) {
      if (r.contract_id) contractIds.add(r.contract_id);
    }
  }
  {
    const { data, error } = await admin
      .from("contracts")
      .select("id")
      .eq("company_id", companyId)
      .in("source_equipment_id", ids)
      .is("deleted_at", null);
    err(error, "Leer los contratos del equipo");
    for (const r of (data ?? []) as Array<{ id: string }>) contractIds.add(r.id);
  }

  type K = {
    id: string;
    customer_id: string;
    reference_code: string | null;
    plan_type: string;
    status: string;
    financier_id: string | null;
    source_equipment_id: string | null;
  };
  let contratosRaw: K[] = [];
  if (contractIds.size > 0) {
    const { data, error } = await admin
      .from("contracts")
      .select("id, customer_id, reference_code, plan_type, status, financier_id, source_equipment_id")
      .eq("company_id", companyId)
      .in("id", [...contractIds])
      .is("deleted_at", null);
    err(error, "Leer los contratos");
    // Solo se arrastran los contratos del cliente de origen.
    contratosRaw = ((data ?? []) as K[]).filter((k) => k.customer_id === origin.id);
  }

  // Otros equipos activos del origen que cubre cada contrato y que no viajan.
  const contratos: ContratoLigado[] = [];
  for (const k of contratosRaw) {
    const { data: instK, error: e1 } = await admin
      .from("installations")
      .select("id")
      .eq("company_id", companyId)
      .eq("contract_id", k.id);
    err(e1, "Leer las instalaciones del contrato");
    const iIds = ((instK ?? []) as Array<{ id: string }>).map((i) => i.id);
    const otros = new Set<string>();
    if (iIds.length > 0) {
      const { data: eqK, error: e2 } = await admin
        .from("customer_equipment")
        .select("id")
        .eq("company_id", companyId)
        .eq("customer_id", origin.id)
        .eq("is_active", true)
        .in("installation_id", iIds);
      err(e2, "Leer los equipos del contrato");
      for (const e of (eqK ?? []) as Array<{ id: string }>) if (!ids.includes(e.id)) otros.add(e.id);
    }
    if (k.source_equipment_id && !ids.includes(k.source_equipment_id)) otros.add(k.source_equipment_id);
    contratos.push({
      id: k.id,
      reference_code: k.reference_code,
      plan_type: k.plan_type,
      status: k.status,
      financier_id: k.financier_id,
      otros_equipos: otros.size,
    });
  }
  const kIds = contratos.map((k) => k.id);

  // --- Conteos para el resumen --------------------------------------------
  const contar = async (q: Promise<{ count: number | null; error: { message: string } | null }>, que: string) => {
    const r = await q;
    err(r.error, que);
    return r.count ?? 0;
  };
  const head = { count: "exact" as const, head: true };
  const orEquipoContrato = (colEq: string, colK: string) =>
    kIds.length > 0 ? `${colEq}.in.(${ids.join(",")}),${colK}.in.(${kIds.join(",")})` : `${colEq}.in.(${ids.join(",")})`;

  const [mantenimientos, contratosMant, incidencias, apuntes, cobrosFacturados, mandatos, instalaciones] =
    await Promise.all([
      contar(
        admin
          .from("maintenance_jobs")
          .select("id", head)
          .eq("company_id", companyId)
          .eq("customer_id", origin.id)
          .or(orEquipoContrato("customer_equipment_id", "contract_id")),
        "Contar mantenimientos",
      ),
      contar(
        admin
          .from("maintenance_contracts")
          .select("id", head)
          .eq("company_id", companyId)
          .eq("customer_id", origin.id)
          .or(orEquipoContrato("customer_equipment_id", "source_contract_id")),
        "Contar contratos de mantenimiento",
      ),
      contar(
        admin
          .from("incidents")
          .select("id", head)
          .eq("company_id", companyId)
          .eq("customer_id", origin.id)
          .in("customer_equipment_id", ids),
        "Contar incidencias",
      ),
      kIds.length > 0
        ? contar(
            admin
              .from("wallet_entries")
              .select("id", head)
              .eq("company_id", companyId)
              .in("contract_id", kIds)
              .eq("status", "pending")
              .is("invoice_id", null)
              .or(`customer_id.eq.${origin.id},customer_id.is.null`),
            "Contar cobros pendientes",
          )
        : Promise.resolve(0),
      kIds.length > 0
        ? contar(
            admin
              .from("wallet_entries")
              .select("id", head)
              .eq("company_id", companyId)
              .in("contract_id", kIds)
              .eq("status", "pending")
              .not("invoice_id", "is", null),
            "Contar cuotas facturadas pendientes",
          )
        : Promise.resolve(0),
      kIds.length > 0
        ? contar(
            admin
              .from("sepa_mandates")
              .select("id", head)
              .eq("company_id", companyId)
              .in("contract_id", kIds)
              .in("status", ["draft", "active"]),
            "Contar mandatos SEPA",
          )
        : Promise.resolve(0),
      contar(
        admin
          .from("installations")
          .select("id", head)
          .eq("company_id", companyId)
          .or(
            [
              instIds.length > 0 ? `id.in.(${instIds.join(",")})` : null,
              kIds.length > 0 ? `contract_id.in.(${kIds.join(",")})` : null,
            ]
              .filter(Boolean)
              .join(",") || "id.is.null",
          ),
        "Contar instalaciones",
      ),
    ]);

  // --- Dirección -----------------------------------------------------------
  let addressToClone: Record<string, unknown> | null = null;
  let twinAddressId: string | null = null;
  let direccion: "copia" | "reutiliza" | "sin_direccion" | "ya_es_suya" = "sin_direccion";
  if (equipment.address_id) {
    const { data: addrData, error: aErr } = await admin
      .from("addresses")
      .select("*")
      .eq("id", equipment.address_id)
      .eq("company_id", companyId)
      .maybeSingle();
    err(aErr, "Leer la dirección");
    const addr = addrData as Record<string, unknown> | null;
    if (addr && addr.customer_id === target.id) {
      direccion = "ya_es_suya";
    } else if (addr) {
      const { data: twinData, error: tErr } = await admin
        .from("addresses")
        .select("id")
        .eq("company_id", companyId)
        .eq("customer_id", target.id)
        .eq("street", addr.street ?? "")
        .eq("street_number", addr.street_number ?? "")
        .eq("postal_code", addr.postal_code ?? "")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      err(tErr, "Buscar la dirección en el destino");
      twinAddressId = (twinData as { id: string } | null)?.id ?? null;
      if (twinAddressId) direccion = "reutiliza";
      else {
        addressToClone = addr;
        direccion = "copia";
      }
    }
  }

  // --- Datos de facturación del destino (si va a recibir cuotas) ----------
  let bloqueo = bloqueoPorContratoCompartido(contratos);
  const conCuotas = contratosConCuotas(contratos);
  const extraAvisos: string[] = [];
  {
    const { data: dirP, error: dErr } = await admin
      .from("addresses")
      .select("street, postal_code, city")
      .eq("company_id", companyId)
      .eq("customer_id", target.id)
      .eq("is_primary", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    err(dErr, "Leer la dirección principal del destino");
    const faltan = faltanDatosFacturacion(target, dirP as never);
    if (faltan.length > 0) {
      const texto = `A ${customerLabel(target)} le falta para poder facturarle: ${faltan.join(", ")}.`;
      if (conCuotas.length > 0 && !bloqueo) {
        bloqueo = `${texto} Este traspaso le pasa cuotas de contrato: complétalo en su ficha antes.`;
      } else {
        extraAvisos.push(`${texto} Complétalo antes de facturarle.`);
      }
    }
  }

  const resumen = resumenTraspasoEquipo({
    origenNombre: customerLabel(origin),
    destinoNombre: customerLabel(target),
    equipos: ids.length,
    contratos,
    instalaciones,
    mantenimientos,
    contratosMantenimiento: contratosMant,
    incidencias,
    apuntesPendientes: apuntes,
    cobrosFacturadosPendientes: cobrosFacturados,
    mandatosVivos: mandatos,
    direccion,
    seSueltaDelPack: equipment.parent_equipment_id !== null,
    accesoriosQueSeQuedan: includeChildren ? 0 : directChildren.length,
  });
  resumen.avisos.push(...extraAvisos);

  return {
    ok: true,
    plan: {
      equipment,
      origin,
      target,
      ids,
      directChildren,
      includeChildren,
      contratos,
      bloqueo,
      resumen,
      addressToClone,
      twinAddressId,
    },
  };
}

/** Paso 1 del diálogo: qué se va a mover, sin tocar nada. */
export async function previewTransferEquipmentAction(input: {
  equipment_id: string;
  target_customer_id: string;
  include_children?: boolean;
}): Promise<
  | { ok: true; origen: string; destino: string; bloqueo: string | null; resumen: ResumenTraspaso }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeTraspasar(session)) return { ok: false, error: "Solo un administrador puede traspasar equipos" };
    const admin = createAdminClient() as Admin;
    const r = await planificar(admin, session.company_id, input);
    if (!r.ok) return r;
    return {
      ok: true,
      origen: customerLabel(r.plan.origin),
      destino: customerLabel(r.plan.target),
      bloqueo: r.plan.bloqueo,
      resumen: r.plan.resumen,
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** Paso 2: el traspaso de verdad (todo o nada). */
export async function transferEquipmentAction(input: {
  equipment_id: string;
  target_customer_id: string;
  /**
   * Un pack es una sola instalación física: por defecto viaja entero. A
   * false solo si de verdad se quiere partir el pack entre dos clientes.
   */
  include_children?: boolean;
  motivo: string;
}): Promise<{ ok: true; result: TransferEquipmentResult } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeTraspasar(session)) return { ok: false, error: "Solo un administrador puede traspasar equipos" };
    const motivoErr = validarMotivo(input.motivo);
    if (motivoErr) return { ok: false, error: motivoErr };
    const motivo = input.motivo.trim();

    const admin = createAdminClient() as Admin;
    const companyId = session.company_id;
    const r = await planificar(admin, companyId, input);
    if (!r.ok) return r;
    const p = r.plan;
    if (p.bloqueo) return { ok: false, error: p.bloqueo };

    // Dirección: se copia ANTES de la transacción (si esta falla, se borra).
    let newAddressId: string | null = p.twinAddressId ?? p.equipment.address_id;
    let clonedId: string | null = null;
    if (p.addressToClone) {
      const clone: Record<string, unknown> = { ...p.addressToClone };
      delete clone.id;
      delete clone.created_at;
      delete clone.updated_at;
      clone.customer_id = p.target.id;
      clone.lead_id = null;
      // La principal de una ficha es asunto de esa ficha.
      clone.is_primary = false;
      clone.created_by = session.user_id;
      const { data: insData, error: insErr } = await admin.from("addresses").insert(clone).select("id").single();
      if (insErr) return { ok: false, error: `No se pudo copiar la dirección: ${insErr.message}` };
      clonedId = (insData as { id: string }).id;
      newAddressId = clonedId;
    }
    const oldAddressId = p.equipment.address_id;
    // Si la dirección ya era del destino, no hay nada que reapuntar.
    if (!p.addressToClone && !p.twinAddressId) newAddressId = oldAddressId;

    const payload = {
      equipment_id: p.equipment.id,
      serial_number: p.equipment.serial_number,
      from_customer_id: p.origin.id,
      from_customer_name: customerLabel(p.origin),
      to_customer_id: p.target.id,
      to_customer_name: customerLabel(p.target),
      contract_refs: p.contratos.map((k) => k.reference_code ?? k.id.slice(0, 8)),
      actor_name: session.full_name ?? session.email ?? null,
      resumen: `${customerLabel(p.origin)} → ${customerLabel(p.target)}. Motivo: ${motivo}`,
      mueve: p.resumen.mueve,
      no_mueve: p.resumen.noMueve,
    };

    const { data: res, error: rpcErr } = await admin.rpc("traspasar_equipo_a_cliente", {
      p_company_id: companyId,
      p_origen_id: p.origin.id,
      p_destino_id: p.target.id,
      p_equipment_ids: p.ids,
      p_contract_ids: p.contratos.map((k) => k.id),
      p_old_address_id: oldAddressId,
      p_new_address_id: newAddressId,
      p_detach_root_id: p.equipment.parent_equipment_id ? p.equipment.id : null,
      p_detach_children: !p.includeChildren ? p.directChildren : [],
      p_motivo: motivo,
      p_actor_user_id: session.user_id,
      p_payload: payload,
    });
    if (rpcErr) {
      if (clonedId) {
        await admin.from("addresses").delete().eq("id", clonedId).eq("company_id", companyId);
      }
      if (/traspasar_equipo_a_cliente|PGRST202|Could not find the function/i.test(`${rpcErr.code ?? ""} ${rpcErr.message}`)) {
        return {
          ok: false,
          error: "Falta aplicar la migración 20261110090000_traspaso_equipo_completo en la base de datos. No se ha cambiado nada.",
        };
      }
      const msg = String(rpcErr.message ?? "").replace(/^TRASPASO:\s*/, "");
      return { ok: false, error: `No se ha cambiado nada: ${msg}` };
    }

    revalidatePath(`/clientes/${p.origin.id}`);
    revalidatePath(`/clientes/${p.target.id}`);
    for (const k of p.contratos) revalidatePath(`/contratos/${k.id}`);

    const d = (res ?? {}) as Partial<TransferEquipmentResult>;
    return {
      ok: true,
      result: {
        equipment_moved: d.equipment_moved ?? 0,
        contracts_moved: d.contracts_moved ?? 0,
        installations_moved: d.installations_moved ?? 0,
        jobs_moved: d.jobs_moved ?? 0,
        maintenance_contracts_moved: d.maintenance_contracts_moved ?? 0,
        incidents_moved: d.incidents_moved ?? 0,
        wallet_moved: d.wallet_moved ?? 0,
        sepa_mandates_revoked: d.sepa_mandates_revoked ?? 0,
        address_cloned: clonedId !== null,
      },
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export interface TransferTarget {
  id: string;
  label: string;
  party_kind: "individual" | "company";
  is_autonomo: boolean;
  tax_id: string | null;
  related: boolean;
}

/**
 * Clientes destino posibles (cualquiera de la empresa: empresa, autónomo o
 * particular), sin el actual. Sin texto: los que comparten DNI/CIF, email o
 * teléfono (la misma persona con otra forma jurídica) y los más recientes.
 * Con texto: búsqueda por nombre, razón social, nombre comercial o DNI/CIF.
 */
export async function listTransferTargets(
  currentCustomerId: string,
  texto?: string,
): Promise<TransferTarget[]> {
  const session = await requireSession();
  if (!session.company_id || !puedeTraspasar(session)) return [];
  const admin = createAdminClient() as Admin;

  const cols = `${CUSTOMER_COLS}, email, phone_primary`;
  type Row = CustomerRow & { email: string | null; phone_primary: string | null };
  const { data: meData, error: meErr } = await admin
    .from("customers")
    .select(cols)
    .eq("id", currentCustomerId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (meErr) throw new Error(meErr.message);
  const me = meData as Row | null;
  if (!me) return [];

  const base = () =>
    admin
      .from("customers")
      .select(cols)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .neq("id", currentCustomerId);

  // Coma y paréntesis rompen el or=() de PostgREST; % y _ son comodines.
  const q = (texto ?? "").replace(/[,()%_*\\]/g, " ").trim().slice(0, 60);
  const safe = (v: string | null) => (v && !/[,()]/.test(v) ? v : null);
  const orParts: string[] = [];
  if (safe(me.tax_id)) orParts.push(`tax_id.eq.${safe(me.tax_id)}`);
  if (safe(me.email)) orParts.push(`email.eq.${safe(me.email)}`);
  if (safe(me.phone_primary)) orParts.push(`phone_primary.eq.${safe(me.phone_primary)}`);

  const [lista, relatives] = await Promise.all([
    q
      ? base()
          .or(
            `legal_name.ilike.%${q}%,trade_name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,tax_id.ilike.%${q}%`,
          )
          .limit(30)
      : base().order("created_at", { ascending: false }).limit(30),
    orParts.length > 0 ? base().or(orParts.join(",")).limit(50) : Promise.resolve({ data: [], error: null }),
  ]);
  if (lista.error) throw new Error(lista.error.message);
  if (relatives.error) throw new Error(relatives.error.message);

  const byId = new Map<string, Row>();
  for (const r of (relatives.data ?? []) as Row[]) byId.set(r.id, r);
  for (const r of (lista.data ?? []) as Row[]) byId.set(r.id, r);

  return [...byId.values()].map((r) => ({
    id: r.id,
    label: customerLabel(r),
    party_kind: r.party_kind,
    is_autonomo: !!r.is_autonomo,
    tax_id: r.tax_id,
    related:
      (!!me.email && r.email?.toLowerCase() === me.email.toLowerCase()) ||
      (!!me.phone_primary && r.phone_primary === me.phone_primary) ||
      (!!me.tax_id && r.tax_id?.toUpperCase() === me.tax_id.toUpperCase()),
  }));
}
