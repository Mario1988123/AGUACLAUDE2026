/**
 * La puerta. Ninguna llamada del agente de voz sale sin pasar por aquí.
 *
 * Diseño deliberado: `evaluateCallGate` es una función PURA. No toca la base
 * de datos, no lee la hora del sistema, no hace red. Todo lo que necesita
 * entra por parámetro. Así se puede probar de verdad — y una regla que decide
 * si es legal llamar a alguien tiene que estar probada, no supervisada a ojo.
 *
 * El orden de las comprobaciones importa: primero lo que es ilegal, luego lo
 * que es caro, luego lo que es inoportuno. La primera que falla corta.
 *
 * Recordatorio de por qué existe cada bloque:
 *  · B2C_COMMERCIAL  → art. 66.1.b LGTel. Llamada comercial a un particular
 *                      sin consentimiento previo: multas AEPD de 10-40 k€.
 *  · CALLER_ID_*     → Resolución 14-abr-2026 (BOE-A-2026-8409): desde el
 *                      17-oct-2026 las comerciales solo salen del rango 400,
 *                      y el 400 tiene PROHIBIDO usarse para atención al
 *                      cliente. Son dos números distintos, no uno.
 *  · WINDOW          → 9-21 L-V sin festivos para comerciales.
 *  · DNC             → un "no me llaméis" vale para los dos propósitos.
 *  · BUDGET          → un agente en bucle es una factura de cuatro cifras.
 */

export type CallPurpose = "service" | "commercial";
export type PartyKind = "individual" | "company";

/** Fecha en la que el rango 400 pasa a ser obligatorio para las comerciales. */
export const PREFIX_400_MANDATORY_FROM = Date.UTC(2026, 9, 17); // 17-oct-2026

export interface GateSettings {
  service_enabled: boolean;
  commercial_enabled: boolean;
  caller_id_service: string | null;
  caller_id_commercial: string | null;
  service_window_start: number;
  service_window_end: number;
  commercial_window_start: number;
  commercial_window_end: number;
  monthly_minutes_cap: number;
  minutes_used_month: number;
  agent_id_service: string | null;
  agent_id_commercial: string | null;
}

export interface GateTarget {
  purpose: CallPurpose;
  party_kind: PartyKind;
  to_phone_e164: string;
  /** true si el teléfono está en voice_do_not_call de la empresa. */
  on_do_not_call: boolean;
  /** Solo servicio: el cliente revocó el tratamiento de datos (RGPD). */
  data_processing_revoked?: boolean;
  /**
   * Solo comercial: hay consentimiento vigente o interés legítimo documentado.
   * Para B2B (persona jurídica) la base suele ser el interés legítimo del
   * art. 19 LOPDGDD, pero el registro sigue siendo obligatorio.
   */
  commercial_basis?: "consent" | "legitimate_interest" | null;
  /** Solo comercial: fecha del opt-in. Caduca a los 2 años (Circular 1/2023). */
  consent_granted_at?: string | null;
}

export interface GateClock {
  /** Hora de pared en Madrid, 0-23. */
  hour: number;
  /** Día ISO en Madrid: 0=Lunes … 6=Domingo. */
  isoDow: number;
  /** true si ese día es festivo no laborable. */
  isHoliday: boolean;
  /** Instante actual en ms epoch (para la vigencia del 400 y la caducidad). */
  nowMs: number;
}

export type GateDenyCode =
  | "MODULE_DISABLED"
  | "B2C_COMMERCIAL_FORBIDDEN"
  | "NO_CONSENT_BASIS"
  | "CONSENT_EXPIRED"
  | "DO_NOT_CALL"
  | "DATA_PROCESSING_REVOKED"
  | "CALLER_ID_MISSING"
  | "CALLER_ID_400_REQUIRED"
  | "CALLER_ID_400_FORBIDDEN_FOR_SERVICE"
  | "AGENT_NOT_CONFIGURED"
  | "OUTSIDE_WINDOW"
  | "WEEKEND_OR_HOLIDAY"
  | "BUDGET_EXCEEDED"
  | "INVALID_PHONE";

export type GateResult =
  | { allowed: true; from_number: string; agent_id: string }
  | { allowed: false; code: GateDenyCode; reason: string; retryable: boolean };

const E164 = /^\+[1-9]\d{7,14}$/;
/** Rango 400 español: +34 400 XXXXXX (9 dígitos nacionales). */
const SPANISH_400 = /^\+34400\d{6}$/;
const TWO_YEARS_MS = 2 * 365 * 24 * 3600 * 1000;

function deny(code: GateDenyCode, reason: string, retryable = false): GateResult {
  return { allowed: false, code, reason, retryable };
}

/**
 * Decide si esta llamada concreta puede salir ahora mismo.
 *
 * `retryable: true` significa "hoy no, pero vuelve a intentarlo" (fuera de
 * ventana, presupuesto agotado este mes). `false` significa "esta llamada no
 * debe existir": el marcador la cancela en vez de reintentarla.
 */
