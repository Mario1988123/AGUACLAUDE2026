import { describe, expect, it } from "vitest";
import {
  contenidoDe,
  estadosAnteriores,
  extraerContactosApp,
  extraerEcos,
  extraerEntrantes,
  extraerEstados,
  extraerHistorial,
  fechaMeta,
  validarTextoSaliente,
  ventanaAbierta,
  waIdValido,
} from "./bandeja-logica";

const AHORA = new Date("2026-11-27T10:00:00Z");

describe("extraerEntrantes", () => {
  it("texto con contacto (nombre de perfil, BSUID y teléfono)", () => {
    const r = extraerEntrantes(
      {
        contacts: [{ wa_id: "34600111222", user_id: "ES.abc123", profile: { name: "Bar Pepe" } }],
        messages: [
          { from: "34600111222", from_user_id: "ES.abc123", id: "wamid.1", timestamp: "1764237600", type: "text", text: { body: "Hola" } },
        ],
      },
      AHORA,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      wamid: "wamid.1",
      direccion: "entrante",
      origen: "api",
      autor: "contacto",
      tipo: "texto",
      cuerpo: "Hola",
      estado: "recibido",
      contacto: { waId: "34600111222", bsuid: "ES.abc123", nombre: "Bar Pepe" },
    });
    expect(r[0]!.metaAt).toBe(new Date(1764237600 * 1000).toISOString());
  });

  it("usuario con nombre de usuario: sin from, solo from_user_id", () => {
    const r = extraerEntrantes({
      contacts: [{ user_id: "ES.xyz", profile: { name: "Ana" } }],
      messages: [{ from_user_id: "ES.xyz", id: "wamid.2", timestamp: "1", type: "text", text: { body: "Hey" } }],
    });
    expect(r[0]!.contacto).toEqual({ waId: null, bsuid: "ES.xyz", nombre: "Ana" });
  });

  it("descarta lo que no trae ni teléfono ni BSUID, o no trae id", () => {
    expect(extraerEntrantes({ messages: [{ id: "w", type: "text", text: { body: "x" } }] })).toEqual([]);
    expect(extraerEntrantes({ messages: [{ from: "34600111222", type: "text" }] })).toEqual([]);
    expect(extraerEntrantes(null)).toEqual([]);
  });

  it("guarda a qué mensaje responde (context.id)", () => {
    const r = extraerEntrantes({
      messages: [
        { from: "34600111222", id: "w3", type: "button", button: { payload: "SI:1", text: "Sí, cuéntame" }, context: { id: "wamid.plantilla" } },
      ],
    });
    expect(r[0]).toMatchObject({ tipo: "boton", cuerpo: "Sí, cuéntame", payloadBoton: "SI:1", respondeA: "wamid.plantilla" });
  });
});

describe("contenidoDe", () => {
  it("interactive button_reply y list_reply", () => {
    expect(contenidoDe({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "LLAMAR", title: "Que me llaméis" } } }))
      .toMatchObject({ tipo: "boton", cuerpo: "Que me llaméis", payloadBoton: "LLAMAR" });
    expect(contenidoDe({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x", title: "Opción" } } }).cuerpo).toBe("Opción");
  });
  it("multimedia: pie de foto y nombre del documento", () => {
    expect(contenidoDe({ type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "La máquina" } })).toMatchObject({
      tipo: "imagen",
      cuerpo: "La máquina",
      media: { id: "m1", mime: "image/jpeg", nombre: null },
    });
    expect(contenidoDe({ type: "document", document: { id: "d1", filename: "presupuesto.pdf" } }).cuerpo).toBe("presupuesto.pdf");
    expect(contenidoDe({ type: "audio", audio: { id: "a1", voice: true } })).toMatchObject({ tipo: "audio", cuerpo: null });
  });
  it("ubicación, reacción, contactos y desconocido", () => {
    expect(contenidoDe({ type: "location", location: { latitude: 39.5, longitude: 2.4, name: "Hotel", address: "Andratx" } }).cuerpo).toBe("Hotel · Andratx");
    expect(contenidoDe({ type: "reaction", reaction: { message_id: "w", emoji: "👍" } })).toMatchObject({ tipo: "reaccion", cuerpo: "👍" });
    expect(contenidoDe({ type: "contacts", contacts: [{ name: { formatted_name: "Luis" } }] }).cuerpo).toBe("Luis");
    expect(contenidoDe({ type: "unsupported" })).toMatchObject({ tipo: "otro", cuerpo: null });
  });
});

describe("extraerEcos (coexistencia)", () => {
  it("lo escrito en el móvil sale como saliente desde el móvil", () => {
    const { mensajes, cambios } = extraerEcos({
      metadata: { display_phone_number: "34971000000", phone_number_id: "1065" },
      contacts: [{ wa_id: "34600111222", user_id: "ES.abc" }],
      message_echoes: [
        { from: "34971000000", to: "34600111222", to_user_id: "ES.abc", id: "wamid.e1", timestamp: "1739321024", type: "text", text: { body: "Te llamo luego" } },
      ],
    });
    expect(cambios).toEqual([]);
    expect(mensajes[0]).toMatchObject({
      wamid: "wamid.e1",
      direccion: "saliente",
      origen: "movil",
      autor: "humano",
      cuerpo: "Te llamo luego",
      estado: "enviado",
      contacto: { waId: "34600111222", bsuid: "ES.abc" },
    });
  });

  it("sin to: toma el contacto de value.contacts", () => {
    const { mensajes } = extraerEcos({
      contacts: [{ user_id: "ES.solo" }],
      message_echoes: [{ from: "34971000000", id: "wamid.e2", type: "text", text: { body: "x" } }],
    });
    expect(mensajes[0]!.contacto.bsuid).toBe("ES.solo");
  });

  it("edit y revoke se convierten en cambios sobre el original", () => {
    const { mensajes, cambios } = extraerEcos({
      message_echoes: [
        { id: "w5", type: "edit", edit: { original_message_id: "wamid.e1", message: { type: "text", text: { body: "Corregido" } } } },
        { id: "w6", type: "revoke", revoke: { original_message_id: "wamid.e0" } },
      ],
    });
    expect(mensajes).toEqual([]);
    expect(cambios).toEqual([
      { accion: "editar", wamidOriginal: "wamid.e1", cuerpoNuevo: "Corregido" },
      { accion: "borrar", wamidOriginal: "wamid.e0", cuerpoNuevo: null },
    ]);
  });
});

