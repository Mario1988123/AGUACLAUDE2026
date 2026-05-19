"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface SchedulingContext {
  ok: boolean;
  error?: string;
  /** Preferencias del cliente recogidas en el contrato. */
  preferences: {
    slot: "morning" | "afternoon" | "any" | "custom" | null;
    notes: string | null;
    days_of_week: number[] | null;
    dates: string[] | null;
  };
  /** Días con instalaciones del instalador en el rango (YYYY-MM-DD → count). */
  installer_busy_days: Record<string, number>;
  /** Días con AL MENOS un hueco morning/afternoon libre. */
  installer_free_slots: Record<string, { morning: boolean; afternoon: boolean }>;
  /** Dirección breve del cliente (para mostrar). */
  customer_address: string | null;
  /** Días sugeridos por proximidad. YYYY-MM-DD → distancia min al cliente más cercano del técnico ese día. */
  suggested_route_days: Record<string, { km: number; nearby_count: number }>;
  /** Radio configurado por la empresa. */
  max_route_radius_km: number;
}

/**
 * Devuelve el contexto necesario para agendar una instalación:
 *  - Preferencias del cliente (slot, fechas, notas).
 *  - Huecos del instalador en las próximas 8 semanas: qué días tiene
 *    instalaciones programadas y qué franjas (morning/afternoon) están
 *    ocupadas.
 *
 * Útil para que el modal de agendar muestre un mini-calendario con
 * disponibilidad en tiempo real.
 */
