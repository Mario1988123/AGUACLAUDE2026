"use server";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import {
  computeOfferableSlots,
  isSlotOfferable,
  type EngineInput,
  type OfferableResult,
  type Slot,
} from "@/modules/scheduling/availability";

/** Resuelve el input del motor de fechas ofrecibles desde el token de mantenimiento. */
async function engineInputForMaintenanceToken(
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<EngineInput | null> {
  const { data: tok } = await admin
    .from("maintenance_confirmation_tokens")
    .select("job_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return null;
  if (new Date((tok as { expires_at: string }).expires_at).getTime() < Date.now())
    return null;
  const jobId = (tok as { job_id: string }).job_id;
  const { data: job } = await admin
    .from("maintenance_jobs")
    .select("id, company_id, customer_id, technician_user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const j = job as {
    id: string;
    company_id: string;
    customer_id: string | null;
    technician_user_id: string | null;
  };

  let lat: number | null = null;
  let lng: number | null = null;
  let postalCode: string | null = null;
  if (j.customer_id) {
    const { data } = await admin
      .from("addresses")
      .select("latitude, longitude, postal_code")
      .eq("customer_id", j.customer_id)
      .eq("is_primary", true)
      .maybeSingle();
    if (data) {
      lat = (data as { latitude: number | null }).latitude;
      lng = (data as { longitude: number | null }).longitude;
      postalCode = (data as { postal_code: string | null }).postal_code;
    }
  }

  return {
    companyId: j.company_id,
    lat,
    lng,
    postalCode,
    technicianUserId: j.technician_user_id,
    excludeJobId: jobId,
    jobTable: "maintenance_jobs",
  };
}

/** Fechas/franjas ofrecibles al cliente para reagendar su mantenimiento. */
export async function getMaintenanceOfferableSlots(
  token: string,
): Promise<OfferableResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const input = await engineInputForMaintenanceToken(token, admin);
  if (!input)
    return {
      ok: false,
      zonesConfigured: false,
      coveredByZone: false,
      slots: [],
      weeks: 4,
      error: "Enlace no válido",
    };
  return computeOfferableSlots(input);
}

function slotHour(slot: Slot): number {
  return slot === "morning" ? 10 : 16;
}

interface TokenRow {
  id: string;
  job_id: string;
  expires_at: string;
  used_at: string | null;
}

interface JobInfo {
  id: string;
  company_id: string;
  customer_id: string;
  status: string;
  scheduled_at: string | null;
  technician_user_id: string | null;
}

/**
 * Genera (o reutiliza si ya existe vigente) un token público para que
 * el cliente confirme/reagende/posponga su visita vía email.
 *
 * Se llama desde el cron de recordatorios. La duración es 30 días por
 * defecto para cubrir tanto el aviso 14d antes como el de víspera.
 */
export async function ensureConfirmationToken(jobId: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Reutilizar token vigente
    const { data: existing } = await admin
      .from("maintenance_confirmation_tokens")
      .select("token, expires_at, used_at")
      .eq("job_id", jobId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) {
      return (existing as { token: string }).token;
    }
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { error } = await admin
      .from("maintenance_confirmation_tokens")
      .insert({ job_id: jobId, token, expires_at: expires });
    if (error) return null;
    return token;
  } catch {
    return null;
  }
}

interface PublicView {
  ok: true;
  job: {
    id: string;
    scheduled_at: string;
    customer_name: string;
    customer_address: string | null;
    technician_name: string | null;
    company_name: string;
    company_phone: string | null;
    status: string;
  };
  token: { used: boolean; used_action: string | null };
}

/**
 * Devuelve la info pública mínima necesaria para renderizar la página
 * de confirmación. Nunca expone teléfono/email del cliente: el cliente
 * ya sabe sus datos.
 */