describe("extraerHistorial (coexistencia)", () => {
  const value = {
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [
          {
            id: "34600111222",
            context: { wa_id: "34600111222", user_id: "ES.abc" },
            messages: [
              { from: "34600111222", from_user_id: "ES.abc", id: "h1", timestamp: "100", type: "text", text: { body: "¿Precio?" }, history_context: { status: "READ" } },
              { from: "34971000000", id: "h2", timestamp: "200", type: "text", text: { body: "Te lo paso" }, history_context: { status: "DELIVERED" } },
            ],
          },
          {
            context: { user_id: "ES.sinTel" },
            messages: [{ from_user_id: "ES.sinTel", id: "h3", timestamp: "300", type: "text", text: { body: "Hola" } }],
          },
        ],
      },
    ],
  };

  it("distingue negocio y cliente por from y no marca leídos los del cliente", () => {
    const { mensajes, fases } = extraerHistorial(value, "34971000000");
    expect(fases).toEqual([{ fase: 0, progreso: 100, errorCodigo: null }]);
    expect(mensajes.map((m) => [m.wamid, m.direccion, m.autor, m.estado, m.origen])).toEqual([
      ["h1", "entrante", "contacto", "recibido", "historial"],
      ["h2", "saliente", "humano", "entregado", "historial"],
      ["h3", "entrante", "contacto", "recibido", "historial"],
    ]);
    expect(mensajes[1]!.contacto).toEqual({ waId: "34600111222", bsuid: "ES.abc", nombre: null });
    expect(mensajes[2]!.contacto).toEqual({ waId: null, bsuid: "ES.sinTel", nombre: null });
  });

  it("error 2593109 (el negocio no comparte el historial)", () => {
    const { mensajes, fases } = extraerHistorial({ history: [{ errors: [{ code: 2593109 }] }] }, "34971000000");
    expect(mensajes).toEqual([]);
    expect(fases[0]!.errorCodigo).toBe(2593109);
  });
});

describe("extraerContactosApp", () => {
  it("contactos con nombre y acción", () => {
    expect(
      extraerContactosApp({
        state_sync: [
          { type: "contact", contact: { full_name: "Pepe (bar)", phone_number: "34600111222", user_id: "ES.abc" }, action: "add" },
          { type: "contact", contact: { first_name: "Ana", user_id: "ES.x" }, action: "remove" },
          { type: "otro" },
        ],
      }),
    ).toEqual([
      { waId: "34600111222", bsuid: "ES.abc", nombre: "Pepe (bar)", accion: "add" },
      { waId: null, bsuid: "ES.x", nombre: "Ana", accion: "remove" },
    ]);
  });
});

describe("estados", () => {
  it("traduce statuses y el error", () => {
    expect(
      extraerEstados({
        statuses: [
          { id: "w1", status: "delivered" },
          { id: "w2", status: "played" },
          { id: "w3", status: "failed", errors: [{ code: 131049, title: "t", message: "m", error_data: { details: "Detalle" } }] },
          { id: "w4", status: "raro" },
        ],
      }),
    ).toEqual([
      { wamid: "w1", estado: "entregado", errorCodigo: null, errorTexto: null },
      { wamid: "w2", estado: "leido", errorCodigo: null, errorTexto: null },
      { wamid: "w3", estado: "fallido", errorCodigo: 131049, errorTexto: "Detalle" },
    ]);
  });

  it("solo hacia delante; un fallido tardío no pisa un leído", () => {
    expect(estadosAnteriores("entregado")).toEqual(["recibido", "enviado"]);
    expect(estadosAnteriores("leido")).toEqual(["recibido", "enviado", "entregado"]);
    expect(estadosAnteriores("enviado")).toEqual(["recibido"]);
    expect(estadosAnteriores("fallido")).not.toContain("leido");
  });
});

describe("utilidades", () => {
  it("waIdValido", () => {
    expect(waIdValido("+34600111222")).toBe("34600111222");
    expect(waIdValido("34 600")).toBeNull();
    expect(waIdValido(undefined)).toBeNull();
  });
  it("fechaMeta con valor raro usa la hora por defecto", () => {
    expect(fechaMeta("abc", AHORA)).toBe(AHORA.toISOString());
  });
  it("validarTextoSaliente", () => {
    expect(validarTextoSaliente("  hola \r\n ")).toEqual({ ok: true, texto: "hola" });
    expect(validarTextoSaliente("   ").ok).toBe(false);
    expect(validarTextoSaliente("x".repeat(4097)).ok).toBe(false);
  });
  it("ventanaAbierta", () => {
    expect(ventanaAbierta("2026-11-27T11:00:00Z", AHORA)).toBe(true);
    expect(ventanaAbierta("2026-11-27T09:00:00Z", AHORA)).toBe(false);
    expect(ventanaAbierta(null, AHORA)).toBe(false);
  });
});