export async function getSchedulingContext(
  installationId: string,
  installerUserId: string | null,
): Promise<SchedulingContext> {
  const empty: SchedulingContext = {
    ok: false,
    preferences: { slot: null, notes: null, days_of_week: null, dates: null },
    installer_busy_days: {},
    installer_free_slots: {},
    customer_address: null,
    suggested_route_days: {},
    max_route_radius_km: 15,
  };
  try {
    const session = await requireSession();
    if (!session.company_id) return { ...empty, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Cargar la instalación + contrato + dirección
    const { data: inst } = await admin
      .from("installations")
      .select("id, contract_id, address_id, customer_id, company_id")
      .eq("id", installationId)
      .maybeSingle();
    if (!inst) return { ...empty, error: "Instalación no encontrada" };
    const i = inst as {
      id: string;
      contract_id: string | null;
      address_id: string | null;
      customer_id: string | null;
      company_id: string;
    };
    if (i.company_id !== session.company_id)
      return { ...empty, error: "Otra empresa" };

    // Preferencias desde el contrato
    let preferences = empty.preferences;
    if (i.contract_id) {
      try {
        const { data } = await admin
          .from("contracts")
          .select(
            "preferred_install_time_slot, preferred_install_time_notes, preferred_install_days_of_week, preferred_install_dates",
          )
          .eq("id", i.contract_id)
          .maybeSingle();
        if (data) {
          const c = data as {
            preferred_install_time_slot: string | null;
            preferred_install_time_notes: string | null;
            preferred_install_days_of_week: number[] | null;
            preferred_install_dates: string[] | null;
          };
          preferences = {
            slot: (c.preferred_install_time_slot as
              | "morning"
              | "afternoon"
              | "any"
              | "custom"
              | null) ?? null,
            notes: c.preferred_install_time_notes,
            days_of_week: c.preferred_install_days_of_week,
            dates: c.preferred_install_dates,
          };
        }
      } catch {
        /* fail-soft si schema cache no tiene las columnas */
      }
    }

    // Dirección breve
    let customerAddress: string | null = null;
    if (i.address_id) {
      try {
        const { data } = await admin
          .from("addresses")
          .select("street_type, street, street_number, city, postal_code")
          .eq("id", i.address_id)
          .maybeSingle();
        if (data) {
          const a = data as {
            street_type: string | null;
            street: string | null;
            street_number: string | null;
            city: string | null;
            postal_code: string | null;
          };
          const street = `${a.street_type ?? ""} ${a.street ?? ""}`.trim();
          const num = a.street_number ? ` ${a.street_number}` : "";
          const pc = a.postal_code ? ` ${a.postal_code}` : "";
          const city = a.city ? ` ${a.city}` : "";
          customerAddress = `${street}${num},${pc}${city}`.trim();
        }
      } catch {
        /* */
      }
    }

    // Huecos del instalador: instalaciones programadas en las próximas 8 semanas
    const busyDays: Record<string, number> = {};
    const freeSlots: Record<string, { morning: boolean; afternoon: boolean }> = {};
    if (installerUserId) {
      const now = new Date();
      const eightWeeks = new Date(now);
      eightWeeks.setDate(eightWeeks.getDate() + 56);
      const { data: scheds } = await admin
        .from("installations")
        .select("id, scheduled_at, status")
        .eq("installer_user_id", installerUserId)
        .eq("company_id", session.company_id)
        .neq("id", installationId)
        .is("deleted_at", null)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", eightWeeks.toISOString())
        .in("status", ["scheduled", "in_progress", "paused"]);
      type S = { id: string; scheduled_at: string; status: string };
      for (const s of ((scheds ?? []) as S[])) {
        const d = new Date(s.scheduled_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        busyDays[key] = (busyDays[key] ?? 0) + 1;
        const hour = d.getHours();
        const slot = hour < 14 ? "morning" : "afternoon";
        if (!freeSlots[key]) freeSlots[key] = { morning: true, afternoon: true };
        freeSlots[key][slot] = false;
      }
    }

    // === Sugerencia por radio (capa 3) ===
    let maxRouteRadiusKm = 15;
    const suggestedRouteDays: Record<string, { km: number; nearby_count: number }> = {};
    try {
      const { data: cs } = await admin
        .from("company_settings")
        .select("scheduling_max_route_radius_km")
        .eq("company_id", session.company_id)
        .maybeSingle();
      const csRow = cs as { scheduling_max_route_radius_km: number | null } | null;
      if (csRow?.scheduling_max_route_radius_km) {
        maxRouteRadiusKm = csRow.scheduling_max_route_radius_km;
      }
    } catch {
      /* default 15 */
    }
    // Coordenadas del cliente a instalar
    let clientLat: number | null = null;
    let clientLng: number | null = null;
    if (i.address_id) {
      try {
        const { data } = await admin
          .from("addresses")
          .select("latitude, longitude")
          .eq("id", i.address_id)
          .maybeSingle();
        if (data) {
          clientLat = (data as { latitude: number | null }).latitude;
          clientLng = (data as { longitude: number | null }).longitude;
        }
      } catch {
        /* */
      }
    }
    if (clientLat != null && clientLng != null && installerUserId) {
      // Cargar otras instalaciones del técnico con sus coordenadas
      const now = new Date();
      const eightWeeks = new Date(now);
      eightWeeks.setDate(eightWeeks.getDate() + 56);
      try {
        const { data: others } = await admin
          .from("installations")
          .select("id, scheduled_at, address_id")
          .eq("installer_user_id", installerUserId)
          .eq("company_id", session.company_id)
          .neq("id", installationId)
          .is("deleted_at", null)
          .gte("scheduled_at", now.toISOString())
          .lte("scheduled_at", eightWeeks.toISOString())
          .in("status", ["scheduled", "in_progress", "paused"])
          .not("address_id", "is", null);
        type O = {
          id: string;
          scheduled_at: string;
          address_id: string | null;
        };
        const list = (others ?? []) as O[];
        if (list.length > 0) {
          const addrIds = list
            .map((o) => o.address_id)
            .filter((v): v is string => !!v);
          const { data: addrs } = await admin
            .from("addresses")
            .select("id, latitude, longitude")
            .in("id", addrIds);
          type A = {
            id: string;
            latitude: number | null;
            longitude: number | null;
          };
          const coordsById = new Map<string, { lat: number; lng: number }>();
          for (const a of ((addrs ?? []) as A[])) {
            if (a.latitude != null && a.longitude != null) {
              coordsById.set(a.id, { lat: a.latitude, lng: a.longitude });
            }
          }
          for (const o of list) {
            if (!o.address_id) continue;
            const coords = coordsById.get(o.address_id);
            if (!coords) continue;
            const km = haversineKm(clientLat, clientLng, coords.lat, coords.lng);
            if (km > maxRouteRadiusKm) continue;
            const d = new Date(o.scheduled_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const prev = suggestedRouteDays[key];
            if (!prev || km < prev.km) {
              suggestedRouteDays[key] = {
                km: Math.round(km * 10) / 10,
                nearby_count: (prev?.nearby_count ?? 0) + 1,
              };
            } else {
              suggestedRouteDays[key] = {
                km: prev.km,
                nearby_count: prev.nearby_count + 1,
              };
            }
          }
        }
      } catch {
        /* */
      }
    }

    return {
      ok: true,
      preferences,
      installer_busy_days: busyDays,
      installer_free_slots: freeSlots,
      customer_address: customerAddress,
      suggested_route_days: suggestedRouteDays,
      max_route_radius_km: maxRouteRadiusKm,
    };
  } catch (e) {
    return {
      ...empty,
      error: e instanceof Error ? e.message : "Error",
    };
  }
}

/** Distancia Haversine en km entre dos puntos lat/lng. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // radio Tierra km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
