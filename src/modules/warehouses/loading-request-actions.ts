"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { decrementStock } from "./stock-decrement";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

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
  const parsed = parseOrFriendly(createSchema, input, "Orden de carga");
  if (parsed.source_warehouse_id === parsed.destination_warehouse_id) {
    throw new Error("Origen y destino deben ser diferentes");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
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

  await supabase.from("loading_request_items").insert(
    parsed.items.map((it) => ({
      loading_request_id: requestId,
      company_id: session.company_id,
      product_id: it.product_id,
      quantity_requested: it.quantity_requested,
    })),
  );

  revalidatePath("/almacenes");
}

export async function deliverLoadingRequestAction(requestId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: req } = await admin
    .from("loading_requests")
    .select("id, status, source_warehouse_id, destination_warehouse_id, company_id")
    .eq("id", requestId)
    .single();
  if (!req) throw new Error("Solicitud no encontrada");
  const r = req as {
    id: string;
    status: string;
    source_warehouse_id: string;
    destination_warehouse_id: string;
    company_id: string;
  };
  if (r.status === "delivered") throw new Error("Ya entregada");

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
      // upsert warehouse_stock destino
      const { data: existing } = await admin
        .from("warehouse_stock")
        .select("id, quantity")
        .eq("warehouse_id", r.destination_warehouse_id)
        .eq("product_id", it.product_id)
        .eq("state", "new")
        .is("location_id", null)
        .maybeSingle();
      const ex = existing as { id: string; quantity: number } | null;
      if (ex) {
        await admin
          .from("warehouse_stock")
          .update({ quantity: ex.quantity + moved, updated_at: new Date().toISOString() })
          .eq("id", ex.id);
      } else {
        await admin.from("warehouse_stock").insert({
          warehouse_id: r.destination_warehouse_id,
          product_id: it.product_id,
          company_id: r.company_id,
          quantity: moved,
          state: "new",
        });
      }
      // movimiento entrada
      await admin.from("stock_movements").insert({
        company_id: r.company_id,
        product_id: it.product_id,
        warehouse_id: r.destination_warehouse_id,
        movement_type: "transfer_in",
        quantity: moved,
        loading_request_id: requestId,
        performed_by: session.user_id,
        notes: "Recepción vehículo",
      });
      // actualizar quantity_delivered
      await admin
        .from("loading_request_items")
        .update({ quantity_delivered: moved, quantity_prepared: moved })
        .eq("id", it.id);
    }
  }

  await admin
    .from("loading_requests")
    .update({
      status: "delivered",
      prepared_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      prepared_by: session.user_id,
      delivered_by: session.user_id,
    })
    .eq("id", requestId);

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
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("loading_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .neq("status", "delivered");
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
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function createLoadingRequestSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createLoadingRequestAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function cancelLoadingRequestSafeAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cancelLoadingRequestAction(requestId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
