"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { isModuleActiveForCompany } from "@/shared/lib/auth/module-guard";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { toE164, isSpanishMobile } from "./guardrails";
import { loadVoiceSettings } from "./settings";

/**
 * Punto de entrada de las CAMPAÑAS COMERCIALES del agente de voz.
 *
 * La fase 1 dejó los guardarraíles montados (CHECK, trigger, gate) pero sin
 * forma de encolar una llamada comercial. Esto es esa forma, y lo primero que
 * hay que entender de este fichero es lo que NO hace: no relaja ninguna regla.
 *
 * LA REGLA: una llamada comercial solo puede salir hacia una persona JURÍDICA.
 * La base de datos ya lo impide dos veces (el CHECK
 * `voice_task_commercial_never_individual` y el trigger `voice_task_validate`,
 * que lanza `VOICE_B2C_BLOCKED` tras releer el lead real). Aquí se filtra por
 * `party_kind = 'company'` una TERCERA vez, y no por desconfianza de la BD:
 * es la única capa que puede contarle al usuario cuántos particulares se han
 * quedado fuera de su selección. Sin ese recuento, alguien que filtra por
 * provincia y encola 12 de 300 leads no entiende qué ha pasado y acaba
 * buscando la forma de "arreglarlo".
 */

// Quién puede lanzar una tanda de llamadas en frío. Más corta que la de la
// cola de servicio a propósito: `technical_director` gestiona mantenimientos,
// no captación, y una campaña comercial mal lanzada es una multa de la AEPD.
const CAMPAIGN_ROLES = ["company_admin", "telemarketing_director"];

function canManage(roles: string[], isSuper: boolean): boolean {
  return isSuper || roles.some((r) => CAMPAIGN_ROLES.includes(r));
}

export type CampaignStatus = "draft" | "running" | "paused" | "done";

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  notes: string | null;
  created_at: string;
  /** Recuento de tareas de la campaña por estado de la cola. */
  counts: {
    pending: number;
    calling: number;
    done: number;
    failed: number;
    cancelled: number;
    total: number;
  };
}

export interface CampaignSeedResult {
  ok: boolean;
  enqueued: number;
  skipped: {
    no_phone: number;
    individuals: number;
    already_queued: number;
    excluded: number;
  };
  error?: string;
}

function emptySkipped(): CampaignSeedResult["skipped"] {
  return { no_phone: 0, individuals: 0, already_queued: 0, excluded: 0 };
}

function seedFailure(error: string): CampaignSeedResult {
  return { ok: false, enqueued: 0, skipped: emptySkipped(), error };
}

/**
 * Campañas de la empresa con el recuento de llamadas por estado.
 *
 * Los recuentos se hacen en memoria a partir de las tareas de la empresa en
 * vez de con un `count` por campaña y estado: son cinco estados por campaña,
 * y una empresa con diez campañas serían cincuenta viajes a la base de datos
 * para pintar una tabla. Se lee con `fetchAllRows` porque PostgREST corta a
 * 1000 filas sin avisar y una campaña de 2000 leads dejaría la mitad de los
 * contadores a cero — un número mal no es "un detalle" cuando lo que cuenta
 * son llamadas ya hechas.
 */
export async function listCampaigns(): Promise<CampaignRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!canManage(session.roles, session.is_superadmin)) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data, error } = await admin
    .from("voice_campaigns")
    .select("id, name, status, notes, created_at")
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    status: CampaignStatus;
    notes: string | null;
    created_at: string;
  };
  const campaigns = (data ?? []) as Raw[];
  if (campaigns.length === 0) return [];

  const ids = campaigns.map((c) => c.id);
  const tasks = await fetchAllRows<{ campaign_id: string | null; status: string }>(
    (from, to) =>
      admin
        .from("voice_call_tasks")
        .select("campaign_id, status")
        .eq("company_id", session.company_id)
        .in("campaign_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "voice_call_tasks/campaigns", maxRows: 100_000 },
  );

  const byCampaign = new Map<string, CampaignRow["counts"]>();
  for (const t of tasks) {
    if (!t.campaign_id) continue;
    let c = byCampaign.get(t.campaign_id);
    if (!c) {
      c = { pending: 0, calling: 0, done: 0, failed: 0, cancelled: 0, total: 0 };
      byCampaign.set(t.campaign_id, c);
    }
    c.total++;
    if (t.status === "pending") c.pending++;
    else if (t.status === "calling") c.calling++;
    else if (t.status === "done") c.done++;
    else if (t.status === "failed") c.failed++;
    else if (t.status === "cancelled") c.cancelled++;
  }

  return campaigns.map((c) => ({
    ...c,
    counts:
      byCampaign.get(c.id) ??
      { pending: 0, calling: 0, done: 0, failed: 0, cancelled: 0, total: 0 },
  }));
}

