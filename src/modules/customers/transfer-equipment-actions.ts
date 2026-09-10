"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";

/**
 * TRASPASO DE TITULARIDAD DE UN EQUIPO
 *
 * El caso real: un cliente de siempre —particular o autónomo— tiene tres
 * equipos y te dice que a partir de ahora quiere uno a nombre de su sociedad y
 * los otros dos a título personal. El equipo no se mueve de sitio, no va nadie
 * a tocarlo: lo único que cambia es a quién se le factura.
 *
 * Por eso esto NO es `relocateEquipmentAction` (que sí manda a un técnico a
 * llevárselo a otra dirección) ni `mergeCustomersAction` (que fusiona dos
 * fichas en una). Aquí las dos fichas siguen vivas y separadas a propósito:
 * son dos titulares fiscales distintos de la misma persona.
 *
 * QUÉ SE MUEVE
 *   · El equipo, y sus accesorios si es un pack (parent_equipment_id).
 *   · La dirección donde está instalado: se clona en la ficha destino, porque
 *     `addresses.customer_id` va en CASCADE y si un día se borra la ficha de
 *     origen el equipo se quedaría sin dirección.
 *   · Los mantenimientos PENDIENTES (todo lo que no esté completado ni
 *     cancelado) y el contrato de mantenimiento ACTIVO: las próximas visitas y
 *     las próximas cuotas son del titular nuevo.
 *   · Las incidencias ABIERTAS.
 *
 * QUÉ NO SE MUEVE, NUNCA
 *   · Facturas. Lo ya facturado es de quien lo pagó, y con VeriFactu de por
 *     medio reasignar una factura emitida no es una corrección, es un fraude.
 *   · Mantenimientos completados o cancelados, e incidencias cerradas: son
 *     historia de lo que le pasó a ese titular.
 *   · Monedero (`wallet_entries`) y contratos de financiación (`contracts`):
 *     son deuda de una persona concreta.
 *
 * O sea: el futuro se muda, el pasado se queda. Que es exactamente lo que
 * pide Hacienda y lo que espera cualquiera que mire la ficha antigua.
 */

/** Mantenimientos que ya son historia y por tanto no se tocan. */
const MAINTENANCE_DONE = ["completed", "cancelled"] as const;
/** Incidencias que ya son historia. */
const INCIDENT_DONE = ["closed", "cancelled", "resolved"] as const;

