import { describe, it, expect } from "vitest";
import {
  evaluateCallGate,
  evaluateInboundGate,
  toE164,
  isSpanishMobile,
  PREFIX_400_MANDATORY_FROM,
  type GateSettings,
  type GateTarget,
  type GateClock,
  type InboundGateSettings,
} from "./guardrails";

const settings = (over: Partial<GateSettings> = {}): GateSettings => ({
  service_enabled: true,
  commercial_enabled: true,
  caller_id_service: "+34911234567",
  caller_id_commercial: "+34400123456",
  service_window_start: 10,
  service_window_end: 20,
  commercial_window_start: 9,
  commercial_window_end: 21,
  monthly_minutes_cap: 500,
  minutes_used_month: 0,
  agent_id_service: "agent_service_1",
  agent_id_commercial: "agent_commercial_1",
  ...over,
});

const serviceTarget = (over: Partial<GateTarget> = {}): GateTarget => ({
  purpose: "service",
  party_kind: "individual",
  to_phone_e164: "+34612345678",
  on_do_not_call: false,
  ...over,
});

const commercialTarget = (over: Partial<GateTarget> = {}): GateTarget => ({
  purpose: "commercial",
  party_kind: "company",
  to_phone_e164: "+34911111111",
  on_do_not_call: false,
  commercial_basis: "legitimate_interest",
  ...over,
});

/** Martes laborable a las 11:00 en Madrid, después del 17-oct-2026. */
const clock = (over: Partial<GateClock> = {}): GateClock => ({
  hour: 11,
  isoDow: 1,
  isHoliday: false,
  nowMs: Date.UTC(2026, 10, 3), // 3-nov-2026
  ...over,
});

