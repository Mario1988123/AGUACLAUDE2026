import { describe, it, expect } from "vitest";
import {
  buildServicePrompt,
  buildCommercialPrompt,
  buildInboundPrompt,
  buildFirstMessage,
  buildInboundGreeting,
  toolsForRole,
  inboundToolsFor,
  agentRole,
  SERVICE_TOOLS,
  COMMERCIAL_TOOLS,
  INBOUND_TOOLS,
} from "./prompts";

const base = {
  company_name: "Aguas del Sur",
  company_pitch: null,
  forbidden_topics: null,
  can_transfer: false,
};

const inboundBase = {
  ...base,
  can_book: true,
  can_open_incident: true,
  transfer_enabled: false,
};

/**
 * Estas dos frases son obligaciones legales, no decisiones de producto: la
 * declaración de IA es el art. 50 del Reglamento Europeo de IA y la salida a
 * persona es la Ley 10/2025. Si alguien las quita de un guion, quiero que se
 * entere aquí y no en una inspección.
 */
describe("las frases que no pueden desaparecer de ningún guion", () => {
  const guiones: Array<[string, string]> = [
    ["servicio", buildServicePrompt(base)],
    ["comercial", buildCommercialPrompt(base)],
    ["entrante", buildInboundPrompt(inboundBase)],
  ];

  for (const [nombre, guion] of guiones) {
    it(`el guion de ${nombre} obliga a declararse como IA`, () => {
      expect(guion).toMatch(/inteligencia artificial/i);
      expect(guion).toMatch(/sistema autom[áa]tico/i);
    });

    it(`el guion de ${nombre} obliga a ofrecer una persona`, () => {
      expect(guion).toMatch(/hablar con una persona/i);
      expect(guion).toMatch(/escalar_humano/);
    });

    it(`el guion de ${nombre} prohíbe dar precios`, () => {
      expect(guion).toMatch(/precio/i);
    });
  }
});

describe("los saludos llevan la declaración incrustada", () => {
  it("saliente de servicio", () => {
    const m = buildFirstMessage("service", "Aguas del Sur", "María");
    expect(m).toMatch(/inteligencia artificial/i);
    expect(m).toMatch(/persona/i);
    expect(m).toContain("María");
  });

  it("saliente comercial declara además el motivo comercial", () => {
    const m = buildFirstMessage("commercial", "Aguas del Sur");
    expect(m).toMatch(/inteligencia artificial/i);
    expect(m).toMatch(/comercial/i);
  });

  it("entrante", () => {
    const m = buildInboundGreeting("Aguas del Sur");
    expect(m).toMatch(/inteligencia artificial/i);
    expect(m).toMatch(/persona/i);
    expect(m).toContain("Aguas del Sur");
  });

  it("usa un solo tratamiento: usted, sin mezclar con vosotros", () => {
    const m = buildInboundGreeting("Aguas del Sur");
    expect(m).not.toMatch(/prefer[íi]s|dec[íi]dme|ten[ée]is/i);
  });
});

describe("el guardarraíl anti-venta del agente de mantenimientos", () => {
  const guion = buildServicePrompt(base);

  it("le prohíbe ofrecer productos", () => {
    expect(guion).toMatch(/No ofreces productos/i);
  });

  it("le dice qué hacer cuando el cliente pregunta: crear lead y devolver el tema", () => {
    expect(guion).toContain("crear_lead");
    expect(guion).toMatch(/Vuelve al tema de la cita/i);
  });

  it("explica POR QUÉ, que es lo que evita que alguien lo relaje", () => {
    expect(guion).toMatch(/llamada comercial/i);
  });
});

describe("el agente comercial se niega si acaba hablando con un particular", () => {
  const guion = buildCommercialPrompt(base);

  it("solo llama a empresas", () => {
    expect(guion).toMatch(/personas jur[íi]dicas/i);
  });

  it("cuelga si resulta ser un domicilio", () => {
    expect(guion).toContain("marcar_numero_erroneo");
    expect(guion).toMatch(/domicilio/i);
  });

  it("no insiste ante un no", () => {
    expect(guion).toMatch(/Un "no" es un no/i);
  });
});

describe("la recepcionista y el trato de datos ajenos", () => {
  it("identifica antes de contar nada", () => {
    const g = buildInboundPrompt(inboundBase);
    expect(g).toContain("identificar_contacto");
    expect(g).toMatch(/Nunca leas en voz alta un dato/i);
  });

  it("no confirma si alguien es cliente a quien llama desde otro número", () => {
    const g = buildInboundPrompt(inboundBase);
    expect(g).toMatch(/dato personal/i);
  });

  it("manda facturas y bajas directamente a una persona", () => {
    const g = buildInboundPrompt(inboundBase);
    expect(g).toMatch(/Factura, recibo/i);
    expect(g).toMatch(/darse de baja/i);
  });

  it("no promete transferir si la empresa no puede transferir", () => {
    const sinTransfer = buildInboundPrompt({ ...inboundBase, transfer_enabled: false });
    expect(sinTransfer).toMatch(/No puedes transferir/i);
    expect(sinTransfer).toMatch(/No digas "le paso" si no puedes/i);

    const conTransfer = buildInboundPrompt({
      ...inboundBase,
      transfer_enabled: true,
      can_transfer: true,
    });
    expect(conTransfer).toMatch(/Puedes pasar la llamada/i);
  });

  it("cambia el guion si la empresa le quita agendar o abrir incidencias", () => {
    const limitada = buildInboundPrompt({
      ...inboundBase,
      can_book: false,
      can_open_incident: false,
    });
    expect(limitada).toMatch(/las citas las cierra una\s+persona/i);
    expect(limitada).toMatch(/apertura de\s+incidencias está desactivada/i);
  });
});