export interface TransferEquipmentResult {
  equipment_moved: number;
  jobs_moved: number;
  contracts_moved: number;
  incidents_moved: number;
  address_cloned: boolean;
  detached_from_pack: boolean;
  /** Pasos que fallaron después de mover el equipo. Vacío = todo limpio. */
  warnings: string[];
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

function customerLabel(c: CustomerRow): string {
  if (c.party_kind === "company") {
    return c.trade_name || c.legal_name || "Empresa sin nombre";
  }
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre";
}

export async function transferEquipmentAction(input: {
  equipment_id: string;
  target_customer_id: string;
  /**
   * Un pack (depuradora + descalcificador, por ejemplo) es una sola instalación
   * física: por defecto viaja entero. Ponlo a false solo si de verdad quieres
   * partir el pack entre dos titulares.
   */
  include_children?: boolean;
  notes?: string | null;
}): Promise<
  { ok: true; result: TransferEquipmentResult } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    // Mismo listón que reubicar o cambiar la modalidad de compra: cambia a
    // quién se factura, así que no lo hace un comercial de nivel 3.
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("technical_director");
    if (!isUpper) {
      return { ok: false, error: "Solo admin o dirección puede cambiar el titular de un equipo" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const companyId = session.company_id;

    // --- 1. El equipo, comprobando que es de esta empresa -------------------
    const { data: eqData } = await admin
      .from("customer_equipment")
      .select("id, company_id, customer_id, address_id, parent_equipment_id, serial_number")
      .eq("id", input.equipment_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const equipment = eqData as EquipmentRow | null;
    if (!equipment) {
      return { ok: false, error: "Equipo no encontrado o no pertenece a tu empresa" };
    }

    if (equipment.customer_id === input.target_customer_id) {
      return { ok: false, error: "El equipo ya está a nombre de esa ficha" };
    }

    // --- 2. Las dos fichas -------------------------------------------------
    const customerCols =
      "id, company_id, party_kind, is_autonomo, legal_name, trade_name, first_name, last_name, tax_id, deleted_at";
    const { data: bothData } = await admin
      .from("customers")
      .select(customerCols)
      .in("id", [equipment.customer_id, input.target_customer_id])
      .eq("company_id", companyId);
    const both = (bothData ?? []) as CustomerRow[];
    const origin = both.find((c) => c.id === equipment.customer_id);
    const target = both.find((c) => c.id === input.target_customer_id);
    if (!origin || !target) {
      return { ok: false, error: "Ficha de origen o destino no encontrada en tu empresa" };
    }
    if (target.deleted_at) {
      return { ok: false, error: "La ficha de destino está borrada" };
    }

    // --- 3. Qué equipos viajan --------------------------------------------
    const includeChildren = input.include_children !== false;
    const ids = [equipment.id];
    // Descendencia completa, no solo los hijos directos. Hoy el modelo solo
    // encadena un nivel (extras colgando de un principal), pero nada en la BD
    // impide un nieto y un nieto olvidado se queda apuntando a un equipo que
    // ya es de otro titular. El bucle está acotado por si alguien crea un
    // ciclo a mano.
    const childrenOf = async (parents: string[]): Promise<string[]> => {
      const { data: kids } = await admin
        .from("customer_equipment")
        .select("id")
        .in("parent_equipment_id", parents)
        .eq("company_id", companyId);
      return ((kids ?? []) as Array<{ id: string }>).map((k) => k.id);
    };
    const directChildren = await childrenOf([equipment.id]);
    if (includeChildren) {
      let frontier = directChildren;
      for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
        for (const id of frontier) if (!ids.includes(id)) ids.push(id);
        frontier = (await childrenOf(frontier)).filter((id) => !ids.includes(id));
      }
    }

    // Si lo que se mueve es un accesorio de un pack que se queda, hay que
    // soltarlo del padre: si no, quedaría colgando de un equipo que ya es de
    // otro titular y la ficha del pack mentiría.
    const detachFromPack = equipment.parent_equipment_id !== null;

    // Sin transacción (PostgREST no las expone), así que lo que falle a mitad
    // se recoge aquí y se devuelve: el traspaso queda hecho pero el llamante
    // sabe exactamente qué se quedó a medias en vez de creerse que fue bien.
    const partial: string[] = [];

    // --- 4. La dirección ---------------------------------------------------
    // El equipo sigue físicamente donde estaba, pero la dirección cuelga de la
    // ficha de origen. Se clona en la de destino (o se reutiliza una idéntica
    // que ya tenga) para que el equipo no dependa de una ficha ajena.
    let newAddressId: string | null = equipment.address_id;
    let addressCloned = false;
    if (equipment.address_id) {
      const { data: addrData } = await admin
        .from("addresses")
        .select("*")
        .eq("id", equipment.address_id)
        .eq("company_id", companyId)
        .maybeSingle();
      const addr = addrData as Record<string, unknown> | null;
      if (addr && addr.customer_id !== target.id) {
        const { data: twinData } = await admin
          .from("addresses")
          .select("id")
          .eq("company_id", companyId)
          .eq("customer_id", target.id)
          .eq("street", addr.street ?? "")
          .eq("street_number", addr.street_number ?? "")
          .eq("postal_code", addr.postal_code ?? "")
          .is("deleted_at", null)
          .maybeSingle();
        const twin = twinData as { id: string } | null;
        if (twin) {
          newAddressId = twin.id;
        } else {
          const clone: Record<string, unknown> = { ...addr };
          delete clone.id;
          delete clone.created_at;
          delete clone.updated_at;
          clone.customer_id = target.id;
          clone.lead_id = null;
          // La principal de una ficha es asunto de esa ficha: la copia entra
          // como una dirección más y no le roba el "principal" a la de destino.
          clone.is_primary = false;
          clone.created_by = session.user_id;
          const { data: insData, error: insErr } = await admin
            .from("addresses")
            .insert(clone)
            .select("id")
            .single();
          if (insErr) {
            return { ok: false, error: `No se pudo copiar la dirección: ${insErr.message}` };
          }
          newAddressId = (insData as { id: string }).id;
          addressCloned = true;
        }
      }
    }

    // --- 5. Mover los equipos ---------------------------------------------
    const equipmentPatch: Record<string, unknown> = {
      customer_id: target.id,
      address_id: newAddressId,
    };
    const { error: eqErr } = await admin
      .from("customer_equipment")
      .update(equipmentPatch)
      .in("id", ids)
      .eq("company_id", companyId);
    if (eqErr) return { ok: false, error: eqErr.message };

    if (detachFromPack) {
      const { error } = await admin
        .from("customer_equipment")
        .update({ parent_equipment_id: null })
        .eq("id", equipment.id)
        .eq("company_id", companyId);
      if (error) partial.push(`soltar del pack de origen: ${error.message}`);
    }

    // Si el pack se parte a propósito (include_children = false), los extras
    // que se quedan NO pueden seguir colgando de un equipo que ya es de otro
    // titular: la ficha vieja mostraría "Extra del pack" sin pack, y dar de
    // baja el principal en la ficha nueva arrastraría en cascada equipos de
    // un cliente distinto.
    if (!includeChildren && directChildren.length > 0) {
      const { error } = await admin
        .from("customer_equipment")
        .update({ parent_equipment_id: null })
        .in("id", directChildren)
        .eq("company_id", companyId);
      if (error) partial.push(`soltar los extras que se quedan: ${error.message}`);
    }

    // --- 6. Mantenimientos pendientes -------------------------------------
    const { data: jobsData } = await admin
      .from("maintenance_jobs")
      .select("id")
      .in("customer_equipment_id", ids)
      .eq("company_id", companyId)
      .not("status", "in", `(${MAINTENANCE_DONE.join(",")})`);
    const jobIds = ((jobsData ?? []) as Array<{ id: string }>).map((j) => j.id);
    if (jobIds.length > 0) {
      const { error } = await admin
        .from("maintenance_jobs")
        .update({ customer_id: target.id, address_id: newAddressId })
        .in("id", jobIds)
        .eq("company_id", companyId);
      if (error) partial.push(`mover mantenimientos pendientes: ${error.message}`);
    }

    // --- 7. Contrato de mantenimiento activo ------------------------------
    const { data: contractsData } = await admin
      .from("maintenance_contracts")
      .select("id")
      .in("customer_equipment_id", ids)
      .eq("company_id", companyId)
      .eq("status", "active");
    const contractIds = ((contractsData ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contractIds.length > 0) {
      const { error } = await admin
        .from("maintenance_contracts")
        .update({ customer_id: target.id })
        .in("id", contractIds)
        .eq("company_id", companyId);
      if (error) partial.push(`mover el contrato de mantenimiento: ${error.message}`);
    }

    // --- 8. Incidencias abiertas ------------------------------------------
    const { data: incData } = await admin
      .from("incidents")
      .select("id")
      .in("customer_equipment_id", ids)
      .eq("company_id", companyId)
      .not("status", "in", `(${INCIDENT_DONE.join(",")})`);
    const incidentIds = ((incData ?? []) as Array<{ id: string }>).map((i) => i.id);
    if (incidentIds.length > 0) {
      const { error } = await admin
        .from("incidents")
        .update({ customer_id: target.id, address_id: newAddressId })
        .in("id", incidentIds)
        .eq("company_id", companyId);
      if (error) partial.push(`mover las incidencias abiertas: ${error.message}`);
    }

    // --- 9. Rastro en las dos fichas --------------------------------------
    // Se escribe en las dos a propósito: quien mire la ficha vieja dentro de un
    // año tiene que poder ver a dónde se fue el equipo, no encontrarse un hueco.
    const payload = {
      equipment_id: equipment.id,
      equipment_ids: ids,
      serial_number: equipment.serial_number,
      from_customer_id: origin.id,
      from_customer_name: customerLabel(origin),
      to_customer_id: target.id,
      to_customer_name: customerLabel(target),
      jobs_moved: jobIds.length,
      contracts_moved: contractIds.length,
      incidents_moved: incidentIds.length,
      notes: input.notes ?? null,
    };
    await admin.from("events").insert([
      {
        company_id: companyId,
        subject_type: "customer",
        subject_id: origin.id,
        kind: "equipment.transferred_out",
        payload,
        actor_user_id: session.user_id,
      },
      {
        company_id: companyId,
        subject_type: "customer",
        subject_id: target.id,
        kind: "equipment.transferred_in",
        payload,
        actor_user_id: session.user_id,
      },
    ]);

    revalidatePath(`/clientes/${origin.id}`);
    revalidatePath(`/clientes/${target.id}`);

    return {
      ok: true,
      result: {
        equipment_moved: ids.length,
        jobs_moved: jobIds.length,
        contracts_moved: contractIds.length,
        incidents_moved: incidentIds.length,
        address_cloned: addressCloned,
        detached_from_pack: detachFromPack,
        warnings: partial,
      },
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Fichas a las que tiene sentido traspasar: el mismo titular real dado de alta
 * con otra forma jurídica. Se detectan por DNI/CIF, email o teléfono
 * compartidos, que es exactamente lo que el anti-duplicados deja pasar cuando
 * cambia el `party_kind` (ver `isBlockingDuplicate`).
 *
 * Devuelve también las demás fichas de la empresa por si el traspaso es a un
 * tercero de verdad (una herencia, una empresa que compra el local), pero
 * marcadas como `related: false` para que la UI las separe.
 */
export async function listTransferTargets(currentCustomerId: string): Promise<
  Array<{
    id: string;
    label: string;
    party_kind: "individual" | "company";
    is_autonomo: boolean;
    tax_id: string | null;
    related: boolean;
  }>
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const cols =
    "id, company_id, party_kind, is_autonomo, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary, deleted_at";
  const { data: meData } = await admin
    .from("customers")
    .select(cols)
    .eq("id", currentCustomerId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const me = meData as (CustomerRow & { email: string | null; phone_primary: string | null }) | null;
  if (!me) return [];

  type Row = CustomerRow & { email: string | null; phone_primary: string | null };

  // Las 500 más recientes son solo la lista "por si acaso". El caso de uso
  // real —la misma persona dada de alta también como empresa— se busca
  // aparte por DNI/CIF, email o teléfono: si no, con 1.800 fichas la ficha
  // hermana se queda fuera de la ventana y el traspaso es imposible.
  const orParts: string[] = [];
  // Una coma o un paréntesis dentro del valor rompen la sintaxis del or=()
  // de PostgREST: esos se dejan fuera y ya los pillará la lista de recientes.
  const safe = (v: string | null) => (v && !/[,()]/.test(v) ? v : null);
  const meTaxId = safe(me.tax_id);
  const meEmail = safe(me.email);
  const mePhone = safe(me.phone_primary);
  if (meTaxId) orParts.push(`tax_id.eq.${meTaxId}`);
  if (meEmail) orParts.push(`email.eq.${meEmail}`);
  if (mePhone) orParts.push(`phone_primary.eq.${mePhone}`);

  const [recent, relatives] = await Promise.all([
    admin
      .from("customers")
      .select(cols)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .neq("id", currentCustomerId)
      .order("created_at", { ascending: false })
      .limit(500),
    orParts.length > 0
      ? admin
          .from("customers")
          .select(cols)
          .eq("company_id", session.company_id)
          .is("deleted_at", null)
          .neq("id", currentCustomerId)
          .or(orParts.join(","))
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);

  const byId = new Map<string, Row>();
  for (const r of ((recent?.data ?? []) as Row[])) byId.set(r.id, r);
  for (const r of ((relatives?.data ?? []) as Row[])) byId.set(r.id, r);
  const rows = [...byId.values()];

  return rows.map((r) => {
    const related =
      (!!me.email && r.email?.toLowerCase() === me.email.toLowerCase()) ||
      (!!me.phone_primary && r.phone_primary === me.phone_primary) ||
      (!!me.tax_id && r.tax_id?.toUpperCase() === me.tax_id.toUpperCase());
    return {
      id: r.id,
      label: customerLabel(r),
      party_kind: r.party_kind,
      is_autonomo: !!r.is_autonomo,
      tax_id: r.tax_id,
      related,
    };
  });
}