/**
 * Crea la campaña vacía, siempre en `draft`.
 *
 * Nace sin destinatarios y parada: se crea, se siembra con unos filtros, se
 * mira a quién ha cogido, y solo entonces se pone en marcha. Crear y arrancar
 * en el mismo clic sería la forma más rápida de llamar a 800 empresas con un
 * filtro mal puesto.
 */
export async function createCampaignAction(
  name: string,
  notes?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!canManage(session.roles, session.is_superadmin)) {
      return { ok: false, error: "No tienes permiso para crear campañas." };
    }
    if (!(await isModuleActiveForCompany(session.company_id, "voice_agent"))) {
      return { ok: false, error: "El módulo Agente de voz IA no está activo." };
    }

    const clean = name.trim();
    if (!clean) return { ok: false, error: "Ponle un nombre a la campaña." };
    if (clean.length > 120) {
      return { ok: false, error: "El nombre no puede pasar de 120 caracteres." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("voice_campaigns")
      .insert({
        company_id: session.company_id,
        name: clean,
        // `purpose` lo fija la BD en 'commercial' y un CHECK impide otra cosa:
        // no se manda desde aquí para que no parezca configurable.
        status: "draft",
        notes: notes?.trim() || null,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath("/agente-voz/campanas");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: toActionError(e, "createCampaignAction") };
  }
}

export interface CampaignSeedFilters {
  province?: string;
  postalPrefix?: string;
  onlyWithoutContract?: boolean;
  limit?: number;
}

/**
 * Encola llamadas comerciales en la campaña a partir de los leads.
 *
 * Qué entra: leads vivos de la empresa que sean persona JURÍDICA, que no estén
 * ya convertidos en cliente y que tengan un teléfono interpretable. Se mira
 * primero `phone_company` y solo después `phone_primary`: en un lead de empresa
 * el segundo suele ser el móvil personal de quien atendió, y llamar a un móvil
 * particular con un guion comercial es exactamente lo que la norma persigue,
 * aunque el lead esté marcado como empresa.
 *
 * Qué NO entra, y por qué se cuenta cada caso por separado:
 *  · `individuals`     → particulares que encajaban con los filtros. Se
 *                        descartan aquí y, si alguno se colara, el trigger lo
 *                        rechazaría con VOICE_B2C_BLOCKED.
 *  · `no_phone`        → no hay número que marcar.
 *  · `already_queued`  → ya tienen una llamada viva de esta campaña; lo impide
 *                        el índice único `uq_voice_task_alive`.
 *  · `excluded`        → en la lista de exclusión (VOICE_DNC) o error raro.
 *
 * Es idempotente: sembrar dos veces seguidas con los mismos filtros no encola
 * nada nuevo, porque el `dedupe_key` es por campaña y lead.
 */
export async function seedCampaignAction(
  campaignId: string,
  filters: CampaignSeedFilters,
): Promise<CampaignSeedResult> {
  try {
    const session = await requireSession();
    const companyId = session.company_id;
    if (!companyId) return seedFailure("Sin empresa");
    if (!canManage(session.roles, session.is_superadmin)) {
      return seedFailure("No tienes permiso para lanzar llamadas comerciales.");
    }
    if (!(await isModuleActiveForCompany(companyId, "voice_agent"))) {
      return seedFailure("El módulo Agente de voz IA no está activo.");
    }

    const skipped = emptySkipped();
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: campaign, error: campErr } = await admin
      .from("voice_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (campErr) throw campErr;
    if (!campaign) return seedFailure("La campaña no existe o es de otra empresa.");
    if ((campaign as { status: string }).status === "done") {
      return seedFailure("La campaña está cerrada. Crea una nueva.");
    }

    const settings = await loadVoiceSettings(companyId);

    const province = filters.province?.trim();
    const postalPrefix = filters.postalPrefix?.trim();
    // La provincia y el código postal viven en `addresses`, no en el lead. Con
    // `!inner` PostgREST convierte el embebido en INNER JOIN y así se puede
    // filtrar por sus columnas; sin filtros no se pide el join para no dejar
    // fuera a los leads que aún no tienen dirección.
    const needsAddress = Boolean(province || postalPrefix);
    const baseCols =
      "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, phone_company";
    const select = needsAddress
      ? `${baseCols}, addresses!inner(province, postal_code, deleted_at)`
      : baseCols;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyFilters(q: any, kind: "company" | "individual") {
      let out = q
        .eq("company_id", companyId)
        .eq("party_kind", kind)
        .is("deleted_at", null)
        .neq("status", "converted");
      if (filters.onlyWithoutContract) {
        // Un lead con `converted_to_customer_id` ya es cliente con contrato:
        // llamarle en frío con guion de captación queda fuera del interés
        // legítimo y encima queda fatal.
        out = out.is("converted_to_customer_id", null);
      }
      if (province) out = out.eq("addresses.province", province);
      if (postalPrefix) out = out.like("addresses.postal_code", `${postalPrefix}%`);
      if (needsAddress) out = out.is("addresses.deleted_at", null);
      return out;
    }

    // Los particulares se cuentan con los MISMOS filtros, en una consulta
    // aparte. Es el número que le falta al usuario para entender por qué su
    // selección de 300 leads ha encolado 40.
    //
    // Con join de direcciones NO vale el `count` de PostgREST: cuenta filas del
    // join, así que un lead con tres sedes en la provincia contaría por tres y
    // el aviso diría el triple de particulares de los que hay. En ese caso se
    // traen los ids y se cuentan únicos.
    if (needsAddress) {
      const ids = await fetchAllRows<{ id: string }>(
        (from, to) =>
          applyFilters(
            admin.from("leads").select("id, addresses!inner(id)"),
            "individual",
          )
            .order("id", { ascending: true })
            .range(from, to),
        { label: "leads/individuals", maxRows: 20_000 },
      );
      skipped.individuals = new Set(ids.map((r) => r.id)).size;
    } else {
      const { count, error: indErr } = await applyFilters(
        admin.from("leads").select("id", { count: "exact", head: true }),
        "individual",
      );
      if (indErr) throw indErr;
      skipped.individuals = count ?? 0;
    }

    const { data: leads, error } = await applyFilters(
      admin.from("leads").select(select),
      "company",
    )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    type Row = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone_primary: string | null;
      phone_company: string | null;
    };

    const now = new Date();
    const seen = new Set<string>();
    let enqueued = 0;

    for (const lead of (leads ?? []) as Row[]) {
      // El INNER JOIN con direcciones repite el lead una vez por dirección que
      // encaje. Sin esto, un lead con sede y almacén en la misma provincia
      // gastaría dos huecos del límite y sumaría un falso `already_queued`.
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);

      // Cinturón y tirantes: la consulta ya filtra por party_kind, pero si
      // alguna vez deja de hacerlo esto es lo que evita que llegue al trigger.
      if (lead.party_kind !== "company") {
        skipped.individuals++;
        continue;
      }

      const phone = toE164(lead.phone_company) ?? toE164(lead.phone_primary);
      if (!phone) {
        skipped.no_phone++;
        continue;
      }

      const name =
        lead.trade_name ??
        lead.legal_name ??
        [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() ??
        null;

      const { error: insErr } = await admin.from("voice_call_tasks").insert({
        company_id: companyId,
        purpose: "commercial",
        target_party_kind: "company",
        lead_id: lead.id,
        campaign_id: campaignId,
        to_phone_e164: phone,
        contact_name: name || null,
        max_attempts: settings.max_attempts,
        dedupe_key: `campaign:${campaignId}:lead:${lead.id}`,
        created_by: session.user_id,
        // Igual que en la cola de servicio: el móvil se coge y el fijo de la
        // centralita no. Sale antes lo que tiene más posibilidades.
        next_attempt_at: isSpanishMobile(phone)
          ? now.toISOString()
          : new Date(now.getTime() + 60_000).toISOString(),
      });

      if (insErr) {
        const msg = String((insErr as { message?: string }).message ?? "");
        if (msg.includes("VOICE_DNC")) {
          skipped.excluded++;
        } else if (msg.includes("VOICE_B2C_BLOCKED")) {
          // La BD ha visto un particular donde la consulta veía una empresa:
          // el lead cambió de tipo entre la lectura y la inserción. Se cuenta
          // como particular, que es lo que es, y no se reintenta nada.
          skipped.individuals++;
        } else if (msg.includes("duplicate key") || msg.includes("uq_voice_task_alive")) {
          skipped.already_queued++;
        } else {
          // Un fallo raro en una fila no debe tumbar la siembra entera, pero
          // sí tiene que quedar en los logs con el lead concreto.
          console.error("[voice-agent] no se pudo encolar lead", lead.id, msg);
          skipped.excluded++;
        }
        continue;
      }
      enqueued++;
    }

    revalidatePath("/agente-voz/campanas");
    revalidatePath("/agente-voz");
    return { ok: true, enqueued, skipped };
  } catch (e) {
    return seedFailure(toActionError(e, "seedCampaignAction"));
  }
}

