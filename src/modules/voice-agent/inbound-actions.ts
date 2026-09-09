"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { toE164 } from "./guardrails";

/**
 * Los números que atiende la recepcionista.
 *
 * Un número entrante identifica a UNA empresa y solo a una: es lo único que
 * lleva la llamada cuando entra, así que la unicidad es global, no por tenant.
 * Si dos empresas pudieran registrar el mismo, las llamadas de una acabarían
 * leyendo los datos de la otra — por eso el `unique` de la tabla no incluye
 * `company_id` y por eso aquí se traduce el error a un mensaje entendible.
 */

export interface InboundNumberRow {
  id: string;
  phone_e164: string;
  label: string | null;
  active: boolean;
  created_at: string;
}

function requireAdmin(roles: string[], isSuper: boolean): void {
  if (!isSuper && !roles.includes("company_admin")) {
    throw new Error("Solo el administrador de la empresa puede tocar los números de entrada.");
  }
}

export async function listInboundNumbers(): Promise<InboundNumberRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!session.is_superadmin && !session.roles.includes("company_admin")) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("voice_inbound_numbers")
    .select("id, phone_e164, label, active, created_at")
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InboundNumberRow[];
}

export async function addInboundNumberAction(
  rawPhone: string,
  label?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    requireAdmin(session.roles, session.is_superadmin);

    const phone = toE164(rawPhone);
    if (!phone) {
      return { ok: false, error: "Teléfono no válido. Formato: +34911234567" };
    }
    // El rango 400 es exclusivamente saliente y exclusivamente comercial: no
    // admite llamadas entrantes y el BOE prohíbe usarlo para atención al
    // cliente. La BD también lo rechaza; esto es para dar un motivo legible.
    if (/^\+?34?400/.test(phone)) {
      return {
        ok: false,
        error:
          "El rango 400 no admite llamadas entrantes y está reservado a llamadas comerciales salientes. Usa el número geográfico o el 900 de la empresa.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("voice_inbound_numbers").insert({
      company_id: session.company_id,
      phone_e164: phone,
      label: label?.trim() || null,
      active: true,
    });
    if (error) {
      const msg = String((error as { message?: string }).message ?? "");
      if (msg.includes("voice_inbound_number_unique") || msg.includes("duplicate key")) {
        return {
          ok: false,
          error:
            "Ese número ya está dado de alta. Si crees que lo tiene otra empresa por error, avisa al soporte: un número solo puede atender a una.",
        };
      }
      throw error;
    }

    revalidatePath("/configuracion/agente-voz");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "addInboundNumberAction") };
  }
}

export async function toggleInboundNumberAction(
  id: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    requireAdmin(session.roles, session.is_superadmin);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("voice_inbound_numbers")
      .update({ active })
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) throw error;

    revalidatePath("/configuracion/agente-voz");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "toggleInboundNumberAction") };
  }
}

export async function removeInboundNumberAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    requireAdmin(session.roles, session.is_superadmin);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("voice_inbound_numbers")
      .delete()
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) throw error;

    revalidatePath("/configuracion/agente-voz");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "removeInboundNumberAction") };
  }
}

export interface InboundCallRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  to_phone_e164: string;
  outcome: string | null;
  summary: string | null;
  customer_id: string | null;
  lead_id: string | null;
  incident_id: string | null;
  human_escalation_requested: boolean;
  transcript_purged_at: string | null;
}

/**
 * Últimas llamadas atendidas por la recepcionista.
 *
 * Visible para todo el nivel 1/2, no solo para el administrador: quien lleva la
 * parte técnica necesita ver las averías que entran por teléfono, y quien lleva
 * telemarketing, los interesados. Los números de entrada, en cambio, siguen
 * siendo cosa del administrador porque tocarlos rompe el enrutado.
 */
export async function listInboundCalls(limit = 50): Promise<InboundCallRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const puede =
    session.is_superadmin ||
    session.roles.some((r) =>
      [
        "company_admin",
        "technical_director",
        "telemarketing_director",
        "commercial_director",
      ].includes(r),
    );
  if (!puede) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("voice_call_attempts")
    .select(
      "id, started_at, ended_at, duration_seconds, to_phone_e164, outcome, summary, customer_id, lead_id, incident_id, human_escalation_requested, transcript_purged_at",
    )
    .eq("company_id", session.company_id)
    .eq("direction", "inbound")
    .order("started_at", { ascending: false })
    .limit(Math.min(limit, 200));
  if (error) throw error;
  return (data ?? []) as InboundCallRow[];
}
