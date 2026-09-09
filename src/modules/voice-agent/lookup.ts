import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { toE164 } from "./guardrails";

/**
 * Consultas del agente de voz que corren SIN SESIÓN.
 *
 * Este fichero existe porque una llamada entrante no tiene usuario: llega un
 * webhook de la plataforma de voz y hay que resolver quién llama antes de
 * abrir la boca. Las funciones equivalentes del CRM (`checkDedupe`,
 * `listCustomerEquipment`, `listContractsByCustomer`) empiezan todas con
 * `requireSession()`, así que no sirven aquí.
 *
 * Lo que se ha copiado se ha copiado a conciencia; lo que importa es que
 * **el `company_id` es un parámetro obligatorio en todas**, y viene de resolver
 * el número marcado, nunca de lo que diga el agente. Es la misma regla que en
 * las herramientas: la identidad del tenant no viaja por la conversación.
 */

export type CallerKind = "customer" | "lead" | "unknown";

export interface ResolvedCaller {
  kind: CallerKind;
  id: string | null;
  display_name: string | null;
  party_kind: "individual" | "company" | null;
  /** Solo clientes: si tiene algún contrato activo. Cambia lo que puede contar el agente. */
  has_active_contract: boolean;
  /** El teléfono normalizado con el que se hizo la búsqueda. */
  phone_e164: string | null;
}

interface PartyRow {
  id: string;
  party_kind: "individual" | "company" | null;
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function displayName(p: PartyRow): string {
  const company = p.trade_name ?? p.legal_name;
  const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  if (p.party_kind === "company") return company || person || "Cliente";
  return person || company || "Cliente";
}

/**
 * Variantes del mismo teléfono con las que buscar.
 *
 * En la base de datos conviven formatos: unos números se guardaron como
 * "+34 612345678", otros como "612345678" y otros como "612 34 56 78". No hay
 * normalización a E.164 en BD y los índices son sobre el valor literal, así
 * que una búsqueda con un solo formato falla la mitad de las veces. Se prueban
 * las tres formas que de verdad aparecen — el mismo problema que ya resolvió
 * `checkDedupe` a su manera.
 */
export function phoneVariants(e164: string): string[] {
  const out = new Set<string>([e164]);
  if (e164.startsWith("+34")) {
    const nat = e164.slice(3);
    out.add(nat);
    out.add(`+34 ${nat}`);
    out.add(`0034${nat}`);
  }
  return [...out];
}

/**
 * Teléfono → cliente, lead o desconocido.
 *
 * El orden importa: **primero cliente, luego lead**. Si un número está en las
 * dos tablas, quien llama es cliente y merece el trato de cliente; tratarle
 * como lead sería ofrecerle lo que ya ha comprado.
 *
 * Devolver `unknown` es un resultado legítimo y frecuente, no un error: llama
 * gente desde el móvil del hijo, desde el trabajo, o gente que no es cliente.
 * El guion del agente sabe qué hacer con cada caso.
 */
export async function resolveCallerByPhone(
  companyId: string,
  rawPhone: string | null | undefined,
): Promise<ResolvedCaller> {
  const phone = toE164(rawPhone);
  const miss: ResolvedCaller = {
    kind: "unknown",
    id: null,
    display_name: null,
    party_kind: null,
    has_active_contract: false,
    phone_e164: phone,
  };
  if (!phone) return miss;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const variants = phoneVariants(phone);
  const cols = "id, party_kind, legal_name, trade_name, first_name, last_name";

  // --- 1) Cliente ---
  const { data: customers } = await admin
    .from("customers")
    .select(cols)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .or(
      variants
        .flatMap((v) => [`phone_primary.eq.${v}`, `phone_secondary.eq.${v}`])
        .join(","),
    )
    .limit(2);

  const cList = (customers ?? []) as PartyRow[];
  const c = cList.length === 1 ? cList[0] : undefined;
  if (c) {
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("customer_id", c.id)
      .eq("status", "active")
      .is("deleted_at", null);
    return {
      kind: "customer",
      id: c.id,
      display_name: displayName(c),
      party_kind: c.party_kind,
      has_active_contract: (count ?? 0) > 0,
      phone_e164: phone,
    };
  }
  // Dos clientes con el mismo teléfono (matrimonio, empresa familiar): no
  // adivinamos. Mejor que el agente trate la llamada como desconocida y
  // pregunte, a que salude a una persona por el nombre de otra.
  if (cList.length > 1) return miss;

  // --- 2) Lead ---
  const { data: leads } = await admin
    .from("leads")
    .select(cols)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .neq("status", "converted")
    .or(
      variants
        .flatMap((v) => [`phone_primary.eq.${v}`, `phone_company.eq.${v}`])
        .join(","),
    )
    .limit(2);

  const lList = (leads ?? []) as PartyRow[];
  const l = lList.length === 1 ? lList[0] : undefined;
  if (l) {
    return {
      kind: "lead",
      id: l.id,
      display_name: displayName(l),
      party_kind: l.party_kind,
      has_active_contract: false,
      phone_e164: phone,
    };
  }

  return miss;
}

export interface EquipmentSummary {
  equipment: Array<{
    name: string;
    serial_number: string | null;
    installed_at: string | null;
    last_maintenance_at: string | null;
    next_maintenance_at: string | null;
  }>;
  next_visit: { date: string; equipment: string } | null;
  last_visit: { date: string } | null;
  has_maintenance_contract: boolean;
}

/**
 * Qué tiene instalado el cliente y cuándo le toca la revisión.
 *
 * Es lo que el agente necesita para responder a la pregunta más común de una
 * llamada entrante ("¿cuándo me toca?") sin escalar a una persona. Devuelve
 * poco y masticado a propósito: cuanto menos texto crudo reciba el modelo,
 * menos se inventa.
 */
export async function getEquipmentSummary(
  companyId: string,
  customerId: string,
): Promise<EquipmentSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [{ data: eq }, { data: jobs }, { count: contracts }] = await Promise.all([
    admin
      .from("customer_equipment")
      .select(
        "id, serial_number, installed_at, is_active, products(name), external_equipment_models(name)",
      )
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .order("installed_at", { ascending: false })
      .limit(20),
    admin
      .from("maintenance_jobs")
      .select("id, status, scheduled_at, completed_at, customer_equipment_id")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .order("scheduled_at", { ascending: true })
      .limit(50),
    admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("status", "active")
      .eq("maintenance_included", true)
      .is("deleted_at", null),
  ]);

