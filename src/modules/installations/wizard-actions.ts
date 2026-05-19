"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { notifyByRoles } from "@/modules/notifications/notifier";
import { completeInstallation } from "./actions";

/** Distancia en metros (Haversine) entre dos coordenadas. */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

type StartResult =
  | { ok: true; far: boolean; meters: number | null }
  | { ok: false; error: string };

/**
 * Inicia el parte capturando geolocalización. Si está a >300m de la
 * dirección del cliente, marca started_far_from_address=true y notifica
 * a nivel 1 y nivel 2 (no bloquea).
 *
 * Devuelve result discriminado para preservar el mensaje en producción
 * (Next.js redacta Error.message en server actions).
 */
export async function startInstallationAction(input: {
  installation_id: string;
  geo_lat: number | null;
  geo_lng: number | null;
}): Promise<StartResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Cargar la dirección de la instalación para calcular distancia
    let inst: unknown = null;
    let instErr: string | null = null;
    try {
      const r = await admin
        .from("installations")
        .select("id, company_id, address_id, customer_id, scheduled_at, status")
        .eq("id", input.installation_id)
        .maybeSingle();
      inst = r.data;
      instErr = (r.error as { message?: string } | null)?.message ?? null;
    } catch (e) {
      instErr = e instanceof Error ? e.message : String(e);
    }
    if (instErr) {
      console.error("[startInstallation] SELECT installations failed:", instErr);
      return { ok: false, error: `No se pudo leer la instalación: ${instErr}` };
    }
    const i = inst as
      | {
          id: string;
          company_id: string;
          address_id: string | null;
          customer_id: string | null;
          scheduled_at: string | null;
          status: string;
        }
      | null;
    if (!i) {
      console.error(
        "[startInstallation] installation not found for id:",
        input.installation_id,
      );
      return {
        ok: false,
        error: `Instalación no encontrada (id: ${input.installation_id.slice(0, 8)}…). Recarga la página e inténtalo de nuevo. Si persiste, contacta con soporte.`,
      };
    }

    // Bloqueo de fecha (decisión usuario 2026-05-19, actualizada):
    // ventana ±24h desde scheduled_at. Antes de eso → bloqueado. Si no
    // hay scheduled_at → bloqueado (regla nueva: solo agendadas se pueden
    // iniciar). Nivel 1/2 puede saltar este bloqueo en campo.
    const isUpperLevel =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("telemarketing_director");
    const autoRescheduledFromFuture = false;

    // Bloqueo por incidencia abierta: si la instalación tiene una
    // incidencia abierta sin resolver, no se puede iniciar parte.
    try {
      const { data: openInc } = await admin
        .from("installation_incidents")
        .select("id")
        .eq("installation_id", input.installation_id)
        .is("resolved_at", null)
        .limit(1)
        .maybeSingle();
      if (openInc && !isUpperLevel) {
        return {
          ok: false,
          error:
            "Esta instalación tiene una incidencia abierta sin resolver. Resuélvela antes de iniciar el parte.",
        };
      }
    } catch {
      /* fail-soft: si la tabla de incidencias no responde, no bloquear */
    }

    if (!i.scheduled_at && !isUpperLevel) {
      return {
        ok: false,
        error:
          "Esta instalación no está agendada. Pide a un director que le ponga fecha antes de iniciar el parte.",
      };
    }
    if (i.scheduled_at && !isUpperLevel) {
      const now = Date.now();
      const sched = new Date(i.scheduled_at).getTime();
      const HOUR = 3600 * 1000;
      if (sched > now + 24 * HOUR) {
        const hoursLeft = Math.round((sched - now) / HOUR);
        return {
          ok: false,
          error: `Aún faltan ~${hoursLeft}h para la instalación (programada el ${new Date(i.scheduled_at).toLocaleString("es-ES")}). Solo se puede iniciar el parte dentro de las 24 horas previas.`,
        };
      }
      if (sched < now - 24 * HOUR) {
        return {
          ok: false,
          error: `La instalación estaba programada para el ${new Date(i.scheduled_at).toLocaleString("es-ES")} (hace más de 24h). Pide a un director que la reprograme antes de iniciarla.`,
        };
      }
    }

    let meters: number | null = null;
    let addrLat: number | null = null;
    let addrLng: number | null = null;
    if (i.address_id) {
      try {
        const { data: addr, error: addrErr } = await admin
          .from("addresses")
          .select("latitude, longitude")
          .eq("id", i.address_id)
          .maybeSingle();
        if (addrErr) {
          console.error(
            "[startInstallation] addresses SELECT failed:",
            addrErr.message,
          );
        }
        if (addr) {
          addrLat = (addr as { latitude: number | null }).latitude;
          addrLng = (addr as { longitude: number | null }).longitude;
        }
      } catch (e) {
        console.error("[startInstallation] addresses SELECT threw:", e);
      }
    }
    if (
      input.geo_lat != null &&
      input.geo_lng != null &&
      addrLat != null &&
      addrLng != null
    ) {
      meters = haversineMeters(input.geo_lat, input.geo_lng, addrLat, addrLng);
    }

    // Tolerancia configurable en company_settings.installation_geo_tolerance_m
    // (fallback 300 m si no hay setting).
    let tolerance = 300;
    try {
      const { data: cs } = await admin
        .from("company_settings")
        .select("installation_geo_tolerance_m")
        .eq("company_id", i.company_id)
        .maybeSingle();
      const t = (cs as { installation_geo_tolerance_m: number | null } | null)?.installation_geo_tolerance_m;
      if (t && t > 0) tolerance = t;
    } catch {
      /* no-op, fallback 300 */
    }
    const far = meters != null && meters > tolerance;

    // Defensivo ante migraciones no aplicadas: la migración 20260504150000
    // añade started_geo_lat/lng + started_far_from_address. Si en producción
    // no está aplicada, esos UPDATE explotaban con digest "Server Components
    // render" sin mensaje útil. Iteramos columna a columna.
    const nowIso = new Date().toISOString();
    const updates: Array<[string, unknown]> = [
      ["status", "in_progress"],
      ["started_at", nowIso],
      ["geo_distance_to_address_m", meters],
      ["started_geo_lat", input.geo_lat],
      ["started_geo_lng", input.geo_lng],
      ["started_far_from_address", far],
    ];
    if (autoRescheduledFromFuture) {
      updates.push(["scheduled_at", nowIso]);
    }
    for (const [col, val] of updates) {
      const r = await admin
        .from("installations")
        .update({ [col]: val })
        .eq("id", input.installation_id);
      const m = (r.error as { message?: string } | null)?.message ?? null;
      if (!m) continue;
      if (/column .* does not exist|schema cache/i.test(m)) continue;
      console.error(
        `[startInstallation] UPDATE col=${col} failed:`,
        m,
        "value:",
        val,
      );
      return { ok: false, error: m };
    }

    // Insert event defensivo: si la tabla `events` tiene CHECK constraint
    // sobre `kind` que no incluye "installation.started" o cualquier otro
    // fallo, no debe tumbar el inicio del parte.
    try {
      const { error: evErr } = await admin.from("events").insert({
        company_id: i.company_id,
        subject_type: "installation",
        subject_id: i.id,
        kind: "installation.started",
        payload: {
          meters,
          far,
          auto_rescheduled_from_future: autoRescheduledFromFuture,
        },
        actor_user_id: session.user_id,
      });
      if (evErr) {
        console.error(
          "[startInstallation] events insert installation.started failed:",
          evErr.message,
        );
      }
    } catch (e) {
      console.error("[startInstallation] events insert threw:", e);
    }

    if (far) {
      try {
        await notifyByRoles(
          i.company_id,
          ["company_admin", "technical_director"],
          {
            kind: "installation.started_far",
            severity: "warning",
            title: "Instalación iniciada lejos del cliente",
            body: `${meters} m de distancia (límite ${tolerance} m)`,
            subject_type: "installation",
            subject_id: i.id,
            action_url: `/instalaciones/${i.id}`,
          },
        );
      } catch {
        /* no-op */
      }
    }

    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true, far, meters };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