export function evaluateCallGate(
  target: GateTarget,
  settings: GateSettings,
  clock: GateClock,
): GateResult {
  // ---------------------------------------------------------------- 0. Formato
  if (!E164.test(target.to_phone_e164)) {
    return deny(
      "INVALID_PHONE",
      `El teléfono "${target.to_phone_e164}" no está en formato internacional E.164 (+34…).`,
    );
  }

  // ------------------------------------------- 1. LO ILEGAL, ANTES QUE NADA
  // Un particular NUNCA recibe una llamada comercial de la IA. No hay
  // configuración, plan ni permiso que levante esto: si hiciera falta,
  // se cambia el código a conciencia, no por una casilla de la UI.
  if (target.purpose === "commercial" && target.party_kind !== "company") {
    return deny(
      "B2C_COMMERCIAL_FORBIDDEN",
      "Prohibido: llamada comercial a un particular. El agente comercial solo llama a empresas (personas jurídicas).",
    );
  }

  if (target.on_do_not_call) {
    return deny(
      "DO_NOT_CALL",
      "Este teléfono está en la lista de exclusión de la empresa.",
    );
  }

  if (target.purpose === "service" && target.data_processing_revoked) {
    return deny(
      "DATA_PROCESSING_REVOKED",
      "El cliente revocó el tratamiento de sus datos. No se le puede llamar automáticamente.",
    );
  }

  if (target.purpose === "commercial") {
    if (!target.commercial_basis) {
      return deny(
        "NO_CONSENT_BASIS",
        "Sin consentimiento ni interés legítimo documentado no se puede hacer la llamada comercial (art. 66.1.b LGTel).",
      );
    }
    // El consentimiento caduca a los 2 años (Circular 1/2023 AEPD). El interés
    // legítimo no caduca por plazo, pero sí exige oposición disponible.
    if (target.commercial_basis === "consent") {
      if (!target.consent_granted_at) {
        return deny(
          "NO_CONSENT_BASIS",
          "Consentimiento marcado pero sin fecha registrada: no es prueba válida.",
        );
      }
      const granted = Date.parse(target.consent_granted_at);
      if (!Number.isFinite(granted)) {
        return deny("NO_CONSENT_BASIS", "Fecha de consentimiento ilegible.");
      }
      if (clock.nowMs - granted > TWO_YEARS_MS) {
        return deny(
          "CONSENT_EXPIRED",
          "El consentimiento tiene más de 2 años. Hace falta un opt-in nuevo antes de volver a llamar.",
        );
      }
    }
  }

  // ------------------------------------------------------- 2. Módulo y agente
  const enabled =
    target.purpose === "service"
      ? settings.service_enabled
      : settings.commercial_enabled;
  if (!enabled) {
    return deny(
      "MODULE_DISABLED",
      `El agente de voz de ${target.purpose === "service" ? "servicio" : "captación comercial"} está desactivado para esta empresa.`,
    );
  }

  const agentId =
    target.purpose === "service"
      ? settings.agent_id_service
      : settings.agent_id_commercial;
  if (!agentId) {
    return deny(
      "AGENT_NOT_CONFIGURED",
      "Falta el identificador del agente en la plataforma de voz.",
    );
  }

  // ------------------------------------------------ 3. Numeración: DOS números
  const from =
    target.purpose === "service"
      ? settings.caller_id_service
      : settings.caller_id_commercial;

  if (!from) {
    return deny(
      "CALLER_ID_MISSING",
      target.purpose === "service"
        ? "Falta el número saliente de servicio (geográfico, 800 o 900)."
        : "Falta el número saliente comercial del rango 400. Se pide al operador; la CNMC lo asigna a operadores registrados.",
    );
  }

  if (target.purpose === "service" && SPANISH_400.test(from)) {
    // La resolución es explícita: el 400 no puede usarse para atención al
    // cliente. Una llamada para agendar un mantenimiento es atención al
    // cliente, no marketing.
    return deny(
      "CALLER_ID_400_FORBIDDEN_FOR_SERVICE",
      "El rango 400 está reservado a llamadas comerciales y tiene prohibido usarse para atención al cliente. Configura un número geográfico o 900 para el agente de servicio.",
    );
  }

  if (target.purpose === "commercial" && !SPANISH_400.test(from)) {
    // Antes del 17-oct-2026 se avisa pero se deja pasar; después, se corta:
    // los operadores bloquearán la llamada de todas formas.
    if (clock.nowMs >= PREFIX_400_MANDATORY_FROM) {
      return deny(
        "CALLER_ID_400_REQUIRED",
        "Desde el 17-oct-2026 las llamadas comerciales solo pueden salir del rango 400 (+34 400 XXXXXX). Los operadores bloquean el resto.",
      );
    }
  }

  // ----------------------------------------------------------- 4. Presupuesto
  if (settings.minutes_used_month >= settings.monthly_minutes_cap) {
    return deny(
      "BUDGET_EXCEEDED",
      `Alcanzado el tope de ${settings.monthly_minutes_cap} min/mes (consumidos ${settings.minutes_used_month.toFixed(1)}).`,
      true,
    );
  }

  // -------------------------------------------------------------- 5. Horario
  // Comercial: 9-21 L-V, sin festivos. Es obligación legal.
  // Servicio: no hay obligación, pero llamar a un cliente un domingo a las
  // nueve de la noche es una forma cara de perderlo. Misma regla, por educación.
  if (clock.isoDow > 4) {
    return deny(
      "WEEKEND_OR_HOLIDAY",
      "Fin de semana: no se llama.",
      true,
    );
  }
  if (clock.isHoliday) {
    return deny("WEEKEND_OR_HOLIDAY", "Día festivo: no se llama.", true);
  }

  const [start, end] =
    target.purpose === "service"
      ? [settings.service_window_start, settings.service_window_end]
      : [settings.commercial_window_start, settings.commercial_window_end];

  if (clock.hour < start || clock.hour >= end) {
    return deny(
      "OUTSIDE_WINDOW",
      `Fuera de la ventana de llamada (${start}:00-${end}:00).`,
      true,
    );
  }

  return { allowed: true, from_number: from, agent_id: agentId };
}

