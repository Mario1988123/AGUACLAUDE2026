"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * "Mi día": agrega instalaciones, mantenimientos y eventos agenda asignados al
 * usuario actual con scheduled_at hoy. Útil para técnicos/comerciales en
 * tablet/móvil — una sola pantalla con todo lo del día.
 */

export interface DayItem {
  id: string;
  kind: "installation" | "maintenance" | "agenda";
  title: string;
  subtitle: string | null;
  scheduled_at: string;
  status: string;
  href: string;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
}

function startOfToday(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  return { from, to };
}

export async function getMyDayItems(): Promise<DayItem[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { from, to } = startOfToday();

  const [instRes, maintRes, agendaRes] = await Promise.all([
    supabase
      .from("installations")
      .select("id, reference_code, customer_id, status, scheduled_at, address_id")
      .eq("installer_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress", "paused"])
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .is("deleted_at", null),
    supabase
      .from("maintenance_jobs")
      .select("id, customer_id, status, scheduled_at")
      .eq("technician_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress"])
      .gte("scheduled_at", from)
      .lte("scheduled_at", to),
    supabase
      .from("agenda_events")
      .select(
        "id, kind, status, title, description, starts_at, geo_latitude, geo_longitude, subject_type, subject_id",
      )
      .eq("assigned_user_id", session.user_id)
      .in("status", ["scheduled", "in_progress"])
      .gte("starts_at", from)
      .lte("starts_at", to)
      .is("deleted_at", null),
  ]);

  type Inst = {
    id: string;
    reference_code: string | null;
    customer_id: string;
    status: string;
    scheduled_at: string;
    address_id: string | null;
  };
  type Maint = {
    id: string;
    customer_id: string;
    status: string;
    scheduled_at: string;
  };
  type Ag = {
    id: string;
    kind: string;
    status: string;
    title: string;
    description: string | null;
    starts_at: string;
    geo_latitude: number | null;
    geo_longitude: number | null;
    subject_type: string | null;
    subject_id: string | null;
  };
  const insts = (instRes.data ?? []) as Inst[];
  const maints = (maintRes.data ?? []) as Maint[];
  const agendas = (agendaRes.data ?? []) as Ag[];

  // Resolver nombres de cliente
  const cIds = Array.from(
    new Set([...insts.map((i) => i.customer_id), ...maints.map((m) => m.customer_id)].filter(Boolean)),
  );
  const nameMap = new Map<string, string>();
  if (cIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", cIds);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    for (const c of (cs ?? []) as CC[]) {
      const n =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
      nameMap.set(c.id, n);
    }
  }

  const items: DayItem[] = [];

  // Resolver geo de address de instalaciones
  const addrIds = insts.map((i) => i.address_id).filter((v): v is string => !!v);
  const addrGeoMap = new Map<string, { lat: number | null; lng: number | null }>();
  if (addrIds.length > 0) {
    const { data: addrs } = await supabase
      .from("addresses")
      .select("id, latitude, longitude")
      .in("id", addrIds);
    for (const a of (addrs ?? []) as Array<{ id: string; latitude: number | null; longitude: number | null }>) {
      addrGeoMap.set(a.id, { lat: a.latitude, lng: a.longitude });
    }
  }

  for (const i of insts) {
    const geo = i.address_id ? addrGeoMap.get(i.address_id) : null;
    items.push({
      id: i.id,
      kind: "installation",
      title: nameMap.get(i.customer_id) ?? "Cliente",
      subtitle: i.reference_code ?? `#${i.id.slice(0, 8)}`,
      scheduled_at: i.scheduled_at,
      status: i.status,
      href: `/instalaciones/${i.id}`,
      geo_latitude: geo?.lat ?? null,
      geo_longitude: geo?.lng ?? null,
    });
  }
  for (const m of maints) {
    items.push({
      id: m.id,
      kind: "maintenance",
      title: nameMap.get(m.customer_id) ?? "Cliente",
      subtitle: "Mantenimiento",
      scheduled_at: m.scheduled_at,
      status: m.status,
      href: `/mantenimientos/${m.id}`,
    });
  }
  for (const a of agendas) {
    items.push({
      id: a.id,
      kind: "agenda",
      title: a.title,
      subtitle: a.description,
      scheduled_at: a.starts_at,
      status: a.status,
      href: a.subject_type === "lead"
        ? `/leads/${a.subject_id}`
        : a.subject_type === "customer"
          ? `/clientes/${a.subject_id}`
          : "/agenda",
      geo_latitude: a.geo_latitude,
      geo_longitude: a.geo_longitude,
    });
  }

  return items.sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at));
}
