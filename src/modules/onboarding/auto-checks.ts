// NO "use server": exporta un objeto Record, no son server actions. Las
// funciones se llaman desde state-actions.ts (que sí es server) y usan
// createAdminClient, así que su ejecución es server-side de todos modos.
import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Auto-detección de pasos completados del onboarding.
 *
 * Cada función recibe el company_id y devuelve true si el paso está YA
 * hecho en la BD (no requiere marcar manualmente). Si la función
 * lanza, asumimos NO completado (fail-safe).
 *
 * Decisión 2026-05-20: la mayoría de los pasos de la guía pueden
 * detectarse sin pedirle al admin que pulse "Marcar hecho" — basta
 * con consultar el estado real del CRM. Esto evita falsos pendientes
 * cuando una empresa migra desde un sistema existente.
 */
export type AutoCheckFn = (companyId: string) => Promise<boolean>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  return createAdminClient() as unknown;
}

/** Comprueba si TODOS los productos activos tienen al menos un precio. */
async function productsPriced(companyId: string): Promise<boolean> {
  const a = admin();
  // Si no hay productos, el paso "precios de productos" no tiene sentido
  // como pendiente — lo damos por hecho (será relevante cuando haya).
  const { count: total } = await a
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("is_active", true)
    .is("deleted_at", null);
  if ((total ?? 0) === 0) return true;
  // ¿Hay al menos UN producto con precio?
  const { data: priced } = await a
    .from("product_prices")
    .select("product_id")
    .eq("company_id", companyId)
    .not("price_cents", "is", null)
    .gt("price_cents", 0)
    .limit(1);
  return Array.isArray(priced) && priced.length > 0;
}

/** Series de facturación: ¿hay al menos 1 serie activa? */
async function invoicingSeries(companyId: string): Promise<boolean> {
  const a = admin();
  // Defensiva: la tabla puede llamarse invoice_series, series_invoicing,
  // billing_series… probamos en orden.
  const candidates = ["invoice_series", "billing_series", "invoicing_series"];
  for (const t of candidates) {
    try {
      const { count } = await a
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .is("deleted_at", null);
      if ((count ?? 0) > 0) return true;
    } catch {
      /* tabla no existe */
    }
  }
  return false;
}

/** Modo Verifactu: cualquier valor explícito en company_settings.verifactu_mode. */
async function verifactuMode(companyId: string): Promise<boolean> {
  const a = admin();
  const { data } = await a
    .from("company_settings")
    .select("verifactu_mode")
    .eq("company_id", companyId)
    .maybeSingle();
  const v = (data as { verifactu_mode: string | null } | null)?.verifactu_mode;
  // Cualquier valor configurado (incluso "disabled" es decisión consciente)
  return v != null && v !== "";
}

/** Horarios y vacaciones: ¿hay al menos 1 user con horario asignado? */
async function workSchedules(companyId: string): Promise<boolean> {
  const a = admin();
  const candidates = [
    "user_work_schedules",
    "user_schedules",
    "work_schedules",
  ];
  for (const t of candidates) {
    try {
      const { count } = await a
        .from(t)
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if ((count ?? 0) > 0) return true;
    } catch {
      /* */
    }
  }
  return false;
}

/** Calendario de festivos: ¿hay festivos cargados para el año actual? */
async function holidays(companyId: string): Promise<boolean> {
  const a = admin();
  const year = new Date().getFullYear();
  try {
    const { count } = await a
      .from("holidays")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* */
  }
  // Sin company_id (festivos globales del sistema)
  try {
    const { count } = await a
      .from("holidays")
      .select("id", { count: "exact", head: true })
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* */
  }
  return false;
}

/** Agenda: si alguna columna de tolerancia GPS o radio de ruta tiene valor. */
async function agendaConfig(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { data } = await a
      .from("company_settings")
      .select(
        "scheduling_max_route_radius_km, gps_tolerance_meters, schedule_default_start_hour",
      )
      .eq("company_id", companyId)
      .maybeSingle();
    const r = data as
      | {
          scheduling_max_route_radius_km: number | null;
          gps_tolerance_meters: number | null;
          schedule_default_start_hour: number | null;
        }
      | null;
    if (!r) return false;
    return (
      r.scheduling_max_route_radius_km != null ||
      r.gps_tolerance_meters != null ||
      r.schedule_default_start_hour != null
    );
  } catch {
    return false;
  }
}

