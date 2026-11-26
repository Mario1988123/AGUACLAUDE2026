import { describe, expect, it } from "vitest";
import {
  calcularCambiosEvento,
  cambiosParaOutbox,
  fechaDelEvento,
  firmarSvix,
  verificarFirmaSvix,
} from "./webhook-resend";
import { camposResultadoEnvio } from "./registro-envio";

// Secreto de prueba con el mismo formato que los de Resend (whsec_ + base64).
const SECRETO = `whsec_${Buffer.from("secreto-de-prueba-32-bytes-------").toString("base64")}`;
const AHORA_MS = Date.UTC(2026, 10, 26, 10, 0, 0);
const TS = String(Math.floor(AHORA_MS / 1000));

describe("verificarFirmaSvix", () => {
  const cuerpo = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

  it("acepta una firma correcta", () => {
    const firma = firmarSvix(cuerpo, "msg_1", TS, SECRETO);
    expect(
      verificarFirmaSvix({ cuerpo, svixId: "msg_1", svixTimestamp: TS, svixSignature: firma, secreto: SECRETO, ahoraMs: AHORA_MS }),
    ).toEqual({ ok: true });
  });

  it("acepta si una de varias firmas (rotación) es buena", () => {
    const firma = firmarSvix(cuerpo, "msg_1", TS, SECRETO);
    expect(
      verificarFirmaSvix({
        cuerpo,
        svixId: "msg_1",
        svixTimestamp: TS,
        svixSignature: `v1,AAAA ${firma}`,
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }).ok,
    ).toBe(true);
  });

  it("rechaza un cuerpo alterado", () => {
    const firma = firmarSvix(cuerpo, "msg_1", TS, SECRETO);
    expect(
      verificarFirmaSvix({ cuerpo: cuerpo + " ", svixId: "msg_1", svixTimestamp: TS, svixSignature: firma, secreto: SECRETO, ahoraMs: AHORA_MS }),
    ).toEqual({ ok: false, motivo: "invalid signature" });
  });

  it("rechaza otro secreto", () => {
    const firma = firmarSvix(cuerpo, "msg_1", TS, `whsec_${Buffer.from("otro").toString("base64")}`);
    expect(
      verificarFirmaSvix({ cuerpo, svixId: "msg_1", svixTimestamp: TS, svixSignature: firma, secreto: SECRETO, ahoraMs: AHORA_MS }).ok,
    ).toBe(false);
  });

  it("rechaza un timestamp fuera de la ventana de 5 minutos", () => {
    const viejo = String(Math.floor(AHORA_MS / 1000) - 6 * 60);
    const firma = firmarSvix(cuerpo, "msg_1", viejo, SECRETO);
    expect(
      verificarFirmaSvix({ cuerpo, svixId: "msg_1", svixTimestamp: viejo, svixSignature: firma, secreto: SECRETO, ahoraMs: AHORA_MS }),
    ).toEqual({ ok: false, motivo: "timestamp out of window" });
  });
});

