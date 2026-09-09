import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import {
  companyFromToolSecret,
  loadVoiceSettings,
  type VoiceSettings,
} from "@/modules/voice-agent/settings";
import {
  agentRole,
  toolsForRole,
  type AgentRole,
  type ToolName,
} from "@/modules/voice-agent/prompts";
import {
  resolveCallerByPhone,
  getEquipmentSummary,
  createIncidentFromCall,
  createLeadFromCall,
  logVoiceEvent,
  type ResolvedCaller,
} from "@/modules/voice-agent/lookup";
import { sendVoiceConfirmation } from "@/modules/voice-agent/whatsapp-out";
import {
  getMaintenanceOfferableSlots,
  ensureConfirmationToken,
  customerConfirmAction,
  customerRescheduleAction,
  customerPostponeAction,
} from "@/modules/maintenance/public-confirmation-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Las herramientas del agente de voz. Los tres papeles pasan por aquí.
 *
 * Esto es la superficie entera por la que el agente puede tocar el sistema.
 * Todo lo que no esté aquí, el agente no lo puede hacer — por mucho que se lo
 * pidan por teléfono o por mucho que se le convenza con una frase ingeniosa.
 *
 * Cuatro reglas de diseño, y las cuatro son de seguridad:
 *
 *  1. **El `company_id` NUNCA llega en el cuerpo de la petición.** Se deriva
 *     del secreto de la cabecera. Si viniera en el body o en el prompt, bastaría
 *     con convencer al agente de que dijera otro para saltar de empresa.
 *
 *  2. **Cada herramienta se valida contra el PAPEL de la llamada.** El agente
 *     comercial no tiene `confirmar_mantenimiento`; la recepcionista no tiene
 *     `posponer_llamada`. Aunque las llamaran, esta ruta las rechaza. Un prompt
 *     se puede manipular; esta tabla no.
 *
 *  3. **La conversación tiene que ser de la empresa del secreto.** Se comprueba
 *     en todas y cada una, sin excepción.
 *
 *  4. **La recepcionista solo actúa sobre quien ha identificado.** Nunca recibe
 *     un `customer_id` por parámetro: usa el que se resolvió del teléfono al
 *     descolgar. Si no, bastaría con que alguien dijera un nombre por teléfono
 *     para sacar los datos de otra persona.
 *
 * Respuestas: siempre 200 con `{ ok, ... }` salvo en fallo de autenticación.
 * Un 500 hacia la plataforma de voz se convierte en un silencio de varios
 * segundos en mitad de la llamada, y el cliente cuelga. Es preferible
 * devolverle al agente una frase que pueda decir en voz alta.
 */

interface TaskRow {
  id: string;
  company_id: string;
  purpose: "service" | "commercial";
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  maintenance_job_id: string | null;
  to_phone_e164: string;
  contact_name: string | null;
}

interface AttemptRow {
  id: string;
  company_id: string;
  direction: "outbound" | "inbound";
  customer_id: string | null;
  lead_id: string | null;
  to_phone_e164: string;
}

/** Contexto unificado: una saliente cuelga de una tarea, una entrante de un intento. */
interface CallCtx {
  companyId: string;
  role: AgentRole;
  direction: "outbound" | "inbound";
  attemptId: string | null;
  task: TaskRow | null;
  customerId: string | null;
  leadId: string | null;
  phone: string;
  contactName: string | null;
  settings: VoiceSettings;
}

function say(message: string, extra: Record<string, unknown> = {}) {
  // `message` es lo que el agente dice en voz alta. Frases cortas, en español,
  // sin jerga técnica: van directas al oído de un cliente.
  return NextResponse.json({ ok: true, message, ...extra });
}