type SimpleResult = { ok: true } | { ok: false; error: string };

export async function pauseInstallationAction(input: {
  installation_id: string;
  reason: "lunch" | "to_warehouse" | "to_buy" | "end_of_day" | "other";
  reason_notes?: string;
  scheduled_resume_at?: string | null;
}): Promise<SimpleResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Defensivo: la tabla installation_pauses la añade la migración
    // 20260504150000. Si no está aplicada, ignoramos el insert pero seguimos
    // marcando el status en la instalación para que el flujo no se rompa.
    try {
      const { error } = await admin.from("installation_pauses").insert({
        company_id: session.company_id,
        installation_id: input.installation_id,
        reason: input.reason,
        reason_notes: input.reason_notes ?? null,
        scheduled_resume_at: input.scheduled_resume_at ?? null,
        paused_by_user_id: session.user_id,
      });
      if (
        error &&
        !/relation .* does not exist|schema cache/i.test(error.message ?? "")
      ) {
        return { ok: false, error: error.message };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/relation .* does not exist|schema cache/i.test(msg)) {
        return { ok: false, error: msg };
      }
      /* tabla aún no migrada — continuamos con el cambio de status */
    }

    const upd = await admin
      .from("installations")
      .update({ status: "paused" })
      .eq("id", input.installation_id);
    if (upd.error) return { ok: false, error: upd.error.message };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "installation",
      subject_id: input.installation_id,
      kind: "installation.paused",
      payload: { reason: input.reason, scheduled_resume_at: input.scheduled_resume_at ?? null },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export async function resumeInstallationAction(installationId: string): Promise<SimpleResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Cerramos la última pausa abierta — defensivo si la tabla no existe
    try {
      const { data: openPause } = await admin
        .from("installation_pauses")
        .select("id")
        .eq("installation_id", installationId)
        .is("resumed_at", null)
        .order("paused_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openPause) {
        await admin
          .from("installation_pauses")
          .update({ resumed_at: new Date().toISOString() })
          .eq("id", (openPause as { id: string }).id);
      }
    } catch {
      /* tabla aún no migrada */
    }
    const upd = await admin
      .from("installations")
      .update({ status: "in_progress" })
      .eq("id", installationId);
    if (upd.error) return { ok: false, error: upd.error.message };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "installation",
      subject_id: installationId,
      kind: "installation.resumed",
      payload: {},
      actor_user_id: session.user_id,
    });
    revalidatePath(`/instalaciones/${installationId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export async function reportInstallationIncidentAction(input: {
  installation_id: string;
  kind: "stock_shortage" | "missing_material" | "wrong_equipment" | "broken_equipment" | "customer_issue" | "other";
  description?: string;
  pause_and_unschedule?: boolean;
}): Promise<SimpleResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Defensivo: tabla installation_incidents añadida en migración
    // 20260504150000. Si no está aplicada, registramos la incidencia
    // genérica en la tabla `incidents` (existe desde el inicio).
    // El kind 'stock_shortage' se añade en migración 20260526100000; si el
    // CHECK constraint todavía no lo incluye, mapeamos a missing_material
    // y prefijamos la descripción.
    let inserted = false;
    let kind: string = input.kind;
    let description: string | null = input.description ?? null;
    try {
      let { error } = await admin.from("installation_incidents").insert({
        company_id: session.company_id,
        installation_id: input.installation_id,
        kind,
        description,
        reported_by: session.user_id,
      });
      if (
        error &&
        kind === "stock_shortage" &&
        /check constraint|installation_incidents_kind_check/i.test(error.message ?? "")
      ) {
        kind = "missing_material";
        description = `[Stock insuficiente] ${input.description ?? ""}`.trim();
        const retry = await admin.from("installation_incidents").insert({
          company_id: session.company_id,
          installation_id: input.installation_id,
          kind,
          description,
          reported_by: session.user_id,
        });
        error = retry.error;
      }
      if (!error) inserted = true;
      else if (!/relation .* does not exist|schema cache/i.test(error.message ?? "")) {
        return { ok: false, error: error.message };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/relation .* does not exist|schema cache/i.test(msg)) {
        return { ok: false, error: msg };
      }
    }
    if (!inserted) {
      // Fallback: insertar como incidencia genérica
      try {
        await admin.from("incidents").insert({
          company_id: session.company_id,
          title: `Incidencia instalación: ${input.kind}`,
          description: input.description ?? null,
          installation_id: input.installation_id,
          priority: "high",
          status: "open",
          origin: "installer_reported",
          created_by: session.user_id,
        });
      } catch {
        /* fail-soft */
      }
    }

    // Notificar a nivel 1 y nivel 2
    try {
      await notifyByRoles(
        session.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "installation.incident",
          severity: "warning",
          title: "Incidencia en instalación",
          body: `${input.kind}${input.description ? ` — ${input.description}` : ""}`,
          subject_type: "installation",
          subject_id: input.installation_id,
          action_url: `/instalaciones/${input.installation_id}`,
        },
      );
    } catch {
      /* no-op */
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "installation",
      subject_id: input.installation_id,
      kind: "installation.incident",
      payload: { kind: input.kind, description: input.description ?? null },
      actor_user_id: session.user_id,
    });

    // Si la incidencia bloquea el trabajo: marcar la instalación como
    // "incident_pending" y limpiar scheduled_at para que vuelva a aparecer
    // como pendiente de reagendar tanto en /instalaciones como en /agenda.
    if (input.pause_and_unschedule) {
      await admin
        .from("installations")
        .update({
          status: "incident_pending",
          scheduled_at: null,
        })
        .eq("id", input.installation_id);
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "installation",
        subject_id: input.installation_id,
        kind: "installation.unscheduled_by_incident",
        payload: { reason: input.kind },
        actor_user_id: session.user_id,
      });
      revalidatePath("/agenda");
      revalidatePath("/instalaciones");
      revalidatePath("/dashboard");
    }

    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

type IncidentKind =
  | "stock_shortage"
  | "missing_material"
  | "wrong_equipment"
  | "broken_equipment"
  | "customer_issue"
  | "other";

/**
 * Marca una incidencia de instalación como resuelta. Solo admin /
 * director técnico. Acepta tanto `installation_incidents` como
 * `incidents` genérica (distinguidos por el campo `source`).
 */
export async function resolveInstallationIncidentAction(input: {
  incident_id: string;
  source: "installation_incidents" | "incidents";
}): Promise<SimpleResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director");
    if (!isUpper) return { ok: false, error: "Solo admin o director técnico" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    if (input.source === "installation_incidents") {
      // Defensivo: la columna resolved_by se añade en migración
      // 20260526100000. Si aún no está aplicada, hacemos solo resolved_at.
      let r = await admin
        .from("installation_incidents")
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: session.user_id,
        })
        .eq("id", input.incident_id);
      if (r.error && /resolved_by/i.test(r.error.message ?? "")) {
        r = await admin
          .from("installation_incidents")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", input.incident_id);
      }
      if (r.error) return { ok: false, error: r.error.message };
    } else {
      const r = await admin
        .from("incidents")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: session.user_id,
        })
        .eq("id", input.incident_id);
      if (r.error) return { ok: false, error: r.error.message };
    }

    // Localizar installation_id para revalidar la ficha
    let instId: string | null = null;
    if (input.source === "installation_incidents") {
      const { data } = await admin
        .from("installation_incidents")
        .select("installation_id")
        .eq("id", input.incident_id)
        .maybeSingle();
      instId = (data as { installation_id: string | null } | null)?.installation_id ?? null;
    } else {
      const { data } = await admin
        .from("incidents")
        .select("installation_id")
        .eq("id", input.incident_id)
        .maybeSingle();
      instId = (data as { installation_id: string | null } | null)?.installation_id ?? null;
    }
    if (instId) {
      revalidatePath(`/instalaciones/${instId}`);
    }
    revalidatePath("/instalaciones");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Re-clasifica el `kind` de una incidencia de instalación
 * (`installation_incidents` solamente). Permite al admin corregir cuando
 * el técnico eligió mal el motivo (p.ej. puso «equipo equivocado» pero
 * era falta de stock).
 */
export async function reclassifyInstallationIncidentAction(input: {
  incident_id: string;
  kind: IncidentKind;
}): Promise<SimpleResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director");
    if (!isUpper) return { ok: false, error: "Solo admin o director técnico" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("installation_incidents")
      .update({ kind: input.kind })
      .eq("id", input.incident_id);
    if (r.error) return { ok: false, error: r.error.message };

    const { data } = await admin
      .from("installation_incidents")
      .select("installation_id")
      .eq("id", input.incident_id)
      .maybeSingle();
    const instId = (data as { installation_id: string | null } | null)?.installation_id ?? null;
    if (instId) {
      revalidatePath(`/instalaciones/${instId}`);
    }
    revalidatePath("/instalaciones");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Guarda nº de serie por item de la instalación (opcional).
 */
export async function setInstallationItemSerialAction(
  itemId: string,
  serialNumber: string | null,
): Promise<SimpleResult> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("installation_items")
      .update({ serial_number: serialNumber || null })
      .eq("id", itemId);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Marca toggles de estado inicial (desperfectos / agujero encimera).
 */
export async function setInstallationInitialStateAction(input: {
  installation_id: string;
  has_previous_damage: boolean;
  needs_countertop_drilling: boolean;
}): Promise<SimpleResult> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("installations")
      .update({
        has_previous_damage: input.has_previous_damage,
        needs_countertop_drilling: input.needs_countertop_drilling,
      })
      .eq("id", input.installation_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Cierra la instalación desde el wizard. Delega en completeInstallation()
 * (que ya tiene TODA la lógica side-effect: decrement stock, crear
 * customer_equipment, activar contrato, programar mantenimientos, otorgar
 * puntos, notificar) y AÑADE la encuesta de satisfacción anónima y
 * comentario que vienen del wizard nuevo.
 */
export async function finishInstallationAction(input: {
  installation_id: string;
  satisfaction_score: number | null;
  satisfaction_comment?: string | null;
  notes?: string | null;
}): Promise<SimpleResult> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Persistimos satisfacción ANTES porque completeInstallation no la
    // conoce. Defensivo column-by-column (migración 20260504150000 puede
    // no estar aplicada → silent fail aceptado).
    for (const [col, val] of [
      ["satisfaction_score", input.satisfaction_score],
      ["satisfaction_comment", input.satisfaction_comment ?? null],
    ] as Array<[string, unknown]>) {
      const r = await admin
        .from("installations")
        .update({ [col]: val })
        .eq("id", input.installation_id);
      const m = (r.error as { message?: string } | null)?.message ?? null;
      if (m && !/column .* does not exist|schema cache/i.test(m)) {
        return { ok: false, error: m };
      }
    }

    // Delegamos en la lógica completa (idempotente: si ya estaba completed
    // no se ejecuta dos veces porque service_start_date ya está set).
    await completeInstallation({
      id: input.installation_id,
      notes: input.notes ?? null,
      geo_lat: null,
      geo_lng: null,
    });

    revalidatePath(`/instalaciones/${input.installation_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Antes de cerrar la instalación, el técnico confirma con el cliente
 * la periodicidad real de los mantenimientos y los meses cubiertos.
 * Esta action permite ajustar esos dos campos en el contrato vinculado,
 * justo antes de auto-agendar los jobs.
 */
export async function updateContractMaintenanceScheduleAction(input: {
  installation_id: string;
  periodicity_months: number;
  months_included: number;
}): Promise<SimpleResult> {
  try {
    await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    if (
      !Number.isFinite(input.periodicity_months) ||
      input.periodicity_months < 1 ||
      input.periodicity_months > 60
    ) {
      return { ok: false, error: "Periodicidad debe estar entre 1 y 60 meses." };
    }
    if (
      !Number.isFinite(input.months_included) ||
      input.months_included < 1 ||
      input.months_included > 240
    ) {
      return {
        ok: false,
        error: "Meses cubiertos debe estar entre 1 y 240.",
      };
    }
    if (input.months_included < input.periodicity_months) {
      return {
        ok: false,
        error:
          "Los meses cubiertos no pueden ser menores que la periodicidad.",
      };
    }

    const { data: inst } = await admin
      .from("installations")
      .select("contract_id")
      .eq("id", input.installation_id)
      .maybeSingle();
    const contractId = (inst as { contract_id: string | null } | null)
      ?.contract_id ?? null;
    if (!contractId) {
      return { ok: false, error: "Esta instalación no tiene contrato asociado." };
    }

    const { error } = await admin
      .from("contracts")
      .update({
        maintenance_periodicity_months: input.periodicity_months,
        maintenance_months_included: input.months_included,
      })
      .eq("id", contractId);
    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Devuelve las pausas registradas de una instalación.
 */
export async function listInstallationPauses(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("installation_pauses")
    .select("id, reason, reason_notes, paused_at, resumed_at, scheduled_resume_at")
    .eq("installation_id", installationId)
    .order("paused_at", { ascending: false });
  return (data ?? []) as Array<{
    id: string;
    reason: string;
    reason_notes: string | null;
    paused_at: string;
    resumed_at: string | null;
    scheduled_resume_at: string | null;
  }>;
}
