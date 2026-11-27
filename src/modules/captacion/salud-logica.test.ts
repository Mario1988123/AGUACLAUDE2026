import { describe, expect, it } from "vitest";
import { alertasSalud, estadoCron, haceTexto, leerFilaSalud, nivelSalud, resumenCron, type EjecucionCron } from "./salud-logica";

const ahora = new Date("2026-11-27T12:00:00Z");

const cruda = {
  company_id: "e1",
  empresa: "INFINITY AQUA",
  estado: "activa",
  calidad: "verde",
  limite_diario_meta: 250,
  margen_seguridad: 25,
  numero_e164: "+34600000000",
  envios_activos: true,
  ia_activa: false,
  ultimo_webhook_at: "2026-11-27T11:00:00Z",
  ultimo_error: null,
  tope_gasto_mensual_cents: 50000,
  retencion_dias: 365,
  ultimo_aviso_campo: "account_update",
  ultimo_aviso_evento: "PARTNER_ADDED",
  ultimo_aviso_at: "2026-11-20T10:00:00Z",
  envios_hoy: "12",
  fallidos_24h: 0,
  gasto_confirmado_milicentimos: "117000",
  gasto_en_vuelo: 2,
  campanas_activas: 1,
  campanas_pausadas: 0,
  eventos_pendientes: 0,
  eventos_error: 0,
};

describe("leerFilaSalud", () => {
  it("convierte números que llegan como texto y calcula el gasto", () => {
    const f = leerFilaSalud(cruda);
    expect(f.enviosHoy).toBe(12);
    expect(f.ultimoAviso).toEqual({ campo: "account_update", evento: "PARTNER_ADDED", at: "2026-11-20T10:00:00Z" });
    // 117000 + 2 × 5850 = 128700 milicéntimos frente a 50.000.000.
    expect(f.gasto?.comprometidoMilicentimos).toBe(128_700);
    expect(f.gasto?.nivel).toBe("ok");
  });
  it("empresa sin conexión: todo a null y sin gasto", () => {
    const f = leerFilaSalud({ company_id: "e2", empresa: "X", envios_hoy: 0 });
    expect(f.estado).toBeNull();
    expect(f.gasto).toBeNull();
    expect(f.ultimoAviso).toBeNull();
  });
});

describe("alertasSalud", () => {
  it("todo en orden: sin alertas", () => {
    const a = alertasSalud(leerFilaSalud(cruda), ahora);
    expect(a).toEqual([]);
    expect(nivelSalud(a)).toBe("ok");
  });
  it("conexión caída, calidad roja y avisos con error son errores", () => {
    const a = alertasSalud(leerFilaSalud({ ...cruda, estado: "suspendida", calidad: "roja", eventos_error: 3 }), ahora);
    expect(a.filter((x) => x.nivel === "error").map((x) => x.texto)).toEqual([
      "Conexión suspendida.",
      "Calidad del número en rojo.",
      "3 avisos de Meta con error.",
    ]);
    expect(nivelSalud(a)).toBe("error");
  });
  it("avisos: amarilla, fallidos, pendientes, pausas y Meta callado", () => {
    const a = alertasSalud(
      leerFilaSalud({ ...cruda, calidad: "amarilla", fallidos_24h: 1, eventos_pendientes: 2, campanas_pausadas: 1, ultimo_webhook_at: "2026-11-20T00:00:00Z" }),
      ahora,
    );
    expect(a.every((x) => x.nivel === "aviso")).toBe(true);
    expect(a.map((x) => x.texto)).toContain("1 envío fallido en 24 h.");
    expect(a.map((x) => x.texto)).toContain("Sin avisos de Meta desde hace 7 días.");
    expect(nivelSalud(a)).toBe("aviso");
  });
  it("10 fallidos o el tope del mes: error", () => {
    expect(nivelSalud(alertasSalud(leerFilaSalud({ ...cruda, fallidos_24h: 10 }), ahora))).toBe("error");
    expect(nivelSalud(alertasSalud(leerFilaSalud({ ...cruda, gasto_confirmado_milicentimos: 50_000_000 }), ahora))).toBe("error");
  });
  it("módulo activo sin número: aviso", () => {
    expect(alertasSalud(leerFilaSalud({ company_id: "e2", empresa: "X" }), ahora)).toEqual([
      { nivel: "aviso", texto: "Módulo activo sin número conectado." },
    ]);
  });
});

describe("haceTexto", () => {
  it("en minutos, horas y días", () => {
    expect(haceTexto(null, ahora)).toBe("—");
    expect(haceTexto("2026-11-27T11:59:30Z", ahora)).toBe("hace un momento");
    expect(haceTexto("2026-11-27T11:15:00Z", ahora)).toBe("hace 45 min");
    expect(haceTexto("2026-11-26T12:00:00Z", ahora)).toBe("hace 24 h");
    expect(haceTexto("2026-11-24T12:00:00Z", ahora)).toBe("hace 3 días");
  });
});

describe("crons", () => {
  const e: EjecucionCron = {
    job: "captacion-diario",
    started_at: "2026-11-27T02:30:00Z",
    ended_at: "2026-11-27T02:31:00Z",
    ok: true,
    duration_ms: 60_000,
    errors_count: 0,
    summary: { nuevos: 3, retencion: { prospectos: 2, cortado: false }, errors: [{ section: "x", message: "y" }] },
  };
  it("estado de la última ejecución", () => {
    expect(estadoCron(null, ahora)).toBe("nunca");
    expect(estadoCron(e, ahora)).toBe("ok");
    expect(estadoCron({ ...e, errors_count: 2 }, ahora)).toBe("errores");
    expect(estadoCron({ ...e, ok: false }, ahora)).toBe("fallo");
    expect(estadoCron({ ...e, ok: null, ended_at: null }, ahora)).toBe("sin_terminar");
    expect(estadoCron({ ...e, ok: null, ended_at: null, started_at: "2026-11-27T11:55:00Z" }, ahora)).toBe("ok");
  });
  it("resumen sin la lista de errores y con un nivel de anidado", () => {
    expect(resumenCron(e.summary)).toEqual([
      ["nuevos", "3"],
      ["retencion.prospectos", "2"],
      ["retencion.cortado", "false"],
    ]);
    expect(resumenCron(null)).toEqual([]);
  });
});
