import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyVoiceSignature } from "@/modules/voice-agent/webhook-auth";
import { addMinutesUsed, loadVoiceSettings } from "@/modules/voice-agent/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cierre de llamada. La plataforma de voz avisa aquí cuando cuelga, con la
 * duración, la transcripción y el resultado.
 *
 * Aquí es donde se contabiliza el gasto. Si este webhook no llega, el contador
 * de minutos no sube y el tope mensual no protege de nada — por eso la firma se
 * valida pero un fallo de firma se registra en voz alta en los logs en vez de
 * desaparecer en un 401 silencioso.
 *
 * También es donde se cierra la tarea si el agente colgó sin ejecutar ninguna
 * herramienta (no contestan, buzón, cuelgan a los dos segundos), que es la
 * mitad larga de las llamadas reales.
 */
interface AttemptRef {
  id: string;
  company_id: string;
  task_id: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifyVoiceSignature(req, raw)) {
    console.error("[voice-agent] webhook con firma inválida — descartado");
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const data = (payload.data ?? payload) as Record<string, unknown>;
  const conversationId =
    (data.conversation_id as string | undefined) ??
    (data.call_id as string | undefined) ??
    (data.CallSid as string | undefined) ??
    null;

  // El id de tarea viaja en las variables dinámicas que mandamos al iniciar.
  const dyn = ((data.conversation_initiation_client_data as Record<string, unknown>)
    ?.dynamic_variables ?? {}) as Record<string, unknown>;
  const taskId =
    (dyn.hm_task_id as string | undefined) ??
    (data.hm_task_id as string | undefined) ??
    null;

  if (!taskId && !conversationId) {
    return NextResponse.json({ ok: false, error: "no_identifier" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Localizar el intento: por id de la plataforma si lo tenemos, si no por la
  // tarea (el intento abierto más reciente).
  let attempt: AttemptRef | null = null;
  if (conversationId) {
    const { data: byCall } = await admin
      .from("voice_call_attempts")
      .select("id, company_id, task_id")
      .eq("provider_call_id", conversationId)
      .maybeSingle();
    attempt = (byCall as AttemptRef | null) ?? null;
  }
  if (!attempt && taskId) {
    const { data: byTask } = await admin
      .from("voice_call_attempts")
      .select("id, company_id, task_id")
      .eq("task_id", taskId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    attempt = (byTask as AttemptRef | null) ?? null;
  }
  if (!attempt) {
    // Puede pasar con llamadas de prueba lanzadas desde el panel del
    // proveedor. No es un error nuestro.
    return NextResponse.json({ ok: true, ignored: "attempt_not_found" });
  }

  // Idempotencia: la plataforma reintenta el webhook si no responde 200 rápido.
  // Sin este guard, la segunda entrega volvería a sumar los minutos.
  const { data: already } = await admin
    .from("voice_call_attempts")
    .select("ended_at")
    .eq("id", attempt.id)
    .maybeSingle();
  if ((already as { ended_at: string | null } | null)?.ended_at) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const durationSeconds = Number(
    meta.call_duration_secs ?? data.call_duration_secs ?? data.duration ?? 0,
  );
  const transcript = extractTranscript(data);
  const summary =
    ((data.analysis as Record<string, unknown>)?.transcript_summary as string | undefined) ??
    null;
  const outcome = mapOutcome(data);

  await admin
    .from("voice_call_attempts")
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
      transcript,
      summary,
      outcome,
      human_escalation_requested:
        typeof transcript === "string" && /hablar con (una |alguien|persona)/i.test(transcript),
    })
    .eq("id", attempt.id);

  // Gasto: se contabiliza SIEMPRE, aunque la llamada no sirviera de nada.
  // Un buzón de voz de 20 segundos también se factura.
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    await addMinutesUsed(attempt.company_id, durationSeconds / 60);
  }

  // Cerrar la tarea si el agente no ejecutó ninguna herramienta.
  const { data: taskRow } = await admin
    .from("voice_call_tasks")
    .select("id, status, attempts, max_attempts")
    .eq("id", attempt.task_id)
    .maybeSingle();
  const task = taskRow as
    | { id: string; status: string; attempts: number; max_attempts: number }
    | null;

  if (task && task.status === "calling") {
    const settings = await loadVoiceSettings(attempt.company_id);
    const exhausted = task.attempts >= task.max_attempts;
    await admin
      .from("voice_call_tasks")
      .update({
        status: exhausted ? "failed" : "pending",
        outcome: exhausted ? (outcome ?? "no_answer") : null,
        outcome_notes: exhausted
          ? "Agotados los intentos sin respuesta. Pasa a la cola de llamadas a mano."
          : null,
        locked_at: null,
        lock_token: null,
        next_attempt_at: new Date(
          Date.now() + settings.retry_hours * 3_600_000,
        ).toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "calling"); // guard: no pisar lo que ya cerró una herramienta
  }

  return NextResponse.json({ ok: true });
}

function extractTranscript(data: Record<string, unknown>): string | null {
  const t = data.transcript;
  if (typeof t === "string") return t.slice(0, 20_000);
  if (Array.isArray(t)) {
    return t
      .map((turn) => {
        const o = turn as { role?: string; message?: string };
        return `${o.role === "agent" ? "Agente" : "Cliente"}: ${o.message ?? ""}`;
      })
      .join("\n")
      .slice(0, 20_000);
  }
  return null;
}

function mapOutcome(data: Record<string, unknown>): string | null {
  const status = String(
    data.status ?? data.call_status ?? (data.metadata as Record<string, unknown>)?.termination_reason ?? "",
  ).toLowerCase();
  if (status.includes("no-answer") || status.includes("no_answer")) return "no_answer";
  if (status.includes("voicemail") || status.includes("machine")) return "voicemail";
  if (status.includes("busy")) return "busy";
  if (status.includes("failed") || status.includes("error")) return "failed";
  return null;
}
