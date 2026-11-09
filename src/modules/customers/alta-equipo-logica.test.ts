import { describe, expect, it } from "vitest";
import {
  descripcionLlamada,
  diaLlamada,
  programacionMantenimiento,
  tituloLlamada,
} from "./alta-equipo-logica";

describe("diaLlamada", () => {
  it("saca el día de una fecha, datetime o ISO", () => {
    expect(diaLlamada("2026-12-01")).toBe("2026-12-01");
    expect(diaLlamada("2026-12-01T09:30")).toBe("2026-12-01");
    expect(diaLlamada("2026-12-01T09:30:00.000Z")).toBe("2026-12-01");
  });
  it("sin fecha o fecha imposible → no hay llamada", () => {
    expect(diaLlamada(null)).toBeNull();
    expect(diaLlamada("")).toBeNull();
    expect(diaLlamada("01/12/2026")).toBeNull();
    expect(diaLlamada("2026-02-30")).toBeNull();
  });
});

describe("texto de la llamada", () => {
  it("título con el equipo y periodicidad solo si se indicó", () => {
    expect(tituloLlamada("Ósmosis X")).toBe("Llamar para ofrecer mantenimiento · Ósmosis X");
    expect(descripcionLlamada(6)).toContain("cada 6 meses");
    expect(descripcionLlamada(null)).not.toContain("cada");
  });
});

describe("programacionMantenimiento (origen explícito)", () => {
  it("solo el alta manual sin contrato de mantenimiento crea la llamada", () => {
    expect(programacionMantenimiento("alta_manual", false)).toBe("llamada");
    expect(programacionMantenimiento("alta_manual", true)).toBe("visitas");
  });
  it("pack con fecha y sin contrato → UNA llamada (en el principal; los extras nada)", () => {
    const pack = ["pack", "pack_extra", "pack_extra"] as const;
    const llamadas = pack.filter((o) => programacionMantenimiento(o, false) === "llamada");
    expect(llamadas).toEqual(["pack"]);
    expect(programacionMantenimiento("pack_extra", false)).toBe("nada");
  });
  it("pack con contrato de mantenimiento activo → visitas de siempre", () => {
    expect(programacionMantenimiento("pack", true)).toBe("visitas");
    expect(programacionMantenimiento("pack_extra", true)).toBe("visitas");
  });
  it("importación → ninguna llamada, visitas de siempre", () => {
    expect(programacionMantenimiento("importacion", false)).toBe("visitas");
    expect(programacionMantenimiento("importacion", true)).toBe("visitas");
  });
  it("título del pack con el principal y +N extras", () => {
    expect(tituloLlamada("Ósmosis X", 2)).toBe("Llamar para ofrecer mantenimiento · Ósmosis X +2 extras");
    expect(tituloLlamada("Ósmosis X", 1)).toBe("Llamar para ofrecer mantenimiento · Ósmosis X +1 extra");
  });
});
