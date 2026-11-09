import { describe, expect, it } from "vitest";
import {
  aCandidatos,
  callesParecidas,
  calleDeConsulta,
  capitalizarNombre,
  elegirCandidatoCalle,
  municipiosCoinciden,
  parcheDesdeReverse,
  parsearJsonp,
  partesCalle,
  quitarParticulasIniciales,
  separarDireccion,
  type CandidatoCartociudad,
} from "./direccion-texto";

// Fragmentos reales de CartoCiudad (curl 2026-11-09), recortados.
const PALMA_PORTAL = {
  id: "04.07.PML_070400119663",
  province: "Illes Balears",
  muni: "Palma",
  type: "portal",
  address: "CALLE SANT MIQUEL 30, Palma",
  postalCode: "07002",
  poblacion: "Palma",
  tip_via: "CALLE",
  lat: 39.573469930740664,
  lng: 2.6521845298432023,
  portalNumber: 30,
};
const VALENCIA_PORTAL = {
  id: "10.46.250_462500018853",
  province: "València/Valencia",
  muni: "València",
  type: "portal",
  address: "CALLE SANT MIQUEL / SAN MIGUEL 20, València",
  postalCode: "46003",
  poblacion: "València",
  tip_via: "CALLE",
  lat: 39.47688762156442,
  lng: -0.3801737900326135,
  portalNumber: 20,
};

describe("parsearJsonp", () => {
  it("quita el callback de los endpoints *Jsonp", () => {
    const raw = parsearJsonp(`callback(${JSON.stringify([PALMA_PORTAL])})`);
    const c = aCandidatos(raw);
    expect(c).toHaveLength(1);
    expect(c[0]!.postalCode).toBe("07002");
    expect(c[0]!.portalNumber).toBe(30);
  });
  it("acepta JSON plano (objeto de find/reverse)", () => {
    const c = aCandidatos(parsearJsonp(JSON.stringify(PALMA_PORTAL)));
    expect(c[0]!.muni).toBe("Palma");
  });
  it("vacío (HTTP 204) o roto → null", () => {
    expect(parsearJsonp("")).toBeNull();
    expect(parsearJsonp("callback([")).toBeNull();
    expect(aCandidatos(parsearJsonp("callback([])"))).toEqual([]);
  });
  it("descarta candidatos sin tipo o sin dirección", () => {
    expect(aCandidatos([{ id: "x" }, PALMA_PORTAL])).toHaveLength(1);
  });
});

describe("municipiosCoinciden", () => {
  it("ignora tildes y mayúsculas", () => {
    expect(municipiosCoinciden("València", "valencia")).toBe(true);
    expect(municipiosCoinciden("INCA", "Inca")).toBe(true);
  });
  it("Palma ≈ Palma de Mallorca", () => {
    expect(municipiosCoinciden("Palma", "Palma de Mallorca")).toBe(true);
    expect(municipiosCoinciden("Palma de Mallorca", "Palma")).toBe(true);
  });
  it("nombres oficiales con barra o guion", () => {
    expect(municipiosCoinciden("València/Valencia", "Valencia")).toBe(true);
    expect(municipiosCoinciden("Vitoria-Gasteiz", "Vitoria")).toBe(true);
    expect(municipiosCoinciden("Alacant/Alicante", "Alicante")).toBe(true);
  });
  it("artículo inicial y alias", () => {
    expect(municipiosCoinciden("L'Hospitalet de Llobregat", "Hospitalet de Llobregat")).toBe(true);
    expect(municipiosCoinciden("A Coruña", "La Coruña")).toBe(true);
  });
  it("municipios distintos no coinciden", () => {
    expect(municipiosCoinciden("Sant Adrià de Besòs", "Inca")).toBe(false);
    expect(municipiosCoinciden("Sant", "Sant Adrià de Besòs")).toBe(false);
    expect(municipiosCoinciden("", "Inca")).toBe(false);
  });
});

describe("callesParecidas", () => {
  it("Carrer de Sant Miquel ≈ CALLE SANT MIQUEL", () => {
    expect(callesParecidas("Carrer de Sant Miquel", "CALLE SANT MIQUEL")).toBe(true);
  });
  it("Carrer Monasteri ≠ Carrer de Ses Monges", () => {
    expect(callesParecidas("Carrer Monasteri", "Carrer de Ses Monges")).toBe(false);
  });
  it("tolera una errata y tildes", () => {
    expect(callesParecidas("Calle Colon", "CALLE COLÓN")).toBe(true);
    expect(callesParecidas("Carrer de les Monges", "MONGES")).toBe(true);
  });
  it("acepta nombres bilingües del mapa", () => {
    expect(callesParecidas("Calle San Miguel", "SANT MIQUEL / SAN MIGUEL")).toBe(true);
  });
  it("Gran Vía ⊂ Gran Via de les Corts Catalanes", () => {
    expect(callesParecidas("Gran Vía", "Gran Via de les Corts Catalanes")).toBe(true);
  });
  it("calles distintas", () => {
    expect(callesParecidas("Calle Mayor", "Calle Menor")).toBe(false);
    expect(callesParecidas("", "Calle Mayor")).toBe(false);
  });
});

