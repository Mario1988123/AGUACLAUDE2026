import { describe, expect, it } from "vitest";
import {
  anioMadrid,
  claveDiaMadrid,
  diaMananaCron,
  diaReferenciaCron,
  diferenciaDiasClave,
  mesMadrid,
  rangoDiaMadridUtc,
  rangoMesMadridUtc,
  sumarDiasClave,
  sumarMesesClave,
  sumarMesesMadrid,
} from "./fechas-madrid";

describe("claveDiaMadrid", () => {
  it("las 22:30 UTC del 1-oct son ya el 2-oct en Madrid (verano)", () => {
    expect(claveDiaMadrid("2026-10-01T22:30:00Z")).toBe("2026-10-02");
  });
  it("las 22:30 UTC del 1-dic siguen siendo el 1-dic en Madrid (invierno)", () => {
    expect(claveDiaMadrid("2026-12-01T22:30:00Z")).toBe("2026-12-01");
  });
});

describe("sumarDiasClave / diferenciaDiasClave", () => {
  it("cruza fin de mes y de año", () => {
    expect(sumarDiasClave("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDiasClave("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("cuenta días naturales sin efecto del cambio de hora", () => {
    expect(diferenciaDiasClave("2026-10-24", "2026-10-26")).toBe(2);
    expect(diferenciaDiasClave("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("rangoDiaMadridUtc", () => {
  it("día normal de verano: 22:00 UTC a 22:00 UTC", () => {
    expect(rangoDiaMadridUtc("2026-10-02")).toEqual({
      desde: "2026-10-01T22:00:00.000Z",
      hasta: "2026-10-02T22:00:00.000Z",
    });
  });
  it("día del cambio a invierno dura 25 h", () => {
    const r = rangoDiaMadridUtc("2026-10-25");
    expect(r.desde).toBe("2026-10-24T22:00:00.000Z");
    expect(r.hasta).toBe("2026-10-25T23:00:00.000Z");
  });
  it("día del cambio a verano dura 23 h", () => {
    const r = rangoDiaMadridUtc("2026-03-29");
    expect(r.desde).toBe("2026-03-28T23:00:00.000Z");
    expect(r.hasta).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("diaMananaCron (cron diario a las 22:00 UTC)", () => {
  it("en verano (00:00 Madrid del 2-oct) mañana es el 3-oct", () => {
    const ahora = new Date("2026-10-01T22:00:00Z");
    expect(diaReferenciaCron(ahora)).toBe("2026-10-02");
    expect(diaMananaCron(ahora)).toBe("2026-10-03");
  });
  it("en invierno (23:00 Madrid del 1-dic) mañana es también el 3-dic", () => {
    const ahora = new Date("2026-12-01T22:00:00Z");
    expect(diaReferenciaCron(ahora)).toBe("2026-12-02");
    expect(diaMananaCron(ahora)).toBe("2026-12-03");
  });
  it("una ejecución manual a media tarde da el día siguiente", () => {
    expect(diaMananaCron(new Date("2026-10-02T13:00:00Z"))).toBe("2026-10-03");
  });
});

describe("mes y año en Madrid", () => {
  it("un contrato firmado el 1-oct a las 01:30 de Madrid es de octubre", () => {
    const firma = "2026-09-30T23:30:00Z";
    expect(mesMadrid(firma)).toEqual({ anio: 2026, mes: 10 });
  });
  it("la Nochevieja a las 23:30 UTC ya es año nuevo en Madrid", () => {
    expect(anioMadrid("2026-12-31T23:30:00Z")).toBe(2027);
  });
  it("rango de octubre: del 30-sep 22:00 UTC al 31-oct 23:00 UTC", () => {
    expect(rangoMesMadridUtc(2026, 10)).toEqual({
      desde: "2026-09-30T22:00:00.000Z",
      hasta: "2026-10-31T23:00:00.000Z",
    });
  });
  it("rango de diciembre cruza el año", () => {
    expect(rangoMesMadridUtc(2026, 12).hasta).toBe("2026-12-31T23:00:00.000Z");
  });
});

describe("sumarMesesClave / sumarMesesMadrid (sin desbordar)", () => {
  it("31-ene + 1 mes = 28-feb (no 3-mar)", () => {
    expect(sumarMesesClave("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumarMesesClave("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("cruza años en ambos sentidos", () => {
    expect(sumarMesesClave("2026-11-30", 3)).toBe("2027-02-28");
    expect(sumarMesesClave("2026-01-15", -2)).toBe("2025-11-15");
  });
  it("conserva la hora de pared de Madrid al cruzar el cambio de hora", () => {
    // 10:00 Madrid del 31-ene (09:00 UTC) + 6 meses = 10:00 Madrid del 31-jul (08:00 UTC)
    expect(sumarMesesMadrid("2026-01-31T09:00:00Z", 6).toISOString()).toBe(
      "2026-07-31T08:00:00.000Z",
    );
    // 10:00 Madrid del 31-ago + 6 meses = 10:00 Madrid del 28-feb
    expect(sumarMesesMadrid("2026-08-31T08:00:00Z", 6).toISOString()).toBe(
      "2027-02-28T09:00:00.000Z",
    );
  });
});
