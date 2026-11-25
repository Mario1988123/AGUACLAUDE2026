import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aE164,
  aplanarCarga,
  claveDedupe,
  generarPin,
  tokenVerificacionValido,
  traducirCalidad,
  traducirEstadoPlantilla,
  traducirLimite,
  verificarFirmaMeta,
} from "./logica";

const SECRETO = "secreto-de-prueba";
const firmar = (cuerpo: string, s = SECRETO) =>
  `sha256=${createHmac("sha256", s).update(cuerpo).digest("hex")}`;

describe("verificarFirmaMeta", () => {
  const cuerpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("acepta la firma correcta", () => {
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo), SECRETO)).toBe(true);
  });
  it("acepta la firma en mayúsculas", () => {
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo).toUpperCase().replace("SHA256=", "sha256="), SECRETO)).toBe(true);
  });
  it("rechaza una firma con otro secreto", () => {
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo, "otro"), SECRETO)).toBe(false);
  });
  it("rechaza el cuerpo alterado", () => {
    expect(verificarFirmaMeta(cuerpo + " ", firmar(cuerpo), SECRETO)).toBe(false);
  });
  it("rechaza sin cabecera, sin secreto o con formato raro", () => {
    expect(verificarFirmaMeta(cuerpo, null, SECRETO)).toBe(false);
    expect(verificarFirmaMeta(cuerpo, firmar(cuerpo), undefined)).toBe(false);
    expect(verificarFirmaMeta(cuerpo, "sha1=abc", SECRETO)).toBe(false);
    expect(verificarFirmaMeta(cuerpo, "sha256=zz", SECRETO)).toBe(false);
  });
});

describe("tokenVerificacionValido", () => {
  it("compara bien y rechaza vacíos", () => {
    expect(tokenVerificacionValido("abc", "abc")).toBe(true);
    expect(tokenVerificacionValido("abd", "abc")).toBe(false);
    expect(tokenVerificacionValido("abc", undefined)).toBe(false);
    expect(tokenVerificacionValido(null, "abc")).toBe(false);
  });
});

describe("aplanarCarga y claveDedupe", () => {
  const mensaje = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "111",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "222", display_phone_number: "34682663797" },
              contacts: [{ user_id: "ES.abc", profile: { name: "Ana" } }],
              messages: [{ id: "wamid.X", from_user_id: "ES.abc", type: "text", text: { body: "hola" } }],
            },
          },
        ],
      },
    ],
  };

  it("saca phone_number_id, waba y una clave por wamid", () => {
    const [e] = aplanarCarga(mensaje);
    expect(e).toMatchObject({ campo: "messages", wabaId: "111", phoneNumberId: "222", claveDedupe: "msg:wamid.X" });
  });

  it("la misma carga dos veces da la misma clave", () => {
    const a = aplanarCarga(mensaje)[0]!.claveDedupe;
    const b = aplanarCarga(JSON.parse(JSON.stringify(mensaje)))[0]!.claveDedupe;
    expect(a).toBe(b);
  });

  it("los estados distinguen enviado de entregado", () => {
    const sent = claveDedupe("1", { field: "messages", value: { statuses: [{ id: "w1", status: "sent" }] } });
    const del = claveDedupe("1", { field: "messages", value: { statuses: [{ id: "w1", status: "delivered" }] } });
    expect(sent).toBe("st:w1:sent");
    expect(del).not.toBe(sent);
  });

  it("lo que no es de WhatsApp no se aplana", () => {
    expect(aplanarCarga({ object: "page", entry: [] })).toEqual([]);
  });

  it("plantillas y cuenta van por hash", () => {
    const c = claveDedupe("111", { field: "message_template_status_update", value: { event: "APPROVED" } });
    expect(c.startsWith("h:message_template_status_update:")).toBe(true);
  });
});

describe("traducciones", () => {
  it("estado de plantilla", () => {
    expect(traducirEstadoPlantilla("APPROVED")).toBe("aprobada");
    expect(traducirEstadoPlantilla("REJECTED")).toBe("rechazada");
    expect(traducirEstadoPlantilla("PAUSED")).toBe("pausada");
    expect(traducirEstadoPlantilla("DISABLED")).toBe("desactivada");
    expect(traducirEstadoPlantilla("IN_APPEAL")).toBe("pendiente");
    expect(traducirEstadoPlantilla(undefined)).toBe("pendiente");
  });
  it("calidad", () => {
    expect(traducirCalidad("GREEN")).toBe("verde");
    expect(traducirCalidad("YELLOW")).toBe("amarilla");
    expect(traducirCalidad("RED")).toBe("roja");
    expect(traducirCalidad("UNKNOWN")).toBe("desconocida");
  });
  it("límite", () => {
    expect(traducirLimite("TIER_250")).toBe(250);
    expect(traducirLimite("TIER_2K")).toBe(2000);
    expect(traducirLimite("TIER_UNLIMITED")).toBeNull();
    expect(traducirLimite(undefined)).toBeNull();
  });
  it("E.164", () => {
    expect(aE164("+34 682 66 37 97")).toBe("+34682663797");
    expect(aE164("12")).toBeNull();
  });
  it("PIN de 6 dígitos", () => {
    for (let i = 0; i < 50; i++) expect(generarPin(randomBytes)).toMatch(/^\d{6}$/);
  });
});
