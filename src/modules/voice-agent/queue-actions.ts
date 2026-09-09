"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { isModuleActiveForCompany } from "@/shared/lib/auth/module-guard";
import { toE164, isSpanishMobile } from "./guardrails";
import { loadVoiceSettings } from "./settings";

const MANAGER_ROLES = [
  "company_admin",
  "technical_director",
  "telemarketing_director",
];

function canManage(roles: string[], isSuper: boolean): boolean {
  return isSuper || roles.some((r) => MANAGER_ROLES.includes(r));
}

export interface SeedResult {
  ok: boolean;
  enqueued: number;
  skipped: { no_phone: number; already_queued: number; excluded: number };
  error?: string;
}

/**
 * Llena la cola con los mantenimientos que están esperando una llamada.
 *
 * Qué entra: los `preprogrammed` y `needs_callback` de los próximos N días que
 * todavía no tienen fecha confirmada. Es exactamente la cola que hoy alguien
 * tiene que ir llamando a mano desde /mantenimientos/por-confirmar — no una
 * lista nueva ni un criterio nuevo.
 *
 * Qué NO entra:
 *  · Sin teléfono utilizable → no hay nada que marcar.
 *  · Teléfono en la lista de exclusión → el trigger de la BD lo rechaza, y
 *    aquí lo contamos como excluido en vez de dejar que reviente.
 *  · Ya tiene una llamada viva en cola → el índice único lo impide.
 *
 * Se llama desde el botón de la UI y desde el cron diario. Es idempotente:
 * ejecutarla dos veces seguidas no encola nada la segunda vez.
 */
export async function seedMaintenanceCallQueue(
  companyId: string,
  opts: { daysAhead?: number; limit?: number; createdBy?: string | null } = {},
): Promise<SeedResult> {
  const daysAhead = opts.daysAhead ?? 21;
  const limit = Math.min(opts.limit ?? 200, 500);
  const skipped = { no_phone: 0, already_queued: 0, excluded: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const settings = await loadVoiceSettings(companyId);
  if (!settings.service_enabled) {
    return {
      ok: false,
      enqueued: 0,
      skipped,
      error: "El agente de voz de servicio está desactivado para esta empresa.",
    };
  }

  const now = new Date();
  const until = new Date(now.getTime() + daysAhead * 86_400_000);

  const { data: jobs, error } = await admin
    .from("maintenance_jobs")
    .select(
      "id, company_id, customer_id, scheduled_at, status, customers(party_kind, first_name, last_name, trade_name, legal_name, phone_primary, deleted_at)",
    )
    .eq("company_id", companyId)
    .in("status", ["preprogrammed", "needs_callback"])
    .is("confirmed_at", null)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", until.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  type Row = {
    id: string;
    customer_id: string;
    scheduled_at: string | null;
    customers: {
      party_kind: "individual" | "company";
      first_name: string | null;
      last_name: string | null;
      trade_name: string | null;
      legal_name: string | null;
      phone_primary: string | null;
      deleted_at: string | null;
    } | null;
  };

  let enqueued = 0;
  for (const row of (jobs ?? []) as Row[]) {
    const c = row.customers;
    if (!c || c.deleted_at) continue;

    const phone = toE164(c.phone_primary);
    if (!phone) {
      skipped.no_phone++;
      continue;
    }

    const name =
      c.party_kind === "company"
        ? c.trade_name ?? c.legal_name
        : [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;

    const { error: insErr } = await admin.from("voice_call_tasks").insert({
      company_id: companyId,
      purpose: "service",
      target_party_kind: c.party_kind,
      customer_id: row.customer_id,
      maintenance_job_id: row.id,
      to_phone_e164: phone,
      contact_name: name,
      max_attempts: settings.max_attempts,
      dedupe_key: `maint:${row.id}`,
      created_by: opts.createdBy ?? null,
      // Los móviles primero: se cogen mucho más que los fijos y la cola rinde
      // más si empieza por ellos.
      next_attempt_at: isSpanishMobile(phone)
        ? now.toISOString()
        : new Date(now.getTime() + 60_000).toISOString(),
    });

    if (insErr) {
      const msg = String((insErr as { message?: string }).message ?? "");
      if (msg.includes("uq_voice_task_alive") || msg.includes("duplicate key")) {
        skipped.already_queued++;
      } else if (msg.includes("VOICE_DNC")) {
        skipped.excluded++;
      } else {
        // Un fallo raro en una fila no debe tumbar el llenado de la cola
        // entera, pero sí tiene que verse en los logs.
        console.error("[voice-agent] no se pudo encolar job", row.id, msg);
        skipped.excluded++;
      }
      continue;
    }
    enqueued++;
  }

  return { ok: true, enqueued, skipped };
}

/** Versión con sesión, para el botón "Llenar cola" de la UI. */
export async function seedMaintenanceCallQueueAction(
  daysAhead = 21,
): Promise<SeedResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) {
      return {
        ok: false,
        enqueued: 0,
        skipped: { no_phone: 0, already_queued: 0, excluded: 0 },
        error: "Sin empresa",
      };
    }
    if (!canManage(session.roles, session.is_superadmin)) {
      return {
        ok: false,
        enqueued: 0,
        skipped: { no_phone: 0, already_queued: 0, excluded: 0 },
        error: "No tienes permiso para lanzar llamadas.",
      };
    }
    if (!(await isModuleActiveForCompany(session.company_id, "voice_agent"))) {
      return {
        ok: false,
        enqueued: 0,
        skipped: { no_phone: 0, already_queued: 0, excluded: 0 },
        error: "El módulo Agente de voz IA no está activo.",
      };
    }
    const r = await seedMaintenanceCallQueue(session.company_id, {
      daysAhead,
      createdBy: session.user_id,
    });
    revalidatePath("/agente-voz");
    return r;
  } catch (e) {
    return {
      ok: false,
      enqueued: 0,
      skipped: { no_phone: 0, already_queued: 0, excluded: 0 },
      error: toActionError(e, "seedMaintenanceCallQueueAction"),
    };
  }
}