describe("evaluateCallGate — la regla que nunca se salta", () => {
  it("BLOQUEA una llamada comercial a un particular", () => {
    const r = evaluateCallGate(
      commercialTarget({ party_kind: "individual" }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("B2C_COMMERCIAL_FORBIDDEN");
      // No es reintentable: esta llamada no debe existir, no es que sea mal momento.
      expect(r.retryable).toBe(false);
    }
  });

  it("la bloquea aunque todo lo demás esté perfectamente configurado", () => {
    const r = evaluateCallGate(
      commercialTarget({
        party_kind: "individual",
        commercial_basis: "consent",
        consent_granted_at: new Date(Date.UTC(2026, 9, 1)).toISOString(),
      }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("B2C_COMMERCIAL_FORBIDDEN");
  });

  it("PERMITE la llamada de servicio a un particular (es su contrato, no marketing)", () => {
    const r = evaluateCallGate(serviceTarget(), settings(), clock());
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.from_number).toBe("+34911234567");
  });
});

describe("numeración: son dos números distintos, no uno", () => {
  it("rechaza usar el rango 400 para una llamada de servicio", () => {
    const r = evaluateCallGate(
      serviceTarget(),
      settings({ caller_id_service: "+34400123456" }),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("CALLER_ID_400_FORBIDDEN_FOR_SERVICE");
  });

  it("exige el rango 400 en comercial a partir del 17-oct-2026", () => {
    const r = evaluateCallGate(
      commercialTarget(),
      settings({ caller_id_commercial: "+34911234567" }),
      clock({ nowMs: PREFIX_400_MANDATORY_FROM }),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("CALLER_ID_400_REQUIRED");
  });

  it("antes del 17-oct-2026 deja pasar un número comercial que no es 400", () => {
    const r = evaluateCallGate(
      commercialTarget(),
      settings({ caller_id_commercial: "+34911234567" }),
      clock({ nowMs: PREFIX_400_MANDATORY_FROM - 86_400_000 }),
    );
    expect(r.allowed).toBe(true);
  });

  it("acepta un 400 bien formado en comercial", () => {
    const r = evaluateCallGate(commercialTarget(), settings(), clock());
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.from_number).toBe("+34400123456");
  });
});

describe("consentimiento comercial", () => {
  it("bloquea sin base legal", () => {
    const r = evaluateCallGate(
      commercialTarget({ commercial_basis: null }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("NO_CONSENT_BASIS");
  });

  it("caduca el consentimiento a los 2 años", () => {
    const r = evaluateCallGate(
      commercialTarget({
        commercial_basis: "consent",
        consent_granted_at: new Date(Date.UTC(2023, 0, 1)).toISOString(),
      }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("CONSENT_EXPIRED");
  });

  it("acepta un consentimiento reciente", () => {
    const r = evaluateCallGate(
      commercialTarget({
        commercial_basis: "consent",
        consent_granted_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(true);
  });

  it("el interés legítimo no caduca por plazo", () => {
    const r = evaluateCallGate(
      commercialTarget({
        commercial_basis: "legitimate_interest",
        consent_granted_at: null,
      }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(true);
  });
});

describe("exclusión y RGPD", () => {
  it("la lista de exclusión corta también las llamadas de servicio", () => {
    const r = evaluateCallGate(
      serviceTarget({ on_do_not_call: true }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("DO_NOT_CALL");
      expect(r.retryable).toBe(false);
    }
  });

  it("bloquea si el cliente revocó el tratamiento de datos", () => {
    const r = evaluateCallGate(
      serviceTarget({ data_processing_revoked: true }),
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("DATA_PROCESSING_REVOKED");
  });
});

describe("horario y presupuesto — reintentables, no definitivos", () => {
  it("no llama los sábados", () => {
    const r = evaluateCallGate(serviceTarget(), settings(), clock({ isoDow: 5 }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("WEEKEND_OR_HOLIDAY");
      expect(r.retryable).toBe(true);
    }
  });

  it("no llama en festivo", () => {
    const r = evaluateCallGate(serviceTarget(), settings(), clock({ isHoliday: true }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("WEEKEND_OR_HOLIDAY");
  });

  it("respeta la ventana de servicio (10-20)", () => {
    expect(evaluateCallGate(serviceTarget(), settings(), clock({ hour: 9 })).allowed).toBe(false);
    expect(evaluateCallGate(serviceTarget(), settings(), clock({ hour: 10 })).allowed).toBe(true);
    expect(evaluateCallGate(serviceTarget(), settings(), clock({ hour: 19 })).allowed).toBe(true);
    expect(evaluateCallGate(serviceTarget(), settings(), clock({ hour: 20 })).allowed).toBe(false);
  });

  it("respeta la ventana legal comercial (9-21)", () => {
    expect(evaluateCallGate(commercialTarget(), settings(), clock({ hour: 8 })).allowed).toBe(false);
    expect(evaluateCallGate(commercialTarget(), settings(), clock({ hour: 9 })).allowed).toBe(true);
    expect(evaluateCallGate(commercialTarget(), settings(), clock({ hour: 21 })).allowed).toBe(false);
  });

  it("corta al alcanzar el tope de minutos, y es reintentable el mes siguiente", () => {
    const r = evaluateCallGate(
      serviceTarget(),
      settings({ monthly_minutes_cap: 100, minutes_used_month: 100 }),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("BUDGET_EXCEEDED");
      expect(r.retryable).toBe(true);
    }
  });
});

describe("activación por propósito", () => {
  it("se puede tener el de servicio encendido y el comercial apagado", () => {
    const s = settings({ service_enabled: true, commercial_enabled: false });
    expect(evaluateCallGate(serviceTarget(), s, clock()).allowed).toBe(true);
    const r = evaluateCallGate(commercialTarget(), s, clock());
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("MODULE_DISABLED");
  });

  it("exige agente configurado en la plataforma", () => {
    const r = evaluateCallGate(
      serviceTarget(),
      settings({ agent_id_service: null }),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("AGENT_NOT_CONFIGURED");
  });
});

describe("toE164", () => {
  it("normaliza los formatos que la gente escribe de verdad", () => {
    expect(toE164("612 34 56 78")).toBe("+34612345678");
    expect(toE164("+34 612-345-678")).toBe("+34612345678");
    expect(toE164("0034612345678")).toBe("+34612345678");
    expect(toE164("34612345678")).toBe("+34612345678");
    expect(toE164("911234567")).toBe("+34911234567");
  });

  it("devuelve null antes que inventarse un número", () => {
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("12345")).toBeNull();
    expect(toE164("no es un teléfono")).toBeNull();
    expect(toE164("+34")).toBeNull();
  });

  it("un número mal formado nunca llega al marcador", () => {
    const r = evaluateCallGate(
      serviceTarget({ to_phone_e164: "612345678" }), // sin prefijo
      settings(),
      clock(),
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("INVALID_PHONE");
  });
});

describe("isSpanishMobile", () => {
  it("distingue móvil de fijo", () => {
    expect(isSpanishMobile("+34612345678")).toBe(true);
    expect(isSpanishMobile("+34712345678")).toBe(true);
    expect(isSpanishMobile("+34911234567")).toBe(false);
    expect(isSpanishMobile("+33612345678")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ENTRANTE
// ---------------------------------------------------------------------------

const inbound = (over: Partial<InboundGateSettings> = {}): InboundGateSettings => ({
  inbound_enabled: true,
  agent_id_inbound: "agent_inbound_1",
  monthly_minutes_cap: 500,
  minutes_used_month: 0,
  ...over,
});

describe("evaluateInboundGate — quien llama es él, no nosotros", () => {
  it("atiende una llamada normal", () => {
    const r = evaluateInboundGate(inbound(), true);
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.agent_id).toBe("agent_inbound_1");
  });

  it("rechaza un número que no está dado de alta", () => {
    const r = evaluateInboundGate(inbound(), false);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("UNKNOWN_NUMBER");
  });

  it("respeta el interruptor de la empresa", () => {
    const r = evaluateInboundGate(inbound({ inbound_enabled: false }), true);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("INBOUND_DISABLED");
  });

  it("exige agente configurado", () => {
    const r = evaluateInboundGate(inbound({ agent_id_inbound: null }), true);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("AGENT_NOT_CONFIGURED");
  });

  it("corta al agotar el presupuesto, y lo dice como desvío, no como cuelgue", () => {
    const r = evaluateInboundGate(
      inbound({ monthly_minutes_cap: 60, minutes_used_month: 60 }),
      true,
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("BUDGET_EXCEEDED");
      expect(r.reason).toMatch(/desv[íi]a/i);
    }
  });

  it("NO comprueba horario: una entrante a las 3 de la madrugada se atiende", () => {
    // Es la diferencia de fondo con la saliente. No hay reloj en la firma.
    const r = evaluateInboundGate(inbound(), true);
    expect(r.allowed).toBe(true);
  });
});