/**
 * Cambia el estado de la campaña.
 *
 * DECISIÓN: pausar CANCELA las llamadas pendientes; reanudar NO las devuelve.
 *
 * Es asimétrico a propósito. Quien pulsa «pausar» casi siempre lo hace porque
 * algo va mal —el guion dice una tontería, el filtro cogió a quien no debía,
 * ha llamado alguien enfadado— y lo que espera es que deje de sonar el
 * teléfono de nadie más, ya. Dejar las tareas en `pending` y confiar en que el
 * marcador respete un flag es exactamente el fallo que hace que sigan saliendo
 * llamadas diez minutos después de pausar. Cancelarlas es irreversible y ese
 * es el punto: no hay estado intermedio que se pueda malinterpretar.
 *
 * Por eso reanudar no reactiva nada: el usuario vuelve a sembrar con los
 * filtros que quiera, mira otra vez a quién ha cogido y decide. Recuperar en
 * silencio una cola que se paró por un problema es cómo se repite el problema.
 *
 * Cerrar la campaña (`done`) cancela también lo pendiente, por el mismo
 * motivo: una campaña "terminada" que sigue llamando no está terminada.
 */
export async function setCampaignStatusAction(
  campaignId: string,
  status: CampaignStatus,
): Promise<{ ok: boolean; cancelled?: number; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!canManage(session.roles, session.is_superadmin)) {
      return { ok: false, error: "No tienes permiso para cambiar la campaña." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: updated, error } = await admin
      .from("voice_campaigns")
      .update({ status })
      .eq("id", campaignId)
      .eq("company_id", session.company_id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) return { ok: false, error: "La campaña no existe o es de otra empresa." };

    let cancelled = 0;
    if (status === "paused" || status === "done") {
      const { data: rows, error: cancelErr } = await admin
        .from("voice_call_tasks")
        .update({
          status: "cancelled",
          outcome_notes:
            status === "paused" ? "Campaña pausada" : "Campaña cerrada",
        })
        .eq("company_id", session.company_id)
        .eq("campaign_id", campaignId)
        .eq("status", "pending")
        .select("id");
      if (cancelErr) throw cancelErr;
      cancelled = (rows as unknown[] | null)?.length ?? 0;
    }

    revalidatePath("/agente-voz/campanas");
    revalidatePath("/agente-voz");
    return { ok: true, cancelled };
  } catch (e) {
    return { ok: false, error: toActionError(e, "setCampaignStatusAction") };
  }
}