export interface VoiceTaskRow {
  id: string;
  purpose: "service" | "commercial";
  status: string;
  contact_name: string | null;
  to_phone_e164: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  outcome: string | null;
  outcome_notes: string | null;
  maintenance_job_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  created_at: string;
}

export async function listVoiceTasks(
  purpose: "service" | "commercial",
  status?: string[],
): Promise<VoiceTaskRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!canManage(session.roles, session.is_superadmin)) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("voice_call_tasks")
    .select(
      "id, purpose, status, contact_name, to_phone_e164, attempts, max_attempts, next_attempt_at, outcome, outcome_notes, maintenance_job_id, customer_id, lead_id, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("purpose", purpose)
    .order("next_attempt_at", { ascending: true })
    .limit(300);
  if (status?.length) q = q.in("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as VoiceTaskRow[];
}

export async function cancelVoiceTaskAction(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!canManage(session.roles, session.is_superadmin)) {
      return { ok: false, error: "Sin permiso" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("voice_call_tasks")
      .update({ status: "cancelled", outcome_notes: "Anulada a mano" })
      .eq("id", taskId)
      .eq("company_id", session.company_id)
      .in("status", ["pending", "calling"]);
    if (error) throw error;
    revalidatePath("/agente-voz");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "cancelVoiceTaskAction") };
  }
}

/**
 * Añade un teléfono a la lista de exclusión y cancela lo que tuviera en cola.
 * Las dos cosas, siempre juntas: apuntar el "no me llaméis" y dejar una llamada
 * pendiente en la cola es exactamente el fallo que genera la reclamación.
 */
export async function addDoNotCallAction(
  rawPhone: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; cancelled?: number }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    const phone = toE164(rawPhone);
    if (!phone) return { ok: false, error: "Teléfono no válido" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("voice_do_not_call").upsert(
      {
        company_id: session.company_id,
        phone_e164: phone,
        reason: reason ?? null,
        source: "manual",
        created_by: session.user_id,
      },
      { onConflict: "company_id,phone_e164" },
    );
    if (error) throw error;

    const { data: cancelled } = await admin
      .from("voice_call_tasks")
      .update({ status: "cancelled", outcome: "opted_out", outcome_notes: reason ?? null })
      .eq("company_id", session.company_id)
      .eq("to_phone_e164", phone)
      .in("status", ["pending", "calling"])
      .select("id");

    revalidatePath("/agente-voz");
    return { ok: true, cancelled: (cancelled as unknown[] | null)?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: toActionError(e, "addDoNotCallAction") };
  }
}
