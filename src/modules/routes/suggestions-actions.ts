"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface NearbySuggestion {
  id: string;
  kind: "lead" | "customer";
  title: string;
  subtitle: string | null;
  distance_km: number;
  last_activity: string | null;
  lat: number;
  lng: number;
  href: string;
}

interface Args {
  from_lat: number;
  from_lng: number;
  radius_km?: number;
  exclude_recent_days?: number;
  limit?: number;
}

/**
 * Devuelve leads + clientes con dirección dentro del radio dado, ordenados
 * por proximidad ascendente. Filtra:
 *  · leads: estado != lost/converted, sin contacto en los últimos N días
 *  · clientes: con dirección geolocalizada, sin actividad reciente
 *
 * Diseñado para que un comercial llene huecos del día con visitas cercanas.
 */
export async function suggestNearbyVisits(args: Args): Promise<NearbySuggestion[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (
    !Number.isFinite(args.from_lat) ||
    !Number.isFinite(args.from_lng) ||
    Math.abs(args.from_lat) < 0.001
  ) {
    return [];
  }
  const radiusKm = args.radius_km ?? 15;
  const excludeDays = args.exclude_recent_days ?? 14;
  const limit = args.limit ?? 20;
  const sinceIso = new Date(
    Date.now() - excludeDays * 86400000,
  ).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Leads abiertos
  const { data: leadsRows } = await admin
    .from("leads")
    .select(
      // leads NO tiene company_name ni last_activity_at → usamos legal_name/
      // trade_name y updated_at (como en customers). Antes la query fallaba.
      "id, status, first_name, last_name, legal_name, trade_name, party_kind, updated_at, address_id",
    )
    .eq("company_id", session.company_id)
    .not("status", "in", "(lost,converted)")
    .or(`updated_at.is.null,updated_at.lt.${sinceIso}`)
    .limit(200);

  // 2) Clientes con actividad antigua o sin actividad
  const { data: customersRows } = await admin
    .from("customers")
    .select(
      "id, first_name, last_name, trade_name, legal_name, party_kind, updated_at",
    )
    .eq("company_id", session.company_id)
    .or(`updated_at.is.null,updated_at.lt.${sinceIso}`)
    .limit(200);

  // Resolvemos direcciones primarias para ambos
  const leadIds = ((leadsRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  const customerIds = ((customersRows ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  );

  const { data: addrsLeads } = await admin
    .from("addresses")
    .select("lead_id, latitude, longitude, street_type, street, city")
    .in("lead_id", leadIds.length > 0 ? leadIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("is_primary", true);
  const { data: addrsCust } = await admin
    .from("addresses")
    .select("customer_id, latitude, longitude, street_type, street, city")
    .in(
      "customer_id",
      customerIds.length > 0
        ? customerIds
        : ["00000000-0000-0000-0000-000000000000"],
    )
    .eq("is_primary", true);

  type AL = {
    lead_id: string;
    latitude: number | null;
    longitude: number | null;
    street_type: string | null;
    street: string | null;
    city: string | null;
  };
  type AC = {
    customer_id: string;
    latitude: number | null;
    longitude: number | null;
    street_type: string | null;
    street: string | null;
    city: string | null;
  };

  const leadAddr = new Map<string, AL>();
  for (const a of (addrsLeads ?? []) as AL[]) {
    if (a.latitude != null && a.longitude != null) leadAddr.set(a.lead_id, a);
  }
  const custAddr = new Map<string, AC>();
  for (const a of (addrsCust ?? []) as AC[]) {
    if (a.latitude != null && a.longitude != null)
      custAddr.set(a.customer_id, a);
  }

  const out: NearbySuggestion[] = [];

  type LR = {
    id: string;
    status: string;
    first_name: string | null;
    last_name: string | null;
    legal_name: string | null;
    trade_name: string | null;
    party_kind: string | null;
    updated_at: string | null;
  };
  for (const r of (leadsRows ?? []) as LR[]) {
    const a = leadAddr.get(r.id);
    if (!a) continue;
    const dist = haversineKm(
      args.from_lat,
      args.from_lng,
      Number(a.latitude),
      Number(a.longitude),
    );
    if (dist > radiusKm) continue;
    out.push({
      id: r.id,
      kind: "lead",
      title:
        r.party_kind === "company"
          ? r.trade_name ?? r.legal_name ?? "Empresa"
          : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Lead",
      subtitle: a.street
        ? `${a.street_type ?? "Calle"} ${a.street}${a.city ? `, ${a.city}` : ""}`
        : null,
      distance_km: dist,
      last_activity: r.updated_at,
      lat: Number(a.latitude),
      lng: Number(a.longitude),
      href: `/leads/${r.id}`,
    });
  }
  type CR = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    party_kind: string | null;
    updated_at: string | null;
  };
  for (const r of (customersRows ?? []) as CR[]) {
    const a = custAddr.get(r.id);
    if (!a) continue;
    const dist = haversineKm(
      args.from_lat,
      args.from_lng,
      Number(a.latitude),
      Number(a.longitude),
    );
    if (dist > radiusKm) continue;
    out.push({
      id: r.id,
      kind: "customer",
      title:
        r.party_kind === "company"
          ? r.trade_name ?? r.legal_name ?? "Empresa"
          : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Cliente",
      subtitle: a.street
        ? `${a.street_type ?? "Calle"} ${a.street}${a.city ? `, ${a.city}` : ""}`
        : null,
      distance_km: dist,
      last_activity: r.updated_at,
      lat: Number(a.latitude),
      lng: Number(a.longitude),
      href: `/clientes/${r.id}`,
    });
  }

  out.sort((a, b) => a.distance_km - b.distance_km);
  return out.slice(0, limit);
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