export async function getPublicJobView(
  token: string,
): Promise<PublicView | { ok: false; error: string }> {
  try {
    if (!token || token.length < 10) return { ok: false, error: "Token inválido" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: tok } = await admin
      .from("maintenance_confirmation_tokens")
      .select("id, job_id, expires_at, used_at, used_action")
      .eq("token", token)
      .maybeSingle();
    if (!tok) return { ok: false, error: "Enlace no válido o caducado" };
    const t = tok as TokenRow & { used_action: string | null };
    if (new Date(t.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "Este enlace ha caducado. Llámanos para coordinar." };
    }

    const { data: jobRow } = await admin
      .from("maintenance_jobs")
      .select(
        "id, company_id, customer_id, status, scheduled_at, technician_user_id",
      )
      .eq("id", t.job_id)
      .maybeSingle();
    if (!jobRow) return { ok: false, error: "Visita no encontrada" };
    const j = jobRow as JobInfo;

    const [{ data: customer }, { data: company }] = await Promise.all([
      admin
        .from("customers")
        .select("first_name, last_name, trade_name, legal_name, party_kind")
        .eq("id", j.customer_id)
        .maybeSingle(),
      admin
        .from("companies")
        .select("name, phone, email")
        .eq("id", j.company_id)
        .maybeSingle(),
    ]);
    const c = (customer ?? {}) as {
      first_name: string | null;
      last_name: string | null;
      trade_name: string | null;
      legal_name: string | null;
      party_kind: string | null;
    };
    const co = (company ?? {}) as { name: string | null; phone: string | null };

    // Dirección primaria del cliente
    const { data: addr } = await admin
      .from("addresses")
      .select("street_type, street, street_number, city, postal_code")
      .eq("customer_id", j.customer_id)
      .eq("is_primary", true)
      .maybeSingle();
    const a = addr as
      | {
          street_type: string | null;
          street: string | null;
          street_number: string | null;
          city: string | null;
          postal_code: string | null;
        }
      | null;
    const customerAddress = a?.street
      ? `${a.street_type ? a.street_type + " " : ""}${a.street}${a.street_number ? " " + a.street_number : ""}${a.postal_code ? ", " + a.postal_code : ""}${a.city ? " " + a.city : ""}`
      : null;

    let technicianName: string | null = null;
    if (j.technician_user_id) {
      const { data: prof } = await admin
        .from("user_profiles")
        .select("full_name")
        .eq("user_id", j.technician_user_id)
        .maybeSingle();
      technicianName = (prof as { full_name: string | null } | null)?.full_name ?? null;
    }

    const customerName =
      c.party_kind === "company"
        ? c.trade_name ?? c.legal_name ?? "Cliente"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";

    return {
      ok: true,
      job: {
        id: j.id,
        scheduled_at: j.scheduled_at ?? new Date().toISOString(),
        customer_name: customerName,
        customer_address: customerAddress,
        technician_name: technicianName,
        company_name: co.name ?? "AguaClaude",
        company_phone: co.phone,
        status: j.status,
      },
      token: { used: !!t.used_at, used_action: t.used_action },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

interface ActionResult {
  ok: boolean;
  message: string;
}

async function consumeToken(
  token: string,
  action: "confirmed" | "rescheduled" | "postponed" | "reconfirmed",
): Promise<
  | { ok: true; jobId: string; companyId: string; previous: string | null }
  | { ok: false; error: string }
> {
  if (!token || token.length < 10) return { ok: false, error: "Token inválido" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: tok } = await admin
    .from("maintenance_confirmation_tokens")
    .select("id, job_id, expires_at, used_at, used_action")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return { ok: false, error: "Enlace no válido" };
  const t = tok as TokenRow & { used_action: string | null };
  if (new Date(t.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Enlace caducado" };
  }
  // Permitimos reusar el token si la acción anterior fue "reconfirmed"
  // (24h antes) — el cliente puede aún cambiar de opinión. Otras
  // acciones son finales.
  if (t.used_at && t.used_action !== "reconfirmed") {
    return { ok: false, error: "Este enlace ya se ha utilizado" };
  }
  const { data: jobRow } = await admin
    .from("maintenance_jobs")
    .select("id, company_id, status, scheduled_at")
    .eq("id", t.job_id)
    .maybeSingle();
  if (!jobRow) return { ok: false, error: "Visita no encontrada" };
  const j = jobRow as {
    id: string;
    company_id: string;
    status: string;
    scheduled_at: string | null;
  };

  // Claim ATÓMICO: el UPDATE solo afecta si el token sigue sin usar (o si la
  // única acción previa fue "reconfirmed", que no bloquea). Si un doble clic
  // llega a la vez, solo una petición ve filas afectadas; la otra recibe
  // "ya utilizado" y no ejecuta la acción dos veces.
  const { data: claimed } = await admin
    .from("maintenance_confirmation_tokens")
    .update({
      used_at: new Date().toISOString(),
      used_action: action,
    })
    .eq("id", t.id)
    .or("used_at.is.null,used_action.eq.reconfirmed")
    .select("id");
  if (!claimed || (claimed as unknown[]).length === 0) {
    return { ok: false, error: "Este enlace ya se ha utilizado" };
  }

  return {
    ok: true,
    jobId: j.id,
    companyId: j.company_id,
    previous: j.scheduled_at,
  };
}

export async function customerConfirmAction(
  token: string,
): Promise<ActionResult> {
  const r = await consumeToken(token, "confirmed");
  if (!r.ok) return { ok: false, message: r.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const nowIso = new Date().toISOString();
  // No retroceder estado: una confirmación tardía no debe devolver a
  // 'scheduled' un trabajo ya en curso, hecho o cancelado. En esos casos
  // solo registramos la confirmación del cliente sin tocar el status.
  const { data: cur } = await admin
    .from("maintenance_jobs")
    .select("status")
    .eq("id", r.jobId)
    .maybeSingle();
  const curStatus = (cur as { status: string | null } | null)?.status ?? null;
  const advanced =
    curStatus === "in_progress" ||
    curStatus === "completed" ||
    curStatus === "cancelled";
  const confirmUpdates: Record<string, unknown> = {
    confirmed_at: nowIso,
    customer_called_at: nowIso,
  };
  if (!advanced) confirmUpdates.status = "scheduled";
  await admin
    .from("maintenance_jobs")
    .update(confirmUpdates)
    .eq("id", r.jobId);
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "maintenance",
    subject_id: r.jobId,
    kind: "maintenance.customer_confirmed",
    payload: { via: "public_link" },
  });
  return {
    ok: true,
    message: "¡Gracias! Tu cita queda confirmada.",
  };
}

export async function customerReconfirmAction(
  token: string,
): Promise<ActionResult> {
  const r = await consumeToken(token, "reconfirmed");
  if (!r.ok) return { ok: false, message: r.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "maintenance",
    subject_id: r.jobId,
    kind: "maintenance.customer_reconfirmed",
    payload: { via: "public_link" },
  });
  return {
    ok: true,
    message: "Perfecto, mañana nos vemos.",
  };
}

export async function customerRescheduleAction(
  token: string,
  date: string,
  slot: Slot,
): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (slot !== "morning" && slot !== "afternoon")) {
    return { ok: false, message: "Selección no válida" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Validar contra el motor ANTES de consumir el token.
  const input = await engineInputForMaintenanceToken(token, admin);
  if (!input) return { ok: false, message: "Enlace no válido o caducado" };
  const offerable = await isSlotOfferable(input, date, slot);
  if (!offerable) {
    return {
      ok: false,
      message: "Esa fecha ya no está disponible. Vuelve a abrir el enlace y elige otra.",
    };
  }
  const dt = new Date(`${date}T${String(slotHour(slot)).padStart(2, "0")}:00:00`);

  const r = await consumeToken(token, "rescheduled");
  if (!r.ok) return { ok: false, message: r.error };
  const nowIso = new Date().toISOString();
  // Cliente eligió día → preprogrammed con nueva fecha, admin tendrá
  // que validar técnico/disponibilidad. NO pasa a scheduled directamente.
  await admin
    .from("maintenance_jobs")
    .update({
      status: "preprogrammed",
      scheduled_at: dt.toISOString(),
      customer_called_at: nowIso,
    })
    .eq("id", r.jobId);
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "maintenance",
    subject_id: r.jobId,
    kind: "maintenance.customer_rescheduled",
    payload: {
      previous_scheduled_at: r.previous,
      new_scheduled_at: dt.toISOString(),
    },
  });
  // Notif admin / TMK
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      r.companyId,
      ["company_admin", "technical_director", "telemarketing_director"],
      {
        kind: "maintenance.customer_rescheduled",
        severity: "info",
        title: "Cliente ha pedido otra fecha",
        body: `Un cliente ha cambiado su próxima visita a ${dt.toLocaleDateString(
          "es-ES",
          { day: "numeric", month: "long", year: "numeric" },
        )}. Revisa disponibilidad técnico y confírmasela.`,
        subject_type: "maintenance",
        subject_id: r.jobId,
        action_url: `/mantenimientos/${r.jobId}`,
      },
    );
  } catch {
    /* no-op */
  }
  return {
    ok: true,
    message:
      "Anotada la nueva fecha. La revisaremos y te enviaremos confirmación final.",
  };
}

export async function customerPostponeAction(
  token: string,
  reason?: string,
): Promise<ActionResult> {
  const r = await consumeToken(token, "postponed");
  if (!r.ok) return { ok: false, message: r.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const nowIso = new Date().toISOString();
  await admin
    .from("maintenance_jobs")
    .update({
      status: "needs_callback",
      customer_called_at: nowIso,
    })
    .eq("id", r.jobId);
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "maintenance",
    subject_id: r.jobId,
    kind: "maintenance.customer_postponed",
    payload: { reason: reason ?? null, previous_scheduled_at: r.previous },
  });
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      r.companyId,
      ["company_admin", "telemarketing_director", "technical_director"],
      {
        kind: "maintenance.customer_postponed",
        severity: "warning",
        title: "Cliente ha pedido posponer su mantenimiento",
        body:
          "Necesita que le llaméis para coordinar otra fecha." +
          (reason ? ` Motivo: ${reason}` : ""),
        subject_type: "maintenance",
        subject_id: r.jobId,
        action_url: `/mantenimientos/${r.jobId}`,
      },
    );
  } catch {
    /* no-op */
  }
  return {
    ok: true,
    message:
      "Gracias por avisar. Nos pondremos en contacto contigo lo antes posible.",
  };
}
