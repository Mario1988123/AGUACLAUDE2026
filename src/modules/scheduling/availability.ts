/**
 * Motor HÍBRIDO de fechas ofrecibles al cliente (zonas + proximidad).
 *
 * Combina, para las próximas N semanas:
 *  1) ZONA del código postal -> días de la semana cubiertos (service_zones).
 *  2) Día laborable de la empresa (company_settings.business_hours) y, si se
 *     conoce el técnico, su horario (user_work_schedules).
 *  3) Festivos (holidays, no workable) -> bloqueados.
 *  4) CAPACIDAD: nº de trabajos por técnico y franja (mañana/tarde) < tope.
 *  5) RUTA: si el técnico ya tiene trabajos ese día, solo se ofrece si el
 *     cliente está dentro del radio de uno de ellos (mantiene la ruta tight).
 *     Si el día está libre y la zona lo cubre -> se ofrece (día abierto).
 *
 * Es un helper de SERVIDOR (usa admin client). Lo llaman las acciones de
 * confirmación pública (token-gated) y se puede reutilizar en el panel admin.
 * NO debe importarse desde un componente cliente.
 */
import { createAdminClient } from "@/shared/lib/supabase/admin";

export type Slot = "morning" | "afternoon";

export interface OfferableSlot {
  date: string; // YYYY-MM-DD
  slots: Slot[];
  reason: "route" | "open";
  km: number | null;
}

export interface OfferableResult {
  ok: boolean;
  zonesConfigured: boolean;
  coveredByZone: boolean;
  slots: OfferableSlot[];
  weeks: number;
  error?: string;
}

export interface EngineInput {
  companyId: string;
  lat: number | null;
  lng: number | null;
  postalCode: string | null;
  technicianUserId: string | null;
  excludeJobId: string;
  jobTable: "installations" | "maintenance_jobs";
}

const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]; // 0=Lun..6=Dom
const MAX_OFFERED = 8;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hourOf(t: string | null, fallback: number): number {
  if (!t) return fallback;
  const h = parseInt(t.slice(0, 2), 10);
  return isNaN(h) ? fallback : h;
}

