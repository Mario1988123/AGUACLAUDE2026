import { describe, expect, it } from "vitest";
import {
  analizarPlantilla,
  cargaBoton,
  clasificarRespuesta,
  cuerpoCreacionPlantilla,
  errorCortaTanda,
  esBajaPorTexto,
  estadosEnvioAnteriores,
  horaMadrid,
  leerCargaBoton,
  leerEscalado,
  leerHorario,
  minutosRestantesHorario,
  parametroNombre,
  plantillaSirveParaBandeja,
  plantillaSirveParaCaptacion,
  presupuestoEmpresa,
  PROPUESTA_INFINITY,
  renderizarCuerpo,
  topeCampanaHoy,
  trozoDePasada,
  validarPlantillaNueva,
  componentesEnvioDocumento,
  cuerpoCreacionPlantillaDocumento,
  plantillaSirveParaDocumento,
  PROPUESTA_DOCUMENTO,
  validarPlantillaDocumento,
} from "./envios-logica";

const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("fase 8: plantilla con cabecera DOCUMENT", () => {
  it("la propuesta pasa la validación y arma el cuerpo de creación", () => {
    expect(validarPlantillaDocumento(PROPUESTA_DOCUMENTO)).toEqual({ ok: true });
    expect(validarPlantillaDocumento({ ...PROPUESTA_DOCUMENTO, categoria: "authentication" as never }).ok).toBe(false);
    const c = cuerpoCreacionPlantillaDocumento(PROPUESTA_DOCUMENTO, "4::aW-ejemplo");
    expect(c.category).toBe("UTILITY");
    expect(cuerpoCreacionPlantillaDocumento({ ...PROPUESTA_DOCUMENTO, categoria: "marketing" }, "h").category).toBe("MARKETING");
    expect(c.components[0]).toEqual({ type: "HEADER", format: "DOCUMENT", example: { header_handle: ["4::aW-ejemplo"] } });
    expect(c.components[1]).toMatchObject({ type: "BODY", example: { body_text: [["Cafetería Es Born"]] } });
    expect(c.components.find((x) => x.type === "BUTTONS")).toBeUndefined();
  });
  it("la creada sirve para documento y no para captación ni bandeja", () => {
    const a = analizarPlantilla(cuerpoCreacionPlantillaDocumento(PROPUESTA_DOCUMENTO, "h").components);
    expect(a.formatoCabecera).toBe("DOCUMENT");
    expect(plantillaSirveParaDocumento(a)).toEqual({ ok: true });
    expect(plantillaSirveParaCaptacion(a).ok).toBe(false);
    expect(plantillaSirveParaBandeja(a)).toBe(false);
  });
  it("no sirven para documento: sin cabecera, con imagen o con dos variables", () => {
    expect(plantillaSirveParaDocumento(analizarPlantilla([{ type: "BODY", text: "Hola {{1}}." }])).ok).toBe(false);
    expect(analizarPlantilla([{ type: "BODY", text: "x" }]).formatoCabecera).toBeNull();
    expect(plantillaSirveParaDocumento(analizarPlantilla([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola {{1}}." }])).ok).toBe(false);
    expect(
      plantillaSirveParaDocumento(analizarPlantilla([{ type: "HEADER", format: "document" }, { type: "BODY", text: "Hola {{1}}, {{2}}." }])).ok,
    ).toBe(false);
  });
  it("componentes del envío: cabecera document con id (o enlace) y nombre de fichero", () => {
    expect(componentesEnvioDocumento({ documento: { mediaId: "123", nombreFichero: "p.pdf" }, parametroCuerpo: "Bar Uno" })).toEqual([
      { type: "header", parameters: [{ type: "document", document: { id: "123", filename: "p.pdf" } }] },
      { type: "body", parameters: [{ type: "text", text: "Bar Uno" }] },
    ]);
    expect(componentesEnvioDocumento({ documento: { link: "https://x/p.pdf", nombreFichero: "p.pdf" }, parametroCuerpo: null })).toEqual([
      { type: "header", parameters: [{ type: "document", document: { link: "https://x/p.pdf", filename: "p.pdf" } }] },
    ]);
    expect(() => componentesEnvioDocumento({ documento: { nombreFichero: "p.pdf" }, parametroCuerpo: null })).toThrow();
  });
});

describe("propuesta de Infinity Aqua", () => {
  it("las dos plantillas propuestas pasan la validación", () => {
    expect(validarPlantillaNueva(PROPUESTA_INFINITY.primer_contacto)).toEqual({ ok: true });
    expect(validarPlantillaNueva(PROPUESTA_INFINITY.recordatorio)).toEqual({ ok: true });
  });
  it("y sirven para captación tal como se mandan a Meta", () => {
    const c = cuerpoCreacionPlantilla(PROPUESTA_INFINITY.primer_contacto);
    expect(plantillaSirveParaCaptacion(analizarPlantilla(c.components))).toEqual({ ok: true });
  });
});

describe("validarPlantillaNueva", () => {
  const base = { nombre: "prueba_v1", cuerpo: "Hola, {{1}}. ¿Te interesa?", pie: null, ejemplo: "Bar Pepe" };
  it("rechaza nombres con mayúsculas o espacios", () => {
    expect(validarPlantillaNueva({ ...base, nombre: "Prueba 1" }).ok).toBe(false);
  });
  it("exige {{1}} una vez y ninguna otra variable", () => {
    expect(validarPlantillaNueva({ ...base, cuerpo: "Hola, ¿te interesa?" }).ok).toBe(false);
    expect(validarPlantillaNueva({ ...base, cuerpo: "Hola {{1}}, {{2}}, ¿sí?" }).ok).toBe(false);
  });
  it("no deja empezar ni acabar con la variable", () => {
    expect(validarPlantillaNueva({ ...base, cuerpo: "{{1}}, ¿te interesa?" }).ok).toBe(false);
    expect(validarPlantillaNueva({ ...base, cuerpo: "¿Te interesa, {{1}}?" }).ok).toBe(false);
  });
  it("limita el pie a 60 caracteres", () => {
    expect(validarPlantillaNueva({ ...base, pie: "x".repeat(61) }).ok).toBe(false);
  });
});

describe("cuerpoCreacionPlantilla", () => {
  it("monta MARKETING, es, ejemplo del cuerpo y los dos botones en orden", () => {
    const c = cuerpoCreacionPlantilla({ nombre: "p_v1", cuerpo: " Hola, {{1}}. ¿Sí? ", pie: "Pie", ejemplo: "Bar Pepe" });
    expect(c).toEqual({
      name: "p_v1",
      language: "es",
      category: "MARKETING",
      parameter_format: "POSITIONAL",
      components: [
        { type: "BODY", text: "Hola, {{1}}. ¿Sí?", example: { body_text: [["Bar Pepe"]] } },
        { type: "FOOTER", text: "Pie" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Sí, cuéntame" },
            { type: "QUICK_REPLY", text: "No, gracias" },
          ],
        },
      ],
    });
  });
});

describe("analizarPlantilla", () => {
  it("encuentra el Sí y el No aunque vengan en otro orden o sin tilde", () => {
    const a = analizarPlantilla([
      { type: "BODY", text: "Hola {{1}}, ¿hablamos?" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "No me interesa" }, { type: "QUICK_REPLY", text: "Si, claro" }] },
    ]);
    expect(a.botones).toEqual({ si: 1, no: 0 });
    expect(a.variablesCuerpo).toBe(1);
    expect(plantillaSirveParaCaptacion(a)).toEqual({ ok: true });
  });
  it("sin botones no sirve para captación, pero sí para la bandeja", () => {
    const a = analizarPlantilla([{ type: "BODY", text: "Hola {{1}}, seguimos aquí." }]);
    expect(plantillaSirveParaCaptacion(a).ok).toBe(false);
    expect(plantillaSirveParaBandeja(a)).toBe(true);
  });
  it("cabecera con imagen o dos variables: no se sabe rellenar", () => {
    const img = analizarPlantilla([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola {{1}}" }]);
    expect(plantillaSirveParaBandeja(img)).toBe(false);
    const dos = analizarPlantilla([{ type: "BODY", text: "Hola {{1}}, tu pedido {{2}}" }]);
    expect(plantillaSirveParaBandeja(dos)).toBe(false);
  });
  it("componentes vacíos o raros no rompen", () => {
    expect(analizarPlantilla(null).cuerpo).toBeNull();
    expect(analizarPlantilla("x").botones).toBeNull();
  });
});

describe("renderizarCuerpo y parametroNombre", () => {
  it("sustituye la variable por el nombre", () => {
    expect(renderizarCuerpo("Hola, {{1}}.", "Bar Pepe")).toBe("Hola, Bar Pepe.");
  });
  it("limpia saltos de línea y no deja el parámetro vacío", () => {
    expect(parametroNombre("Bar\nPepe\t ")).toBe("Bar Pepe");
    expect(parametroNombre("  ")).toBe("hola");
  });
});

describe("cargas de botones", () => {
  it("ida y vuelta", () => {
    expect(cargaBoton("si", ID)).toBe(`SI:${ID}`);
    expect(cargaBoton("ahora_no", ID)).toBe(`AHORA_NO:${ID}`);
    expect(leerCargaBoton(`NO:${ID}`)).toEqual({ accion: "no", id: ID });
    expect(leerCargaBoton(`LLAMAR:${ID.toUpperCase()}`)).toEqual({ accion: "llamar", id: ID });
  });
  it("rechaza cargas ajenas", () => {
    expect(leerCargaBoton("No, gracias")).toBeNull();
    expect(leerCargaBoton("SI:123")).toBeNull();
    expect(leerCargaBoton(`OTRA:${ID}`)).toBeNull();
    expect(leerCargaBoton(null)).toBeNull();
  });
});

describe("esBajaPorTexto", () => {
  it.each([
    "Baja",
    "BAJA por favor",
    "Quiero darme de baja",
    "no me escribas más",
    "No me interesa, gracias",
    "no nos interesa",
    "STOP",
    "Borra mi número",
    "bórrame de la lista",
    "Os voy a denunciar",
    "esto es spam",
    "No",
    "No, gracias",
    "no gracias!",
    "No necesito nada",
    "Dejadme en paz",
  ])("«%s» es baja", (t) => {
    expect(esBajaPorTexto(t)).toBe(true);
  });
  it.each([
    "Hola, ¿cuánto cuesta?",
    "Sí, cuéntame más",
    "¿Tenéis dispensadores de agua fría?",
    "Ahora no puedo, llamadme mañana",
    "Nosotros ya tenemos uno",
    "",
  ])("«%s» no es baja", (t) => {
    expect(esBajaPorTexto(t)).toBe(false);
  });
});

describe("clasificarRespuesta", () => {
  it("el botón manda por su carga, no por su texto", () => {
    expect(clasificarRespuesta({ tipo: "boton", cuerpo: "Sí, cuéntame", payloadBoton: `NO:${ID}` })).toEqual({
      clase: "boton",
      accion: "no",
      id: ID,
    });
  });
  it("un botón sin nuestra carga cae a texto (o a baja si lo es)", () => {
    expect(clasificarRespuesta({ tipo: "boton", cuerpo: "Sí, cuéntame", payloadBoton: "Sí, cuéntame" })).toEqual({ clase: "texto" });
    expect(clasificarRespuesta({ tipo: "boton", cuerpo: "No, gracias", payloadBoton: "No, gracias" })).toEqual({ clase: "baja" });
  });
  it("texto: baja antes que nada", () => {
    expect(clasificarRespuesta({ tipo: "texto", cuerpo: "no me escribáis", payloadBoton: null })).toEqual({ clase: "baja" });
    expect(clasificarRespuesta({ tipo: "texto", cuerpo: "¿Y el precio?", payloadBoton: null })).toEqual({ clase: "texto" });
  });
  it("audio, imagen… son otro", () => {
    expect(clasificarRespuesta({ tipo: "audio", cuerpo: null, payloadBoton: null })).toEqual({ clase: "otro" });
  });
});

describe("horario", () => {
  it("lee el horario o usa el de por defecto si no cuadra", () => {
    expect(leerHorario({ dias: [1, 2], desde: "09:00", hasta: "14:00" })).toEqual({ dias: [1, 2], desde: "09:00", hasta: "14:00" });
    expect(leerHorario({ dias: [1], desde: "18:00", hasta: "10:00" }).desde).toBe("10:00");
    expect(leerHorario(null).dias).toEqual([1, 2, 3, 4, 5]);
  });
  it("hora de Madrid con horario de invierno (UTC+1)", () => {
    // Viernes 27-11-2026 10:30 UTC = 11:30 en Madrid.
    expect(horaMadrid(new Date("2026-11-27T10:30:00Z"))).toEqual({ dia: 5, minuto: 11 * 60 + 30 });
  });
  it("minutos que quedan de ventana", () => {
    const h = { dias: [1, 2, 3, 4, 5], desde: "10:00", hasta: "19:00" };
    expect(minutosRestantesHorario(h, new Date("2026-11-27T10:30:00Z"))).toBe(7 * 60 + 30);
    expect(minutosRestantesHorario(h, new Date("2026-11-27T08:30:00Z"))).toBe(0); // 9:30, antes de abrir
    expect(minutosRestantesHorario(h, new Date("2026-11-28T11:00:00Z"))).toBe(0); // sábado
  });
});

describe("topes", () => {
  const esc = leerEscalado([{ dias: 3, tope: 50 }, { dias: 3, tope: 100 }]);
  it("escalado 50 → 100 → tope de la campaña", () => {
    expect(topeCampanaHoy(esc, 200, 0)).toBe(50);
    expect(topeCampanaHoy(esc, 200, 2)).toBe(50);
    expect(topeCampanaHoy(esc, 200, 3)).toBe(100);
    expect(topeCampanaHoy(esc, 200, 6)).toBe(200);
    expect(topeCampanaHoy(esc, 30, 0)).toBe(30);
    expect(topeCampanaHoy([], 3, 0)).toBe(3);
  });
  it("presupuesto de la empresa: mínimo de Meta − margen y 200, menos lo enviado", () => {
    expect(presupuestoEmpresa(250, 25, 0)).toBe(200);
    expect(presupuestoEmpresa(250, 25, 190)).toBe(10);
    expect(presupuestoEmpresa(250, 100, 0)).toBe(150);
    expect(presupuestoEmpresa(250, 25, 300)).toBe(0);
    expect(presupuestoEmpresa(2000, 25, 0)).toBe(200);
  });
  it("trozo de pasada: reparte y no pasa de 25", () => {
    expect(trozoDePasada(200, 9 * 60)).toBe(4);
    expect(trozoDePasada(200, 10)).toBe(25);
    expect(trozoDePasada(3, 600)).toBe(1);
    expect(trozoDePasada(0, 600)).toBe(0);
    expect(trozoDePasada(10, 0)).toBe(0);
  });
});

describe("errores y estados", () => {
  it("los límites y la cuenta restringida cortan la tanda; el número sin WhatsApp, no", () => {
    expect(errorCortaTanda(131048)).toBe(true);
    expect(errorCortaTanda(368)).toBe(true);
    expect(errorCortaTanda(131026)).toBe(false);
    expect(errorCortaTanda(null)).toBe(false);
  });
  it("estados solo hacia delante", () => {
    expect(estadosEnvioAnteriores("entregado")).toEqual(["enviado"]);
    expect(estadosEnvioAnteriores("leido")).toEqual(["enviado", "entregado"]);
    expect(estadosEnvioAnteriores("fallido")).not.toContain("leido");
  });
});
