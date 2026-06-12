"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { notifyIncidentCreated } from "@/modules/notifications/notifier";
import { awardPoints, getPointsSettings } from "@/modules/points/award";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const incidentCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().default(""),
  origin: z.enum([
    "installation_out_of_time",
    "installer_reported",
    "equipment_failure",
    "geo_out_of_range",
    "model_changed",
    "out_of_stock",
    "customer_complaint",
    "other",
  ]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  customer_id: z.string().uuid().optional(),
  installation_id: z.string().uuid().optional(),
  maintenance_job_id: z.string().uuid().optional(),
  customer_equipment_id: z.string().uuid().optional(),
});

export async function createIncidentAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(incidentCreateSchema, input, "Incidencia");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: created, error } = await supabase
    .from("incidents")
    .insert({
      company_id: session.company_id,
      title: parsed.title,
      description: parsed.description || null,
      origin: parsed.origin,
      priority: parsed.priority,
      status: "open",
      customer_id: parsed.customer_id || null,
      installation_id: parsed.installation_id || null,
      maintenance_job_id: parsed.maintenance_job_id || null,
      customer_equipment_id: parsed.customer_equipment_id || null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (created) {
    await notifyIncidentCreated(
      session.company_id,
      (created as { id: string }).id,
      parsed.title,
      parsed.priority,
    );
  }
  revalidatePath("/incidencias");
}

export async function getIncident(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("incidents")
    .select(
      "id, reference_code, title, description, status, priority, origin, assigned_user_id, assigned_at, customer_id, installation_id, maintenance_job_id, customer_equipment_id, resolution_notes, resolved_at, resolved_by, created_at, created_by",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    reference_code: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    origin: string;
    assigned_user_id: string | null;
    assigned_at: string | null;
    customer_id: string | null;
    installation_id: string | null;
    maintenance_job_id: string | null;
    customer_equipment_id: string | null;
    resolution_notes: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    created_at: string;
    created_by: string | null;
  };
}

export async function assignIncidentAction(id: string, userId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Admin client: la policy de incidents filtra por scope. Si el rol del
  // que asigna no incluye el scope, UPDATE silencia.
  // SEGURIDAD: admin salta RLS → filtrar por company_id y abortar si no es tuya.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: incPrev } = await admin
    .from("incidents")
    .select("title, company_id")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!incPrev) throw new Error("Incidencia no encontrada o no pertenece a tu empresa");
  const r = await admin
    .from("incidents")
    .update({
      assigned_user_id: userId || null,
      assigned_at: userId ? new Date().toISOString() : null,
      status: userId ? "assigned" : "open",
    })
    .eq("id", id)
    .eq("company_id", session.company_id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "incident",
    subject_id: id,
    kind: "incident.assigned",
    payload: { to_user_id: userId || null },
    actor_user_id: session.user_id,
  });
  // Notify al nuevo asignado
  if (userId && session.company_id) {
    try {
      await admin.from("notifications").insert({
        company_id: session.company_id,
        recipient_user_id: userId,
        kind: "incident.assigned",
        severity: "warning",
        title: "Incidencia asignada",
        body: (incPrev as { title?: string } | null)?.title ?? "Nueva incidencia",
        subject_type: "incident",
        subject_id: id,
        action_url: `/incidencias/${id}`,
      });
    } catch {
      /* no-op */
    }

    // Email al cliente avisando que su incidencia se está atendiendo
    try {
      await sendIncidentEmail(id, "incident_assigned");
    } catch (e) {
      console.error("[assignIncident] email failed:", e);
    }
  }
  revalidatePath(`/incidencias`);
  revalidatePath(`/incidencias/${id}`);
}

/**
 * Envía email al cliente de la incidencia con la plantilla indicada.
 * Fail-soft: si no hay plantilla, cliente sin email, etc., no rompe.
 */
async function sendIncidentEmail(
  incidentId: string,
  templateKey: "incident_assigned" | "incident_sla_warning" | "incident_resolved",
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inc } = await admin
    .from("incidents")
    .select(
      "id, company_id, customer_id, title, deadline_at, created_at, resolved_at, assigned_user_id",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (!inc) return;
  const i = inc as {
    id: string;
    company_id: string;
    customer_id: string | null;
    title: string;
    deadline_at: string | null;
    created_at: string;
    resolved_at: string | null;
    assigned_user_id: string | null;
  };
  if (!i.customer_id) return;

  const { data: cust } = await admin
    .from("customers")
    .select("email, first_name, last_name, trade_name, legal_name, party_kind")
    .eq("id", i.customer_id)
    .maybeSingle();
  const c = cust as {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    party_kind: "individual" | "company";
  } | null;
  if (!c?.email) return;
  const customerName =
    c.party_kind === "company"
      ? c.trade_name || c.legal_name || "Cliente"
      : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";

  let technicianName = "Nuestro técnico";
  if (i.assigned_user_id) {
    const { data: t } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", i.assigned_user_id)
      .maybeSingle();
    technicianName = (t as { full_name?: string } | null)?.full_name ?? technicianName;
  }

  const { data: cs } = await admin
    .from("company_settings")
    .select("fiscal_phone")
    .eq("company_id", i.company_id)
    .maybeSingle();

  const variables: Record<string, string | number> = {
    customer_name: customerName,
    incident_title: i.title,
    technician_name: technicianName,
    deadline_at: i.deadline_at
      ? new Date(i.deadline_at).toLocaleString("es-ES")
      : "—",
    company_phone: (cs as { fiscal_phone?: string } | null)?.fiscal_phone ?? "—",
  };
  if (templateKey === "incident_resolved" && i.resolved_at) {
    const hours =
      (new Date(i.resolved_at).getTime() - new Date(i.created_at).getTime()) /
      (1000 * 60 * 60);
    variables.resolution_hours = hours.toFixed(1);
  }

  const { sendTransactionalEmail } = await import("@/modules/mailing/actions");
  await sendTransactionalEmail({
    template_key: templateKey,
    to_email: c.email,
    to_name: customerName,
    customer_id: i.customer_id,
    variables,
    related_subject_type: "incident",
    related_subject_id: i.id,
  });
}