export async function computeOfferableSlots(
  input: EngineInput,
): Promise<OfferableResult> {
  const base: OfferableResult = {
    ok: false,
    zonesConfigured: false,
    coveredByZone: false,
    slots: [],
    weeks: 4,
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Ajustes
    let jobsPerSlot = 2;
    let offerWeeks = 4;
    let radiusKm = 15;
    let businessHours: Record<string, { open: string; close: string } | null> = {};
    try {
      const { data: cs } = await admin
        .from("company_settings")
        .select(
          "scheduling_jobs_per_slot, scheduling_offer_weeks, scheduling_max_route_radius_km, business_hours",
        )
        .eq("company_id", input.companyId)
        .maybeSingle();
      if (cs) {
        jobsPerSlot = cs.scheduling_jobs_per_slot ?? 2;
        offerWeeks = cs.scheduling_offer_weeks ?? 4;
        radiusKm = cs.scheduling_max_route_radius_km ?? 15;
        businessHours = cs.business_hours ?? {};
      }
    } catch {
      /* defaults */
    }
    base.weeks = offerWeeks;

    // 2) Zonas -> días permitidos por el CP
    let zonesConfigured = false;
    let coveredByZone = false;
    let allowedWeekdays: Set<number> | null = null; // null = sin restricción
    try {
      const { data: zones } = await admin
        .from("service_zones")
        .select("postal_prefixes, weekdays")
        .eq("company_id", input.companyId)
        .eq("active", true);
      const zlist = (zones ?? []) as {
        postal_prefixes: string[] | null;
        weekdays: number[] | null;
      }[];
      zonesConfigured = zlist.length > 0;
      if (zonesConfigured) {
        const pc = (input.postalCode ?? "").trim();
        const matched = zlist.filter((z) =>
          (z.postal_prefixes ?? []).some((p) => p && pc.startsWith(p.trim())),
        );
        if (matched.length > 0) {
          coveredByZone = true;
          allowedWeekdays = new Set<number>();
          for (const z of matched)
            for (const w of z.weekdays ?? []) allowedWeekdays.add(w);
        } else {
          // CP sin zona: no bloqueamos (el equipo revisará); días según disponibilidad.
          allowedWeekdays = null;
        }
      }
    } catch {
      /* sin zonas */
    }

    // 3) Horario del técnico (si se conoce)
    let techSchedule: Map<number, { start: number; end: number }> | null = null;
    if (input.technicianUserId) {
      try {
        const { data: ws } = await admin
          .from("user_work_schedules")
          .select("day_of_week, starts_at, ends_at")
          .eq("user_id", input.technicianUserId);
        const list = (ws ?? []) as {
          day_of_week: number;
          starts_at: string | null;
          ends_at: string | null;
        }[];
        if (list.length > 0) {
          techSchedule = new Map();
          for (const r of list) {
            techSchedule.set(r.day_of_week, {
              start: hourOf(r.starts_at, 9),
              end: hourOf(r.ends_at, 18),
            });
          }
        }
      } catch {
        /* sin horario -> business hours */
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(today);
    end.setDate(end.getDate() + offerWeeks * 7);

    // 4) Festivos
    const holidaySet = new Set<string>();
    try {
      const { data: hol } = await admin
        .from("holidays")
        .select("holiday_date, is_workable, company_id")
        .or(`company_id.eq.${input.companyId},company_id.is.null`)
        .gte("holiday_date", isoDate(start))
        .lte("holiday_date", isoDate(end));
      for (const h of (hol ?? []) as {
        holiday_date: string;
        is_workable: boolean;
      }[]) {
        if (!h.is_workable) holidaySet.add(h.holiday_date);
      }
    } catch {
      /* sin festivos */
    }

    // 5) Trabajos existentes en el rango -> conteo por día/franja + proximidad
    const dayCounts: Record<string, { morning: number; afternoon: number }> = {};
    const dayNearestKm: Record<string, number> = {};
    try {
      const isInstall = input.jobTable === "installations";
      const cols = isInstall
        ? "id, scheduled_at, address_id, customer_id"
        : "id, scheduled_at, customer_id";
      const activeStatus = isInstall
        ? ["scheduled", "in_progress", "paused"]
        : ["scheduled", "preprogrammed", "in_progress"];
      let q = admin
        .from(input.jobTable)
        .select(cols)
        .eq("company_id", input.companyId)
        .neq("id", input.excludeJobId)
        .gte("scheduled_at", start.toISOString())
        .lte("scheduled_at", end.toISOString())
        .in("status", activeStatus);
      if (input.technicianUserId) {
        q = q.eq(
          isInstall ? "installer_user_id" : "technician_user_id",
          input.technicianUserId,
        );
      }
      const { data: jobs } = await q;
      type J = {
        id: string;
        scheduled_at: string;
        address_id?: string | null;
        customer_id?: string | null;
      };
      const list = (jobs ?? []) as J[];

      // Resolver coordenadas de los trabajos existentes.
      const coords = new Map<string, { lat: number; lng: number }>(); // jobId -> coord
      if (input.lat != null && input.lng != null && list.length > 0) {
        if (isInstall) {
          const addrIds = list
            .map((j) => j.address_id)
            .filter((v): v is string => !!v);
          if (addrIds.length > 0) {
            const { data: addrs } = await admin
              .from("addresses")
              .select("id, latitude, longitude")
              .in("id", addrIds);
            const byId = new Map<string, { lat: number; lng: number }>();
            for (const a of (addrs ?? []) as {
              id: string;
              latitude: number | null;
              longitude: number | null;
            }[]) {
              if (a.latitude != null && a.longitude != null)
                byId.set(a.id, { lat: a.latitude, lng: a.longitude });
            }
            for (const j of list) {
              if (j.address_id && byId.has(j.address_id))
                coords.set(j.id, byId.get(j.address_id)!);
            }
          }
        } else {
          const custIds = list
            .map((j) => j.customer_id)
            .filter((v): v is string => !!v);
          if (custIds.length > 0) {
            const { data: addrs } = await admin
              .from("addresses")
              .select("customer_id, latitude, longitude, is_primary")
              .in("customer_id", custIds)
              .eq("is_primary", true);
            const byCust = new Map<string, { lat: number; lng: number }>();
            for (const a of (addrs ?? []) as {
              customer_id: string;
              latitude: number | null;
              longitude: number | null;
            }[]) {
              if (a.latitude != null && a.longitude != null)
                byCust.set(a.customer_id, { lat: a.latitude, lng: a.longitude });
            }
            for (const j of list) {
              if (j.customer_id && byCust.has(j.customer_id))
                coords.set(j.id, byCust.get(j.customer_id)!);
            }
          }
        }
      }

      for (const j of list) {
        const d = new Date(j.scheduled_at);
        const key = isoDate(d);
        if (!dayCounts[key]) dayCounts[key] = { morning: 0, afternoon: 0 };
        const slot: Slot = d.getHours() < 14 ? "morning" : "afternoon";
        dayCounts[key][slot] += 1;
        const c = coords.get(j.id);
        if (c && input.lat != null && input.lng != null) {
          const km = haversineKm(input.lat, input.lng, c.lat, c.lng);
          if (dayNearestKm[key] == null || km < dayNearestKm[key])
            dayNearestKm[key] = km;
        }
      }
    } catch {
      /* sin trabajos -> días abiertos */
    }

    // 6) Recorrer fechas
    const out: OfferableSlot[] = [];
    const cursor = new Date(start);
    while (cursor <= end && out.length < MAX_OFFERED) {
      const key = isoDate(cursor);
      const dowMon = (cursor.getDay() + 6) % 7; // 0=Lun..6=Dom
      cursor.setDate(cursor.getDate() + 1);

      if (holidaySet.has(key)) continue;
      if (allowedWeekdays && !allowedWeekdays.has(dowMon)) continue;

      // ¿Trabaja ese día? (técnico si se conoce, si no la empresa)
      let startH = 9;
      let endH = 18;
      let works: boolean;
      if (techSchedule) {
        const s = techSchedule.get(dowMon);
        works = !!s;
        if (s) {
          startH = s.start;
          endH = s.end;
        }
      } else {
        const dowKey = DOW_KEYS[dowMon] ?? "mon";
        const bh = businessHours?.[dowKey];
        const hasBh = businessHours && Object.keys(businessHours).length > 0;
        works = hasBh ? bh != null : dowMon <= 4; // sin business_hours -> L-V
        if (bh) {
          startH = hourOf(bh.open, 9);
          endH = hourOf(bh.close, 18);
        }
      }
      if (!works) continue;

      const counts = dayCounts[key] ?? { morning: 0, afternoon: 0 };
      const slotsAvail: Slot[] = [];
      if (startH < 14 && counts.morning < jobsPerSlot) slotsAvail.push("morning");
      if (endH > 13 && counts.afternoon < jobsPerSlot)
        slotsAvail.push("afternoon");
      if (slotsAvail.length === 0) continue;

      // Puerta de ruta
      const hasJobsThatDay = counts.morning + counts.afternoon > 0;
      let reason: "route" | "open" = "open";
      let km: number | null = null;
      if (
        hasJobsThatDay &&
        input.lat != null &&
        input.lng != null &&
        dayNearestKm[key] != null
      ) {
        if (dayNearestKm[key] > radiusKm) continue; // ruta lejos -> no ofrecer
        reason = "route";
        km = Math.round(dayNearestKm[key] * 10) / 10;
      }

      out.push({ date: key, slots: slotsAvail, reason, km });
    }

    return { ok: true, zonesConfigured, coveredByZone, slots: out, weeks: offerWeeks };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Valida (server-side) que una fecha+franja concreta esté realmente entre las
 * ofrecibles. Se usa en las acciones de reagendar para no fiarnos del cliente.
 */
export async function isSlotOfferable(
  input: EngineInput,
  date: string,
  slot: Slot,
): Promise<boolean> {
  const r = await computeOfferableSlots(input);
  if (!r.ok) return false;
  return r.slots.some((s) => s.date === date && s.slots.includes(slot));
}