  type EqRow = {
    id: string;
    serial_number: string | null;
    installed_at: string | null;
    products: { name: string | null } | null;
    external_equipment_models: { name: string | null } | null;
  };
  type JobRow = {
    status: string;
    scheduled_at: string | null;
    completed_at: string | null;
    customer_equipment_id: string | null;
  };

  const eqRows = (eq ?? []) as EqRow[];
  const jobRows = (jobs ?? []) as JobRow[];
  const now = Date.now();

  const lastByEq = new Map<string, string>();
  const nextByEq = new Map<string, string>();
  let lastVisit: string | null = null;
  let nextVisit: { date: string; equipmentId: string | null } | null = null;

  for (const j of jobRows) {
    if (j.status === "completed" && j.completed_at) {
      if (!lastVisit || j.completed_at > lastVisit) lastVisit = j.completed_at;
      const k = j.customer_equipment_id;
      if (k && (!lastByEq.has(k) || j.completed_at > lastByEq.get(k)!)) {
        lastByEq.set(k, j.completed_at);
      }
    }
    // "Próxima" = programada o preprogramada y todavía en el futuro. Una visita
    // cancelada no cuenta, y una del pasado sin completar tampoco: decirle a un
    // cliente que su próxima visita fue el mes pasado no ayuda a nadie.
    const pending =
      j.scheduled_at &&
      new Date(j.scheduled_at).getTime() > now &&
      ["scheduled", "preprogrammed", "needs_callback", "rescheduled"].includes(j.status);
    if (pending && j.scheduled_at) {
      if (!nextVisit || j.scheduled_at < nextVisit.date) {
        nextVisit = { date: j.scheduled_at, equipmentId: j.customer_equipment_id };
      }
      const k = j.customer_equipment_id;
      if (k && (!nextByEq.has(k) || j.scheduled_at < nextByEq.get(k)!)) {
        nextByEq.set(k, j.scheduled_at);
      }
    }
  }

  const equipment = eqRows.map((e) => ({
    name: e.products?.name ?? e.external_equipment_models?.name ?? "Equipo",
    serial_number: e.serial_number,
    installed_at: e.installed_at,
    last_maintenance_at: lastByEq.get(e.id) ?? null,
    next_maintenance_at: nextByEq.get(e.id) ?? null,
  }));

  return {
    equipment,
    next_visit: nextVisit
      ? {
          date: nextVisit.date,
          equipment:
            eqRows.find((e) => e.id === nextVisit!.equipmentId)?.products?.name ??
            "su equipo",
        }
      : null,
    last_visit: lastVisit ? { date: lastVisit } : null,
    has_maintenance_contract: (contracts ?? 0) > 0,
  };
}

