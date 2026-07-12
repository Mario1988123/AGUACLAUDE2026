"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { isFunctionMissingError } from "./adjust-stock";

interface DecrementInput {
  company_id: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  movement_type:
    | "outbound_install"
    | "outbound_trial"
    | "outbound_maintenance"
    | "transfer_out"
    | "adjustment_minus";
  installation_id?: string | null;
  free_trial_id?: string | null;
  maintenance_id?: string | null;
  loading_request_id?: string | null;
  contract_id?: string | null;
  performed_by?: string | null;
  notes?: string | null;
}

/**
 * Decrementa stock de un (warehouse, product) y registra el stock_movement.
 * Si la suma de cantidades por estado en ese warehouse es < quantity, decrementa
 * lo que pueda y registra el movimiento por la cantidad real movida.
 *
 * Devuelve la cantidad realmente movida.
 */
export async function decrementStock(input: DecrementInput): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Descuento ATÓMICO repartido por ubicaciones (RPC decrement_stock_spread):
  // recorre las celdas 'new' del (warehouse, product) con FOR UPDATE → sin lost
  // updates. Es lenient (mueve lo que puede). Si la RPC no está aplicada o falla,
  // caemos al bucle clásico read-modify-write → nunca peor que hoy.
  let moved = 0;
  let usedAtomic = false;
  try {
    const { data, error } = await admin.rpc("decrement_stock_spread", {
      p_company_id: input.company_id,
      p_warehouse_id: input.warehouse_id,
      p_product_id: input.product_id,
      p_state: "new",
      p_quantity: input.quantity,
    });
    if (error) {
      const err = new Error(error.message) as Error & { code?: string };
      err.code = error.code;
      throw err;
    }
    moved = typeof data === "number" ? data : Number(data ?? 0);
    usedAtomic = true;
  } catch (e) {
    // Solo fallback si la RPC no existe; otro error (transporte) → propagar para
    // NO doble-descontar (la RPC pudo haber commiteado). audit Fable C3.
    if (!isFunctionMissingError(e)) throw e instanceof Error ? e : new Error(String(e));
    console.error(
      "[decrementStock] RPC decrement_stock_spread no aplicada, fallback:",
      e instanceof Error ? e.message : e,
    );
  }

  if (!usedAtomic) {
    // ---- Camino clásico (read-modify-write, no atómico): solo si la RPC no está ----
    const { data: rows } = await admin
      .from("warehouse_stock")
      .select("id, quantity, state, location_id")
      .eq("warehouse_id", input.warehouse_id)
      .eq("product_id", input.product_id)
      // Solo stock VENDIBLE ('new'). Antes consumía también used/damaged/
      // refurbished/reservado en salidas por instalación/transferencia.
      .eq("state", "new")
      .order("quantity", { ascending: false });
    type Row = { id: string; quantity: number; state: string; location_id: string | null };
    const list = (rows ?? []) as Row[];
    let remaining = input.quantity;
    for (const r of list) {
      if (remaining <= 0) break;
      const take = Math.min(r.quantity, remaining);
      if (take <= 0) continue;
      await admin
        .from("warehouse_stock")
        .update({ quantity: r.quantity - take, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      remaining -= take;
      moved += take;
    }
  }
  // FIFO automático sobre stock_lots: descontar del lote más antiguo
  // primero hasta cubrir `moved`. Si la tabla no existe (migración
  // pendiente), no se descuenta lote, solo stock_movements.
  let lotIdForMovement: string | null = null;
  if (moved > 0) {
    try {
      const { data: lots } = await admin
        .from("stock_lots")
        .select("id, remaining_quantity, received_at")
        .eq("product_id", input.product_id)
        .eq("warehouse_id", input.warehouse_id)
        .gt("remaining_quantity", 0)
        .order("received_at", { ascending: true });
      type L = { id: string; remaining_quantity: number; received_at: string };
      let toConsume = moved;
      for (const l of ((lots ?? []) as L[])) {
        if (toConsume <= 0) break;
        const take = Math.min(Number(l.remaining_quantity), toConsume);
        if (take <= 0) continue;
        await admin
          .from("stock_lots")
          .update({
            remaining_quantity: Number(l.remaining_quantity) - take,
          })
          .eq("id", l.id);
        if (!lotIdForMovement) lotIdForMovement = l.id; // primer lote tocado
        toConsume -= take;
      }
    } catch {
      /* lotes no aplicados aún → seguimos sin lot_id */
    }
  }

  if (moved > 0) {
    // Insertamos el movimiento. Defensivo: contract_id puede no existir en
    // schema cache si la migración Fase A no se aplicó todavía.
    const movementPayload: Record<string, unknown> = {
      company_id: input.company_id,
      product_id: input.product_id,
      warehouse_id: input.warehouse_id,
      movement_type: input.movement_type,
      quantity: moved,
      installation_id: input.installation_id ?? null,
      free_trial_id: input.free_trial_id ?? null,
      maintenance_id: input.maintenance_id ?? null,
      loading_request_id: input.loading_request_id ?? null,
      contract_id: input.contract_id ?? null,
      performed_by: input.performed_by ?? null,
      notes: input.notes ?? null,
      lot_id: lotIdForMovement,
    };
    let { error: mErr } = await admin.from("stock_movements").insert(movementPayload);
    if (mErr && /lot_id|contract_id/i.test(mErr.message ?? "")) {
      delete movementPayload.lot_id;
      delete movementPayload.contract_id;
      const r2 = await admin.from("stock_movements").insert(movementPayload);
      mErr = r2.error;
    }
    if (mErr) console.error("[decrementStock] movement insert:", mErr.message);
  }
  return moved;
}

/**
 * Procesa todos los items instalados, descontando del source_warehouse_id de la
 * instalación. Si no hay warehouse, no hace nada (no es error).
 */
export async function decrementStockForInstallation(installationId: string): Promise<{
  moved_total: number;
  items: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, source_warehouse_id, installer_user_id, contract_id")
    .eq("id", installationId)
    .single();
  if (!inst) return { moved_total: 0, items: 0 };
  const i = inst as {
    id: string;
    company_id: string;
    source_warehouse_id: string | null;
    installer_user_id: string | null;
    contract_id: string | null;
  };
  if (!i.source_warehouse_id) return { moved_total: 0, items: 0 };

  const { data: items } = await admin
    .from("installation_items")
    .select("product_id, quantity")
    .eq("installation_id", installationId);
  const list = (items ?? []) as Array<{ product_id: string; quantity: number }>;
  if (list.length === 0) return { moved_total: 0, items: 0 };

  let total = 0;
  const shortages: Array<{ product_id: string; needed: number; moved: number }> = [];
  for (const it of list) {
    const moved = await decrementStock({
      company_id: i.company_id,
      warehouse_id: i.source_warehouse_id,
      product_id: it.product_id,
      quantity: it.quantity,
      movement_type: "outbound_install",
      installation_id: i.id,
      contract_id: i.contract_id,
      performed_by: i.installer_user_id,
      notes: "Auto-decrement on installation completion",
    });
    total += moved;
    if (moved < it.quantity) {
      shortages.push({ product_id: it.product_id, needed: it.quantity, moved });
    }
  }

  // Faltó stock para cubrir la instalación: el inventario quedará descuadrado.
  // Dejamos constancia (evento + aviso) para que admin/dir. técnico repongan.
  if (shortages.length > 0) {
    try {
      await admin.from("events").insert({
        company_id: i.company_id,
        subject_type: "installation",
        subject_id: i.id,
        kind: "installation.stock_shortage",
        payload: { shortages, warehouse_id: i.source_warehouse_id },
        actor_user_id: i.installer_user_id,
      });
    } catch {
      /* fail-soft */
    }
    try {
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      await notifyByRoles(
        i.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "installation.stock_shortage",
          severity: "warning",
          title: "Falta de stock en una instalación",
          body: `El almacén/furgoneta no tenía stock suficiente para ${shortages.length} producto(s) de una instalación. Revisa el inventario.`,
          subject_type: "installation",
          subject_id: i.id,
          action_url: `/instalaciones/${i.id}`,
        },
      );
    } catch {
      /* fail-soft */
    }
  }

  // Marcar reservas asociadas al contrato como cumplidas (fail-soft).
  if (i.contract_id) {
    try {
      const { fulfillReservationsForContractAction } = await import(
        "./reservation-actions"
      );
      await fulfillReservationsForContractAction(i.contract_id);
    } catch (e) {
      console.error("[decrementStockForInstallation] fulfill failed:", e);
    }
  }

  return { moved_total: total, items: list.length };
}
