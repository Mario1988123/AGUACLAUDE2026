import { describe, expect, it } from "vitest";
import {
  claveMes,
  CORTACIRCUITOS,
  costeEnvio,
  decidirReintento,
  diasEscalado,
  evaluarCortacircuitos,
  evaluarGasto,
  extraerPreciosEstados,
  formatoEuros,
  formatoTasa,
  inicioDiaMadrid,
  inicioMesMadrid,
  leerEmbudo,
  milicentimosACents,
  motivoPausaConexion,
  tasasEmbudo,
  TARIFAS_ES_MILICENTIMOS,
  ventanaAbierta,
  viaEnvioPropuesta,
  type PropuestaPendiente,
} from "./mando-logica";

describe("inicioDiaMadrid", () => {
  it("medianoche de Madrid en invierno (UTC+1) y en verano (UTC+2)", () => {
    expect(inicioDiaMadrid(new Date("2026-11-27T12:00:00Z")).toISOString()).toBe("2026-11-26T23:00:00.000Z");
    expect(inicioDiaMadrid(new Date("2026-07-15T12:00:00Z")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    // 23:30 UTC del 26 ya es día 27 en Madrid.
    expect(inicioDiaMadrid(new Date("2026-11-26T23:30:00Z")).toISOString()).toBe("2026-11-26T23:00:00.000Z");
  });
  it("días de cambio de hora", () => {
    // 29-03-2026: se adelanta a las 2:00; la medianoche aún es UTC+1.
    expect(inicioDiaMadrid(new Date("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    // 25-10-2026: se atrasa a las 3:00; la medianoche aún es UTC+2.
    expect(inicioDiaMadrid(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});

describe("costes", () => {
  it("sin pricing cuenta marketing", () => {
    expect(costeEnvio(null)).toEqual({ milicentimos: 5850, categoria: "marketing" });
  });
  it("usa la categoría de Meta", () => {
    expect(costeEnvio({ facturable: true, categoria: "utility", tipo: null }).milicentimos).toBe(1660);
    expect(costeEnvio({ facturable: true, categoria: "marketing", tipo: "regular" }).milicentimos).toBe(5850);
  });
  it("no facturable, gratuito o servicio: 0", () => {
    expect(costeEnvio({ facturable: false, categoria: "marketing", tipo: null }).milicentimos).toBe(0);
    expect(costeEnvio({ facturable: null, categoria: "utility", tipo: "free_customer_service" }).milicentimos).toBe(0);
    expect(costeEnvio({ facturable: true, categoria: "service", tipo: null }).milicentimos).toBe(0);
  });
  it("categoría desconocida: la más cara", () => {
    expect(costeEnvio({ facturable: true, categoria: "rara", tipo: null }).milicentimos).toBe(TARIFAS_ES_MILICENTIMOS.marketing);
  });
  it("redondea a céntimos enteros", () => {
    expect(milicentimosACents(5850)).toBe(6);
    expect(milicentimosACents(1660)).toBe(2);
  });
  it("lee pricing de los estados", () => {
    const m = extraerPreciosEstados({
      statuses: [
        { id: "wamid.A", status: "delivered", pricing: { billable: true, category: "MARKETING", pricing_model: "PMP", type: "regular" } },
        { id: "wamid.B", status: "delivered" },
        { status: "read", pricing: { billable: true } },
      ],
    });
    expect(m.size).toBe(1);
    expect(m.get("wamid.A")).toEqual({ facturable: true, categoria: "marketing", tipo: "regular" });
    expect(extraerPreciosEstados(null).size).toBe(0);
  });
});

describe("mes de Madrid", () => {
  it("inicio de mes en invierno (UTC+1)", () => {
    const d = inicioMesMadrid(new Date("2026-11-27T10:00:00Z"));
    expect(d.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
  it("inicio de mes en verano (UTC+2)", () => {
    expect(inicioMesMadrid(new Date("2026-07-15T10:00:00Z")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
  it("la medianoche del día 1 ya es del mes nuevo", () => {
    // 2026-11-30T23:30Z = 1 de diciembre 00:30 en Madrid
    expect(claveMes(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12");
    expect(inicioMesMadrid(new Date("2026-11-30T23:30:00Z")).toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
});

describe("tope de gasto", () => {
  it("por debajo del 80 %: ok", () => {
    const g = evaluarGasto({ confirmadoMilicentimos: 100 * 5850, enVuelo: 0, topeCents: 50_000 });
    expect(g.nivel).toBe("ok");
    expect(g.enviosQueCaben).toBe(Math.floor((50_000_000 - 585_000) / 5850));
  });
  it("lo que está en vuelo cuenta", () => {
    // 80 % de 500 € = 400 €; 6838 × 5,85 cts = 400,02 €
    const g = evaluarGasto({ confirmadoMilicentimos: 0, enVuelo: 6838, topeCents: 50_000 });
    expect(g.nivel).toBe("aviso");
  });
  it("al 100 % no cabe nada", () => {
    const g = evaluarGasto({ confirmadoMilicentimos: 50_000_000, enVuelo: 0, topeCents: 50_000 });
    expect(g.nivel).toBe("tope");
    expect(g.enviosQueCaben).toBe(0);
  });
  it("tope 0: nada sale", () => {
    const g = evaluarGasto({ confirmadoMilicentimos: 0, enVuelo: 0, topeCents: 0 });
    expect(g.nivel).toBe("tope");
    expect(g.porcentaje).toBeNull();
    expect(g.enviosQueCaben).toBe(0);
  });
});

describe("cortacircuitos", () => {
  it("con poca muestra no salta", () => {
    expect(evaluarCortacircuitos({ intentos: CORTACIRCUITOS.muestraMinima - 1, fallidos: 29, prospectos: 29, noes: 29 }).salta).toBe(false);
  });
  it("salta por fallidos (> 15 %)", () => {
    const r = evaluarCortacircuitos({ intentos: 100, fallidos: 16, prospectos: 100, noes: 0 });
    expect(r.salta).toBe(true);
    if (r.salta) expect(r.motivo).toMatch(/16 de los últimos 100/);
  });
  it("15 % justo no salta", () => {
    expect(evaluarCortacircuitos({ intentos: 100, fallidos: 15, prospectos: 100, noes: 25 }).salta).toBe(false);
  });
  it("salta por «No» (> 25 %)", () => {
    const r = evaluarCortacircuitos({ intentos: 100, fallidos: 0, prospectos: 80, noes: 21 });
    expect(r.salta).toBe(true);
    if (r.salta) expect(r.motivo).toMatch(/«No»/);
  });
  it("conexión y calidad", () => {
    expect(motivoPausaConexion({ estado: "activa", calidad: "verde" })).toBeNull();
    expect(motivoPausaConexion({ estado: "activa", calidad: "desconocida" })).toBeNull();
    expect(motivoPausaConexion({ estado: "activa", calidad: "roja" })).toMatch(/rojo/);
    expect(motivoPausaConexion({ estado: "activa", calidad: "amarilla" })).toMatch(/amarillo/);
    expect(motivoPausaConexion({ estado: "suspendida", calidad: "verde" })).toMatch(/no está activa/);
    expect(motivoPausaConexion(null)).not.toBeNull();
  });
});

describe("escalado tras una pausa", () => {
  const ahora = new Date("2026-11-27T12:00:00Z");
  it("sin lanzar: día 0", () => expect(diasEscalado(null, null, ahora)).toBe(0));
  it("cuenta desde el lanzamiento", () => expect(diasEscalado("2026-11-20T12:00:00Z", null, ahora)).toBe(7));
  it("tras reanudar, vuelve a empezar", () => {
    expect(diasEscalado("2026-11-01T12:00:00Z", "2026-11-26T12:00:00Z", ahora)).toBe(1);
  });
});

describe("reintento de la propuesta", () => {
  const ahora = new Date("2026-11-27T12:00:00Z");
  const base: PropuestaPendiente = {
    envioError: "fallo de red",
    enviadaAt: null,
    revocadaAt: null,
    caducaAt: "2026-12-27T12:00:00Z",
    intentos: 0,
    ultimoIntentoAt: null,
    ventanaHasta: "2026-11-28T10:00:00Z",
    modoConversacion: "ia",
  };
  it("reintenta dentro de la ventana", () => expect(decidirReintento(base, ahora)).toEqual({ reintentar: true, via: "servicio" }));
  it("fase 8: con la ventana cerrada y plantilla de documento, por plantilla", () => {
    expect(decidirReintento({ ...base, ventanaHasta: null, plantillaDocumento: true }, ahora)).toEqual({ reintentar: true, via: "plantilla" });
    expect(decidirReintento({ ...base, ventanaHasta: "2026-11-27T12:03:00Z", plantillaDocumento: true }, ahora)).toEqual({
      reintentar: true,
      via: "plantilla",
    });
    // Con la ventana abierta manda el documento normal (gratis), aunque haya plantilla.
    expect(decidirReintento({ ...base, plantillaDocumento: true }, ahora)).toEqual({ reintentar: true, via: "servicio" });
    // Cerrada (dijo «No») sigue sin mandarse.
    expect(decidirReintento({ ...base, ventanaHasta: null, plantillaDocumento: true, modoConversacion: "cerrada" }, ahora)).toMatchObject({
      agotar: true,
    });
  });
  it("viaEnvioPropuesta y ventanaAbierta", () => {
    expect(viaEnvioPropuesta("2026-11-28T10:00:00Z", false, ahora)).toBe("servicio");
    expect(viaEnvioPropuesta("2026-11-27T12:04:59Z", true, ahora)).toBe("plantilla");
    expect(viaEnvioPropuesta(null, false, ahora)).toBeNull();
    expect(ventanaAbierta("basura", ahora)).toBe(false);
    expect(ventanaAbierta("2026-11-27T12:05:01Z", ahora)).toBe(true);
  });
  it("como mucho 3", () => {
    expect(decidirReintento({ ...base, intentos: 3 }, ahora)).toMatchObject({ reintentar: false, agotar: true });
  });
  it("fuera de la ventana, no (y se agota)", () => {
    expect(decidirReintento({ ...base, ventanaHasta: "2026-11-27T12:03:00Z" }, ahora)).toMatchObject({ reintentar: false, agotar: true });
    expect(decidirReintento({ ...base, ventanaHasta: null }, ahora)).toMatchObject({ reintentar: false, agotar: true });
  });
  it("espera 10 minutos entre intentos", () => {
    expect(decidirReintento({ ...base, intentos: 1, ultimoIntentoAt: "2026-11-27T11:55:00Z" }, ahora)).toMatchObject({
      reintentar: false,
      agotar: false,
    });
    expect(decidirReintento({ ...base, intentos: 1, ultimoIntentoAt: "2026-11-27T11:49:00Z" }, ahora)).toEqual({
      reintentar: true,
      via: "servicio",
    });
  });
  it("sin equipos, cerrada, revocada o caducada: se agota", () => {
    expect(decidirReintento({ ...base, envioError: "La campaña no tiene equipos asignados para la propuesta." }, ahora)).toMatchObject({ agotar: true });
    expect(decidirReintento({ ...base, modoConversacion: "cerrada" }, ahora)).toMatchObject({ agotar: true });
    expect(decidirReintento({ ...base, revocadaAt: "2026-11-27T00:00:00Z" }, ahora)).toMatchObject({ agotar: true });
    expect(decidirReintento({ ...base, caducaAt: "2026-11-27T00:00:00Z" }, ahora)).toMatchObject({ agotar: true });
  });
});

describe("embudo", () => {
  it("lee la fila del SQL y calcula tasas sobre entregados", () => {
    const e = leerEmbudo({ prospectos: 500, en_cola: 10, contactados: 200, entregados: 180, si: 18, no: 27, interesados: 9, leads: 18, sin_respuesta: 36 });
    expect(e.recordados).toBe(0);
    const t = tasasEmbudo(e);
    expect(t.entrega).toBeCloseTo(0.9);
    expect(t.si).toBeCloseTo(0.1);
    expect(t.no).toBeCloseTo(0.15);
    expect(formatoTasa(t.si)).toBe("10 %");
    expect(formatoTasa(tasasEmbudo(leerEmbudo({})).si)).toBe("—");
  });
  it("euros", () => {
    expect(formatoEuros(5850).replace(/\s/g, " ")).toBe("0,06 €");
    expect(formatoEuros(50_000_000).replace(/\s/g, " ")).toMatch(/^500,00 €$/);
  });
});