describe("calcularCambiosEvento", () => {
  const ahora = new Date(AHORA_MS);
  const fecha = "2026-11-26T09:59:00.000Z";

  it("delivered sube sent → delivered con la fecha del evento", () => {
    const r = calcularCambiosEvento({ type: "email.delivered", created_at: fecha }, { status: "sent" }, ahora);
    expect(r).toEqual({
      ignorar: false,
      cambios: { last_event_at: fecha, delivered_at: fecha, status: "delivered" },
      eventoTimeline: null,
    });
  });

  it("delivered tardío no pisa un rebote", () => {
    const r = calcularCambiosEvento({ type: "email.delivered", created_at: fecha }, { status: "bounced" }, ahora);
    expect(r.ignorar).toBe(false);
    if (!r.ignorar) expect(r.cambios.status).toBeUndefined();
  });

  it("opened cuenta aperturas y solo la primera va al timeline", () => {
    const primera = calcularCambiosEvento({ type: "email.opened" }, { status: "delivered", opens_count: 0 }, ahora);
    const segunda = calcularCambiosEvento({ type: "email.opened" }, { status: "delivered", opens_count: 1 }, ahora);
    expect(primera).toMatchObject({ cambios: { opens_count: 1 }, eventoTimeline: "email.opened" });
    expect(segunda).toMatchObject({ cambios: { opens_count: 2 }, eventoTimeline: null });
  });

  it("opened sobre un sent también lo marca entregado", () => {
    const r = calcularCambiosEvento({ type: "email.opened" }, { status: "sent", opens_count: null }, ahora);
    expect(r).toMatchObject({ cambios: { status: "delivered", opens_count: 1 } });
  });

  it("clicked cuenta clics", () => {
    const r = calcularCambiosEvento({ type: "email.clicked" }, { status: "delivered", clicks_count: 2 }, ahora);
    expect(r).toMatchObject({ cambios: { clicks_count: 3 }, eventoTimeline: null });
  });

  it("bounced guarda el motivo", () => {
    const r = calcularCambiosEvento(
      { type: "email.bounced", data: { bounce: { type: "Permanent", subType: "General", message: "No existe el buzón" } } },
      { status: "sent" },
      ahora,
    );
    expect(r).toMatchObject({
      cambios: { status: "bounced", error_code: "Permanent:General", error_message: "No existe el buzón" },
      eventoTimeline: "email.bounced",
    });
  });

  it("complained marca queja", () => {
    const r = calcularCambiosEvento({ type: "email.complained" }, { status: "delivered" }, ahora);
    expect(r).toMatchObject({ cambios: { status: "complained" }, eventoTimeline: "email.complained" });
  });

  it("failed marca fallo con el motivo de Resend", () => {
    const r = calcularCambiosEvento({ type: "email.failed", data: { failed: { reason: "domain not verified" } } }, { status: "sent" }, ahora);
    expect(r).toMatchObject({ cambios: { status: "failed", error_message: "domain not verified" } });
  });

  it("un tipo desconocido se ignora", () => {
    expect(calcularCambiosEvento({ type: "email.delivery_delayed" }, { status: "sent" }, ahora)).toEqual({
      ignorar: true,
      motivo: "email.delivery_delayed",
    });
  });

  it("sin created_at válido usa la hora actual", () => {
    expect(fechaDelEvento({ type: "x", created_at: "basura" }, ahora)).toBe(ahora.toISOString());
  });
});

describe("cambiosParaOutbox", () => {
  it("solo deja columnas que existen en email_outbox", () => {
    const r = cambiosParaOutbox(
      { type: "email.delivered" },
      { last_event_at: "t", delivered_at: "t", status: "delivered" },
    );
    expect(r).toEqual({ last_event_at: "t" });
  });

  it("el rebote se refleja en error sin tocar status (su CHECK no admite bounced)", () => {
    const r = cambiosParaOutbox(
      { type: "email.bounced", data: { bounce: { message: "buzón lleno" } } },
      { last_event_at: "t", status: "bounced", bounced_at: "t" },
    );
    expect(r).toEqual({ last_event_at: "t", error: "Rebotado: buzón lleno" });
  });
});

describe("camposResultadoEnvio", () => {
  const ahora = new Date(AHORA_MS);

  it("guarda el resend_id de un envío por Resend", () => {
    expect(camposResultadoEnvio({ ok: true, accountType: "resend", resend_id: "re_123" }, ahora)).toEqual({
      status: "sent",
      error_message: null,
      sent_at: ahora.toISOString(),
      from_account_type: "resend",
      resend_id: "re_123",
    });
  });

  it("por SMTP no hay resend_id", () => {
    expect(camposResultadoEnvio({ ok: true, accountType: "company_manual" }, ahora).resend_id).toBeNull();
  });

  it("un fallo guarda el error", () => {
    expect(camposResultadoEnvio({ ok: false, error: "sin SMTP" }, ahora)).toMatchObject({
      status: "failed",
      error_message: "sin SMTP",
      sent_at: null,
      resend_id: null,
    });
  });
});
