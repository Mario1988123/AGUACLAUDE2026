import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { companiesWithModuleDisabled } from "@/shared/lib/auth/module-guard";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { loadVoiceSettings, checkCallAllowed } from "@/modules/voice-agent/settings";
import { placeCall } from "@/modules/voice-agent/provider";
import { seedMaintenanceCallQueue } from "@/modules/voice-agent/queue-actions";
import type { CallPurpose } from "@/modules/voice-agent/guardrails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * El marcador. Corre cada hora y hace tres cosas, en este orden:
 *
 *   1. Suelta las tareas que se quedaron colgadas en 'calling' (el proceso
 *      murió, la plataforma nunca mandó el webhook).
 *   2. Rellena la cola de mantenimientos pendientes.
 *   3. Marca lo que toque, pasando CADA llamada por el gate.
 *
 * Diseñado para pararse solo. Todo lo que puede salir mal —fuera de ventana,
 * presupuesto agotado, teléfono excluido, número comercial sin rango 400— sale
 * del gate como una denegación con motivo, no como una excepción. Una tarea
 * denegada de forma no reintentable se cancela; una reintentable se reprograma.
 *
 * Se ejecuta a la hora en punto pero solo llama dentro de la ventana de cada
 * empresa: el gate lo comprueba con la hora de MADRID, no la del servidor.
 */

const BATCH_PER_COMPANY = 15;

