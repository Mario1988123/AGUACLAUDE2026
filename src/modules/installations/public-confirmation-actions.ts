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

/**
 * Resuelve, a partir del token público, el input para el motor de fechas
 * ofrecibles de una instalación: coordenadas + CP + técnico asignado.
 */
async function engineInputForInstallationToken(
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<EngineInput | null> {
  const { data: tok } = await admin
    .from("installation_confirmation_tokens")
    .select("installation_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return null;
  if (new Date((tok as { expires_at: string }).expires_at).getTime() < Date.now())
    return null;
  const installationId = (tok as { installation_id: string }).installation_id;
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, customer_id, address_id, installer_user_id")
    .eq("id", installationId)
    .maybeSingle();
  if (!inst) return null;
  const j = inst as {
    id: string;
    company_id: string;
    customer_id: string | null;
    address_id: string | null;
    installer_user_id: string | null;
  };

  let lat: number | null = null;
  let lng: number | null = null;
  let postalCode: string | null = null;
  if (j.address_id) {
    const { data } = await admin
      .from("addresses")
      .select("latitude, longitude, postal_code")
      .eq("id", j.address_id)
      .maybeSingle();
    if (data) {
      lat = (data as { latitude: number | null }).latitude;
      lng = (data as { longitude: number | null }).longitude;
      postalCode = (data as { postal_code: string | null }).postal_code;
    }
  }
  if ((lat == null || postalCode == null) && j.customer_id) {
    const { data } = await admin
      .from("addresses")
      .select("latitude, longitude, postal_code")
      .eq("customer_id", j.customer_id)
      .eq("is_primary", true)
      .maybeSingle();
    if (data) {
      lat = lat ?? (data as { latitude: number | null }).latitude;
      lng = lng ?? (data as { longitude: number | null }).longitude;
      postalCode = postalCode ?? (data as { postal_code: string | null }).postal_code;
    }
  }

  return {
    companyId: j.company_id,
    lat,
    lng,
    postalCode,
    technicianUserId: j.installer_user_id,
    excludeJobId: installationId,
    jobTable: "installations",
  };
}

/** Fechas/franjas ofrecibles al cliente para reagendar su instalación. */
export async function getInstallationOfferableSlots(
  token: string,
): Promise<OfferableResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const input = await engineInputForInstallationToken(token, admin);
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
  installation_id: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Genera (o reutiliza si ya existe vigente) un token público para que el
 * cliente confirme/reagende/posponga su instalación vía email. 30 días.
 */
export async function ensureInstallationConfirmationToken(
  installationId: string,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: existing } = await admin
      .from("installation_confirmation_tokens")
      .select("token, expires_at, used_at")
      .eq("installation_id", installationId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return (existing as { token: string }).token;
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { error } = await admin
      .from("installation_confirmation_tokens")
      .insert({ installation_id: installationId, token, expires_at: expires });
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

export async function getPublicInstallationView(
  token: string,
): Promise<PublicView | { ok: false; error: string }> {
  try {
    if (!token || token.length < 10) return { ok: false, error: "Token inválido" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: tok } = await admin
      .from("installation_confirmation_tokens")
      .select("id, installation_id, expires_at, used_at, used_action")
      .eq("token", token)
      .maybeSingle();
    if (!tok) return { ok: false, error: "Enlace no válido o caducado" };
    const t = tok as TokenRow & { used_action: string | null };
    if (new Date(t.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "Este enlace ha caducado. Llámanos para coordinar." };
    }

    const { data: instRow } = await admin
      .from("installations")
      .select(
        "id, company_id, customer_id, address_id, status, scheduled_at, installer_user_id",
      )
      .eq("id", t.installation_id)
      .maybeSingle();
    if (!instRow) return { ok: false, error: "Instalación no encontrada" };
    const j = instRow as {
      id: string;
      company_id: string;
      customer_id: string | null;
      address_id: string | null;
      status: string;
      scheduled_at: string | null;
      installer_user_id: string | null;
    };

    const [{ data: customer }, { data: company }] = await Promise.all([
      j.customer_id
        ? admin
            .from("customers")
            .select("first_name, last_name, trade_name, legal_name, party_kind")
            .eq("id", j.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
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

    // Dirección: la específica de la instalación si existe, si no la primaria.
    let addr: {
      street_type: string | null;
      street: string | null;
      street_number: string | null;
      city: string | null;
      postal_code: string | null;
    } | null = null;
    if (j.address_id) {
      const { data } = await admin
        .from("addresses")
        .select("street_type, street, street_number, city, postal_code")
        .eq("id", j.address_id)
        .maybeSingle();
      addr = data ?? null;
    }
    if (!addr && j.customer_id) {
      const { data } = await admin
        .from("addresses")
        .select("street_type, street, street_number, city, postal_code")
        .eq("customer_id", j.customer_id)
        .eq("is_primary", true)
        .maybeSingle();
      addr = data ?? null;
    }
    const customerAddress = addr?.street
      ? `${addr.street_type ? addr.street_type + " " : ""}${addr.street}${addr.street_number ? " " + addr.street_number : ""}${addr.postal_code ? ", " + addr.postal_code : ""}${addr.city ? " " + addr.city : ""}`
      : null;

    let technicianName: string | null = null;
    if (j.installer_user_id) {
      const { data: prof } = await admin
        .from("user_profiles")
        .select("full_name")
        .eq("user_id", j.installer_user_id)
        .maybeSingle();
      technicianName =
        (prof as { full_name: string | null } | null)?.full_name ?? null;
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
  action: "confirmed" | "rescheduled" | "postponed",
): Promise<
  | { ok: true; installationId: string; companyId: string; previous: string | null }
  | { ok: false; error: string }
> {
  if (!token || token.length < 10) return { ok: false, error: "Token inválido" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: tok } = await admin
    .from("installation_confirmation_tokens")
    .select("id, installation_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return { ok: false, error: "Enlace no válido" };
  const t = tok as TokenRow;
  if (new Date(t.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Enlace caducado" };
  }
  if (t.used_at) return { ok: false, error: "Este enlace ya se ha utilizado" };

  const { data: instRow } = await admin
    .from("installations")
    .select("id, company_id, scheduled_at")
    .eq("id", t.installation_id)
    .maybeSingle();
  if (!instRow) return { ok: false, error: "Instalación no encontrada" };
  const j = instRow as {
    id: string;
    company_id: string;
    scheduled_at: string | null;
  };

  await admin
    .from("installation_confirmation_tokens")
    .update({ used_at: new Date().toISOString(), used_action: action })
    .eq("id", t.id);

  return {
    ok: true,
    installationId: j.id,
    companyId: j.company_id,
    previous: j.scheduled_at,
  };
}

/** Update tolerante a que la migración de columnas nuevas no esté aplicada. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateInstallationSafe(admin: any, id: string, full: Record<string, unknown>, minimal: Record<string, unknown>) {
  const { error } = await admin.from("installations").update(full).eq("id", id);
  if (error && Object.keys(minimal).length > 0) {
    await admin.from("installations").update(minimal).eq("id", id);
  }
}

export async function customerConfirmInstallationAction(
  token: string,
): Promise<ActionResult> {
  const r = await consumeToken(token, "confirmed");
  if (!r.ok) return { ok: false, message: r.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await updateInstallationSafe(
    admin,
    r.installationId,
    { customer_confirmed_at: new Date().toISOString(), customer_reschedule_pending: false },
    {},
  );
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "installation",
    subject_id: r.installationId,
    kind: "installation.customer_confirmed",
    payload: { via: "public_link" },
  });
  return { ok: true, message: "¡Gracias! Tu instalación queda confirmada." };
}

export async function customerRescheduleInstallationAction(
  token: string,
  date: string,
  slot: Slot,
): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (slot !== "morning" && slot !== "afternoon")) {
    return { ok: false, message: "Selección no válida" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Validar contra el motor ANTES de consumir el token (no fiarnos del cliente).
  const input = await engineInputForInstallationToken(token, admin);
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
  await updateInstallationSafe(
    admin,
    r.installationId,
    { scheduled_at: dt.toISOString(), customer_reschedule_pending: true },
    { scheduled_at: dt.toISOString() },
  );
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "installation",
    subject_id: r.installationId,
    kind: "installation.customer_rescheduled",
    payload: {
      previous_scheduled_at: r.previous,
      new_scheduled_at: dt.toISOString(),
    },
  });
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      r.companyId,
      ["company_admin", "technical_director", "commercial_director"],
      {
        kind: "installation.customer_rescheduled",
        severity: "info",
        title: "Cliente ha pedido otra fecha de instalación",
        body: `Un cliente ha cambiado su instalación a ${dt.toLocaleDateString(
          "es-ES",
          { day: "numeric", month: "long", year: "numeric" },
        )}. Revisa disponibilidad de técnico y ruta y confírmasela.`,
        subject_type: "installation",
        subject_id: r.installationId,
        action_url: `/instalaciones/${r.installationId}`,
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

export async function customerPostponeInstallationAction(
  token: string,
  reason?: string,
): Promise<ActionResult> {
  const r = await consumeToken(token, "postponed");
  if (!r.ok) return { ok: false, message: r.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await updateInstallationSafe(
    admin,
    r.installationId,
    { customer_reschedule_pending: true },
    {},
  );
  await admin.from("events").insert({
    company_id: r.companyId,
    subject_type: "installation",
    subject_id: r.installationId,
    kind: "installation.customer_postponed",
    payload: { reason: reason ?? null, previous_scheduled_at: r.previous },
  });
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      r.companyId,
      ["company_admin", "technical_director", "commercial_director"],
      {
        kind: "installation.customer_postponed",
        severity: "warning",
        title: "Cliente ha pedido posponer su instalación",
        body:
          "Necesita que le llaméis para coordinar otra fecha." +
          (reason ? ` Motivo: ${reason}` : ""),
        subject_type: "installation",
        subject_id: r.installationId,
        action_url: `/instalaciones/${r.installationId}`,
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
