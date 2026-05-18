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
    schedule_incidents_opened: 0,
  };

  // 0a) Autocierre de fichajes olvidados (también lo hace el cron horario,
  // pero lo repetimos aquí por si el horario fallara o no estuviera activo)
  try {
    const { data: closed } = await admin.rpc("autoclose_stale_punches");
    stats.punches_autoclosed = Number(closed) || 0;
  } catch {
    /* no-op */
  }

  // 0b) Incidencia automática si AYER alguien no cumplió su horario.
  // Solo se ejecuta si la empresa tiene time_tracking activado.
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    const dow = (yesterday.getDay() + 6) % 7; // 0=Lun

    const { data: activeCompanies } = await admin
      .from("company_modules")
      .select("company_id")
      .eq("module_key", "time_tracking")
      .eq("is_active", true);
    type CM = { company_id: string };
    for (const cm of ((activeCompanies ?? []) as CM[])) {
      // Horarios de ayer (qué usuarios tenían turno)
      const { data: scheds } = await admin
        .from("user_work_schedules")
        .select("user_id, starts_at, ends_at, expected_hours, break_minutes")
        .eq("company_id", cm.company_id)
        .eq("day_of_week", dow)
        .not("starts_at", "is", null);
      type Sched = {
        user_id: string;
        starts_at: string | null;
        ends_at: string | null;
        expected_hours: number | null;
        break_minutes: number | null;
      };
      const schedList = (scheds ?? []) as Sched[];
      if (schedList.length === 0) continue;

      // Punches de ayer agrupados por usuario
      const startIso = new Date(yStr + "T00:00:00").toISOString();
      const endIso = new Date(yStr + "T23:59:59.999").toISOString();
      const { data: punches } = await admin
        .from("time_punches")
        .select("user_id, punch_kind, punched_at, auto_closed")
        .eq("company_id", cm.company_id)
        .gte("punched_at", startIso)
        .lte("punched_at", endIso);
      type Punch = {
        user_id: string;
        punch_kind: string;
        punched_at: string;
        auto_closed: boolean;
      };
      const byUser = new Map<string, Punch[]>();
      for (const p of ((punches ?? []) as Punch[])) {
        if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
        byUser.get(p.user_id)!.push(p);
      }

      // Ausencias aprobadas que cubren ayer
      const { data: abs } = await admin
        .from("time_absences")
        .select("user_id")
        .eq("company_id", cm.company_id)
        .eq("status", "approved")
        .lte("starts_on", yStr)
        .gte("ends_on", yStr);
      const absentUsers = new Set<string>(
        ((abs ?? []) as Array<{ user_id: string }>).map((a) => a.user_id),
      );

      // Festivo ese día → no esperamos jornada
      const { data: hol } = await admin
        .from("holidays")
        .select("id")
        .eq("holiday_date", yStr)
        .or(`company_id.eq.${cm.company_id},company_id.is.null`)
        .limit(1);
      const isHoliday = ((hol ?? []) as Array<{ id: string }>).length > 0;
      if (isHoliday) continue;

      for (const s of schedList) {
        if (absentUsers.has(s.user_id)) continue;
        // Calcular minutos esperados
        let expectedMin = 0;
        if (s.expected_hours != null) expectedMin = Math.round(s.expected_hours * 60);
        else if (s.starts_at && s.ends_at) {
          const [sh, sm] = s.starts_at.split(":").map(Number);
          const [eh, em] = s.ends_at.split(":").map(Number);
          expectedMin = (eh! - sh!) * 60 + (em! - sm!) - (s.break_minutes ?? 0);
        }
        if (expectedMin <= 0) continue;

        // Calcular minutos trabajados emparejando in/out
        const list = (byUser.get(s.user_id) ?? []).sort((a, b) =>
          a.punched_at.localeCompare(b.punched_at),
        );
        let worked = 0;
        let openIn: number | null = null;
        let breakStart: number | null = null;
        let anyAutoClosed = false;
        let hasIn = false;
        let hasOut = false;
        for (const p of list) {
          const ts = new Date(p.punched_at).getTime();
          if (p.auto_closed) anyAutoClosed = true;
          if (p.punch_kind === "clock_in") {
            openIn = ts;
            hasIn = true;
          } else if (p.punch_kind === "clock_out" && openIn != null) {
            worked += (ts - openIn) / 60000;
            openIn = null;
            hasOut = true;
          } else if (p.punch_kind === "break_start") {
            breakStart = ts;
          } else if (p.punch_kind === "break_end" && breakStart != null) {
            worked -= (ts - breakStart) / 60000;
            breakStart = null;
          }
        }
        const workedMin = Math.round(worked);

        // Reglas:
        //  - Sin NINGÚN fichaje → attendance_gap (admin clasifica luego)
        //  - Con clock_in pero sin clock_out (y no autoclosed) → incidencia
        //  - Trabajó <80% del esperado → incidencia
        let needsIncident = false;
        let createsGap = false;
        let reason = "";
        if (!hasIn && !hasOut && list.length === 0) {
          createsGap = true;
        } else if (hasIn && !hasOut && !anyAutoClosed) {
          needsIncident = true;
          reason = "Fichó entrada pero no salida.";
        } else if (expectedMin > 0 && workedMin < expectedMin * 0.8) {
          needsIncident = true;
          reason = `Trabajó ${Math.floor(workedMin / 60)}h ${workedMin % 60}m de ${Math.floor(expectedMin / 60)}h ${expectedMin % 60}m esperados.`;
        }

        if (createsGap) {
          // Insertar en attendance_gaps si no existe ya
          try {
            await admin
              .from("attendance_gaps")
              .insert({
                company_id: cm.company_id,
                user_id: s.user_id,
                gap_date: yStr,
                status: "pending",
              })
              .select("id");
          } catch {
            /* idempotente: unique constraint evita duplicar */
          }
          stats.schedule_incidents_opened++;
          continue;
        }

        if (!needsIncident) continue;

        // Buscar nombre para el título
        const { data: prof } = await admin
          .from("user_profiles")
          .select("full_name, email")
          .eq("user_id", s.user_id)
          .maybeSingle();
        const pName =
          (prof as { full_name?: string; email?: string } | null)?.full_name ||
          (prof as { email?: string } | null)?.email ||
          "Usuario";

        // Evitar duplicar: si ya hay incidencia abierta de horario para
        // ese user_id + fecha, saltar.
        const incidentTitle = `Horario incompleto: ${pName} · ${yStr}`;
        const { data: dup } = await admin
          .from("incidents")
          .select("id")
          .eq("company_id", cm.company_id)
          .eq("title", incidentTitle)
          .limit(1)
          .maybeSingle();
        if (dup) continue;

        await admin.from("incidents").insert({
          company_id: cm.company_id,
          title: incidentTitle,
          description: reason,
          origin: "other",
          priority: "low",
          status: "open",
        });
        stats.schedule_incidents_opened++;
      }
    }
  } catch (e) {
    console.error("[cron daily] schedule incidents failed:", e);
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
  // Decisión 2026-05-09: caducidad diferenciada por origen.
  //   - origin='tmk' → lead_expiry_days_tmk (default 15).
  //   - resto → lead_expiry_days_commercial (default 30).
  // Al caducar: status='expired' + DESASIGNAR (assigned_user_id=null) +
  // evento con previous user para el timeline + alerta a nivel 1/2.
  const { data: companies } = await admin
    .from("company_settings")
    .select(
      "company_id, lead_expiry_days, lead_expiry_days_tmk, lead_expiry_days_commercial",
    );
  for (const cs of (companies ?? []) as Array<{
    company_id: string;
    lead_expiry_days: number;
    lead_expiry_days_tmk: number | null;
    lead_expiry_days_commercial: number | null;
  }>) {
    const tmkDays = cs.lead_expiry_days_tmk ?? cs.lead_expiry_days ?? 15;
    const commercialDays = cs.lead_expiry_days_commercial ?? cs.lead_expiry_days ?? 30;
    const maxDays = Math.max(tmkDays, commercialDays);
    const upperCutoff = new Date();
    upperCutoff.setDate(upperCutoff.getDate() - Math.min(tmkDays, commercialDays));

    // Cargamos un buffer amplio (todos los que pueden caducar por TMK) y
    // filtramos por origen + sus días específicos en memoria.
    const bufferCutoff = new Date();
    bufferCutoff.setDate(bufferCutoff.getDate() - Math.min(tmkDays, commercialDays));
    const { data: stale } = await admin
      .from("leads")
      .select(
        "id, legal_name, trade_name, first_name, last_name, party_kind, origin, assigned_user_id, assigned_at",
      )
      .eq("company_id", cs.company_id)
      .in("status", ["new", "contacted", "qualified"])
      .lt("assigned_at", bufferCutoff.toISOString())
      .is("expired_at", null)
      .is("deleted_at", null)
      .limit(500);
    type StaleLead = {
      id: string;
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      party_kind: "company" | "individual";
      origin: string;
      assigned_user_id: string | null;
      assigned_at: string | null;
    };
    const staleList = (stale ?? []) as StaleLead[];
    const toExpire = staleList.filter((l) => {
      if (!l.assigned_at) return false;
      const days = l.origin === "tmk" ? tmkDays : commercialDays;
      const cut = new Date();
      cut.setDate(cut.getDate() - days);
      return new Date(l.assigned_at) < cut;
    });
    if (toExpire.length === 0) continue;

    for (const l of toExpire) {
      // Update individual para guardar previous_assigned_user_id en payload
      await admin
        .from("leads")
        .update({
          status: "expired",
          expired_at: new Date().toISOString(),
          assigned_user_id: null,
          assigned_at: null,
        })
        .eq("id", l.id);

      // Evento timeline con el comercial anterior
      try {
        await admin.from("events").insert({
          company_id: cs.company_id,
          subject_type: "lead",
          subject_id: l.id,
          kind: "lead.unassigned_by_expiry",
          payload: {
            previous_assigned_user_id: l.assigned_user_id,
            origin: l.origin,
            days_threshold: l.origin === "tmk" ? tmkDays : commercialDays,
          },
          actor_user_id: null,
        });
      } catch {
        /* no-op */
      }

      const name =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Sin nombre"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Sin nombre";
      try {
        await notifyByRoles(
          cs.company_id,
          [
            "company_admin",
            "commercial_director",
            "telemarketing_director",
            "technical_director",
          ],
          {
            kind: "lead.expired",
            severity: "warning",
            title: "Lead caducado y desasignado",
            body: `${name} (${l.origin === "tmk" ? "TMK" : "comercial"}). Reasignar desde /leads.`,
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
    // silenciar variables no usadas
    void maxDays;
    void upperCutoff;
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

  // 4b) Generar órdenes de carga sugeridas para mañana (furgonetas)
  let loadingStats = { companies: 0, requests_created: 0, errors: 0 };
  try {
    const { generateLoadingRequestsForTomorrow } = await import(
      "@/modules/warehouses/auto-loading"
    );
    loadingStats = await generateLoadingRequestsForTomorrow();
  } catch (e) {
    console.error("[cron/daily] auto-loading failed:", e);
  }

  // 5) Recalcular alertas inteligentes de stock por empresa
  const stockAlertsStats = { companies: 0, alerts: 0, failed: 0 };
  try {
    const { data: companiesAll } = await admin
      .from("companies")
      .select("id")
      .is("cancelled_at", null);
    const { recomputeStockAlertsForCompany } = await import(
      "@/modules/warehouses/alert-actions"
    );
    for (const c of (companiesAll ?? []) as Array<{ id: string }>) {
      const r = await recomputeStockAlertsForCompany(c.id);
      stockAlertsStats.companies += 1;
      if (r.ok) stockAlertsStats.alerts += r.total;
      else stockAlertsStats.failed += 1;
    }
  } catch (e) {
    console.error("[cron/daily] stock alerts recompute failed:", e);
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
    // Notificar a admin si hay rechazos AEAT en la cola (status='failed')
    if (verifactu.failed > 0) {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const { data: failedRecords } = await admin
        .from("invoice_aeat_submissions")
        .select("company_id")
        .eq("status", "failed")
        .gte("responded_at", since.toISOString());
      // Agrupar manualmente por empresa
      const byCompany = new Map<string, number>();
      for (const r of (failedRecords ?? []) as Array<{
        company_id: string;
      }>) {
        byCompany.set(r.company_id, (byCompany.get(r.company_id) ?? 0) + 1);
      }
      for (const [cid, cnt] of byCompany) {
        try {
          await notifyByRoles(cid, ["company_admin"], {
            kind: "verifactu.failed",
            severity: "error",
            title: `${cnt} factura(s) rechazadas por AEAT`,
            body: "Revisa la cola Verifactu en /facturas para ver el motivo y reintentar.",
            action_url: "/facturas",
          });
        } catch {
          /* no-op */
        }
      }
    }
  } catch (e) {
    console.error("[cron/daily] verifactu queue failed:", e);
  }

  // GoCardless — reintentar pagos fallidos + webhook events no procesados
  const gcRetry = {
    payments: { attempted: 0, succeeded: 0, exhausted: 0 },
    webhooks: { attempted: 0, succeeded: 0 },
  };
  try {
    const { retryFailedPayments, retryFailedWebhookEvents } = await import(
      "@/modules/gocardless/retry"
    );
    gcRetry.payments = await retryFailedPayments();
    gcRetry.webhooks = await retryFailedWebhookEvents();
  } catch (e) {
    console.error("[cron/daily] gocardless retry failed:", e);
  }

  // SLA INCIDENCIAS — escalado progresivo (decisión usuario 2026-05-10):
  //   75% del SLA agotado → recordatorio al técnico asignado
  //   100% (vencido)      → notificación a admin + director técnico
  //   150% del SLA        → aviso de urgencia adicional al admin
  // Idempotente: una notif por (incidencia, etapa) por día.
  let slaBreaches = 0;
  let slaWarnings = 0;
  let slaCritical = 0;
  try {
    const now = new Date();
    const { data: openIncidents } = await admin
      .from("incidents")
      .select(
        "id, company_id, title, priority, created_at, deadline_at, assigned_user_id, customer_id",
      )
      .in("status", ["open", "assigned", "in_progress"])
      .not("deadline_at", "is", null)
      .limit(500);
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    type Inc = {
      id: string;
      company_id: string;
      title: string;
      priority: string;
      created_at: string;
      deadline_at: string;
      assigned_user_id: string | null;
      customer_id: string | null;
    };

    for (const inc of (openIncidents ?? []) as Inc[]) {
      const created = new Date(inc.created_at).getTime();
      const deadline = new Date(inc.deadline_at).getTime();
      const totalMs = deadline - created;
      if (totalMs <= 0) continue;
      const elapsed = now.getTime() - created;
      const pct = elapsed / totalMs;

      async function alreadySent(kind: string): Promise<boolean> {
        const { count } = await admin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("company_id", inc.company_id)
          .eq("kind", kind)
          .eq("subject_id", inc.id)
          .gte("created_at", since.toISOString());
        return (count ?? 0) > 0;
      }

      // 150% (50% pasado de plazo) — urgente
      if (pct >= 1.5) {
        if (await alreadySent("incident.sla_critical")) continue;
        try {
          await notifyByRoles(
            inc.company_id,
            ["company_admin"],
            {
              kind: "incident.sla_critical",
              severity: "error",
              title: `[URGENTE] Incidencia [${inc.priority}] muy retrasada`,
              body: `${inc.title} — pasó +50% del plazo SLA. Resolver ya.`,
              subject_type: "incident",
              subject_id: inc.id,
              action_url: `/incidencias/${inc.id}`,
            },
          );
          slaCritical += 1;
        } catch {
          /* no-op */
        }
        continue;
      }

      // 100% (vencido)
      if (pct >= 1.0) {
        if (await alreadySent("incident.sla_breach")) continue;
        try {
          await notifyByRoles(
            inc.company_id,
            ["company_admin", "technical_director", "commercial_director"],
            {
              kind: "incident.sla_breach",
              severity: "warning",
              title: `Incidencia [${inc.priority}] fuera de plazo SLA`,
              body: inc.title,
              subject_type: "incident",
              subject_id: inc.id,
              action_url: `/incidencias/${inc.id}`,
            },
          );
          slaBreaches += 1;
        } catch {
          /* no-op */
        }
        continue;
      }

      // 75% — recordatorio al técnico asignado
      if (pct >= 0.75 && inc.assigned_user_id) {
        if (await alreadySent("incident.sla_warning")) continue;
        try {
          await admin.from("notifications").insert({
            company_id: inc.company_id,
            recipient_user_id: inc.assigned_user_id,
            kind: "incident.sla_warning",
            severity: "warning",
            title: `Tu incidencia [${inc.priority}] vence pronto`,
            body: `${inc.title} — quedan ${Math.max(0, Math.round((deadline - now.getTime()) / (1000 * 60 * 60)))}h del SLA.`,
            subject_type: "incident",
            subject_id: inc.id,
            action_url: `/incidencias/${inc.id}`,
          });
          slaWarnings += 1;
          // Email al cliente al 50% del SLA si está sin tocar
          if (inc.customer_id) {
            try {
              const { sendIncidentEmailFromCron } = await import(
                "@/modules/incidents/email-from-cron"
              );
              await sendIncidentEmailFromCron(inc.id, "incident_sla_warning");
            } catch (e) {
              console.error("[cron/daily] sla email failed:", e);
            }
          }
        } catch {
          /* no-op */
        }
      }
    }
  } catch (e) {
    console.error("[cron/daily] SLA escalation:", e);
  }

  // ============================================================================
  // PUNTOS — detectar ciclos cuyo periodo ya terminó y marcarlos como
  // pending_review + notificar al director comercial. NUNCA cierra
  // automáticamente: el cierre exige confirmación humana.
  // ============================================================================
  let cyclesPending = 0;
  try {
    const { computeCycleRange } = await import("@/modules/points/cycles-utils");
    const { data: pointSettings } = await admin
      .from("company_settings")
      .select("company_id, points_settings");
    type PS = {
      company_id: string;
      points_settings: { cycle_close_day?: number } | null;
    };
    for (const row of (pointSettings ?? []) as PS[]) {
      const closeDay = row.points_settings?.cycle_close_day ?? 0;
      const now = new Date();
      // Periodo anterior al actual
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const prevRange = computeCycleRange(yesterday, closeDay);
      // Solo si el rango anterior YA cerró (end_at < ahora)
      if (prevRange.end_at.getTime() > now.getTime()) continue;

      // Buscar el ciclo de ese periodo
      const { data: cycle } = await admin
        .from("points_cycles")
        .select("id, status")
        .eq("company_id", row.company_id)
        .eq("cycle_year", prevRange.cycle_year)
        .eq("cycle_month", prevRange.cycle_month)
        .maybeSingle();
      if (!cycle) {
        // Crear el ciclo en pending_review directamente
        const { data: created } = await admin
          .from("points_cycles")
          .insert({
            company_id: row.company_id,
            cycle_year: prevRange.cycle_year,
            cycle_month: prevRange.cycle_month,
            cycle_start_at: prevRange.start_at.toISOString(),
            cycle_end_at: prevRange.end_at.toISOString(),
            close_day: closeDay,
            status: "pending_review",
          })
          .select("id")
          .single();
        if (created) {
          cyclesPending += 1;
          await notifyByRoles(
            row.company_id,
            ["company_admin", "commercial_director"],
            {
              kind: "points.cycle_pending",
              severity: "info",
              title: "Ciclo de comisiones pendiente de revisión",
              body: `${prevRange.cycle_month
                .toString()
                .padStart(2, "0")}/${prevRange.cycle_year} cerró su periodo. Revisa y cierra desde Comisiones.`,
              action_url: `/comisiones/${(created as { id: string }).id}`,
            },
          ).catch(() => null);
        }
        continue;
      }
      const c = cycle as { id: string; status: string };
      if (c.status !== "open") continue;
      await admin
        .from("points_cycles")
        .update({ status: "pending_review" })
        .eq("id", c.id);
      cyclesPending += 1;
      await notifyByRoles(
        row.company_id,
        ["company_admin", "commercial_director"],
        {
          kind: "points.cycle_pending",
          severity: "info",
          title: "Ciclo de comisiones pendiente de revisión",
          body: `${prevRange.cycle_month
            .toString()
            .padStart(2, "0")}/${prevRange.cycle_year} cerró su periodo. Revisa y cierra desde Comisiones.`,
          action_url: `/comisiones/${c.id}`,
        },
      ).catch(() => null);
    }
  } catch (e) {
    console.error("[cron/daily] points cycles pending failed:", e);
  }

  // ============================================================================
  // RGPD MAILING — purga de body_html en emails de más de 6 meses
  // (mantiene metadatos para métricas y trazabilidad)
  // ============================================================================
  let mailingPurged = 0;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    const r = await admin
      .from("email_sends")
      .update({ body_html: null, body_text: null })
      .lt("created_at", cutoff.toISOString())
      .not("body_html", "is", null)
      .select("id");
    mailingPurged = ((r.data ?? []) as Array<unknown>).length;
  } catch (e) {
    console.error("[cron/daily] mailing purge failed:", e);
  }

  // ============================================================================
  // ============================================================================
  // FASE 2 — Automatizaciones cross-módulo
  // ============================================================================
  const phase2 = {
    proposals_expired: 0,
    proposals_followup_notified: 0,
    free_trials_expired: 0,
    next_maintenance_scheduled: 0,
    installations_forgotten_notified: 0,
  };

  // P2-A) Auto-expire propuestas enviadas hace > 30 días (validez por defecto)
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const { data: expired } = await admin
      .from("proposals")
      .update({ status: "expired" })
      .eq("status", "sent")
      .lt("sent_at", cutoff.toISOString())
      .is("deleted_at", null)
      .select("id");
    phase2.proposals_expired = ((expired ?? []) as Array<unknown>).length;
  } catch (e) {
    console.error("[phase2/expire-proposals]", e);
  }

  // P2-B) Notificar al comercial propuestas sent >7d sin respuesta (una vez)
  try {
    const cutoff7 = new Date();
    cutoff7.setDate(cutoff7.getDate() - 7);
    const cutoff8 = new Date();
    cutoff8.setDate(cutoff8.getDate() - 8);
    // Solo notificamos las que entraron en la ventana hoy (entre día 7 y 8)
    // para no spamear cada día. Si la query falla queda en 0.
    const { data: stale } = await admin
      .from("proposals")
      .select("id, company_id, created_by")
      .eq("status", "sent")
      .gte("sent_at", cutoff8.toISOString())
      .lte("sent_at", cutoff7.toISOString())
      .is("deleted_at", null);
    for (const p of ((stale ?? []) as Array<{
      id: string;
      company_id: string;
      created_by: string | null;
    }>)) {
      if (!p.created_by) continue;
      try {
        await admin.from("notifications").insert({
          company_id: p.company_id,
          recipient_user_id: p.created_by,
          kind: "proposal.followup",
          severity: "info",
          title: "Propuesta sin respuesta hace 7 días",
          body: "Considera contactar al cliente para seguimiento.",
          subject_type: "proposal",
          subject_id: p.id,
          action_url: `/propuestas/${p.id}`,
        });
        phase2.proposals_followup_notified += 1;
      } catch {
        /* */
      }
    }
  } catch (e) {
    console.error("[phase2/followup]", e);
  }

  // P2-C) Marcar pruebas gratuitas caducadas (expires_at < hoy, status installed)
  try {
    const todayDate = new Date().toISOString().slice(0, 10);
    const { data: expiredTrials } = await admin
      .from("free_trials")
      .update({ status: "expired" })
      .eq("status", "installed")
      .lt("expires_at", todayDate)
      .select("id, company_id, assigned_user_id");
    phase2.free_trials_expired = ((expiredTrials ?? []) as Array<unknown>).length;
    for (const t of (expiredTrials ?? []) as Array<{
      id: string;
      company_id: string;
      assigned_user_id: string | null;
    }>) {
      if (t.assigned_user_id) {
        try {
          await admin.from("notifications").insert({
            company_id: t.company_id,
            recipient_user_id: t.assigned_user_id,
            kind: "free_trial.expired",
            severity: "warning",
            title: "Prueba gratuita caducada",
            body: "Decisión pendiente: contratar o desinstalar.",
            subject_type: "free_trial",
            subject_id: t.id,
            action_url: `/pruebas-gratuitas/${t.id}`,
          });
        } catch {
          /* */
        }
      }
    }
  } catch (e) {
    console.error("[phase2/free-trials-expire]", e);
  }

  // P2-D) Programar siguiente mantenimiento para contratos activos con
  // maintenance_included que no tengan job futuro programado.
  try {
    const todayDate2 = new Date().toISOString().slice(0, 10);
    const { data: activeContracts } = await admin
      .from("contracts")
      .select("id, company_id, customer_id, service_start_date")
      .eq("status", "active")
      .eq("maintenance_included", true)
      .is("deleted_at", null);
    for (const c of (activeContracts ?? []) as Array<{
      id: string;
      company_id: string;
      customer_id: string;
      service_start_date: string | null;
    }>) {
      // ¿Tiene job futuro?
      const { count } = await admin
        .from("maintenance_jobs")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", c.id)
        .in("status", ["scheduled", "in_progress"])
        .gte("scheduled_at", todayDate2);
      if ((count ?? 0) > 0) continue;
      // Crear próximo job a 6 meses del último completado (o desde service_start_date).
      const { data: last } = await admin
        .from("maintenance_jobs")
        .select("completed_at")
        .eq("contract_id", c.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const baseDate = (last as { completed_at: string | null } | null)?.completed_at
        ?? c.service_start_date
        ?? todayDate2;
      const next = new Date(baseDate);
      next.setMonth(next.getMonth() + 6);
      if (next < new Date()) {
        // Si por fechas raras quedaría en el pasado, lo programamos en +14d.
        next.setTime(Date.now() + 14 * 86400000);
      }
      try {
        await admin.from("maintenance_jobs").insert({
          company_id: c.company_id,
          customer_id: c.customer_id,
          contract_id: c.id,
          kind: "contracted",
          status: "scheduled",
          scheduled_at: next.toISOString(),
        });
        phase2.next_maintenance_scheduled += 1;
      } catch {
        /* */
      }
    }
  } catch (e) {
    console.error("[phase2/next-maintenance]", e);
  }

  // P2-E) Avisar de instalaciones del día que siguen in_progress después de
  // las 22:00 (probable olvido del técnico).
  try {
    const nowHour = new Date().getHours();
    if (nowHour >= 22) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const { data: forgotten } = await admin
        .from("installations")
        .select("id, company_id, installer_user_id, reference_code")
        .eq("status", "in_progress")
        .gte("scheduled_at", dayStart.toISOString())
        .is("deleted_at", null);
      for (const ins of (forgotten ?? []) as Array<{
        id: string;
        company_id: string;
        installer_user_id: string | null;
        reference_code: string | null;
      }>) {
        if (!ins.installer_user_id) continue;
        try {
          await admin.from("notifications").insert({
            company_id: ins.company_id,
            recipient_user_id: ins.installer_user_id,
            kind: "installation.forgotten",
            severity: "warning",
            title: "Instalación en curso sin cerrar",
            body: `${ins.reference_code ?? "Instalación"} sigue en curso. ¿Olvidaste cerrar el parte?`,
            subject_type: "installation",
            subject_id: ins.id,
            action_url: `/instalaciones/${ins.id}`,
          });
          phase2.installations_forgotten_notified += 1;
        } catch {
          /* */
        }
      }
    }
  } catch (e) {
    console.error("[phase2/installations-forgotten]", e);
  }

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

  // ============================================================================
  // FASE 2 — AUTO-MENSUALIDAD FACTURACIÓN RENTING/RENTAL — día 1 de cada mes
  // ============================================================================
  let monthlyInvoicing: { contracts: number; generated: number; errors: number } | null = null;
  if (today.getDate() === 1) {
    monthlyInvoicing = { contracts: 0, generated: 0, errors: 0 };
    try {
      const monthIso = today.toISOString().slice(0, 10);
      const { data: activeContracts } = await admin
        .from("contracts")
        .select("id, company_id, customer_id, monthly_cents, reference_code, plan_type")
        .eq("status", "active")
        .in("plan_type", ["renting", "rental"])
        .gt("monthly_cents", 0)
        .is("deleted_at", null);
      for (const c of ((activeContracts ?? []) as Array<{
        id: string;
        company_id: string;
        customer_id: string;
        monthly_cents: number;
        reference_code: string | null;
      }>)) {
        monthlyInvoicing.contracts += 1;
        try {
          // ¿Existe ya una factura de este mes para este contrato?
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
          const { count: already } = await admin
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("contract_id", c.id)
            .gte("issued_at", monthStart)
            .is("deleted_at", null);
          if ((already ?? 0) > 0) continue;
          // Insertar factura mínima draft (admin la emite a mano si quiere)
          const { error } = await admin.from("invoices").insert({
            company_id: c.company_id,
            customer_id: c.customer_id,
            contract_id: c.id,
            kind: "invoice",
            status: "draft",
            total_cents: c.monthly_cents,
            pending_cents: c.monthly_cents,
            issue_date: monthIso,
            due_date: new Date(today.getFullYear(), today.getMonth() + 1, 0)
              .toISOString()
              .slice(0, 10),
            notes: `Mensualidad ${monthIso.slice(0, 7)} contrato ${c.reference_code ?? c.id.slice(0, 8)}`,
          });
          if (error) {
            monthlyInvoicing.errors += 1;
            console.error("[phase2/monthly-invoice]", error.message);
            continue;
          }
          monthlyInvoicing.generated += 1;
        } catch (e) {
          monthlyInvoicing.errors += 1;
          console.error("[phase2/monthly-invoice exception]", e);
        }
      }
    } catch (e) {
      console.error("[phase2/monthly-invoicing]", e);
    }
  }

  return NextResponse.json({
    ok: true,
    stats: {
      ...stats,
      verifactu,
      savings_scraper: scraperStats,
      stock_alerts: stockAlertsStats,
      auto_loading: loadingStats,
      incident_sla_breaches: slaBreaches,
      gocardless_retry: gcRetry,
      cycles_pending_review: cyclesPending,
      sla: {
        breaches: slaBreaches,
        warnings: slaWarnings,
        critical: slaCritical,
      },
      mailing_purged: mailingPurged,
      phase2,
      monthly_invoicing: monthlyInvoicing,
    },
    ranAt: new Date().toISOString(),
  });
}