export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("voice-calls");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const stats = {
    released: 0,
    seeded: 0,
    placed: 0,
    simulated: 0,
    denied: 0,
    cancelled: 0,
    errors: 0,
    by_deny_code: {} as Record<string, number>,
  };

  // --- 1. Tareas colgadas ------------------------------------------------
  try {
    const { data } = await admin.rpc("voice_release_stale_tasks", { p_minutes: 15 });
    stats.released = Number(data ?? 0);
  } catch (e) {
    tracker.error("release_stale", e);
  }

  // --- Empresas con el módulo encendido ----------------------------------
  const disabled = await companiesWithModuleDisabled("voice_agent");
  let companies: string[] = [];
  try {
    const { data } = await admin
      .from("voice_agent_settings")
      .select("company_id, service_enabled, commercial_enabled")
      .or("service_enabled.eq.true,commercial_enabled.eq.true");
    companies = ((data ?? []) as Array<{ company_id: string }>)
      .map((r) => r.company_id)
      .filter((id) => !disabled.has(id));
  } catch (e) {
    tracker.error("list_companies", e);
  }

  for (const companyId of companies) {
    const settings = await loadVoiceSettings(companyId);

    // --- 2. Rellenar la cola de mantenimientos ---------------------------
    if (settings.service_enabled) {
      try {
        const seeded = await seedMaintenanceCallQueue(companyId, { daysAhead: 21 });
        stats.seeded += seeded.enqueued;
      } catch (e) {
        tracker.error(`seed:${companyId}`, e);
        stats.errors++;
      }
    }

    // --- 3. Marcar -------------------------------------------------------
    // Servicio primero: es el que genera dinero y el que no tiene fricción
    // legal. Si el presupuesto del mes se agota, que se agote llamando a
    // clientes propios, no haciendo captación.
    for (const purpose of ["service", "commercial"] as CallPurpose[]) {
      const on =
        purpose === "service" ? settings.service_enabled : settings.commercial_enabled;
      if (!on) continue;

      let claimed: Array<Record<string, unknown>> = [];
      try {
        const { data } = await admin.rpc("voice_claim_tasks", {
          p_purpose: purpose,
          p_limit: BATCH_PER_COMPANY,
        });
        claimed = (data ?? []) as Array<Record<string, unknown>>;
      } catch (e) {
        tracker.error(`claim:${companyId}:${purpose}`, e);
        stats.errors++;
        continue;
      }

      for (const raw of claimed) {
        const task = raw as unknown as {
          id: string;
          company_id: string;
          purpose: CallPurpose;
          target_party_kind: "individual" | "company";
          to_phone_e164: string;
          contact_name: string | null;
          customer_id: string | null;
          lead_id: string | null;
          attempts: number;
          max_attempts: number;
        };

        // Defensa en profundidad: la RPC no filtra por empresa (reclama por
        // propósito). Si una tarea de otra empresa se colara, aquí se para.
        if (task.company_id !== companyId) {
          stats.errors++;
          continue;
        }

        const gate = await checkCallAllowed(
          companyId,
          {
            purpose: task.purpose,
            party_kind: task.target_party_kind,
            to_phone_e164: task.to_phone_e164,
            customer_id: task.customer_id,
            lead_id: task.lead_id,
          },
          settings,
        );

        if (!gate.allowed) {
          stats.denied++;
          stats.by_deny_code[gate.code] = (stats.by_deny_code[gate.code] ?? 0) + 1;

          if (gate.retryable) {
            // Mal momento, no mala llamada: devolver a la cola sin gastar
            // intento. Si contara como intento, tres noches fuera de ventana
            // agotarían la tarea sin haber marcado ni una vez.
            await admin
              .from("voice_call_tasks")
              .update({
                status: "pending",
                attempts: Math.max(task.attempts - 1, 0),
                locked_at: null,
                lock_token: null,
                next_attempt_at: new Date(Date.now() + 3_600_000).toISOString(),
                outcome_notes: gate.reason,
              })
              .eq("id", task.id);
          } else {
            await admin
              .from("voice_call_tasks")
              .update({
                status: "cancelled",
                outcome: gate.code === "DO_NOT_CALL" ? "opted_out" : "failed",
                outcome_notes: `${gate.code}: ${gate.reason}`,
                locked_at: null,
                lock_token: null,
              })
              .eq("id", task.id);
            stats.cancelled++;
          }
          continue;
        }

        // --- Marcar de verdad ---
        const { data: company } = await admin
          .from("companies")
          .select("name")
          .eq("id", companyId)
          .maybeSingle();
        const companyName = (company as { name: string | null } | null)?.name ?? "su instalador";

        const { data: attemptRow } = await admin
          .from("voice_call_attempts")
          .insert({
            company_id: companyId,
            task_id: task.id,
            purpose: task.purpose,
            provider: settings.provider,
            from_number: gate.from_number,
            to_phone_e164: task.to_phone_e164,
            // La declaración de IA va en `first_message`, que la plataforma
            // dice siempre al descolgar. Se marca aquí porque el guion la
            // lleva incrustada, no porque confiemos en que el modelo se acuerde.
            ai_disclosure_given: true,
            human_escalation_offered: true,
          })
          .select("id")
          .single();
        const attemptId = (attemptRow as { id: string } | null)?.id ?? null;

        const result = await placeCall({
          purpose: task.purpose,
          settings,
          companyName,
          agentId: gate.agent_id,
          fromNumber: gate.from_number,
          toPhoneE164: task.to_phone_e164,
          contactName: task.contact_name,
          taskId: task.id,
          toolSecret: "", // el secreto lo presenta la plataforma, no viaja aquí
          variables: {
            contact_name: task.contact_name ?? "",
            company_name: companyName,
          },
        });

        if (attemptId) {
          await admin
            .from("voice_call_attempts")
            .update({
              provider_call_id: result.provider_call_id,
              error_message: result.error,
              ...(result.ok ? {} : { ended_at: new Date().toISOString(), outcome: "failed" }),
            })
            .eq("id", attemptId);
        }

        if (result.ok) {
          if (result.simulated) {
            stats.simulated++;
            // En simulación no hay webhook que cierre la tarea: la devolvemos
            // a la cola para que la próxima ejecución la vuelva a considerar.
            await admin
              .from("voice_call_tasks")
              .update({
                status: "pending",
                locked_at: null,
                lock_token: null,
                next_attempt_at: new Date(Date.now() + 86_400_000).toISOString(),
                outcome_notes: "Simulación: no se ha marcado.",
              })
              .eq("id", task.id);
          } else {
            stats.placed++;
          }
        } else {
          stats.errors++;
          const exhausted = task.attempts >= task.max_attempts;
          await admin
            .from("voice_call_tasks")
            .update({
              status: exhausted ? "failed" : "pending",
              outcome: exhausted ? "failed" : null,
              outcome_notes: result.error,
              locked_at: null,
              lock_token: null,
              next_attempt_at: new Date(
                Date.now() + settings.retry_hours * 3_600_000,
              ).toISOString(),
            })
            .eq("id", task.id);
        }
      }
    }
  }

  await tracker.finish({ summary: stats });
  return NextResponse.json({ ok: true, stats });
}