// ---------------------------------------------------------------------------
// ENTRANTE
// ---------------------------------------------------------------------------

export type InboundDenyCode =
  | "UNKNOWN_NUMBER"
  | "INBOUND_DISABLED"
  | "AGENT_NOT_CONFIGURED"
  | "BUDGET_EXCEEDED";

export type InboundGateResult =
  | { allowed: true; agent_id: string }
  | { allowed: false; code: InboundDenyCode; reason: string };

export interface InboundGateSettings {
  inbound_enabled: boolean;
  agent_id_inbound: string | null;
  monthly_minutes_cap: number;
  minutes_used_month: number;
}

/**
 * Decide si la recepcionista atiende esta llamada.
 *
 * Mucho más corta que la de salida, y el motivo es jurídico, no de pereza:
 * **aquí ha llamado el cliente**. No hay consentimiento que comprobar (no le
 * estamos contactando), ni ventana horaria (ha marcado él a la hora que ha
 * querido), ni numeración que validar (el 400 ni siquiera admite entrantes).
 * Lo único que sigue aplicando es que cuesta dinero por minuto.
 *
 * Lo que NO decide esta función pero es igual de obligatorio: declarar que es
 * una IA y ofrecer una persona. Eso va en el guion y en el saludo, y se registra
 * en `voice_call_attempts` como prueba.
 *
 * Ojo con el presupuesto agotado: a diferencia de una saliente, aquí no se
 * puede "reintentar mañana". Si no se atiende, el teléfono de la empresa suena
 * y no lo coge nadie — que es peor que la factura. Por eso el caller debe
 * tratar `BUDGET_EXCEEDED` como "pasa la llamada al desvío de siempre", no
 * como "cuelga".
 */
export function evaluateInboundGate(
  settings: InboundGateSettings,
  companyResolved: boolean,
): InboundGateResult {
  if (!companyResolved) {
    return {
      allowed: false,
      code: "UNKNOWN_NUMBER",
      reason:
        "El número marcado no está dado de alta como número de entrada de ninguna empresa.",
    };
  }
  if (!settings.inbound_enabled) {
    return {
      allowed: false,
      code: "INBOUND_DISABLED",
      reason: "La recepcionista IA está desactivada para esta empresa.",
    };
  }
  if (!settings.agent_id_inbound) {
    return {
      allowed: false,
      code: "AGENT_NOT_CONFIGURED",
      reason: "Falta el identificador del agente de entrada en la plataforma de voz.",
    };
  }
  if (settings.minutes_used_month >= settings.monthly_minutes_cap) {
    return {
      allowed: false,
      code: "BUDGET_EXCEEDED",
      reason: `Alcanzado el tope de ${settings.monthly_minutes_cap} min/mes. Desvía la llamada en vez de colgarla.`,
    };
  }
  return { allowed: true, agent_id: settings.agent_id_inbound };
}

/**
 * Normaliza a E.164 español. Devuelve null si no hay forma de interpretarlo:
 * preferimos no llamar a llamar a un número equivocado.
 *
 * Duplica a propósito la lógica de `whatsapp.ts#normalizePhoneE164` en lugar
 * de importarla: aquel módulo es de mensajería y este de telefonía, y un
 * cambio en uno no debe alterar en silencio a quién llama el marcador.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/[\s\-.()]/g, "");
  if (clean.startsWith("+")) return E164.test(clean) ? clean : null;
  if (clean.startsWith("0034")) {
    const c = `+34${clean.slice(4)}`;
    return E164.test(c) ? c : null;
  }
  if (clean.startsWith("34") && clean.length === 11) {
    const c = `+${clean}`;
    return E164.test(c) ? c : null;
  }
  if (/^[6789]\d{8}$/.test(clean)) return `+34${clean}`;
  return null;
}

/**
 * ¿Es un móvil español? Las llamadas de agendado funcionan mucho mejor a móvil
 * que a fijo (el fijo del garaje no lo coge nadie), y el coste por minuto es
 * distinto. Se usa para priorizar la cola, no para bloquear.
 */
export function isSpanishMobile(e164: string): boolean {
  return /^\+34[67]\d{8}$/.test(e164);
}
