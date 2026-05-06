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
  // Admin client: la policy de incidents filtra por scope. Si el rol del
  // que asigna no incluye el scope, UPDATE silencia.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: incPrev } = await admin
    .from("incidents")
    .select("title, company_id")
    .eq("id", id)
    .maybeSingle();
  const r = await admin
    .from("incidents")
    .update({
      assigned_user_id: userId || null,
      assigned_at: userId ? new Date().toISOString() : null,
      status: userId ? "assigned" : "open",
    })
    .eq("id", id);
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
  }
  revalidatePath(`/incidencias`);
  revalidatePath(`/incidencias/${id}`);
}

export async function resolveIncidentAction(id: string, notes: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: prev } = await admin
    .from("incidents")
    .select("assigned_user_id, company_id, title")
    .eq("id", id)
    .single();

  const r = await admin
    .from("incidents")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: session.user_id,
      resolution_notes: notes,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "incident",
    subject_id: id,
    kind: "incident.resolved",
    payload: { notes },
    actor_user_id: session.user_id,
  });

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
  await requireSession();
  const supabase = await createClient();
  const FULL =
    "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at, deadline_at";
  const FALLBACK =
    "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  let { data, error } = await sb
    .from("incidents")
    .select(FULL)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  // Si deadline_at no existe (migración SLA pendiente) reintenta sin esa columna
  if (error && /deadline_at/.test(error.message ?? "")) {
    const r = await sb
      .from("incidents")
      .select(FALLBACK)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
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
