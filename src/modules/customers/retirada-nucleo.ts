import "server-only";
import { madridLocalToUtcISO } from "@/shared/lib/format-date";
import { adjustStockBatch, isFunctionMissingError } from "@/modules/warehouses/adjust-stock";
import { siguienteReferencia } from "@/modules/scheduling/referencias";
import { errorMessage } from "@/shared/lib/actions/safe-error";
import {
  ERROR_RENTING,
  ERROR_SIN_MODELO,
  equiposSinModeloAlAlmacen,
  leerParametrosRetirada,
  type DestinoEquipo,
} from "./retirada-logica";
import {
  COBRO_VACIO,
  dejarDeCobrarEquipos,
  equiposEnRenting,
  type ResultadoDejarDeCobrar,
} from "./retirada-cobro";

export type ResultadoCierreRetirada = {
  moved: number;
  deactivated: number;
} & ResultadoDejarDeCobrar;

/**
 * NÚCLEO de la retirada de equipos, compartido por:
 *  - la orden agendada (createUninstallAction → técnico → completeInstallation),
 *  - "ya está hecha" del flujo de baja de cliente (completeUninstallNowAction),
 *  - la retirada manual sin agendar (retirarEquipoManualAction).
 *
 * NO es una server action (no lleva "use server"): recibe el cliente admin y
 * el company_id YA verificados por quien lo llama, así no queda expuesto al
 * navegador un endpoint que mueva stock por id sin comprobar la sesión.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface CrearOrdenRetiradaEntrada {
  company_id: string;
  user_id: string;
  customer_id: string;
  equipment_ids: string[];
  destination_warehouse_id: string;
  scheduled_at?: string | null;
  default_state?: "used" | "damaged" | null;
  notes?: string | null;
  installer_user_id?: string | null;
  destinos?: Map<string, DestinoEquipo>;
  /**
   * Si es true, un fallo al guardar las líneas o el evento ABORTA (la orden
   * se borra). La retirada manual lo exige: sin líneas no vuelve el stock.
   * La orden agendada mantiene su comportamiento de siempre (solo registra).
   */
  estricto?: boolean;
}

/**
 * Crea la orden kind='uninstall' (installations + installation_items + evento
 * `equipment.uninstall_requested`). Es el cuerpo que antes vivía dentro de
 * createUninstallAction, sin cambios de comportamiento para ese camino.
 * Lanza Error con un mensaje para el usuario.
 */
