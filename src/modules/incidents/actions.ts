"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

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
  const parsed = incidentCreateSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("incidents").insert({
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
  });
  if (error) throw new Error(error.message);
  revalidatePath("/incidencias");
}

export async function assignIncidentAction(id: string, userId: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("incidents")
    .update({
      assigned_user_id: userId || null,
      assigned_at: userId ? new Date().toISOString() : null,
      status: userId ? "assigned" : "open",
    })
    .eq("id", id);
  revalidatePath(`/incidencias`);
  void session;
}

export async function resolveIncidentAction(id: string, notes: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("incidents")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: session.user_id,
      resolution_notes: notes,
    })
    .eq("id", id);
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
}

export async function listIncidents(): Promise<IncidentRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incidents")
    .select(
      "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at",
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as IncidentRow[];
}