function problem(message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, ...extra });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tool: string }> },
) {
  const { tool } = await ctx.params;

  // --- 1. Identidad del tenant, desde el secreto y solo desde el secreto ---
  const secret =
    req.headers.get("x-hm-voice-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const companyId = await companyFromToolSecret(secret || null);
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return problem("No he entendido la petición.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const call = await buildContext(admin, companyId, body);
  if (!call) {
    return NextResponse.json({ ok: false, error: "call_not_found" }, { status: 404 });
  }

  // --- 2. ¿Puede este papel usar esta herramienta? ---
  const allowed = toolsForRole(call.role) as readonly string[];
  if (!allowed.includes(tool)) {
    console.warn(
      `[voice-agent] herramienta "${tool}" rechazada para el papel "${call.role}"`,
    );
    return problem("Eso no lo puedo hacer yo. Le paso con un compañero.");
  }

  // --- 3. Lo que la empresa haya apagado, apagado está ---
  if (call.direction === "inbound") {
    if (
      !call.settings.inbound_can_book &&
      (tool === "huecos_mantenimiento" || tool === "confirmar_mantenimiento")
    ) {
      return problem("Para cambiar la cita le paso con un compañero, que lo lleva él.");
    }
    if (!call.settings.inbound_can_open_incident && tool === "crear_incidencia") {
      return problem("Tomo nota y le llama un técnico enseguida.");
    }
  }

  try {
    return await runTool(tool as ToolName, call, body, admin);
  } catch (e) {
    console.error(`[voice-agent] herramienta ${tool} falló`, e);
    return problem("Ahora mismo no puedo consultarlo. Le llama un compañero enseguida.");
  }
}

/**
 * Resuelve de qué llamada estamos hablando.
 *
 * Se acepta `task_id` (saliente) o `attempt_id` (entrante), y ambos filtrados
 * por la empresa del secreto: es el filtro que impide que el agente de una
 * empresa toque la conversación de otra.
 */
async function buildContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  body: Record<string, unknown>,
): Promise<CallCtx | null> {
  const settings = await loadVoiceSettings(companyId);

  const taskId = String(body.task_id ?? body.hm_task_id ?? "");
  if (taskId) {
    const { data } = await admin
      .from("voice_call_tasks")
      .select(
        "id, company_id, purpose, status, customer_id, lead_id, maintenance_job_id, to_phone_e164, contact_name",
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .maybeSingle();
    const task = data as TaskRow | null;
    if (!task) return null;
    return {
      companyId,
      role: agentRole(task.purpose, "outbound"),
      direction: "outbound",
      attemptId: null,
      task,
      customerId: task.customer_id,
      leadId: task.lead_id,
      phone: task.to_phone_e164,
      contactName: task.contact_name,
      settings,
    };
  }

  const attemptId = String(body.attempt_id ?? body.hm_attempt_id ?? "");
  if (attemptId) {
    const { data } = await admin
      .from("voice_call_attempts")
      .select("id, company_id, direction, customer_id, lead_id, to_phone_e164")
      .eq("id", attemptId)
      .eq("company_id", companyId)
      .maybeSingle();
    const att = data as AttemptRow | null;
    if (!att) return null;
    return {
      companyId,
      // Una entrante es atención al cliente: servicio, nunca comercial.
      role: agentRole("service", att.direction),
      direction: att.direction,
      attemptId: att.id,
      task: null,
      customerId: att.customer_id,
      leadId: att.lead_id,
      phone: att.to_phone_e164,
      contactName: null,
      settings,
    };
  }

  return null;
}

/**
 * En una entrante no hay `maintenance_job_id` prefijado: hay que encontrar la
 * próxima visita pendiente del cliente que ha llamado. Se busca la más cercana
 * en el futuro y sin completar — que es la que va a querer mover.
 */
async function pendingJobForCustomer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  customerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("maintenance_jobs")
    .select("id, scheduled_at, status")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .in("status", ["preprogrammed", "needs_callback", "scheduled", "rescheduled"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Saliente: el job viene en la tarea. Entrante: hay que buscarlo. */
async function resolveJobId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  call: CallCtx,
): Promise<string | null> {
  if (call.task?.maintenance_job_id) return call.task.maintenance_job_id;
  if (call.customerId) {
    return pendingJobForCustomer(admin, call.companyId, call.customerId);
  }
  return null;
}

async function runTool(
  tool: ToolName,
  call: CallCtx,
  body: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<NextResponse> {
  switch (tool) {
    // =====================================================================
    // ENTRANTE — identificación y consulta
    // =====================================================================
    case "identificar_contacto": {
      // Se vuelve a resolver en vez de fiarse de lo guardado: si el equipo ha
      // dado de alta al cliente mientras sonaba el teléfono, esto lo pilla.
      const caller = await resolveCallerByPhone(call.companyId, call.phone);
      if (caller.kind === "customer" && caller.id && caller.id !== call.customerId) {
        await admin
          .from("voice_call_attempts")
          .update({ customer_id: caller.id })
          .eq("id", call.attemptId);
      }
      if (caller.kind === "unknown") {
        return say("No me consta este número. ¿Me dice su nombre, por favor?", {
          caller_kind: "unknown",
        });
      }
      return say(
        caller.kind === "customer"
          ? `Es ${caller.display_name}, cliente${caller.has_active_contract ? " con contrato activo" : ""}.`
          : `Es ${caller.display_name}, un contacto registrado sin equipos instalados.`,
        {
          caller_kind: caller.kind,
          caller_name: caller.display_name,
          has_active_contract: caller.has_active_contract,
        },
      );
    }

    case "consultar_equipo": {
      if (!call.customerId) {
        return say(
          "No me consta ningún equipo a su nombre con este número. Le paso con un compañero para que lo mire.",
          { found: false },
        );
      }
      const sum = await getEquipmentSummary(call.companyId, call.customerId);
      if (sum.equipment.length === 0) {
        return say("No me aparecen equipos instalados a su nombre.", { found: false });
      }
      const nombres = sum.equipment.map((e) => e.name).join(", ");
      const proxima = sum.next_visit
        ? ` Su próxima revisión está prevista para ${spokenDay(sum.next_visit.date)}.`
        : " No tiene ninguna revisión programada ahora mismo.";
      return say(`Tiene ${nombres}.${proxima}`, {
        found: true,
        equipment: sum.equipment,
        next_visit: sum.next_visit,
        last_visit: sum.last_visit,
        has_maintenance_contract: sum.has_maintenance_contract,
      });
    }

    case "crear_incidencia": {
      const desc = typeof body.description === "string" ? body.description : "";
      if (desc.trim().length < 5) {
        return problem("¿Me cuenta un poco más qué le pasa al equipo?");
      }
      // Una fuga de agua no espera a la cola normal. Se detecta por lo que
      // diga el agente y también por lo que diga el cliente, porque el modelo
      // no siempre marca la urgencia aunque se la cuenten.
      const urgente =
        body.urgent === true || /fuga|inunda|se sale el agua|sin agua/i.test(desc);
      const r = await createIncidentFromCall({
        companyId: call.companyId,
        customerId: call.customerId,
        title:
          typeof body.title === "string" && body.title.trim()
            ? body.title.trim()
            : "Avería comunicada por teléfono",
        description: `${desc}\n\n[Abierta por el agente de voz IA desde ${call.phone}]`,
        priority: urgente ? "critical" : "high",
      });
      if (!r.ok) return problem("No he podido registrarlo. Le paso con un compañero.");

      if (call.attemptId) {
        await admin
          .from("voice_call_attempts")
          .update({ incident_id: r.id, outcome: "incident_created" })
          .eq("id", call.attemptId);
      }

      await notifyTeam(call, {
        kind: "voice_agent.incident_created",
        severity: urgente ? "error" : "warning",
        title: urgente
          ? "Avería URGENTE comunicada por teléfono"
          : "Avería comunicada por teléfono",
        body: `${call.contactName ?? call.phone}: ${desc.slice(0, 200)}`,
        subject_type: "incident",
        subject_id: r.id,
        action_url: `/incidencias/${r.id}`,
      });

      return say(
        urgente
          ? "Queda registrado como urgente. Si hay agua saliendo, cierre la llave de paso; le llamamos ahora mismo."
          : `Queda registrado${r.reference ? ` con la referencia ${r.reference}` : ""}. Un técnico se pondrá en contacto con usted.`,
        { incident_id: r.id, reference: r.reference },
      );
    }

    case "marcar_spam": {
      if (call.attemptId) {
        await admin
          .from("voice_call_attempts")
          .update({ outcome: "spam" })
          .eq("id", call.attemptId);
      }
      return say("Gracias, no nos interesa. Buenos días.");
    }

    // =====================================================================
    // MANTENIMIENTO — sirve a la saliente de servicio y a la entrante
    // =====================================================================
    case "huecos_mantenimiento": {
      const jobId = await resolveJobId(admin, call);
      if (!jobId) {
        return say(
          "No le veo ninguna revisión pendiente. Le paso con un compañero para que lo revise.",
          { slots: [] },
        );
      }
      const token = await ensureConfirmationToken(jobId);
      if (!token) return problem("No he podido consultar la agenda.");
      const result = await getMaintenanceOfferableSlots(token);
      if (!result.ok || result.slots.length === 0) {
        return say(
          "Ahora mismo no tengo huecos que ofrecerle. Le llama un compañero para cuadrarlo.",
          { slots: [] },
        );
      }
      // Máximo DOS opciones. Con tres, la gente duda y la llamada se alarga.
      const offered = result.slots
        .slice(0, 2)
        .map((s) => {
          const franja = s.slots[0];
          if (!franja) return null;
          return { date: s.date, slot: franja, spoken: spokenDate(s.date, franja) };
        })
        .filter(
          (o): o is { date: string; slot: "morning" | "afternoon"; spoken: string } =>
            o !== null,
        );
      if (offered.length === 0) {
        return say(
          "Ahora mismo no tengo huecos que ofrecerle. Le llama un compañero para cuadrarlo.",
          { slots: [] },
        );
      }
      return say(
        `Tengo ${offered.map((o) => o.spoken).join(", o ")}. ¿Cuál le viene mejor?`,
        { slots: offered, job_id: jobId },
      );
    }

    case "confirmar_mantenimiento": {
      const jobId = await resolveJobId(admin, call);
      if (!jobId) return problem("No encuentro la visita.");
      const token = await ensureConfirmationToken(jobId);
      if (!token) return problem("No he podido confirmar la cita.");

      const date = typeof body.date === "string" ? body.date : null;
      const slot = body.slot === "afternoon" ? "afternoon" : "morning";

      // Sin fecha = acepta la que ya tenía propuesta. Con fecha = ha elegido
      // otra de las que le he ofrecido, y entonces se revalida contra el motor
      // de disponibilidad antes de tocar nada.
      const r = date
        ? await customerRescheduleAction(token, date, slot)
        : await customerConfirmAction(token);

      if (!r.ok) return problem(r.message);

      if (call.task) {
        await closeTask(admin, call.task, date ? "rescheduled" : "confirmed", r.message);
      } else if (call.attemptId) {
        await admin
          .from("voice_call_attempts")
          .update({ outcome: "appointment_booked" })
          .eq("id", call.attemptId);
      }

      // Cierre por WhatsApp. Duplica la asistencia a la cita y deja prueba
      // escrita de lo acordado, que es justo lo que le falta a una llamada.
      const wa = await sendVoiceConfirmation({
        companyId: call.companyId,
        settings: call.settings,
        toPhone: call.phone,
        customerId: call.customerId,
        jobId,
        token,
        date,
        slot,
      });

      const coletilla = wa.sent ? " Le mando ahora la confirmación por WhatsApp." : "";
      return say(
        date
          ? `Perfecto, queda anotado para ${spokenDate(date, slot)}.${coletilla}`
          : `Perfecto, su cita queda confirmada.${coletilla}`,
      );
    }

    case "posponer_mantenimiento": {
      const jobId = await resolveJobId(admin, call);
      if (!jobId) return problem("No encuentro la visita.");
      const token = await ensureConfirmationToken(jobId);
      if (!token) return problem("No he podido anotarlo.");
      const reason =
        typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
      const r = await customerPostponeAction(token, reason);
      if (!r.ok) return problem(r.message);
      if (call.task) await closeTask(admin, call.task, "postponed", reason ?? null);
      return say(
        "De acuerdo, lo dejamos para más adelante y le llamamos nosotros. Gracias por avisar.",
      );
    }

    // =====================================================================
    // COMERCIAL
    // =====================================================================
    case "marcar_no_interesado": {
      if (call.task) {
        await closeTask(
          admin,
          call.task,
          "not_interested",
          typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        );
      }
      return say("Entendido, gracias por su tiempo. Que tenga buen día.");
    }

    case "posponer_llamada": {
      if (!call.task) return problem("Eso no lo puedo hacer yo.");
      const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);
      await admin
        .from("voice_call_tasks")
        .update({
          status: "pending",
          next_attempt_at: new Date(Date.now() + days * 86_400_000).toISOString(),
          attempts: 0,
          locked_at: null,
          lock_token: null,
          outcome_notes:
            typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        })
        .eq("id", call.task.id)
        .eq("company_id", call.companyId);
      return say("Perfecto, le llamamos más adelante entonces. Gracias.");
    }

    // =====================================================================
    // COMUNES
    // =====================================================================
    case "crear_lead": {
      const note = typeof body.note === "string" ? body.note.slice(0, 1000) : "";
      const name = typeof body.name === "string" ? body.name.slice(0, 120) : null;

      // En una ENTRANTE de un desconocido sí se crea el lead de verdad: es un
      // interesado que ha llamado él, y perderlo sería absurdo.
      // En una SALIENTE de mantenimiento NO se crea nada nuevo: ya es cliente,
      // y lo que toca es avisar a un comercial para que le llame.
      let leadId: string | null = call.leadId;
      if (call.direction === "inbound" && !call.customerId && !call.leadId) {
        const created = await createLeadFromCall({
          companyId: call.companyId,
          phoneE164: call.phone,
          name,
          notes: note || "Llamó preguntando por nuestros servicios.",
          origin: "inbound_call",
        });
        if (created.ok) {
          leadId = created.id;
          if (call.attemptId) {
            await admin
              .from("voice_call_attempts")
              .update({ lead_id: created.id, outcome: "lead_created" })
              .eq("id", call.attemptId);
          }
        }
      }

      const caller: ResolvedCaller = {
        kind: call.customerId ? "customer" : leadId ? "lead" : "unknown",
        id: call.customerId ?? leadId,
        display_name: name ?? call.contactName,
        party_kind: null,
        has_active_contract: false,
        phone_e164: call.phone,
      };
      await logVoiceEvent({
        companyId: call.companyId,
        kind: "voice_agent.interest_detected",
        caller,
        payload: { note, name, phone: call.phone, direction: call.direction },
      });

      await notifyTeam(call, {
        kind: "voice_agent.interest_detected",
        severity: "info",
        title:
          call.direction === "inbound"
            ? "Alguien ha llamado preguntando por productos"
            : "Un cliente ha preguntado por productos en una llamada del agente",
        body: `${name ?? call.contactName ?? call.phone}: ${note || "sin detalle"}. Llámale tú.`,
        subject_type: call.customerId ? "customer" : "lead",
        subject_id: call.customerId ?? leadId ?? undefined,
        action_url: call.customerId ? `/clientes/${call.customerId}` : "/leads",
      });

      if (call.task && call.task.purpose === "commercial") {
        await closeTask(admin, call.task, "lead_created", note);
        return say("Perfecto, le llama un compañero para cuadrar el día. Muchas gracias.");
      }
      if (call.direction === "inbound") {
        return say(
          "Perfecto, le paso el aviso a un compañero y le llama para explicárselo con detalle. ¿Algo más?",
        );
      }
      // En servicio NO se cierra la tarea: la llamada sigue, hay que agendar.
      return say(
        "Se lo paso a un compañero y le llama él, que se lo explicará mejor. Y volviendo a la cita:",
      );
    }

    case "escalar_humano": {
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
      if (call.attemptId) {
        await admin
          .from("voice_call_attempts")
          .update({ human_escalation_requested: true, outcome: "escalated" })
          .eq("id", call.attemptId);
      } else if (call.task) {
        await admin
          .from("voice_call_attempts")
          .update({ human_escalation_requested: true })
          .eq("task_id", call.task.id)
          .is("ended_at", null);
      }

      await notifyTeam(call, {
        kind: "voice_agent.escalation",
        severity: "warning",
        title: "Un cliente ha pedido hablar con una persona",
        body: `${call.contactName ?? call.phone} pidió hablar con alguien${reason ? `: ${reason}` : ""}. Llámale hoy.`,
        subject_type: call.customerId ? "customer" : "lead",
        subject_id: call.customerId ?? call.leadId ?? undefined,
        action_url: call.customerId ? `/clientes/${call.customerId}` : "/leads",
      });

      if (call.task) await closeTask(admin, call.task, "escalated", reason);

      // La transferencia en caliente solo se ofrece si la empresa la tiene
      // configurada. Prometer "le paso" y luego colgar es peor que no ofrecerlo.
      const puedeTransferir =
        call.settings.transfer_enabled && Boolean(call.settings.escalation_phone);
      return say(
        puedeTransferir
          ? "Por supuesto, le paso con un compañero. No cuelgue."
          : "Por supuesto. Le llama un compañero hoy mismo, ya le paso el aviso.",
        {
          transfer: puedeTransferir,
          transfer_to: puedeTransferir ? call.settings.escalation_phone : null,
        },
      );
    }

    case "no_llamar_mas": {
      // Las dos cosas juntas y siempre: apuntar la exclusión y vaciar lo que
      // esa persona tuviera en cola. Anotar el "no me llaméis" y dejar una
      // llamada pendiente es justo lo que genera la reclamación.
      await admin.from("voice_do_not_call").upsert(
        {
          company_id: call.companyId,
          phone_e164: call.phone,
          reason:
            typeof body.reason === "string"
              ? body.reason.slice(0, 500)
              : "Pedido en llamada",
          source: "call_optout",
          customer_id: call.customerId,
          lead_id: call.leadId,
        },
        { onConflict: "company_id,phone_e164" },
      );

      await admin
        .from("voice_call_tasks")
        .update({ status: "cancelled", outcome: "opted_out" })
        .eq("company_id", call.companyId)
        .eq("to_phone_e164", call.phone)
        .in("status", ["pending", "calling"]);

      if (call.leadId) {
        await admin.from("voice_consents").insert({
          company_id: call.companyId,
          lead_id: call.leadId,
          phone_e164: call.phone,
          basis: "consent",
          granted: false,
          source: "call",
          evidence: { via: "voice_agent", direction: call.direction },
        });
      }

      return say(
        "Queda anotado, no volverá a recibir llamadas nuestras. Disculpe las molestias y gracias.",
      );
    }

    case "marcar_numero_erroneo": {
      if (call.task) {
        await closeTask(
          admin,
          call.task,
          "wrong_number",
          typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
        );
      }
      // Un número equivocado no se vuelve a marcar nunca: se excluye.
      await admin.from("voice_do_not_call").upsert(
        {
          company_id: call.companyId,
          phone_e164: call.phone,
          reason: "Número erróneo detectado en llamada",
          source: "call_optout",
        },
        { onConflict: "company_id,phone_e164" },
      );
      return say("Disculpe la molestia, me he debido equivocar de número. Buen día.");
    }

    default:
      return problem("Eso no lo puedo hacer yo.");
  }
}

async function notifyTeam(
  call: CallCtx,
  payload: {
    kind: string;
    severity: "info" | "success" | "warning" | "error";
    title: string;
    body: string;
    subject_type: string;
    subject_id?: string;
    action_url: string;
  },
): Promise<void> {
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      call.companyId,
      [
        "company_admin",
        "technical_director",
        "telemarketing_director",
        "commercial_director",
      ],
      {
        kind: payload.kind,
        severity: payload.severity,
        title: payload.title,
        body: payload.body,
        // Sin `subject_id` no se puede colgar de nada: se manda igual pero sin
        // sujeto, para que al menos llegue el aviso.
        ...(payload.subject_id
          ? {
              subject_type: payload.subject_type as never,
              subject_id: payload.subject_id,
            }
          : {}),
        action_url: payload.action_url,
      },
    );
  } catch {
    /* la notificación es un extra: si falla, el evento ya quedó grabado */
  }
}

async function closeTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  task: TaskRow,
  outcome: string,
  notes: string | null,
): Promise<void> {
  await admin
    .from("voice_call_tasks")
    .update({
      status: "done",
      outcome,
      outcome_notes: notes,
      locked_at: null,
      lock_token: null,
    })
    .eq("id", task.id)
    .eq("company_id", task.company_id);
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * "2026-09-18" + "morning" → "el jueves dieciocho de septiembre por la mañana".
 *
 * Se construye aquí y no en el prompt porque un modelo leyendo "2026-09-18"
 * en voz alta dice cosas como "dos mil veintiséis guion cero nueve" más veces
 * de las que uno querría explicar a un cliente.
 */
function spokenDate(date: string, slot: "morning" | "afternoon"): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const franja = slot === "morning" ? "por la mañana" : "por la tarde";
  return `el ${DIAS[dt.getUTCDay()]} ${d} de ${MESES[m - 1]} ${franja}`;
}

/** Igual, pero para un instante completo y sin franja. */
function spokenDay(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dt);
  return `el ${parts}`;
}
