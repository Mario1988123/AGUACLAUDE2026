"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  adjustStockBatch,
  isFunctionMissingError,
  type StockState,
} from "@/modules/warehouses/adjust-stock";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  aplicarCierreRetirada,
  cerrarOrdenRetirada,
  crearOrdenRetirada,
  registrarResultadoCierre,
} from "./retirada-nucleo";
import { puedeRetirar } from "./retirada-logica";

/**
 * Destino de cada equipo retirado:
 *  - 'warehouse': vuelve a un almacén (suma stock como usado/dañado). Default.
 *  - 'lost'     : máquina perdida (no se sabe dónde) — no vuelve a stock.
 *  - 'broken'   : rota, se tira a la basura — no vuelve a stock.
 *  - 'stolen'   : robada — no vuelve a stock.
 * En los tres últimos el equipo se da de baja igual, pero NO entra en ningún
 * almacén (queda registrado el motivo en notas + evento de auditoría).
 */
export type EquipmentDisposition = "warehouse" | "lost" | "broken" | "stolen" | "not_ours";

export interface UninstallEquipmentInput {
  customer_id: string;
  // Equipos seleccionados a desinstalar (todos del mismo cliente)
  equipment_ids: string[];
  // Almacén destino donde van los equipos usados.
  destination_warehouse_id: string;
  scheduled_at?: string | null;
  // Si por adelantado se sabe el state real (used / damaged), se puede
  // forzar aquí. Default: el técnico decide al completar la instalación.
  default_state?: "used" | "damaged" | null;
  notes?: string | null;
  // Técnico que hará la retirada (opcional). Si se asigna, la verá en su
  // "Mi día" y agenda como RETIRADA.
  installer_user_id?: string | null;
  // Destino por equipo (opcional). Si no se indica para un equipo, se asume
  // 'warehouse' (comportamiento clásico). Permite marcar perdida/rota/robada.
  equipment_dispositions?: Array<{
    equipment_id: string;
    disposition: EquipmentDisposition;
  }> | null;
}

/**
 * Crea una orden de desinstalación: una sola installation kind='uninstall'
 * que agrupa todos los equipos a retirar. Cuando se complete, el flujo
 * suma el stock al almacén destino con state=used (o el que se indique).
 *
 * No descuenta stock — al revés: cuando termine la instalación, el hook
 * de cierre incrementa el almacén destino. Por eso desactivamos el
 * decremento normal: kind='uninstall' lo detecta el flujo de cierre.
 */
