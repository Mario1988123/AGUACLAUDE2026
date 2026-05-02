import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { notifyByRoles } from "@/modules/notifications/notifier";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron diario (Vercel Cron). Procesa para todas las empresas activas:
 *  - Leads con assigned_at hace > company_settings.lead_expiry_days → status=expired + notif
 *  - Instalaciones programadas para mañana → notif al instalador + admin
 *  - Stock bajo (warehouse_stock.quantity ≤ products.stock_min) → notif a admin
 *  - Mantenimientos programados para mañana → notif al técnico + admin
 *
 * Auth: header `x-cron-secret` debe coincidir con CRON_SECRET. Vercel Cron lo
 * inyecta vía `Authorization: Bearer ${VERCEL_CRON_SECRET}` — soportamos ambos.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (secret) {
    const ok = auth === `Bearer ${secret}` || xCron === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = {
    leads_expired: 0,
    installations_tomorrow: 0,
    maintenance_tomorrow: 0,
    stock_low: 0,
    contracts_activated_today: 0,
  };

  // 0) Contratos con service_start_date <= hoy y status=signed → activar y
  // programar mantenimientos. Cubre el caso "instalado hoy pero arranca el 1 del mes".
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const { data: dueContracts } = await admin
    .from("contracts")
    .select("id, company_id")
    .eq("status", "signed")
    .not("service_start_date", "is", null)
    .lte("service_start_date", todayIsoDate)
    .is("deleted_at", null);
  for (const c of ((dueContracts ?? []) as Array<{ id: string; company_id: string }>)) {
    try {
      await admin.from("contracts").update({ status: "active" }).eq("id", c.id);
      const mod = await import("@/modules/maintenance/auto-schedule");
      await mod.autoScheduleMaintenanceForContract(c.id);
      await admin.from("events").insert({
        company_id: c.company_id,
        subject_type: "contract",
        subject_id: c.id,
        kind: "contract.activated",
        payload: { auto: true, by_cron: true },
        actor_user_id: null,
      });
      stats.contracts_activated_today += 1;
    } catch {
      /* no-op */
    }
  }

  // 1) Leads caducados ----------------------------------------------------------
  const { data: companies } = await admin
    .from("company_settings")
    .select("company_id, lead_expiry_days");
  for (const cs of (companies ?? []) as Array<{
    company_id: string;
    lead_expiry_days: number;
  }>) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cs.lead_expiry_days);
    const { data: stale } = await admin
      .from("leads")
      .select("id, legal_name, trade_name, first_name, last_name, party_kind")
      .eq("company_id", cs.company_id)
      .in("status", ["new", "contacted", "qualified"])
      .lt("assigned_at", cutoff.toISOString())
      .is("expired_at", null)
      .is("deleted_at", null)
      .limit(500);
    const list = (stale ?? []) as Array<{
      id: string;
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      party_kind: "company" | "individual";
    }>;
    if (list.length === 0) continue;

    await admin
      .from("leads")
      .update({ status: "expired", expired_at: new Date().toISOString() })
      .in(
        "id",
        list.map((l) => l.id),
      );

    for (const l of list) {
      const name =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Sin nombre"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Sin nombre";
      try {
        await notifyByRoles(
          cs.company_id,
          ["company_admin", "telemarketing_director", "commercial_director"],
          {
            kind: "lead.expired",
            severity: "warning",
            title: "Lead caducado",
            body: name,
            subject_type: "lead",
            subject_id: l.id,
            action_url: `/leads/${l.id}`,
          },
        );
      } catch {
        /* no-op */
      }
      stats.leads_expired += 1;
    }
  }

  // 2) Instalaciones para mañana -----------------------------------------------
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = new Date(tomorrow);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(tomorrow);
  dayEnd.setHours(23, 59, 59, 999);

  const { data: insts } = await admin
    .from("installations")
    .select("id, company_id, reference_code, scheduled_at, installer_user_id")
    .in("status", ["scheduled"])
    .gte("scheduled_at", dayStart.toISOString())
    .lte("scheduled_at", dayEnd.toISOString())
    .is("deleted_at", null);
  for (const inst of (insts ?? []) as Array<{
    id: string;
    company_id: string;
    reference_code: string | null;
    scheduled_at: string;
    installer_user_id: string | null;
  }>) {
    const time = new Date(inst.scheduled_at).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (inst.installer_user_id) {
      try {
        await admin.from("notifications").insert({
          company_id: inst.company_id,
          recipient_user_id: inst.installer_user_id,
          kind: "installation.tomorrow",
          severity: "info",
          title: "Instalación mañana",
          body: `${inst.reference_code ?? ""} a las ${time}`.trim(),
          subject_type: "installation",
          subject_id: inst.id,
          action_url: `/instalaciones/${inst.id}`,
        });
      } catch {
        /* no-op */
      }
    }
    try {
      await notifyByRoles(
        inst.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "installation.tomorrow",
          severity: "info",
          title: "Instalación mañana",
          body: `${inst.reference_code ?? ""} a las ${time}`.trim(),
          subject_type: "installation",
          subject_id: inst.id,
          action_url: `/instalaciones/${inst.id}`,
        },
      );
    } catch {
      /* no-op */
    }
    stats.installations_tomorrow += 1;
  }

  // 3) Mantenimientos para mañana ----------------------------------------------
  const { data: jobs } = await admin
    .from("maintenance_jobs")
    .select("id, company_id, scheduled_at, technician_user_id")
    .eq("status", "scheduled")
    .gte("scheduled_at", dayStart.toISOString())
    .lte("scheduled_at", dayEnd.toISOString());
  for (const j of (jobs ?? []) as Array<{
    id: string;
    company_id: string;
    scheduled_at: string;
    technician_user_id: string | null;
  }>) {
    const time = new Date(j.scheduled_at).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (j.technician_user_id) {
      try {
        await admin.from("notifications").insert({
          company_id: j.company_id,
          recipient_user_id: j.technician_user_id,
          kind: "maintenance.tomorrow",
          severity: "info",
          title: "Mantenimiento mañana",
          body: `Programado a las ${time}`,
          subject_type: "maintenance",
          subject_id: j.id,
          action_url: `/mantenimientos`,
        });
      } catch {
        /* no-op */
      }
    }
    stats.maintenance_tomorrow += 1;
  }

  // 4) Stock bajo --------------------------------------------------------------
  const { data: stocks } = await admin.rpc("get_low_stock_products");
  // Si no existe la RPC, hacemos query manual
  let lowStockRows: Array<{
    company_id: string;
    product_id: string;
    name: string;
    quantity: number;
    stock_min: number;
  }> = [];
  if (Array.isArray(stocks)) {
    lowStockRows = stocks as typeof lowStockRows;
  } else {
    const { data: prods } = await admin
      .from("products")
      .select("id, company_id, name, stock_min")
      .eq("stock_managed", true)
      .is("deleted_at", null);
    for (const p of (prods ?? []) as Array<{
      id: string;
      company_id: string;
      name: string;
      stock_min: number;
    }>) {
      const { data: ws } = await admin
        .from("warehouse_stock")
        .select("quantity")
        .eq("product_id", p.id);
      const total = ((ws ?? []) as Array<{ quantity: number }>).reduce(
        (s, r) => s + r.quantity,
        0,
      );
      if (total <= p.stock_min) {
        lowStockRows.push({
          company_id: p.company_id,
          product_id: p.id,
          name: p.name,
          quantity: total,
          stock_min: p.stock_min,
        });
      }
    }
  }

  for (const ls of lowStockRows) {
    try {
      // Idempotencia: solo notifica si no ha habido otra notif del mismo producto en 24h
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const { count } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("company_id", ls.company_id)
        .eq("kind", "stock.low")
        .eq("subject_id", ls.product_id)
        .gte("created_at", since.toISOString());
      if ((count ?? 0) > 0) continue;

      await notifyByRoles(ls.company_id, ["company_admin", "technical_director"], {
        kind: "stock.low",
        severity: "warning",
        title: "Stock bajo",
        body: `${ls.name}: ${ls.quantity}/${ls.stock_min} mín.`,
        subject_type: "product",
        subject_id: ls.product_id,
        action_url: `/productos/${ls.product_id}`,
      });
      stats.stock_low += 1;
    } catch {
      /* no-op */
    }
  }

  return NextResponse.json({ ok: true, stats, ranAt: new Date().toISOString() });
}