export async function resolveIncidentAction(id: string, notes: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SEGURIDAD: admin salta RLS → filtrar por company_id y abortar si no es tuya.
  const { data: prev } = await admin
    .from("incidents")
    .select("assigned_user_id, company_id, title")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!prev) throw new Error("Incidencia no encontrada o no pertenece a tu empresa");

  const r = await admin
    .from("incidents")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: session.user_id,
      resolution_notes: notes,
    })
    .eq("id", id)
    .eq("company_id", session.company_id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "incident",
    subject_id: id,
    kind: "incident.resolved",
    payload: { notes },
    actor_user_id: session.user_id,
  });

  // Auto-resolver notificaciones pendientes vinculadas a esta incidencia
  // (la incidencia ya no es accionable, no tiene sentido que sigan
  // apareciendo en la campana o como toast).
  try {
    const { autoResolveNotificationsForSubject } = await import(
      "@/modules/notifications/subject-actions"
    );
    await autoResolveNotificationsForSubject(
      "incident",
      id,
      "Incidencia resuelta",
    );
  } catch {
    /* fail-soft */
  }

  // Puntos al asignado (o resolutor si no había asignado)
  if (session.company_id) {
    try {
      const technicianId =
        (prev as { assigned_user_id: string | null } | null)?.assigned_user_id ??
        session.user_id;
      const cfg = await getPointsSettings(session.company_id);
      if (technicianId && cfg.points_per_incident > 0) {
        await awardPoints({
          company_id: session.company_id,
          user_id: technicianId,
          points: cfg.points_per_incident,
          reason: "incident_resolved",
          subject_type: "incident",
          subject_id: id,
        });
      }
    } catch {
      /* no-op */
    }

    // Notificar a admin/director técnico que la incidencia se resolvió
    try {
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      const incidentTitle =
        (prev as { title: string | null } | null)?.title ?? "Incidencia";
      await notifyByRoles(
        session.company_id,
        ["company_admin", "technical_director"],
        {
          kind: "incident.resolved",
          severity: "success",
          title: "✓ Incidencia resuelta",
          body: incidentTitle,
          subject_type: "incident",
          subject_id: id,
          action_url: `/incidencias/${id}`,
        },
      );

      // Email al cliente notificando resolución
      try {
        await sendIncidentEmail(id, "incident_resolved");
      } catch (e) {
        console.error("[resolveIncident] email failed:", e);
      }
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/incidencias`);
}

export interface IncidentRow {
  id: string;
  reference_code: string | null;
  title: string;
  status: string;
  priority: string;
  origin: string;
  assigned_user_id: string | null;
  customer_id: string | null;
  created_at: string;
  deadline_at: string | null;
}

export async function listIncidents(): Promise<IncidentRow[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds, isLevel1 } = await import("@/shared/lib/auth/role-scope");
  // Las incidencias las ven niveles 1-2 + installer (su scope). El
  // resto (sales_rep, telemarketer) no debe ver el módulo.
  const isInstaller = session.roles.includes("installer");
  const isTechDir = session.roles.includes("technical_director");
  if (!isLevel1(session) && !isTechDir && !isInstaller) {
    return [];
  }
  const visibleUserIds = await resolveVisibleUserIds(session);

  const supabase = await createClient();
  const FULL =
    "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at, deadline_at";
  const FALLBACK =
    "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  let q = sb
    .from("incidents")
    .select(FULL)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  // Nivel 3 installer: solo sus incidencias asignadas.
  // Nivel 2 director técnico: las de su equipo.
  if (visibleUserIds) {
    q = q.in("assigned_user_id", visibleUserIds);
  }
  let { data, error } = await q;
  // Si deadline_at no existe (migración SLA pendiente) reintenta sin esa columna
  if (error && /deadline_at/.test(error.message ?? "")) {
    let q2 = sb
      .from("incidents")
      .select(FALLBACK)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (visibleUserIds) q2 = q2.in("assigned_user_id", visibleUserIds);
    const r = await q2;
    data = r.data;
    error = r.error;
  }
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    reference_code: (r.reference_code as string | null) ?? null,
    title: r.title as string,
    status: r.status as string,
    priority: r.priority as string,
    origin: r.origin as string,
    assigned_user_id: (r.assigned_user_id as string | null) ?? null,
    customer_id: (r.customer_id as string | null) ?? null,
    created_at: r.created_at as string,
    deadline_at: (r.deadline_at as string | null) ?? null,
  }));
}

// =================== Safe wrappers ===================

export async function createIncidentSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createIncidentAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function assignIncidentSafeAction(
  id: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assignIncidentAction(id, userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function resolveIncidentSafeAction(
  id: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await resolveIncidentAction(id, notes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