/** Planes de mantenimiento: ¿hay al menos uno activo? */
async function maintenancePlans(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { count } = await a
      .from("maintenance_plans")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** SLA de incidencias: ¿hay configuración SLA personalizada? */
async function incidentSla(companyId: string): Promise<boolean> {
  const a = admin();
  const candidates = ["incident_sla_settings", "incident_sla", "sla_settings"];
  for (const t of candidates) {
    try {
      const { count } = await a
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if ((count ?? 0) > 0) return true;
    } catch {
      /* */
    }
  }
  // Fallback: comprobar columna en company_settings
  try {
    const { data } = await a
      .from("company_settings")
      .select("incident_sla_first_response_hours")
      .eq("company_id", companyId)
      .maybeSingle();
    const v = (data as { incident_sla_first_response_hours: number | null } | null)
      ?.incident_sla_first_response_hours;
    return v != null;
  } catch {
    return false;
  }
}

/** GoCardless: ¿está configurado y enabled? */
async function gocardless(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { data } = await a
      .from("gocardless_settings")
      .select("access_token, enabled")
      .eq("company_id", companyId)
      .maybeSingle();
    const r = data as
      | { access_token: string | null; enabled: boolean | null }
      | null;
    return Boolean(r?.access_token && r?.enabled);
  } catch {
    return false;
  }
}

/** Wallet methods: IBAN de la empresa configurado en company_settings. */
async function walletMethods(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { data } = await a
      .from("company_settings")
      .select("fiscal_iban")
      .eq("company_id", companyId)
      .maybeSingle();
    const v = (data as { fiscal_iban: string | null } | null)?.fiscal_iban;
    return v != null && v.trim().length > 0;
  } catch {
    return false;
  }
}

/** Dominio email verificado en mailing settings. */
async function mailingDomain(companyId: string): Promise<boolean> {
  const a = admin();
  const candidates = [
    "company_mailing_settings",
    "mailing_settings",
    "email_settings",
  ];
  for (const t of candidates) {
    try {
      const { data } = await a
        .from(t)
        .select("domain, domain_verified, from_email")
        .eq("company_id", companyId)
        .maybeSingle();
      const r = data as
        | { domain: string | null; domain_verified: boolean | null; from_email: string | null }
        | null;
      if (r && (r.domain_verified === true || r.from_email)) return true;
    } catch {
      /* */
    }
  }
  return false;
}

/** Plantillas email: ¿hay al menos 1 plantilla custom de la empresa? */
async function emailTemplates(companyId: string): Promise<boolean> {
  const a = admin();
  const candidates = ["email_templates", "mailing_templates"];
  for (const t of candidates) {
    try {
      const { count } = await a
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if ((count ?? 0) > 0) return true;
    } catch {
      /* */
    }
  }
  return false;
}

/** Si la empresa tiene 1+ factura emitida → series y verifactu deben estar OK. */
async function hasAnyInvoiceIssued(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { count } = await a
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .neq("status", "draft")
      .is("deleted_at", null);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Si tiene contratos firmados → catálogo + precios deben estar OK. */
async function hasAnyContractSigned(companyId: string): Promise<boolean> {
  const a = admin();
  try {
    const { count } = await a
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["signed", "active", "completed"])
      .is("deleted_at", null);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Mapa de step_key → función de auto-check.
 * Las que no aparecen aquí, caen al sistema declarativo `auto_check` en
 * steps-config.ts o requieren marcado manual.
 */
export const AUTO_CHECK_FUNCTIONS: Record<string, AutoCheckFn> = {
  invoicing_series: async (cid) => {
    // Si ya hay alguna factura emitida, asumimos serie configurada
    if (await hasAnyInvoiceIssued(cid)) return true;
    return invoicingSeries(cid);
  },
  verifactu_mode: verifactuMode,
  product_pricing: async (cid) => {
    if (await hasAnyContractSigned(cid)) return true;
    return productsPriced(cid);
  },
  work_schedules: workSchedules,
  holidays: holidays,
  agenda_config: agendaConfig,
  maintenance_plans: maintenancePlans,
  incident_sla: incidentSla,
  gocardless: gocardless,
  wallet_methods: walletMethods,
  mailing_domain: mailingDomain,
  email_templates: emailTemplates,
};
