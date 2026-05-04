"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { decrementStock } from "@/modules/warehouses/stock-decrement";

const createSchema = z.object({
  customer_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  installation_address_id: z.string().uuid().optional(),
  duration_days: z.number().int().positive().default(30),
  conditions_text: z.string().optional(),
  scheduled_at: z.string().optional(),
  assigned_installer_user_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        product_name_snapshot: z.string(),
        quantity: z.number().int().positive().default(1),
      }),
    )
    .min(1),
});

export interface FreeTrialRow {
  id: string;
  reference_code: string | null;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  scheduled_at: string | null;
  installed_at: string | null;
  expires_at: string | null;
  decided_outcome: string | null;
  duration_days: number;
  conditions_signed: boolean;
  notes: string | null;
  created_at: string;
}

export async function listFreeTrials(): Promise<FreeTrialRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("free_trials")
    .select(
      "id, reference_code, status, customer_id, lead_id, scheduled_at, installed_at, expires_at, decided_outcome, duration_days, conditions_signed, notes, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as FreeTrialRow[];
}

export async function getFreeTrial(id: string): Promise<FreeTrialRow & { items: Array<{ id: string; product_id: string; product_name_snapshot: string; quantity: number; serial_number: string | null }> }> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [{ data: trial, error: e1 }, { data: items }] = await Promise.all([
    supabase
      .from("free_trials")
      .select(
        "id, reference_code, status, customer_id, lead_id, installation_address_id, scheduled_at, installed_at, expires_at, decided_at, decided_outcome, removed_at, rejected_reason, generated_contract_id, duration_days, conditions_text, conditions_signed, assigned_installer_user_id, notes, created_at",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("free_trial_items")
      .select("id, product_id, product_name_snapshot, quantity, serial_number")
      .eq("free_trial_id", id),
  ]);
  if (e1) throw e1;
  return { ...(trial as FreeTrialRow), items: (items ?? []) } as never;
}

export async function createFreeTrialAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = createSchema.parse(input);
  if (!parsed.customer_id && !parsed.lead_id) {
    throw new Error("Debe especificarse cliente o lead");
  }
  if (parsed.customer_id && parsed.lead_id) {
    throw new Error("Solo cliente o lead, no ambos");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: created, error } = await supabase
    .from("free_trials")
    .insert({
      company_id: session.company_id,
      customer_id: parsed.customer_id ?? null,
      lead_id: parsed.lead_id ?? null,
      installation_address_id: parsed.installation_address_id ?? null,
      status: parsed.scheduled_at ? "scheduled" : "draft",
      duration_days: parsed.duration_days,
      conditions_text: parsed.conditions_text ?? null,
      scheduled_at: parsed.scheduled_at ?? null,
      assigned_installer_user_id: parsed.assigned_installer_user_id ?? null,
      notes: parsed.notes ?? null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (created as { id: string }).id;

  await supabase.from("free_trial_items").insert(
    parsed.items.map((it) => ({
      free_trial_id: id,
      company_id: session.company_id,
      product_id: it.product_id,
      product_name_snapshot: it.product_name_snapshot,
      quantity: it.quantity,
    })),
  );

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.created",
    payload: { items: parsed.items.length },
    actor_user_id: session.user_id,
  });

  revalidatePath("/pruebas-gratuitas");
  return id;
}

export async function installFreeTrialAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const { data: trial } = await supabase
    .from("free_trials")
    .select("id, duration_days, status, assigned_installer_user_id")
    .eq("id", id)
    .single();
  if (!trial) throw new Error("No encontrada");
  const t = trial as { duration_days: number; status: string; assigned_installer_user_id: string | null };
  if (t.status === "installed" || t.status === "accepted") {
    throw new Error("Ya instalada");
  }
  const expires = new Date(now);
  expires.setDate(expires.getDate() + t.duration_days);

  // Admin client: la policy ft_update sólo permite UPDATE si status NOT IN
  // (accepted, rejected, expired, removed). Si el cron auto-expiró la
  // prueba ANTES de que el técnico marcara como instalada → silent fail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("free_trials")
    .update({
      status: "installed",
      installed_at: now.toISOString(),
      expires_at: expires.toISOString(),
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  const installerId = t.assigned_installer_user_id;
  let warehouseId: string | null = null;
  if (installerId) {
    const { data: wh } = await admin
      .from("warehouses")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("assigned_user_id", installerId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    warehouseId = (wh as { id: string } | null)?.id ?? null;
  }
  if (!warehouseId) {
    const { data: wh } = await admin
      .from("warehouses")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("kind", "main")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    warehouseId = (wh as { id: string } | null)?.id ?? null;
  }
  if (warehouseId) {
    const { data: items } = await admin
      .from("free_trial_items")
      .select("product_id, quantity")
      .eq("free_trial_id", id);
    for (const it of ((items ?? []) as Array<{ product_id: string; quantity: number }>)) {
      try {
        await decrementStock({
          company_id: session.company_id,
          warehouse_id: warehouseId,
          product_id: it.product_id,
          quantity: it.quantity,
          movement_type: "outbound_trial",
          free_trial_id: id,
          performed_by: session.user_id,
          notes: "Salida prueba gratuita",
        });
      } catch {
        /* no-op */
      }
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.installed",
    payload: { expires_at: expires.toISOString() },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
}

export async function rejectFreeTrialAction(id: string, reason: string) {
  const session = await requireSession();
  // Admin client: la policy ft_update bloquea si ya está
  // accepted/rejected/expired/removed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("free_trials")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_outcome: "rejected",
      rejected_reason: reason,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.rejected",
    payload: { reason },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
}

export async function markReturnedAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const r = await admin
    .from("free_trials")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);

  // Re-incorporar stock como 'used' al almacén main
  const { data: wh } = await admin
    .from("warehouses")
    .select("id")
    .eq("company_id", session.company_id)
    .eq("kind", "main")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const warehouseId = (wh as { id: string } | null)?.id ?? null;
  if (warehouseId) {
    const { data: items } = await admin
      .from("free_trial_items")
      .select("product_id, quantity")
      .eq("free_trial_id", id);
    for (const it of ((items ?? []) as Array<{ product_id: string; quantity: number }>)) {
      const { data: existing } = await admin
        .from("warehouse_stock")
        .select("id, quantity")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", it.product_id)
        .eq("state", "used")
        .is("location_id", null)
        .maybeSingle();
      const ex = existing as { id: string; quantity: number } | null;
      if (ex) {
        await admin
          .from("warehouse_stock")
          .update({ quantity: ex.quantity + it.quantity, updated_at: new Date().toISOString() })
          .eq("id", ex.id);
      } else {
        await admin.from("warehouse_stock").insert({
          warehouse_id: warehouseId,
          product_id: it.product_id,
          company_id: session.company_id,
          quantity: it.quantity,
          state: "used",
        });
      }
      await admin.from("stock_movements").insert({
        company_id: session.company_id,
        product_id: it.product_id,
        warehouse_id: warehouseId,
        movement_type: "return",
        quantity: it.quantity,
        free_trial_id: id,
        performed_by: session.user_id,
        notes: "Devolución prueba gratuita",
        state_after: "used",
      });
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.returned",
    payload: {},
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
}