export async function createUninstallAction(
  input: UninstallEquipmentInput,
): Promise<
  { ok: true; installation_id: string } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Solo admin o director técnico" };
    }
    if (input.equipment_ids.length === 0) {
      return { ok: false, error: "Selecciona al menos un equipo" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const destinos = new Map<string, EquipmentDisposition>();
    for (const d of input.equipment_dispositions ?? []) {
      destinos.set(d.equipment_id.toLowerCase(), d.disposition);
    }
    const creada = await crearOrdenRetirada(admin, {
      company_id: session.company_id,
      user_id: session.user_id,
      customer_id: input.customer_id,
      equipment_ids: input.equipment_ids,
      destination_warehouse_id: input.destination_warehouse_id,
      scheduled_at: input.scheduled_at ?? null,
      default_state: input.default_state ?? null,
      notes: input.notes ?? null,
      installer_user_id: input.installer_user_id ?? null,
      destinos,
    });
    const installationId = creada.installation_id;

    revalidatePath(`/clientes/${input.customer_id}`);
    revalidatePath("/instalaciones");
    return { ok: true, installation_id: installationId };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Programa una desinstalación DESDE LA AGENDA: el admin elige cliente, sus
 * equipos a retirar, el técnico y la fecha. El destino es la FURGONETA del
 * técnico (decisión 2026-06-11: el equipo retirado pasa primero a su furgoneta
 * con etiqueta 'usado' + S/N, y luego él lo descarga donde toque). Si el técnico
 * no tiene furgoneta, cae al almacén principal.
 */
export async function createUninstallFromAgendaAction(input: {
  customer_id: string;
  equipment_ids: string[];
  technician_user_id?: string | null;
  scheduled_at?: string | null;
  notes?: string | null;
}): Promise<
  { ok: true; installation_id: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    return { ok: false, error: "Solo admin o director técnico puede programar retiradas" };
  }
  if (!input.equipment_ids || input.equipment_ids.length === 0) {
    return { ok: false, error: "Selecciona al menos un equipo a retirar" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: whs } = await admin
    .from("warehouses")
    .select("id, kind, assigned_user_id")
    .eq("company_id", session.company_id)
    .is("deleted_at", null);
  const list = (whs ?? []) as Array<{
    id: string;
    kind: string;
    assigned_user_id: string | null;
  }>;

  let destWarehouseId: string | null = null;
  if (input.technician_user_id) {
    const van = list.find(
      (w) => w.kind === "vehicle" && w.assigned_user_id === input.technician_user_id,
    );
    if (van) destWarehouseId = van.id;
  }
  if (!destWarehouseId) {
    const main =
      list.find((w) => w.kind === "main") ?? list.find((w) => w.kind !== "vehicle");
    destWarehouseId = main?.id ?? null;
  }
  if (!destWarehouseId) {
    return {
      ok: false,
      error:
        "No hay almacén destino. Crea un almacén principal o asigna una furgoneta al técnico.",
    };
  }

  return createUninstallAction({
    customer_id: input.customer_id,
    equipment_ids: input.equipment_ids,
    destination_warehouse_id: destWarehouseId,
    default_state: "used",
    scheduled_at: input.scheduled_at ?? null,
    installer_user_id: input.technician_user_id ?? null,
    notes: input.notes ?? null,
  });
}

/**
 * Cuando se completa una installation kind='uninstall', el flujo normal de
 * cierre (completeInstallation) llama aquí: devuelve el stock al almacén
 * destino y da de baja los equipos. El cuerpo vive en `aplicarCierreRetirada`
 * (retirada-nucleo.ts), compartido con la retirada manual.
 *
 * SEGURIDAD: es una server action exportada → exige sesión y limita a la
 * empresa de la sesión (antes aceptaba cualquier id sin comprobar nada).
 * Quien la llama debe haber hecho ya el compare-and-set del estado.
 */
export async function processUninstallCompletion(
  installationId: string,
): Promise<{ moved: number; deactivated: number }> {
  const session = await requireSession();
  if (!session.company_id) return { moved: 0, deactivated: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const res = await aplicarCierreRetirada(admin, session.company_id, installationId, {
    actor_user_id: session.user_id,
  });
  await registrarResultadoCierre(admin, session.company_id, installationId, res, session.user_id);
  return { moved: res.moved, deactivated: res.deactivated };
}

/**
 * Cambia el estado de una línea de stock entre new/used/damaged/refurbished.
 * Pensado para "marcar como reacondicionado" desde el almacén de usados.
 * Si no hay otra línea con el nuevo estado, mueve la cantidad. Si hay,
 * fusiona.
 */
export async function changeStockStateAction(input: {
  warehouse_stock_id: string;
  new_state: "new" | "used" | "damaged" | "refurbished";
  quantity?: number;          // por defecto, todo
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Sin permisos" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("warehouse_stock")
      .select("id, warehouse_id, product_id, quantity, state, location_id, company_id")
      .eq("id", input.warehouse_stock_id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Línea no encontrada" };
    const r = row as {
      id: string;
      warehouse_id: string;
      product_id: string;
      quantity: number;
      state: string;
      location_id: string | null;
      company_id: string;
    };
    // SEGURIDAD: admin client salta RLS → la línea se cargó solo por id;
    // verificamos que es de tu empresa antes de mover/borrar stock.
    if (!session.company_id || r.company_id !== session.company_id) {
      return { ok: false, error: "Línea no encontrada o no pertenece a tu empresa" };
    }
    if (r.state === input.new_state) return { ok: true };
    const qty = Math.min(r.quantity, input.quantity ?? r.quantity);
    if (qty <= 0) return { ok: false, error: "Cantidad inválida" };

    // Cambio de estado ATÓMICO con adjust_stock_batch (auditoría 2026-10-01):
    // antes era leer-sumar-escribir en dos líneas sueltas, y dos cambios a la
    // vez (o un fallo a mitad) perdían o duplicaban unidades. La RPC aplica la
    // salida del estado viejo y la entrada en el nuevo en UNA transacción, con
    // bloqueo de fila, y registra los dos movimientos.
    let usedAtomic = false;
    try {
      const motivo = `Cambio de estado ${r.state} → ${input.new_state}`;
      await adjustStockBatch(r.company_id, session.user_id, [
        {
          warehouse_id: r.warehouse_id,
          product_id: r.product_id,
          state: r.state as StockState,
          location_id: r.location_id,
          delta: -qty,
          movement_type: "adjustment_minus",
          reason: motivo,
          notes: input.notes ?? null,
        },
        {
          warehouse_id: r.warehouse_id,
          product_id: r.product_id,
          state: input.new_state,
          location_id: r.location_id,
          delta: qty,
          movement_type: "adjustment_plus",
          reason: motivo,
          notes: input.notes ?? null,
        },
      ]);
      usedAtomic = true;
    } catch (e) {
      // Solo hay camino clásico si la RPC no existe; con cualquier otro error
      // pudo haber commiteado y repetir por legacy duplicaría stock.
      if (!isFunctionMissingError(e)) throw e instanceof Error ? e : new Error(String(e));
      console.error(
        "[changeStockState] adjust_stock_batch no aplicada, fallback:",
        e instanceof Error ? e.message : e,
      );
    }

    if (!usedAtomic) {
      // Decrementar línea original
      if (qty === r.quantity) {
        await admin.from("warehouse_stock").delete().eq("id", r.id);
      } else {
        await admin
          .from("warehouse_stock")
          .update({ quantity: r.quantity - qty })
          .eq("id", r.id);
      }

      // Sumar en línea destino
      const { data: existing } = await admin
        .from("warehouse_stock")
        .select("id, quantity")
        .eq("warehouse_id", r.warehouse_id)
        .eq("product_id", r.product_id)
        .eq("state", input.new_state)
        .is("location_id", r.location_id)
        .maybeSingle();
      const dst = existing as { id: string; quantity: number } | null;
      if (dst) {
        await admin
          .from("warehouse_stock")
          .update({ quantity: dst.quantity + qty })
          .eq("id", dst.id);
      } else {
        await admin.from("warehouse_stock").insert({
          company_id: r.company_id,
          warehouse_id: r.warehouse_id,
          product_id: r.product_id,
          quantity: qty,
          state: input.new_state,
          location_id: r.location_id,
        });
      }

      // Movement informativo
      await admin.from("stock_movements").insert({
        company_id: r.company_id,
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        movement_type: "adjustment_plus",
        quantity: qty,
        state_after: input.new_state,
        reason: `Cambio de estado ${r.state} → ${input.new_state}`,
        notes: input.notes ?? null,
        performed_by: session.user_id,
      });
    }

    revalidatePath(`/almacenes/${r.warehouse_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Marca una orden de desinstalación como YA HECHA (cuando el cliente nos dice
 * que el equipo ya se retiró). Pone la installation en 'completed' con la
 * fecha indicada y aplica el cierre común (devuelve stock de los 'warehouse' y
 * da de baja TODOS los equipos). Idempotente: compare-and-set del estado; un
 * segundo envío no vuelve a devolver el stock. Para retiradas a futuro NO se
 * usa esto: las cierra el técnico desde /instalaciones como siempre.
 */
export async function completeUninstallNowAction(input: {
  installation_id: string;
  completed_at?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeRetirar(session)) {
      return { ok: false, error: "Solo admin o director técnico" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await cerrarOrdenRetirada(admin, session.company_id, input.installation_id, {
      completed_at: input.completed_at || new Date().toISOString(),
      actor_user_id: session.user_id,
    });
    if (!r.ok) return r;
    if (!r.ya_cerrada) {
      await registrarResultadoCierre(
        admin,
        session.company_id,
        input.installation_id,
        r,
        session.user_id,
      );
    }
    revalidatePath("/instalaciones");
    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
