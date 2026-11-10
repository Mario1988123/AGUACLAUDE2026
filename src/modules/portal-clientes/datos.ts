import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { SesionPortal } from "./sesion";

// =============================================================================
// Datos que ve el cliente en su portal. SIEMPRE filtrados por company_id y
// customer_id de la sesión del portal (service_role, sin RLS). Cada bloque es
// independiente: si uno falla, el resto se pinta.
// =============================================================================

export interface DatosPortal {
  empresa: { nombre: string; telefono: string | null; email: string | null };
  cliente: { nombre: string; email: string | null; telefono: string | null };
  equipos: Array<{
    id: string;
    nombre: string;
    direccion: string | null;
    numero_serie: string | null;
    instalado_el: string | null;
    garantia_hasta: string | null;
    ultimo_mantenimiento: string | null;
  }>;
  proximos_mantenimientos: Array<{ id: string; fecha: string | null; tipo: string; estado: string }>;
  mantenimientos_hechos: Array<{ id: string; fecha: string | null; tipo: string }>;
  contratos: Array<{
    id: string;
    referencia: string | null;
    estado: string;
    cuota_cents: number | null;
    firmado_el: string | null;
  }>;
  planes_mantenimiento: Array<{
    id: string;
    referencia: string | null;
    estado: string | null;
    cuota_cents: number | null;
    visitas_anuales: number | null;
    desde: string | null;
    hasta: string | null;
  }>;
  incidencias: Array<{
    id: string;
    referencia: string | null;
    titulo: string;
    estado: string;
    abierta_el: string;
    resuelta_el: string | null;
  }>;
  facturas: Array<{
    id: string;
    referencia: string | null;
    estado: string;
    total_cents: number;
    fecha: string | null;
    vence: string | null;
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function seguro<T>(fn: () => Promise<T>, defecto: T, etiqueta: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[portal.datos] ${etiqueta}:`, e);
    return defecto;
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function cargarDatosPortal(s: SesionPortal): Promise<DatosPortal> {
  const admin = createAdminClient() as Admin;
  const co = s.company_id;
  const cu = s.customer_id;
  const ahora = new Date().toISOString();

  const [empresa, cliente, equipos, mant, contratos, planes, incidencias, facturas] =
    await Promise.all([
      seguro(
        async () => {
          const { data } = await admin
            .from("companies")
            .select("name, billing_email, fiscal_data")
            .eq("id", co)
            .maybeSingle();
          const fd = (data?.fiscal_data ?? {}) as Record<string, unknown>;
          return {
            nombre: (data?.name as string) ?? "",
            telefono: texto(fd.phone) ?? texto(fd.telefono),
            email: texto(fd.email) ?? texto(data?.billing_email),
          };
        },
        { nombre: "", telefono: null, email: null },
        "empresa",
      ),
      seguro(
        async () => {
          const { data } = await admin
            .from("customers")
            .select("first_name, last_name, legal_name, trade_name, email, phone_primary")
            .eq("id", cu)
            .eq("company_id", co)
            .maybeSingle();
          const nombre =
            [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim() ||
            data?.trade_name ||
            data?.legal_name ||
            "";
          return { nombre, email: data?.email ?? null, telefono: data?.phone_primary ?? null };
        },
        { nombre: "", email: null, telefono: null },
        "cliente",
      ),
      seguro(() => cargarEquipos(admin, co, cu), [], "equipos"),
      seguro(
        async () => {
          const { data } = await admin
            .from("maintenance_jobs")
            .select("id, kind, status, scheduled_at, completed_at")
            .eq("company_id", co)
            .eq("customer_id", cu)
            .order("scheduled_at", { ascending: false })
            .limit(200);
          return (data ?? []) as Array<{
            id: string;
            kind: string;
            status: string;
            scheduled_at: string | null;
            completed_at: string | null;
          }>;
        },
        [],
        "mantenimientos",
      ),
      seguro(
        async () => {
          const { data } = await admin
            .from("contracts")
            .select("id, reference_code, status, monthly_cents, signed_at")
            .eq("company_id", co)
            .eq("customer_id", cu)
            .is("deleted_at", null)
            .in("status", ["signed", "active", "completed"])
            .order("signed_at", { ascending: false });
          return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
            id: c.id as string,
            referencia: (c.reference_code as string) ?? null,
            estado: c.status as string,
            cuota_cents: (c.monthly_cents as number) ?? null,
            firmado_el: (c.signed_at as string) ?? null,
          }));
        },
        [],
        "contratos",
      ),
      seguro(
        async () => {
          const { data } = await admin
            .from("maintenance_contracts")
            .select("id, reference_code, status, monthly_cents_snapshot, visits_per_year_snapshot, starts_on, ends_on")
            .eq("company_id", co)
            .eq("customer_id", cu)
            .is("deleted_at", null)
            .neq("status", "draft")
            .order("starts_on", { ascending: false });
          return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: m.id as string,
            referencia: (m.reference_code as string) ?? null,
            estado: (m.status as string) ?? null,
            cuota_cents: (m.monthly_cents_snapshot as number) ?? null,
            visitas_anuales: (m.visits_per_year_snapshot as number) ?? null,
            desde: (m.starts_on as string) ?? null,
            hasta: (m.ends_on as string) ?? null,
          }));
        },
        [],
        "planes",
      ),
      seguro(
        async () => {
          const { data } = await admin
            .from("incidents")
            .select("id, reference_code, title, status, created_at, resolved_at")
            .eq("company_id", co)
            .eq("customer_id", cu)
            .order("created_at", { ascending: false })
            .limit(50);
          return ((data ?? []) as Array<Record<string, unknown>>).map((i) => ({
            id: i.id as string,
            referencia: (i.reference_code as string) ?? null,
            titulo: (i.title as string) ?? "Incidencia",
            estado: i.status as string,
            abierta_el: i.created_at as string,
            resuelta_el: (i.resolved_at as string) ?? null,
          }));
        },
        [],
        "incidencias",
      ),
      seguro(
        async () => {
          const { data } = await admin
            .from("invoices")
            .select("id, full_reference, status, total_cents, issue_date, due_date")
            .eq("company_id", co)
            .eq("customer_id", cu)
            .in("status", ["issued", "paid", "overdue"])
            .is("deleted_at", null)
            .order("issue_date", { ascending: false })
            .limit(100);
          return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
            id: f.id as string,
            referencia: (f.full_reference as string) ?? null,
            estado: f.status as string,
            total_cents: (f.total_cents as number) ?? 0,
            fecha: (f.issue_date as string) ?? null,
            vence: (f.due_date as string) ?? null,
          }));
        },
        [],
        "facturas",
      ),
    ]);

  const proximos = mant
    .filter((m) => (m.status === "scheduled" || m.status === "rescheduled") && (!m.scheduled_at || m.scheduled_at >= ahora))
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))
    .map((m) => ({ id: m.id, fecha: m.scheduled_at, tipo: m.kind, estado: m.status }));
  const hechos = mant
    .filter((m) => m.status === "completed")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 20)
    .map((m) => ({ id: m.id, fecha: m.completed_at ?? m.scheduled_at, tipo: m.kind }));

  return {
    empresa,
    cliente,
    equipos,
    proximos_mantenimientos: proximos,
    mantenimientos_hechos: hechos,
    contratos,
    planes_mantenimiento: planes,
    incidencias,
    facturas,
  };
}

async function cargarEquipos(admin: Admin, co: string, cu: string): Promise<DatosPortal["equipos"]> {
  const { data, error } = await admin
    .from("customer_equipment")
    .select("id, product_id, external_equipment_model_id, address_id, serial_number, installed_at, warranty_until, is_active")
    .eq("company_id", co)
    .eq("customer_id", cu)
    .eq("is_active", true)
    .order("installed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as Array<{
    id: string;
    product_id: string | null;
    external_equipment_model_id: string | null;
    address_id: string | null;
    serial_number: string | null;
    installed_at: string | null;
    warranty_until: string | null;
  }>;
  if (filas.length === 0) return [];

  const unicos = (xs: Array<string | null>) => Array.from(new Set(xs.filter(Boolean))) as string[];
  const nombres = new Map<string, string>();
  const direcciones = new Map<string, string>();
  const ultimo = new Map<string, string>();

  const pIds = unicos(filas.map((f) => f.product_id));
  if (pIds.length) {
    const { data: ps } = await admin.from("products").select("id, name").in("id", pIds);
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>) nombres.set(p.id, p.name);
  }
  const eIds = unicos(filas.map((f) => f.external_equipment_model_id));
  if (eIds.length) {
    const { data: es } = await admin
      .from("external_equipment_models")
      .select("id, brand, model")
      .in("id", eIds);
    for (const e of (es ?? []) as Array<{ id: string; brand: string | null; model: string | null }>) {
      const l = `${e.brand ?? ""} ${e.model ?? ""}`.trim();
      if (l) nombres.set(e.id, l);
    }
  }
  const aIds = unicos(filas.map((f) => f.address_id));
  if (aIds.length) {
    const { data: as } = await admin
      .from("addresses")
      .select("id, street_type, street, street_number, city")
      .in("id", aIds)
      .eq("company_id", co);
    for (const a of (as ?? []) as Array<Record<string, string | null>>) {
      const l = [a.street_type, a.street, a.street_number].filter(Boolean).join(" ");
      direcciones.set(a.id as string, [l, a.city].filter(Boolean).join(", "));
    }
  }
  const { data: ms } = await admin
    .from("maintenance_jobs")
    .select("customer_equipment_id, completed_at")
    .eq("company_id", co)
    .in("customer_equipment_id", filas.map((f) => f.id))
    .eq("status", "completed");
  for (const m of (ms ?? []) as Array<{ customer_equipment_id: string; completed_at: string | null }>) {
    if (!m.completed_at) continue;
    const prev = ultimo.get(m.customer_equipment_id);
    if (!prev || m.completed_at > prev) ultimo.set(m.customer_equipment_id, m.completed_at);
  }

  return filas.map((f) => ({
    id: f.id,
    nombre:
      (f.product_id && nombres.get(f.product_id)) ||
      (f.external_equipment_model_id && nombres.get(f.external_equipment_model_id)) ||
      "Equipo",
    direccion: f.address_id ? direcciones.get(f.address_id) ?? null : null,
    numero_serie: f.serial_number,
    instalado_el: f.installed_at,
    garantia_hasta: f.warranty_until,
    ultimo_mantenimiento: ultimo.get(f.id) ?? null,
  }));
}