describe("partesCalle y elegirCandidatoCalle", () => {
  const cands = aCandidatos([PALMA_PORTAL, VALENCIA_PORTAL]) as CandidatoCartociudad[];

  it("quita número y municipio del address", () => {
    expect(partesCalle(cands[0]!)).toEqual({ tipo: "CALLE", nombre: "SANT MIQUEL" });
  });
  it("elige el portal exacto del municipio escrito y descarta los demás", () => {
    const e = elegirCandidatoCalle(cands, { calle: "Carrer de Sant Miquel", numero: "30", poblacion: "Palma de Mallorca" });
    expect(e.exacto?.postalCode).toBe("07002");
    const v = elegirCandidatoCalle(cands, { calle: "Carrer de Sant Miquel", numero: "30", poblacion: "Inca" });
    expect(v.exacto).toBeNull();
    expect(v.mismaCalle).toBeNull();
  });
  it("otro número de la misma calle → mismaCalle, no exacto", () => {
    const e = elegirCandidatoCalle(cands, { calle: "Sant Miquel", numero: "32", poblacion: "Palma" });
    expect(e.exacto).toBeNull();
    expect(e.mismaCalle?.portalNumber).toBe(30);
  });
});

describe("separarDireccion", () => {
  it("calle + número + CP + población", () => {
    expect(separarDireccion("Carrer Monasteri 17, 07300 Inca")).toEqual({
      calle: "Carrer Monasteri",
      numero: "17",
      cp: "07300",
      poblacion: "Inca",
      provincia: "",
    });
  });
  it("número en su propio tramo", () => {
    const r = separarDireccion("Calle Mayor, 3, Madrid, España");
    expect(r.calle).toBe("Calle Mayor");
    expect(r.numero).toBe("3");
    expect(r.poblacion).toBe("Madrid");
  });
  it("nº, letra y s/n", () => {
    expect(separarDireccion("C/ Mayor nº 3").numero).toBe("3");
    expect(separarDireccion("Calle Mayor 17B").numero).toBe("17B");
    expect(separarDireccion("Camí de Son Rapinya s/n, Palma").numero).toBe("s/n");
  });
  it("no confunde un número dentro del nombre", () => {
    const r = separarDireccion("Avenida 8 de Marzo");
    expect(r.calle).toBe("Avenida 8 de Marzo");
    expect(r.numero).toBe("");
    expect(separarDireccion("Calle 1 de Mayo 5").numero).toBe("5");
  });
  it("solo calle", () => {
    expect(separarDireccion("Carrer Monasteri")).toMatchObject({ calle: "Carrer Monasteri", numero: "", poblacion: "" });
  });
});

describe("parcheDesdeReverse", () => {
  const rev = {
    street_type: "calle",
    street: "de les Monges",
    street_number: "21",
    postal_code: "07300",
    city: "Inca",
    province: "Illes Balears",
  };
  const vacio = { street_type: "calle", calle: "", numero: "", cp: "", poblacion: "", provincia: "" };

  it("calle escrita a mano: no toca calle ni número y avisa del nombre del mapa", () => {
    const actual = { ...vacio, calle: "Carrer Monasteri", numero: "17", poblacion: "Inca" };
    const r = parcheDesdeReverse(rev, actual, { modo: "todo", respetarCalle: true });
    expect(r.parche.calle).toBeUndefined();
    expect(r.parche.numero).toBeUndefined();
    expect(r.parche.poblacion).toBeUndefined(); // ya coincide
    expect(r.parche.cp).toBe("07300");
    expect(r.parche.provincia).toBe("Illes Balears");
    expect(r.nombreEnMapa).toBe("de les Monges 21");
  });
  it("calle a mano: pisa CP si lo había puesto la app", () => {
    const actual = { ...vacio, calle: "Monasteri", cp: "07001" };
    const r = parcheDesdeReverse(rev, actual, { modo: "huecos", respetarCalle: true, autos: new Set(["cp"]) });
    expect(r.parche.cp).toBe("07300");
  });
  it("calle a mano y escrito por el usuario: no pisa el CP", () => {
    const actual = { ...vacio, calle: "Monasteri", cp: "07001" };
    const r = parcheDesdeReverse(rev, actual, { modo: "todo", respetarCalle: true });
    expect(r.parche.cp).toBeUndefined();
  });
  it("calle automática, modo todo: rellena todo", () => {
    const actual = { ...vacio, calle: "Otra", numero: "1" };
    const r = parcheDesdeReverse(rev, actual, { modo: "todo", respetarCalle: false });
    expect(r.parche).toMatchObject({ calle: "de les Monges", numero: "21", cp: "07300", poblacion: "Inca" });
    expect(r.nombreEnMapa).toBeNull();
  });
  it("modo huecos: no pisa lo escrito", () => {
    const actual = { ...vacio, calle: "Otra" };
    const r = parcheDesdeReverse(rev, actual, { modo: "huecos", respetarCalle: false });
    expect(r.parche.calle).toBeUndefined();
    expect(r.parche.numero).toBe("21");
  });
});

describe("utilidades", () => {
  it("quitarParticulasIniciales", () => {
    expect(quitarParticulasIniciales("DE LES MONGES")).toBe("MONGES");
    expect(quitarParticulasIniciales("SANT MIQUEL")).toBe("SANT MIQUEL");
    expect(quitarParticulasIniciales("DE")).toBe("DE");
  });
  it("capitalizarNombre", () => {
    expect(capitalizarNombre("CALLE DE LES MONGES")).toBe("Calle de les Monges");
    expect(capitalizarNombre("SANT MIQUEL / SAN MIGUEL")).toBe("Sant Miquel / San Miguel");
  });
  it("calleDeConsulta salta el tipo de vía suelto", () => {
    expect(calleDeConsulta("calle, Mayor, 3, 28013, Madrid, España")).toBe("Mayor");
    expect(calleDeConsulta("Carrer Monasteri 17, 07300, Inca")).toBe("Carrer Monasteri");
    expect(calleDeConsulta("07300, España")).toBe("España");
  });
});