describe("los textos de la empresa no pueden pisar lo obligatorio", () => {
  it("el contexto de empresa se añade DESPUÉS del bloque legal", () => {
    const g = buildServicePrompt({
      ...base,
      company_pitch: "Somos los mejores y regalamos descalcificadores.",
    });
    const posLegal = g.indexOf("inteligencia artificial");
    const posPitch = g.indexOf("Somos los mejores");
    expect(posLegal).toBeGreaterThanOrEqual(0);
    expect(posPitch).toBeGreaterThan(posLegal);
  });

  it("los temas vetados de la empresa se suman, no sustituyen", () => {
    const g = buildInboundPrompt({
      ...inboundBase,
      forbidden_topics: "No hablar de la competencia.",
    });
    expect(g).toMatch(/inteligencia artificial/i);
    expect(g).toContain("No hablar de la competencia.");
  });
});

describe("cada papel tiene sus herramientas y solo las suyas", () => {
  it("el comercial no puede tocar mantenimientos", () => {
    expect(COMMERCIAL_TOOLS).not.toContain("confirmar_mantenimiento");
    expect(COMMERCIAL_TOOLS).not.toContain("huecos_mantenimiento");
    expect(COMMERCIAL_TOOLS).not.toContain("crear_incidencia");
  });

  it("el de servicio no tiene herramientas comerciales", () => {
    expect(SERVICE_TOOLS).not.toContain("posponer_llamada");
    expect(SERVICE_TOOLS).not.toContain("marcar_no_interesado");
  });

  it("la recepcionista no tiene nada de campañas salientes", () => {
    expect(INBOUND_TOOLS).not.toContain("posponer_llamada");
    expect(INBOUND_TOOLS).not.toContain("marcar_no_interesado");
    expect(INBOUND_TOOLS).not.toContain("posponer_mantenimiento");
  });

  it("ningún papel puede tocar facturación", () => {
    const todas = [...SERVICE_TOOLS, ...COMMERCIAL_TOOLS, ...INBOUND_TOOLS];
    for (const t of todas) {
      expect(t).not.toMatch(/factur|cobr|pag|precio|descuento/i);
    }
  });

  it("los tres pueden escalar a una persona y anotar un no-llamar", () => {
    for (const set of [SERVICE_TOOLS, COMMERCIAL_TOOLS, INBOUND_TOOLS]) {
      expect(set).toContain("escalar_humano");
      expect(set).toContain("no_llamar_mas");
    }
  });
});

describe("agentRole y toolsForRole", () => {
  it("una entrante siempre es recepcionista, aunque el propósito sea servicio", () => {
    expect(agentRole("service", "inbound")).toBe("inbound");
    expect(agentRole("commercial", "inbound")).toBe("inbound");
  });

  it("una saliente depende del propósito", () => {
    expect(agentRole("service", "outbound")).toBe("service_outbound");
    expect(agentRole("commercial", "outbound")).toBe("commercial_outbound");
  });

  it("devuelve el juego correcto para cada papel", () => {
    expect(toolsForRole("service_outbound")).toBe(SERVICE_TOOLS);
    expect(toolsForRole("commercial_outbound")).toBe(COMMERCIAL_TOOLS);
    expect(toolsForRole("inbound")).toBe(INBOUND_TOOLS);
  });
});

describe("inboundToolsFor recorta lo que la empresa apaga", () => {
  it("sin agendar, quita las dos herramientas de cita", () => {
    const t = inboundToolsFor({ can_book: false, can_open_incident: true });
    expect(t).not.toContain("huecos_mantenimiento");
    expect(t).not.toContain("confirmar_mantenimiento");
    expect(t).toContain("crear_incidencia");
  });

  it("sin incidencias, quita solo esa", () => {
    const t = inboundToolsFor({ can_book: true, can_open_incident: false });
    expect(t).not.toContain("crear_incidencia");
    expect(t).toContain("huecos_mantenimiento");
  });

  it("aunque se apague todo, sigue pudiendo escalar a una persona", () => {
    const t = inboundToolsFor({ can_book: false, can_open_incident: false });
    expect(t).toContain("escalar_humano");
    expect(t).toContain("identificar_contacto");
  });
});
