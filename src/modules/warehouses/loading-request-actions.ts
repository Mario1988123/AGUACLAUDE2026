"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { esGestorStock } from "@/shared/lib/auth/role-scope";
import { decrementStock } from "./stock-decrement";
import { adjustStockBatch } from "./adjust-stock";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";

const createSchema = z.object({
  source_warehouse_id: z.string().uuid(),
  destination_warehouse_id: z.string().uuid(),
  needed_for: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity_requested: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function createLoadingRequestAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // 2026-11-12: crear órdenes de carga es de la oficina (el técnico registra
  // su carga con registrarCargaFurgoneta). Admin + company_id: con la RLS de
  // almacenes cerrada, el cliente RLS fallaría en silencio.
  if (!esGestorStock(session)) throw new Error("Sin permiso para crear órdenes de carga");
  const parsed = parseOrFriendly(createSchema, input, "Orden de carga");
  if (parsed.source_warehouse_id === parsed.destination_warehouse_id) {
    throw new Error("Origen y destino deben ser diferentes");
  }
  const { assertWarehouseCompany } = await import("./ownership");
  await assertWarehouseCompany(parsed.source_warehouse_id, session.company_id);
  await assertWarehouseCompany(parsed.destination_warehouse_id, session.company_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  const { data: created, error } = await supabase
    .from("loading_requests")
    .insert({
      company_id: session.company_id,
      source_warehouse_id: parsed.source_warehouse_id,
      destination_warehouse_id: parsed.destination_warehouse_id,
      needed_for: parsed.needed_for || null,
      notes: parsed.notes || null,
      status: "requested",
      requested_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const requestId = (created as { id: string }).id;

  const { error: errItems } = await supabase.from("loading_request_items").insert(
    parsed.items.map((it) => ({
      loading_request_id: requestId,
      company_id: session.company_id,
      product_id: it.product_id,
      quantity_requested: it.quantity_requested,
    })),
  );
  if (errItems) {
    await supabase.from("loading_requests").delete().eq("id", requestId);
    throw new Error(errItems.message);
  }

  revalidatePath("/almacenes");
}

export async function deliverLoadingRequestAction(requestId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Rol (auditoría 2026-10-01): entregar mueve stock entre almacenes, así que
  // exige los mismos roles que el resto de movimientos de stock
  // (inventory-actions.ensureCanManage). [decide] admin, director técnico e
  // instalador (el que recibe la carga en su furgoneta).
  // 2026-11-12: el técnico solo puede dar por entregada una orden cuyo
  // destino sea SU furgoneta (se comprueba abajo, tras leer la orden).
  const gestor = esGestorStock(session);
  if (!gestor && !session.roles.includes("installer")) {
    throw new Error("Sin permiso para entregar órdenes de carga");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: req } = await admin
    .from("loading_requests")
    .select("id, status, source_warehouse_id, destination_warehouse_id, company_id")
    .eq("id", requestId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!req) throw new Error("Solicitud no encontrada o no pertenece a tu empresa");
  const r = req as {
    id: string;
    status: string;
    source_warehouse_id: string;
    destination_warehouse_id: string;
    company_id: string;
  };
  // SEGURIDAD: el admin client salta RLS; ya filtramos por company_id arriba,
  // pero reforzamos para que todo el movimiento de stock use SOLO datos propios.
  if (r.company_id !== session.company_id) {
    throw new Error("Solicitud no pertenece a tu empresa");
  }
  if (!gestor) {
    const { data: miFurgo } = await admin
      .from("warehouses")
      .select("id")
      .eq("id", r.destination_warehouse_id)
      .eq("company_id", session.company_id)
      .eq("kind", "vehicle")
      .eq("assigned_user_id", session.user_id)
      .maybeSingle();
    if (!miFurgo) throw new Error("Solo puedes recibir cargas para tu furgoneta");
  }
  if (r.status === "delivered") throw new Error("Ya entregada");
  if (r.status === "cancelled") throw new Error("La orden está cancelada");

  // Compare-and-set ANTES de mover stock (auditoría 2026-10-01, I42): solo un
  // envío pasa a 'delivered'. Un doble clic hacía un doble traspaso.
  // [decide] Si algo falla después, la orden queda entregada y el error se
  // muestra: preferimos un traspaso a revisar a un traspaso duplicado.
  const nowIso = new Date().toISOString();
  const { data: reclamada, error: errClaim } = await admin
    .from("loading_requests")
    .update({
      status: "delivered",
      prepared_at: nowIso,
      delivered_at: nowIso,
      prepared_by: session.user_id,
      delivered_by: session.user_id,
    })
    .eq("id", requestId)
    .eq("company_id", session.company_id)
    .not("status", "in", "(delivered,cancelled)")
    .select("id");
  if (errClaim) throw new Error(errClaim.message);
  if (!reclamada || (reclamada as unknown[]).length === 0) {
    throw new Error("Ya entregada");
  }

  const { data: items } = await admin
    .from("loading_request_items")
    .select("id, product_id, quantity_requested")
    .eq("loading_request_id", requestId);
  type Item = { id: string; product_id: string; quantity_requested: number };
  const list = (items ?? []) as Item[];

  const shortages: Array<{
    product_id: string;
    requested: number;
    delivered: number;
  }> = [];

  for (const it of list) {
    // Salida del almacén origen
    const moved = await decrementStock({
      company_id: r.company_id,
      warehouse_id: r.source_warehouse_id,
      product_id: it.product_id,
      quantity: it.quantity_requested,
      movement_type: "transfer_out",
      loading_request_id: requestId,
      performed_by: session.user_id,
      notes: "Carga vehículo",
    });
    if (moved < it.quantity_requested) {
      shortages.push({
        product_id: it.product_id,
        requested: it.quantity_requested,
        delivered: moved,
      });
    }

    // Entrada en almacén destino
    if (moved > 0) {
      // Entrada en destino + movimiento transfer_in, ATÓMICO vía RPC
      // adjust_stock_batch (antes leer-sumar-escribir).
      await adjustStockBatch(r.company_id, session.user_id, [
        {
          warehouse_id: r.destination_warehouse_id,
          product_id: it.product_id,
          state: "new",
          location_id: null,
          delta: moved,
          movement_type: "transfer_in",
          loading_request_id: requestId,
          notes: "Recepción vehículo",
        },
      ]);
      // actualizar quantity_delivered
      await admin
        .from("loading_request_items")
        .update({ quantity_delivered: moved, quantity_prepared: moved })
        .eq("id", it.id);
    }
  }

  // Entrega PARCIAL: si algún producto se entregó por debajo de lo pedido
  // (faltaba stock), dejamos constancia (evento + aviso) en lugar de marcar
  // "entregada" en silencio. Fail-soft.
  if (shortages.length > 0) {
    try {
      await admin.from("events").insert({
        company_id: r.company_id,
        subject_type: "loading_request",
        subject_id: requestId,
        kind: "loading_request.partial_delivery",
        payload: { shortages },
        actor_user_id: session.user_id,
      });
    } catch {
      /* fail-soft */
    }
    try {
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      await notifyByRoles(
        r.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "loading_request.partial_delivery",
          severity: "warning",
          title: "Carga de furgoneta incompleta",
          body: `Faltó stock para ${shortages.length} producto(s) al cargar la furgoneta. Revisa el almacén y reponlo.`,
          subject_type: "loading_request",
          subject_id: requestId,
          action_url: "/almacenes",
        },
      );
    } catch {
      /* fail-soft */
    }
  }

  revalidatePath("/almacenes");
}

export async function cancelLoadingRequestAction(requestId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!esGestorStock(session)) throw new Error("Sin permiso para cancelar órdenes de carga");
  // Admin + company_id (2026-11-12): antes iba sin filtrar empresa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from("loading_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("company_id", session.company_id)
    .neq("status", "delivered");
  if (error) throw new Error(error.message);
  revalidatePath("/almacenes");
}

// =================== Safe wrappers ===================

export async function deliverLoadingRequestSafeAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deliverLoadingRequestAction(requestId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function createLoadingRequestSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createLoadingRequestAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function cancelLoadingRequestSafeAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cancelLoadingRequestAction(requestId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
