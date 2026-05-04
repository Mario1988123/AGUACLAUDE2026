"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { notifyByRoles } from "@/modules/notifications/notifier";

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

/**
 * Inicia el parte capturando geolocalización. Si está a >300m de la
 * dirección del cliente, marca started_far_from_address=true y notifica
 * a nivel 1 y nivel 2 (no bloquea).
 */
export async function startInstallationAction(input: {
  installation_id: string;
  geo_lat: number | null;
  geo_lng: number | null;
}): Promise<{ far: boolean; meters: number | null }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cargar la dirección de la instalación para calcular distancia
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, address_id, customer_id, scheduled_at, status")
    .eq("id", input.installation_id)
    .single();
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
  if (!i) throw new Error("Instalación no encontrada");

  // No se puede iniciar una instalación programada para el FUTURO. Si la
  // fecha programada es posterior a hoy hay que reagendarla primero. Las
  // de hoy o atrasadas sí se pueden iniciar.
  if (i.scheduled_at) {
    const sched = new Date(i.scheduled_at);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (sched > today) {
      throw new Error(
        "Esta instalación está programada para un día futuro. Reagéndala a hoy antes de iniciar el parte.",
      );
    }
  }

  let meters: number | null = null;
  let addrLat: number | null = null;
  let addrLng: number | null = null;
  if (i.address_id) {
    const { data: addr } = await admin
      .from("addresses")
      .select("latitude, longitude")
      .eq("id", i.address_id)
      .maybeSingle();
    if (addr) {
      addrLat = (addr as { latitude: number | null }).latitude;
      addrLng = (addr as { longitude: number | null }).longitude;
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
  const far = meters != null && meters > 300;

  await admin
    .from("installations")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      started_geo_lat: input.geo_lat,
      started_geo_lng: input.geo_lng,
      started_far_from_address: far,
      geo_distance_to_address_m: meters,
    })
    .eq("id", input.installation_id);

  await admin.from("events").insert({
    company_id: i.company_id,
    subject_type: "installation",
    subject_id: i.id,
    kind: "installation.started",
    payload: { meters, far },
    actor_user_id: session.user_id,
  });

  if (far) {
    try {
      await notifyByRoles(
        i.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "installation.started_far",
          severity: "warning",
          title: "Instalación iniciada lejos del cliente",
          body: `${meters} m de distancia (límite 300 m)`,
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
  return { far, meters };
}

export async function pauseInstallationAction(input: {
  installation_id: string;
  reason: "lunch" | "to_warehouse" | "to_buy" | "end_of_day" | "other";
  reason_notes?: string;
  scheduled_resume_at?: string | null;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { error } = await admin.from("installation_pauses").insert({
    company_id: session.company_id,
    installation_id: input.installation_id,
    reason: input.reason,
    reason_notes: input.reason_notes ?? null,
    scheduled_resume_at: input.scheduled_resume_at ?? null,
    paused_by_user_id: session.user_id,
  });
  if (error) throw new Error(error.message);

  await admin
    .from("installations")
    .update({ status: "paused" })
    .eq("id", input.installation_id);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: input.installation_id,
    kind: "installation.paused",
    payload: { reason: input.reason, scheduled_resume_at: input.scheduled_resume_at ?? null },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/instalaciones/${input.installation_id}`);
}

export async function resumeInstallationAction(installationId: string): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cerramos la última pausa abierta
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
  await admin
    .from("installations")
    .update({ status: "in_progress" })
    .eq("id", installationId);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.resumed",
    payload: {},
    actor_user_id: session.user_id,
  });
  revalidatePath(`/instalaciones/${installationId}`);
}

export async function reportInstallationIncidentAction(input: {
  installation_id: string;
  kind: "missing_material" | "wrong_equipment" | "broken_equipment" | "customer_issue" | "other";
  description?: string;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { error } = await admin.from("installation_incidents").insert({
    company_id: session.company_id,
    installation_id: input.installation_id,
    kind: input.kind,
    description: input.description ?? null,
    reported_by: session.user_id,
  });
  if (error) throw new Error(error.message);

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

  revalidatePath(`/instalaciones/${input.installation_id}`);
}

/**
 * Guarda nº de serie por item de la instalación (opcional).
 */
export async function setInstallationItemSerialAction(
  itemId: string,
  serialNumber: string | null,
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("installation_items")
    .update({ serial_number: serialNumber || null })
    .eq("id", itemId);
}

/**
 * Marca toggles de estado inicial (desperfectos / agujero encimera).
 */
export async function setInstallationInitialStateAction(input: {
  installation_id: string;
  has_previous_damage: boolean;
  needs_countertop_drilling: boolean;
}): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("installations")
    .update({
      has_previous_damage: input.has_previous_damage,
      needs_countertop_drilling: input.needs_countertop_drilling,
    })
    .eq("id", input.installation_id);
  revalidatePath(`/instalaciones/${input.installation_id}`);
}

/**
 * Cierra la instalación. Calcula duration_seconds, guarda encuesta de
 * satisfacción y anota timestamp final. La satisfacción es anónima para
 * el instalador (no se le muestra en su propio listado).
 */
export async function finishInstallationAction(input: {
  installation_id: string;
  satisfaction_score: number | null;
  satisfaction_comment?: string | null;
  notes?: string | null;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: inst } = await admin
    .from("installations")
    .select("id, started_at, contract_id")
    .eq("id", input.installation_id)
    .single();
  const i = inst as { id: string; started_at: string | null; contract_id: string | null } | null;
  if (!i) throw new Error("Instalación no encontrada");

  const now = new Date();
  const dur =
    i.started_at != null
      ? Math.max(
          0,
          Math.round((now.getTime() - new Date(i.started_at).getTime()) / 1000),
        )
      : null;

  await admin
    .from("installations")
    .update({
      status: "completed",
      completed_at: now.toISOString(),
      duration_seconds: dur,
      satisfaction_score: input.satisfaction_score,
      satisfaction_comment: input.satisfaction_comment ?? null,
      notes: input.notes ?? null,
    })
    .eq("id", input.installation_id);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: input.installation_id,
    kind: "installation.completed",
    payload: {
      duration_seconds: dur,
      satisfaction: input.satisfaction_score,
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/instalaciones/${input.installation_id}`);
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