/**
 * Registra la base legal para llamar a un lead por teléfono.
 *
 * `voice_consents` es append-only: una revocación se guarda como una fila
 * nueva con `granted=false`, nunca modificando la anterior. El histórico ES la
 * prueba ante la AEPD, y una prueba que se puede editar no prueba nada. Por
 * eso aquí solo se inserta.
 *
 * El teléfono se guarda tal y como se va a marcar (E.164 normalizado, con
 * `phone_company` por delante igual que en la siembra): el consentimiento es
 * para un número concreto, no para "el lead". Si mañana cambian el teléfono,
 * el registro sigue diciendo a qué número se autorizó llamar.
 */
export async function grantVoiceConsentAction(
  leadId: string,
  basis: "consent" | "legitimate_interest",
  source: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!canManage(session.roles, session.is_superadmin)) {
      return { ok: false, error: "No tienes permiso para registrar la base legal." };
    }

    const cleanSource = source.trim();
    if (!cleanSource) {
      return {
        ok: false,
        error: "Indica de dónde sale el consentimiento (formulario, contrato, llamada…).",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .select("id, party_kind, phone_primary, phone_company")
      .eq("id", leadId)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (leadErr) throw leadErr;
    if (!lead) return { ok: false, error: "El lead no existe o es de otra empresa." };

    const l = lead as {
      party_kind: "individual" | "company";
      phone_primary: string | null;
      phone_company: string | null;
    };
    const phone = toE164(l.phone_company) ?? toE164(l.phone_primary);
    if (!phone) {
      return { ok: false, error: "El lead no tiene un teléfono válido que registrar." };
    }
    if (l.party_kind !== "company" && basis === "legitimate_interest") {
      // El art. 19 LOPDGDD ampara el contacto profesional de una persona
      // jurídica. Con un particular no hay interés legítimo que valga: o hay
      // opt-in expreso o no se le llama.
      return {
        ok: false,
        error:
          "El interés legítimo solo vale para empresas. Con un particular hace falta consentimiento expreso.",
      };
    }

    const { error } = await admin.from("voice_consents").insert({
      company_id: session.company_id,
      lead_id: leadId,
      phone_e164: phone,
      basis,
      granted: true,
      source: cleanSource,
      recorded_by: session.user_id,
    });
    if (error) throw error;

    revalidatePath("/agente-voz/campanas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "grantVoiceConsentAction") };
  }
}
