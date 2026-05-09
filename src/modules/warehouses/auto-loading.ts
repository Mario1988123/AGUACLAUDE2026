"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { notifyByRoles } from "@/modules/notifications/notifier";

/**
 * Genera órdenes de carga sugeridas para mañana.
 *
 * Para cada empresa:
 *  1. Lee instalaciones agendadas para mañana con installer_user_id.
 *  2. Agrupa por técnico → lista de productos necesarios (sumando cantidades).
 *  3. Para cada técnico: busca su furgoneta (warehouses.kind='vehicle' con
 *     assigned_user_id = técnico). Si no hay, salta.
 *  4. Resta el stock que ya tiene en la furgoneta (state='new').
 *  5. Crea un loading_request (origen=principal, destino=furgoneta,
 *     needed_for=fecha_mañana) con sus loading_request_items.
 *  6. Idempotente: si ya hay loading_request del mismo destino + needed_for,
 *     no se duplica.
 *  7. Notifica al admin/director técnico que hay órdenes pendientes.
 */
export async function generateLoadingRequestsForTomorrow(): Promise<{
  companies: number;
  requests_created: number;
  errors: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { companies: 0, requests_created: 0, errors: 0 };

  // Ventana mañana
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = new Date(tomorrow);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(tomorrow);
  dayEnd.setHours(23, 59, 59, 999);
  const neededFor = dayStart.toISOString().slice(0, 10);

  const { data: companies } = await admin
    .from("companies")
    .select("id")
    .is("deleted_at", null);
  for (const c of (companies ?? []) as Array<{ id: string }>) {
    stats.companies += 1;
    try {
      // Almacén principal
      const { data: warehouses } = await admin
        .from("warehouses")
        .select("id, kind, assigned_user_id")
        .eq("company_id", c.id)
        .is("deleted_at", null);
      const whs = (warehouses ?? []) as Array<{
        id: string;
        kind: string;
        assigned_user_id: string | null;
      }>;
      const main = whs.find((w) => w.kind === "main") ?? whs.find((w) => w.kind !== "vehicle");
      if (!main) continue;

      // Instalaciones de mañana
      const { data: insts } = await admin
        .from("installations")
        .select("id, installer_user_id")
        .eq("company_id", c.id)
        .in("status", ["scheduled"])
        .gte("scheduled_at", dayStart.toISOString())
        .lte("scheduled_at", dayEnd.toISOString())
        .is("deleted_at", null);
      const installations = (insts ?? []) as Array<{
        id: string;
        installer_user_id: string | null;
      }>;
      if (installations.length === 0) continue;

      // Items por instalación
      const instIds = installations.map((i) => i.id);
      const { data: items } = await admin
        .from("installation_items")
        .select("installation_id, product_id, quantity")
        .in("installation_id", instIds);
      const itemsByInst = new Map<
        string,
        Array<{ product_id: string; quantity: number }>
      >();
      for (const it of (items ?? []) as Array<{
        installation_id: string;
        product_id: string;
        quantity: number;
      }>) {
        if (!itemsByInst.has(it.installation_id))
          itemsByInst.set(it.installation_id, []);
        itemsByInst
          .get(it.installation_id)!
          .push({ product_id: it.product_id, quantity: it.quantity });
      }

      // Por técnico
      const byTechnician = new Map<string, Map<string, number>>();
      for (const inst of installations) {
        if (!inst.installer_user_id) continue;
        const items = itemsByInst.get(inst.id) ?? [];
        if (!byTechnician.has(inst.installer_user_id))
          byTechnician.set(inst.installer_user_id, new Map());
        const acc = byTechnician.get(inst.installer_user_id)!;
        for (const it of items) {
          acc.set(it.product_id, (acc.get(it.product_id) ?? 0) + it.quantity);
        }
      }

      let createdForCompany = 0;

      for (const [technicianId, productNeeds] of byTechnician.entries()) {
        // Furgoneta del técnico
        const van = whs.find(
          (w) => w.kind === "vehicle" && w.assigned_user_id === technicianId,
        );
        if (!van) continue;

        // Idempotencia: ya hay request para esa van+día?
        const { data: existing } = await admin
          .from("loading_requests")
          .select("id, status")
          .eq("destination_warehouse_id", van.id)
          .eq("needed_for", neededFor)
          .in("status", ["requested", "preparing", "prepared"])
          .limit(1);
        if (((existing ?? []) as Array<unknown>).length > 0) continue;

        // Stock actual en furgoneta para descontar
        const productIds = Array.from(productNeeds.keys());
        const { data: vanStock } = await admin
          .from("warehouse_stock")
          .select("product_id, quantity")
          .eq("warehouse_id", van.id)
          .in("product_id", productIds);
        const vanStockMap = new Map<string, number>();
        for (const s of (vanStock ?? []) as Array<{ product_id: string; quantity: number }>) {
          vanStockMap.set(s.product_id, (vanStockMap.get(s.product_id) ?? 0) + s.quantity);
        }

        // Líneas a cargar = needed - already in van
        const lines: Array<{ product_id: string; quantity: number }> = [];
        for (const [pid, needed] of productNeeds.entries()) {
          const already = vanStockMap.get(pid) ?? 0;
          const toLoad = needed - already;
          if (toLoad > 0) lines.push({ product_id: pid, quantity: toLoad });
        }
        if (lines.length === 0) continue;

        // Crear loading_request
        const { data: lr, error: lrErr } = await admin
          .from("loading_requests")
          .insert({
            company_id: c.id,
            source_warehouse_id: main.id,
            destination_warehouse_id: van.id,
            status: "requested",
            needed_for: neededFor,
            requested_by: null,
            notes: "Generado automáticamente — instalaciones del día siguiente",
          })
          .select("id")
          .single();
        if (lrErr || !lr) {
          stats.errors += 1;
          continue;
        }
        const lrId = (lr as { id: string }).id;
        const lineRows = lines.map((l) => ({
          loading_request_id: lrId,
          company_id: c.id,
          product_id: l.product_id,
          quantity_requested: l.quantity,
        }));
        await admin.from("loading_request_items").insert(lineRows);

        stats.requests_created += 1;
        createdForCompany += 1;

        // Notificar al técnico
        try {
          await admin.from("notifications").insert({
            company_id: c.id,
            recipient_user_id: technicianId,
            kind: "loading.suggested",
            severity: "info",
            title: "Sugerencia de carga para mañana",
            body: `${lines.length} producto(s) a cargar para tus instalaciones de mañana.`,
            subject_type: "loading_request",
            subject_id: lrId,
            action_url: `/almacenes/${van.id}`,
          });
        } catch {
          /* fail-soft */
        }
      }

      if (createdForCompany > 0) {
        try {
          await notifyByRoles(c.id, ["company_admin", "technical_director"], {
            kind: "loading.batch",
            severity: "info",
            title: "Órdenes de carga generadas",
            body: `${createdForCompany} furgoneta(s) tienen sugerencia de carga para mañana.`,
            action_url: "/almacenes",
          });
        } catch {
          /* fail-soft */
        }
      }
    } catch (e) {
      console.error("[generateLoadingRequestsForTomorrow]", c.id, e);
      stats.errors += 1;
    }
  }
  return stats;
}
