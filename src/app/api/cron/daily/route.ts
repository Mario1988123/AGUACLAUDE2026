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
    punches_autoclosed: 0,
  };

  // 0a) Autocierre de fichajes olvidados (también lo hace el cron horario,
  // pero lo repetimos aquí por si el horario fallara o no estuviera activo)
  try {
    const { data: closed } = await admin.rpc("autoclose_stale_punches");
    stats.punches_autoclosed = Number(closed) || 0;
  } catch {
    /* no-op */
  }

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

    // Email recordatorio al cliente (víspera) con datos de la cita.
    // Fail-soft: si falta plantilla o cliente sin email, no rompe el cron.
    try {
      const { data: instFull } = await admin
        .from("installations")
        .select(
          `customer_id, address_id, installer:installer_user_id(full_name, phone)`,
        )
        .eq("id", inst.id)
        .maybeSingle();
      if (!instFull?.customer_id) continue;

      const { data: cust } = await admin
        .from("customers")
        .select("email, first_name, last_name, legal_name, trade_name, party_kind")
        .eq("id", instFull.customer_id)
        .maybeSingle();
      if (!cust?.email) continue;

      let address = "";
      if (instFull.address_id) {
        const { data: addr } = await admin
          .from("addresses")
          .select("street_type, street, street_number, city")
          .eq("id", instFull.address_id)
          .maybeSingle();
        if (addr) {
          address = `${addr.street_type ?? ""} ${addr.street ?? ""} ${addr.street_number ?? ""}, ${addr.city ?? ""}`.trim();
        }
      }

      const installer = instFull.installer as {
        full_name?: string;
        phone?: string;
      } | null;
      const customerFirstName =
        cust.party_kind === "company"
          ? cust.trade_name ?? cust.legal_name ?? "Cliente"
          : cust.first_name ?? "Cliente";

      // Importar dinámicamente para no cargar el módulo en cada deploy
      const { sendTransactionalEmail } = await import(
        "@/modules/mailing/actions"
      );
      await sendTransactionalEmail({
        template_key: "installation_reminder",
        to_email: cust.email,
        to_name: customerFirstName,
        customer_id: instFull.customer_id,
        variables: {
          customer_first_name: customerFirstName,
          appointment_date: inst.scheduled_at,
          appointment_time: time,
          customer_address: address || "—",
          technician_name: installer?.full_name ?? "Nuestro técnico",
          technician_phone: installer?.phone ?? "—",
        },
        related_subject_type: "installation",
        related_subject_id: inst.id,
      });

      // WhatsApp paralelo (si hay phone + Twilio configurado)
      try {
        const { data: phoneRow } = await admin
          .from("customers")
          .select("phone_primary")
          .eq("id", instFull.customer_id)
          .maybeSingle();
        if (phoneRow?.phone_primary) {
          const { isWhatsAppConfigured, sendWhatsApp } = await import(
            "@/modules/mailing/whatsapp"
          );
          if (isWhatsAppConfigured()) {
            const fullDate = new Date(inst.scheduled_at).toLocaleDateString(
              "es-ES",
              { day: "numeric", month: "long" },
            );
            await sendWhatsApp({
              to_phone: phoneRow.phone_primary,
              body: `Hola ${customerFirstName} 👋\n\nTe recordamos que *mañana ${fullDate} a las ${time}* tenemos tu instalación.\n\n📍 ${address || "Tu dirección"}\n👷 ${installer?.full_name ?? "Nuestro técnico"}\n\n¡Hasta mañana!`,
            });
          }
        }
      } catch (e) {
        console.error("[cron/daily] installation_reminder whatsapp failed:", e);
      }
    } catch (e) {
      console.error("[cron/daily] installation_reminder email failed:", e);
    }
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

  // Procesar cola Verifactu pendiente (envíos a AEAT). En Vercel Hobby
  // solo tenemos 1 cron diario → lo invocamos desde aquí. Para mayor
  // frecuencia (cada 5-15min) hace falta cron externo o Vercel Pro.
  let verifactu = { processed: 0, succeeded: 0, failed: 0 };
  try {
    const { processVerifactuQueue } = await import(
      "@/modules/invoices/verifactu-queue"
    );
    verifactu = await processVerifactuQueue();
  } catch (e) {
    console.error("[cron/daily] verifactu queue failed:", e);
  }

  // ============================================================================
  // SCRAPER PRECIOS AGUA — solo el día 1 del mes
  // ============================================================================
  let scraperStats: { ok: number; failed: number; total: number } | null = null;
  const today = new Date();
  if (today.getDate() === 1) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminCli = (createAdminClient()) as any;
      const { refreshAllScraperPrices } = await import("@/modules/savings/scrapers");
      scraperStats = await refreshAllScraperPrices(adminCli);
      console.log(`[cron/daily] savings scraper:`, scraperStats);
    } catch (e) {
      console.error("[cron/daily] savings scraper failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    stats: { ...stats, verifactu, savings_scraper: scraperStats },
    ranAt: new Date().toISOString(),
  });
}
