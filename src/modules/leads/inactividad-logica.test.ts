import { describe, expect, it } from "vitest";
import {
  clienteDebeSeguirAlLead,
  diasInactividad,
  elegirDuenoCliente,
  leadsInactivos,
} from "./inactividad-logica";

const AHORA = Date.parse("2026-11-13T10:00:00Z");
const haceDias = (d: number) => new Date(AHORA - d * 86_400_000).toISOString();

describe("diasInactividad", () => {
  it("sin columna (migración sin aplicar) → 40", () => {
    expect(diasInactividad({ lead_expiry_days: 30 })).toBe(40);
    expect(diasInactividad(null)).toBe(40);
  });
  it("valor válido → ese valor; absurdo → 40", () => {
    expect(diasInactividad({ lead_stale_days: 20 })).toBe(20);
    expect(diasInactividad({ lead_stale_days: 0 })).toBe(40);
    expect(diasInactividad({ lead_stale_days: "x" })).toBe(40);
  });
});

describe("leadsInactivos", () => {
  const lead = (id: string, creado: number, asignado: number | null, editado: number | null) => ({
    id,
    created_at: haceDias(creado),
    assigned_at: asignado === null ? null : haceDias(asignado),
    updated_at: editado === null ? null : haceDias(editado),
  });

  it("avisa solo si alta, asignación y edición son anteriores al corte", () => {
    const r = leadsInactivos(
      [lead("viejo", 90, 60, 50), lead("reasignado", 90, 10, 50), lead("editado", 90, 60, 5)],
      40,
      new Set(),
      AHORA,
    );
    expect(r.map((l) => l.id)).toEqual(["viejo"]);
  });

  it("con actividad externa (evento, agenda, prueba) no avisa", () => {
    const r = leadsInactivos([lead("a", 90, 60, 50)], 40, new Set(["a"]), AHORA);
    expect(r).toEqual([]);
  });
});

describe("elegirDuenoCliente", () => {
  const activos = new Set(["andres", "domingo"]);
  const es = (u: string) => activos.has(u);

  it("lead asignado → su comercial", () => {
    expect(
      elegirDuenoCliente({ asignado: "fer", ultimoDueno: "andres", creador: "domingo", convierte: "lara", esComercialActivo: es }),
    ).toBe("fer");
  });
  it("sin dueño → último comercial que lo tuvo, antes que el creador", () => {
    expect(
      elegirDuenoCliente({ asignado: null, ultimoDueno: "andres", creador: "domingo", convierte: "lara", esComercialActivo: es }),
    ).toBe("andres");
  });
  it("último dueño inactivo → creador comercial", () => {
    expect(
      elegirDuenoCliente({ asignado: null, ultimoDueno: "baja", creador: "domingo", convierte: "lara", esComercialActivo: es }),
    ).toBe("domingo");
  });
  it("nadie válido → quien convierte (nunca null)", () => {
    expect(
      elegirDuenoCliente({ asignado: null, ultimoDueno: null, creador: "lara", convierte: "lara", esComercialActivo: es }),
    ).toBe("lara");
  });
});

describe("clienteDebeSeguirAlLead", () => {
  it("cliente del dueño anterior → sigue al nuevo", () => {
    expect(clienteDebeSeguirAlLead({ duenoCliente: "a", duenoAnteriorLead: "a", duenoNuevoLead: "b" })).toBe(true);
  });
  it("cliente reasignado a propósito a otro → no se toca", () => {
    expect(clienteDebeSeguirAlLead({ duenoCliente: "c", duenoAnteriorLead: "a", duenoNuevoLead: "b" })).toBe(false);
  });
  it("desasignar el lead → el cliente no queda sin dueño", () => {
    expect(clienteDebeSeguirAlLead({ duenoCliente: "a", duenoAnteriorLead: "a", duenoNuevoLead: null })).toBe(false);
  });
});