export async function crearOrdenRetirada(
  admin: Admin,
  e: CrearOrdenRetiradaEntrada,
): Promise<{ installation_id: string; reference_code: string; equipos: number }> {
  // 1) Equipos válidos del cliente. SIN embed de products (un embed puede
  //    tumbar la query con equipos externos importados, product_id null).
  const { data: rawEq, error: eqErr } = await admin
    .from("customer_equipment")
    .select(
      "id, company_id, customer_id, product_id, external_equipment_model_id, address_id, serial_number, is_active",
    )
    .in("id", e.equipment_ids)
    .eq("company_id", e.company_id);
  if (eqErr) throw new Error(`No se pudieron leer los equipos: ${eqErr.message}`);
  type EQ = {
    id: string;
    company_id: string;
    customer_id: string;
    product_id: string | null;
    external_equipment_model_id: string | null;
    address_id: string | null;
    serial_number: string | null;
    is_active: boolean;
  };
  const valid = ((rawEq ?? []) as EQ[]).filter(
    (x) =>
      x.company_id === e.company_id &&
      x.customer_id === e.customer_id &&
      // La retirada manual "reserva" los equipos (is_active=false) ANTES de
      // crear la orden para que dos envíos a la vez no dupliquen el stock.
      (x.is_active || e.estricto === true),
  );
  if (valid.length === 0) throw new Error("Ningún equipo válido para desinstalar");

  // RENTING no se retira (Mario 2026-11-09). Aplica a todo lo que crea
  // órdenes: retirada agendada, agenda, baja de cliente y retirada manual.
  const enRenting = await equiposEnRenting(admin, e.company_id, valid.map((x) => x.id));
  if (enRenting.length > 0) throw new Error(ERROR_RENTING);

  // Equipo pendiente sin modelo que «vuelve al almacén»: sin producto no hay
  // dónde sumarlo al stock → se bloquea en vez de perderlo en silencio.
  if (equiposSinModeloAlAlmacen(valid, e.destinos).length > 0) {
    throw new Error(ERROR_SIN_MODELO);
  }

  const dispOf = (id: string): DestinoEquipo =>
    e.destinos?.get(id.toLowerCase()) ?? "warehouse";
  // Solo los equipos NUESTROS marcados 'warehouse' vuelven al stock.
  const ours = valid.filter((x) => x.product_id && dispOf(x.id) === "warehouse");

  // SEGURIDAD: el almacén llega del navegador → verificar que es de la empresa.
  if (e.destination_warehouse_id) {
    const { assertWarehouseCompany } = await import("@/modules/warehouses/ownership");
    await assertWarehouseCompany(e.destination_warehouse_id, e.company_id);
  }

  // 2) Reference code I-YYYY-NNNN (contador atómico por empresa).
  const referenceCode = await siguienteReferencia(admin, e.company_id, "installations", "I");

  // 3) Notas con el listado de equipos + destino. El #UUID se mantiene
  //    SIEMPRE: es lo que el cierre usa para dar de baja cada equipo.
  const prodIds = Array.from(new Set(valid.map((x) => x.product_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (prodIds.length > 0) {
    const { data: prods } = await admin.from("products").select("id, name").in("id", prodIds);
    for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(p.id, p.name);
    }
  }
  const DISP_TAG: Record<DestinoEquipo, string> = {
    warehouse: "",
    lost: " [PERDIDA]",
    broken: " [ROTA]",
    stolen: " [ROBADA]",
    not_ours: " [NO ES NUESTRO]",
  };
  const items = valid.map((x) => {
    const name = x.product_id ? nameById.get(x.product_id) ?? "Equipo" : "Equipo externo";
    return `${name}${x.serial_number ? ` (S/N ${x.serial_number})` : ""}${DISP_TAG[dispOf(x.id)]} #${x.id}`;
  });
  const status = e.scheduled_at ? "scheduled" : "unscheduled";
  const notesParts = [
    `Desinstalación de ${valid.length} equipo(s):`,
    ...items.map((i) => `  - ${i}`),
    `destination_warehouse_id=${e.destination_warehouse_id}`,
    `default_state=${e.default_state ?? "used"}`,
    e.notes ?? "",
  ].filter(Boolean);

  // 4) Orden
  const { data: inst, error: instErr } = await admin
    .from("installations")
    .insert({
      company_id: e.company_id,
      kind: "uninstall",
      status,
      reference_code: referenceCode,
      customer_id: e.customer_id,
      address_id: valid[0]?.address_id ?? null,
      scheduled_at: e.scheduled_at ? madridLocalToUtcISO(e.scheduled_at) : null,
      installer_user_id: e.installer_user_id ?? null,
      assigned_at: e.installer_user_id ? new Date().toISOString() : null,
      assigned_by: e.installer_user_id ? e.user_id : null,
      notes: notesParts.join("\n"),
    })
    .select("id")
    .single();
  if (instErr) throw new Error(instErr.message);
  const installationId = (inst as { id: string }).id;

  const deshacer = async () => {
    await admin.from("installations").delete().eq("id", installationId).eq("company_id", e.company_id);
  };

  // 5) Una línea por equipo nuestro que vuelve a almacén (1 ud por equipo).
  if (ours.length > 0) {
    const { error: lErr } = await admin.from("installation_items").insert(
      ours.map((x) => ({
        installation_id: installationId,
        company_id: e.company_id,
        product_id: x.product_id,
        quantity: 1,
        serial_number: x.serial_number,
        notes: `Desinstalar — equipment ${x.id}`,
      })),
    );
    if (lErr) {
      if (e.estricto) {
        await deshacer();
        throw new Error(`No se pudieron guardar las líneas de la retirada: ${lErr.message}`);
      }
      console.error("[uninstall] items insert:", lErr.message);
    }
  }

  // 6) Evento en el cliente
  try {
    const { error: evErr } = await admin.from("events").insert({
      company_id: e.company_id,
      subject_type: "customer",
      subject_id: e.customer_id,
      kind: "equipment.uninstall_requested",
      payload: {
        installation_id: installationId,
        equipment_ids: e.equipment_ids,
        destination_warehouse_id: e.destination_warehouse_id,
        default_state: e.default_state ?? "used",
        dispositions: valid.map((x) => ({ id: x.id, disposition: dispOf(x.id) })),
      },
      actor_user_id: e.user_id,
    });
    if (evErr) console.error("[uninstall] evento:", evErr.message);
  } catch {
    /* no-op: el evento de "solicitada" es informativo */
  }

  return { installation_id: installationId, reference_code: referenceCode, equipos: valid.length };
}

/** Fallo del cierre indicando si el stock llegó a aplicarse. */
export class ErrorCierreRetirada extends Error {
  constructor(
    message: string,
    public readonly stockAplicado: boolean,
  ) {
    super(message);
    this.name = "ErrorCierreRetirada";
  }
}

/**
 * Efectos de una orden kind='uninstall' COMPLETADA: devuelve el stock de los
 * equipos que vuelven a almacén (RPC atómica adjust_stock_batch) y da de baja
 * (is_active=false) TODOS los equipos de la orden.
 *
 * NO es idempotente por sí solo: quien lo llama debe haber hecho antes el
 * compare-and-set del estado de la orden (solo una llamada pasa a completed).
 * El destino y el estado se leen de las notas que serializó crearOrdenRetirada.
 */
export async function aplicarCierreRetirada(
  admin: Admin,
  companyId: string,
  installationId: string,
  contexto?: { actor_user_id?: string | null; motivo?: string | null },
): Promise<ResultadoCierreRetirada> {
  const vacio: ResultadoCierreRetirada = { moved: 0, deactivated: 0, ...COBRO_VACIO };
  const { data: inst, error: iErr } = await admin
    .from("installations")
    .select("id, company_id, kind, notes, customer_id, reference_code, completed_at")
    .eq("id", installationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (iErr) throw new ErrorCierreRetirada(`No se pudo leer la orden: ${iErr.message}`, false);
  if (!inst) return vacio;
  const i = inst as {
    id: string;
    company_id: string;
    kind: string;
    notes: string | null;
    customer_id: string | null;
    reference_code: string | null;
    completed_at: string | null;
  };
  if (i.kind !== "uninstall") return vacio;

  const { destinoAlmacenId, estadoVuelta, equipoIds } = leerParametrosRetirada(i.notes);

  // Red de seguridad: un equipo en RENTING no se retira aunque la orden se
  // creara antes de la regla. Se para ANTES de mover stock.
  try {
    if ((await equiposEnRenting(admin, companyId, equipoIds)).length > 0) {
      throw new ErrorCierreRetirada(ERROR_RENTING, false);
    }
  } catch (e) {
    if (e instanceof ErrorCierreRetirada) throw e;
    throw new ErrorCierreRetirada(errorMessage(e), false);
  }

  // Líneas a devolver a stock (solo existen para los equipos 'warehouse').
  type IT = { product_id: string; quantity: number; serial_number: string | null; notes: string | null };
  let list: IT[] = [];
  if (destinoAlmacenId) {
    const { data: items, error: itErr } = await admin
      .from("installation_items")
      .select("product_id, quantity, serial_number, notes")
      // La orden ya se comprobó arriba contra companyId.
      .eq("installation_id", installationId);
    if (itErr) {
      throw new ErrorCierreRetirada(`No se pudieron leer las líneas: ${itErr.message}`, false);
    }
    list = (items ?? []) as IT[];
  }
  let moved = 0;

  if (list.length > 0 && destinoAlmacenId) {
    // Reincorporación ATÓMICA (una transacción). Si la RPC no existe, camino
    // clásico → nunca peor que antes.
    let usedAtomic = false;
    try {
      await adjustStockBatch(
        i.company_id,
        null,
        list.map((it) => ({
          warehouse_id: destinoAlmacenId,
          product_id: it.product_id,
          state: estadoVuelta,
          delta: it.quantity,
          movement_type: "return",
          installation_id: i.id,
          notes: it.notes ?? null,
          reason: `Desinstalación cliente — entra como ${estadoVuelta}`,
        })),
      );
      moved = list.reduce((s, it) => s + it.quantity, 0);
      usedAtomic = true;
    } catch (e) {
      // Solo fallback si la RPC no existe; otro error → propagar (evita doble
      // abono de stock). audit Fable C3. La RPC es atómica: si falla, no aplicó nada.
      if (!isFunctionMissingError(e)) {
        throw new ErrorCierreRetirada(`No se pudo devolver el stock: ${errorMessage(e)}`, false);
      }
      console.error("[aplicarCierreRetirada] adjust_stock_batch no aplicada, fallback:", errorMessage(e));
    }

    if (!usedAtomic) {
      // ---- Camino clásico (no atómico): solo si la RPC no está disponible ----
      for (const it of list) {
        const { data: existing } = await admin
          .from("warehouse_stock")
          .select("id, quantity")
          .eq("company_id", i.company_id)
          .eq("warehouse_id", destinoAlmacenId)
          .eq("product_id", it.product_id)
          .eq("state", estadoVuelta)
          .is("location_id", null)
          .maybeSingle();
        const row = existing as { id: string; quantity: number } | null;
        if (row) {
          await admin.from("warehouse_stock").update({ quantity: row.quantity + it.quantity }).eq("id", row.id);
        } else {
          await admin.from("warehouse_stock").insert({
            company_id: i.company_id,
            warehouse_id: destinoAlmacenId,
            product_id: it.product_id,
            quantity: it.quantity,
            state: estadoVuelta,
          });
        }
        await admin.from("stock_movements").insert({
          company_id: i.company_id,
          product_id: it.product_id,
          warehouse_id: destinoAlmacenId,
          movement_type: "return",
          quantity: it.quantity,
          state_after: estadoVuelta,
          installation_id: i.id,
          notes: it.notes ?? null,
          reason: `Desinstalación cliente — entra como ${estadoVuelta}`,
        });
        moved += it.quantity;
      }
    }
  }

  // Baja de los equipos referenciados en las notas (#UUID).
  let deactivated = 0;
  if (equipoIds.length > 0 && i.customer_id) {
    const { error: deErr } = await admin
      .from("customer_equipment")
      .update({ is_active: false })
      .in("id", equipoIds)
      .eq("customer_id", i.customer_id)
      .eq("company_id", companyId);
    if (deErr) {
      throw new ErrorCierreRetirada(`No se pudieron dar de baja los equipos: ${deErr.message}`, true);
    }
    deactivated = equipoIds.length;
  }

  // Al retirar el equipo SE DEJA DE COBRAR (decisión Mario 2026-11-09):
  // contrato con cuota, contrato de mantenimiento y mantenimientos futuros.
  // Nunca lanza: lo que no se pueda hacer vuelve como aviso.
  let cobro = COBRO_VACIO;
  if (equipoIds.length > 0 && i.customer_id) {
    cobro = await dejarDeCobrarEquipos(admin, companyId, {
      customer_id: i.customer_id,
      equipment_ids: equipoIds,
      installation_id: i.id,
      referencia: i.reference_code ?? i.id.slice(0, 8),
      fecha: i.completed_at ?? new Date().toISOString(),
      motivo: contexto?.motivo ?? null,
      actor_user_id: contexto?.actor_user_id ?? null,
    });
  }

  return { moved, deactivated, ...cobro };
}

/**
 * Cierra una orden kind='uninstall' "en despacho" (sin wizard del técnico):
 * compare-and-set a 'completed' y aplica el cierre común. Si el cierre falla
 * ANTES de mover stock, devuelve la orden a su estado anterior para que se
 * pueda reintentar sin riesgo; si falla después, la deja cerrada (preferimos
 * un paso pendiente visible a un stock duplicado invisible).
 *
 * Idempotente: si ya estaba completada no hace nada (`ya_cerrada: true`).
 */
export async function cerrarOrdenRetirada(
  admin: Admin,
  companyId: string,
  installationId: string,
  opciones: {
    completed_at: string;
    notas_extra?: string | null;
    actor_user_id?: string | null;
    motivo?: string | null;
  },
): Promise<
  | ({ ok: true; ya_cerrada: boolean } & ResultadoCierreRetirada)
  | { ok: false; error: string }
> {
  const { data: inst, error: iErr } = await admin
    .from("installations")
    .select("id, company_id, kind, status, notes, free_trial_id")
    .eq("id", installationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (iErr) return { ok: false, error: iErr.message };
  const i = inst as
    | { id: string; kind: string; status: string; notes: string | null; free_trial_id: string | null }
    | null;
  if (!i) return { ok: false, error: "Orden no encontrada o no pertenece a tu empresa" };
  if (i.kind !== "uninstall") return { ok: false, error: "No es una orden de desinstalación" };
  if (i.status === "completed") return { ok: true, ya_cerrada: true, moved: 0, deactivated: 0, ...COBRO_VACIO };
  if (i.status === "cancelled") return { ok: false, error: "La orden de retirada está cancelada" };

  const extra = (opciones.notas_extra ?? "").trim();
  const notas = extra ? `${(i.notes ?? "").trim()}\n---\n${extra}` : i.notes;
  const { data: cerradas, error: cErr } = await admin
    .from("installations")
    .update({ status: "completed", completed_at: opciones.completed_at, notes: notas })
    .eq("id", i.id)
    .eq("company_id", companyId)
    .not("status", "in", "(completed,cancelled)")
    .select("id");
  if (cErr) return { ok: false, error: `No se pudo cerrar la orden: ${cErr.message}` };
  if (!cerradas || (cerradas as unknown[]).length === 0) {
    // Otro envío la cerró a la vez: sin efectos secundarios.
    return { ok: true, ya_cerrada: true, moved: 0, deactivated: 0, ...COBRO_VACIO };
  }

  let res: ResultadoCierreRetirada;
  try {
    res = await aplicarCierreRetirada(admin, companyId, i.id, {
      actor_user_id: opciones.actor_user_id ?? null,
      motivo: opciones.motivo ?? null,
    });
  } catch (e) {
    const stockAplicado = e instanceof ErrorCierreRetirada ? e.stockAplicado : true;
    if (!stockAplicado) {
      const { error: rErr } = await admin
        .from("installations")
        .update({ status: i.status, completed_at: null, notes: i.notes })
        .eq("id", i.id)
        .eq("company_id", companyId);
      if (rErr) console.error("[cerrarOrdenRetirada] revertir estado:", rErr.message);
    }
    return {
      ok: false,
      error: stockAplicado
        ? `La retirada quedó cerrada pero falló un paso: ${errorMessage(e)}`
        : errorMessage(e),
    };
  }

  // Igual que completeInstallation: si viene de una prueba gratuita, la prueba
  // pasa a 'removed'.
  if (i.free_trial_id) {
    try {
      const ft = await import("@/modules/free-trials/uninstall-actions");
      await ft.processFreeTrialUninstallCompletion(i.id);
    } catch (e) {
      console.error("[cerrarOrdenRetirada] prueba gratuita:", errorMessage(e));
    }
  }

  return { ok: true, ya_cerrada: false, ...res };
}

/**
 * Deja constancia de lo que hizo el cierre de una retirada agendada (o "ya
 * está hecha"): evento en el cliente y, si hay avisos (contrato que sigue
 * cobrando, fianza pendiente…), notificación a admin / director técnico.
 * La retirada manual registra su propio evento con el motivo.
 */
export async function registrarResultadoCierre(
  admin: Admin,
  companyId: string,
  installationId: string,
  res: ResultadoCierreRetirada,
  actorUserId: string | null,
): Promise<void> {
  try {
    const { data: inst } = await admin
      .from("installations")
      .select("customer_id, reference_code")
      .eq("id", installationId)
      .eq("company_id", companyId)
      .maybeSingle();
    const i = inst as { customer_id: string | null; reference_code: string | null } | null;
    if (!i?.customer_id) return;
    const { error } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: i.customer_id,
      kind: "equipment.uninstall_completed",
      payload: { installation_id: installationId, reference_code: i.reference_code, ...res },
      actor_user_id: actorUserId,
    });
    if (error) console.error("[registrarResultadoCierre] evento:", error.message);
    if (res.avisos.length > 0) {
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      await notifyByRoles(companyId, ["company_admin", "technical_director"], {
        kind: "equipment.uninstall_completed",
        severity: "warning",
        title: `Retirada ${i.reference_code ?? ""}: revisa el cobro`.trim(),
        body: res.avisos.join(" "),
        subject_type: "installation",
        subject_id: installationId,
        action_url: `/clientes/${i.customer_id}`,
      });
    }
  } catch (e) {
    console.error("[registrarResultadoCierre]", errorMessage(e));
  }
}

/**
 * Añade una marca ("PARA REVISAR") a las líneas de la orden: el cierre usa
 * esas notas en el movimiento de stock, así queda visible en el almacén.
 */
export async function marcarLineasParaRevisar(
  admin: Admin,
  installationId: string,
  marca: string,
): Promise<void> {
  const { data, error } = await admin
    .from("installation_items")
    .select("id, notes")
    .eq("installation_id", installationId);
  if (error) {
    console.error("[marcarLineasParaRevisar]", error.message);
    return;
  }
  for (const it of (data ?? []) as Array<{ id: string; notes: string | null }>) {
    const notas = it.notes ? `${it.notes} · ${marca}` : marca;
    const { error: uErr } = await admin.from("installation_items").update({ notes: notas }).eq("id", it.id);
    if (uErr) console.error("[marcarLineasParaRevisar]", uErr.message);
  }
}