/**
 * Abre una incidencia desde una llamada.
 *
 * No se reutiliza `createIncidentAction` porque empieza con `requireSession()`
 * y aquí no hay usuario: la ha abierto un agente automático. Se inserta con la
 * misma forma que esa acción —mismos campos, mismo `status` inicial— y se deja
 * que el trigger `trg_incidents_ref_code` ponga el `INC-YYYY-NNNN`.
 *
 * `created_by` queda a NULL, que es exactamente la verdad: no la creó ninguna
 * persona. En la ficha se distingue por el `origin` y por el evento del timeline.
 */
export async function createIncidentFromCall(input: {
  companyId: string;
  customerId: string | null;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
}): Promise<{ ok: true; id: string; reference: string | null } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data, error } = await admin
      .from("incidents")
      .insert({
        company_id: input.companyId,
        customer_id: input.customerId,
        origin: "customer_complaint",
        priority: input.priority,
        status: "open",
        title: input.title.slice(0, 200),
        description: input.description.slice(0, 4000),
        created_by: null,
      })
      .select("id, reference_code")
      .single();
    if (error) throw error;
    const row = data as { id: string; reference_code: string | null };
    return { ok: true, id: row.id, reference: row.reference_code };
  } catch (e) {
    console.error("[voice-agent] createIncidentFromCall", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "No se pudo abrir la incidencia",
    };
  }
}

/**
 * Crea un lead desde una llamada.
 *
 * Tampoco se reutiliza `createLeadAction`: recibe `FormData`, aplica rate limit
 * por usuario y termina en un `redirect()`, tres cosas que no tienen sentido
 * en un webhook. Se inserta lo mínimo — nombre, teléfono y notas — con un
 * `origin` propio del agente para poder medirlo aparte.
 *
 * Si el teléfono ya es de un lead vivo, no se duplica: se anota en el que hay.
 * Un comercial que abre el CRM y encuentra tres leads del mismo señor porque
 * llamó tres veces deja de fiarse del sistema.
 */
export async function createLeadFromCall(input: {
  companyId: string;
  phoneE164: string;
  name: string | null;
  notes: string;
  origin: "inbound_call" | "ia_voz";
  partyKind?: "individual" | "company";
}): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const existing = await resolveCallerByPhone(input.companyId, input.phoneE164);
    if (existing.kind === "lead" && existing.id) {
      const stamp = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
      const { data: cur } = await admin
        .from("leads")
        .select("notes")
        .eq("id", existing.id)
        .maybeSingle();
      const prev = (cur as { notes: string | null } | null)?.notes ?? "";
      await admin
        .from("leads")
        .update({
          notes: `${prev}\n\n[Agente de voz · ${stamp}] ${input.notes}`.trim().slice(0, 8000),
        })
        .eq("id", existing.id)
        .eq("company_id", input.companyId);
      return { ok: true, id: existing.id, created: false };
    }

    const partyKind = input.partyKind ?? "individual";
    const name = (input.name ?? "").trim();
    const { data, error } = await admin
      .from("leads")
      .insert({
        company_id: input.companyId,
        party_kind: partyKind,
        // El nombre completo no se sabe partir con fiabilidad desde una
        // transcripción, así que va entero en el campo que corresponda y que
        // lo arregle la persona que lo atienda.
        first_name: partyKind === "individual" ? name || "Sin nombre" : null,
        legal_name: partyKind === "company" ? name || "Sin nombre" : null,
        phone_primary: input.phoneE164,
        origin: input.origin,
        potential: "unknown",
        status: "new",
        notes: input.notes.slice(0, 8000),
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: (data as { id: string }).id, created: true };
  } catch (e) {
    console.error("[voice-agent] createLeadFromCall", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "No se pudo crear el lead",
    };
  }
}

/**
 * Deja rastro en el timeline. Se cuelga del cliente o del lead si se sabe quién
 * es; si no, de la propia empresa — `events.subject_id` es NOT NULL y no hay
 * `subject_type` para "llamada", así que una llamada de un desconocido cuelga
 * de la empresa, que es donde tiene sentido buscarla después.
 */
export async function logVoiceEvent(input: {
  companyId: string;
  kind: string;
  caller: ResolvedCaller;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const subjectType =
      input.caller.kind === "customer"
        ? "customer"
        : input.caller.kind === "lead"
          ? "lead"
          : "company";
    await admin.from("events").insert({
      company_id: input.companyId,
      subject_type: subjectType,
      subject_id: input.caller.id ?? input.companyId,
      kind: input.kind,
      payload: input.payload,
      actor_user_id: null,
    });
  } catch (e) {
    // El timeline es trazabilidad, no funcionalidad: si falla, la llamada sigue.
    console.error("[voice-agent] logVoiceEvent", e);
  }
}
