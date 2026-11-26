import { beforeEach, describe, expect, it, vi } from "vitest";
import { firmarSvix } from "@/modules/mailing/webhook-resend";

// Cliente de Supabase simulado: guarda filas por tabla y registra los update.
type Fila = Record<string, unknown>;
const tablas: Record<string, Fila[]> = {};
const updates: Array<{ tabla: string; cambios: Fila; id: unknown }> = [];
const inserts: Array<{ tabla: string; fila: Fila }> = [];

function consulta(tabla: string) {
  const filtros: Array<[string, unknown]> = [];
  let cambios: Fila | null = null;
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => {
      filtros.push([col, val]);
      if (cambios) {
        updates.push({ tabla, cambios, id: val });
        return Promise.resolve({ error: null });
      }
      return q;
    },
    maybeSingle: () => {
      const fila = (tablas[tabla] ?? []).find((f) => filtros.every(([c, v]) => f[c] === v));
      return Promise.resolve({ data: fila ?? null, error: null });
    },
    update: (c: Fila) => {
      cambios = c;
      return q;
    },
    insert: (fila: Fila) => {
      inserts.push({ tabla, fila });
      return Promise.resolve({ error: null });
    },
  };
  return q;
}

vi.mock("@/shared/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => consulta(t) }),
}));

const SECRETO = `whsec_${Buffer.from("secreto-webhook-de-prueba").toString("base64")}`;

async function enviar(evento: unknown, opciones: { firma?: string } = {}) {
  const { POST } = await import("./route");
  const cuerpo = JSON.stringify(evento);
  const ts = String(Math.floor(Date.now() / 1000));
  const firma = opciones.firma ?? firmarSvix(cuerpo, "msg_1", ts, SECRETO);
  const req = new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    body: cuerpo,
    headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": firma },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(req as any);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRETO;
  updates.length = 0;
  inserts.length = 0;
  tablas.email_sends = [
    {
      id: "send-1",
      company_id: "emp-1",
      status: "sent",
      opens_count: 0,
      clicks_count: 0,
      customer_id: "cli-1",
      lead_id: null,
      related_subject_type: null,
      related_subject_id: null,
      template_key: "maintenance_day_before",
      subject: "Mañana vamos",
      resend_id: "re_abc",
    },
  ];
  tablas.email_outbox = [{ id: "out-1", opens_count: 0, clicks_count: 0, resend_id: "re_abc" }];
});

describe("POST /api/webhooks/resend", () => {
  it("un delivered firmado actualiza email_sends y email_outbox", async () => {
    const r = await enviar({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "re_abc" } });
    expect(r).toMatchObject({ status: 200, json: { ok: true, updated: ["email_sends", "email_outbox"] } });
    const enSends = updates.find((u) => u.tabla === "email_sends");
    expect(enSends?.id).toBe("send-1");
    expect(enSends?.cambios).toMatchObject({ status: "delivered" });
  });

  it("un opened crea el evento de timeline del cliente", async () => {
    await enviar({ type: "email.opened", data: { email_id: "re_abc" } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.fila).toMatchObject({ kind: "email.opened", subject_type: "customer", subject_id: "cli-1" });
    expect(updates.find((u) => u.tabla === "email_outbox")?.cambios).toMatchObject({ opens_count: 1 });
  });

  it("rechaza una firma mala sin tocar nada", async () => {
    const r = await enviar({ type: "email.bounced", data: { email_id: "re_abc" } }, { firma: "v1,falsa" });
    expect(r.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("email.received (entrante) se acepta y no toca nada", async () => {
    const r = await enviar({ type: "email.received", data: { email_id: "in_1" } });
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(updates).toHaveLength(0);
  });

  it("un id que no es nuestro (otro proyecto de la cuenta) se ignora con 200", async () => {
    const r = await enviar({ type: "email.delivered", data: { email_id: "re_de_otro" } });
    expect(r).toMatchObject({ status: 200, json: { ignored: "send not found" } });
  });
});
