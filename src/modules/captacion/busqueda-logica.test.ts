import { describe, expect, it } from "vitest";
import {
  consultaOverpass,
  dominioDe,
  elegirTelefono,
  esMovilES,
  fichaDeElemento,
  filtroOsmValido,
  normalizarTelefonoES,
  normalizarWeb,
  telefonosDeHtml,
  zonaValida,
} from "./busqueda-logica";

describe("normalizarTelefonoES", () => {
  it("acepta los formatos habituales", () => {
    expect(normalizarTelefonoES("+34 682 66 37 97")).toBe("+34682663797");
    expect(normalizarTelefonoES("0034682663797")).toBe("+34682663797");
    expect(normalizarTelefonoES("682-66-37-97")).toBe("+34682663797");
    expect(normalizarTelefonoES("(+34) 961 23 45 67")).toBe("+34961234567");
  });
  it("rechaza lo que no es un teléfono español de negocio", () => {
    expect(normalizarTelefonoES("12345")).toBeNull();
    expect(normalizarTelefonoES("+33 6 12 34 56 78")).toBeNull();
    expect(normalizarTelefonoES("902 123 456")).toBeNull();
    expect(normalizarTelefonoES("800 123 456")).toBeNull();
    expect(normalizarTelefonoES("")).toBeNull();
  });
});

describe("esMovilES", () => {
  it("6xx y 71x-74x son móviles; el 70 y los fijos no", () => {
    expect(esMovilES("+34682663797")).toBe(true);
    expect(esMovilES("+34712345678")).toBe(true);
    expect(esMovilES("+34702345678")).toBe(false);
    expect(esMovilES("+34961234567")).toBe(false);
    expect(esMovilES(null)).toBe(false);
  });
});

describe("telefonosDeHtml", () => {
  const html = `
    <a href="https://wa.me/34612345678">WhatsApp</a>
    <a href="tel:+34961234567">Llámanos</a>
    <script type="application/ld+json">{"telephone": "+34 655 11 22 33"}</script>
    <p>Móvil: 699 88 77 66</p>
    <script>var x = "600000000";</script>
  `;
  it("saca cada teléfono con su origen, en orden de confianza", () => {
    expect(telefonosDeHtml(html)).toEqual([
      { e164: "+34612345678", origen: "whatsapp" },
      { e164: "+34961234567", origen: "tel" },
      { e164: "+34655112233", origen: "jsonld" },
      { e164: "+34699887766", origen: "texto" },
    ]);
  });
  it("entiende api.whatsapp.com/send?phone=", () => {
    expect(telefonosDeHtml(`<a href="https://api.whatsapp.com/send?phone=34611223344&text=hola">`)).toEqual([
      { e164: "+34611223344", origen: "whatsapp" },
    ]);
  });
  it("no repite el mismo número", () => {
    expect(telefonosDeHtml(`<a href="tel:612345678">612 345 678</a>`)).toHaveLength(1);
  });
});

describe("elegirTelefono", () => {
  const osmUrl = "https://www.openstreetmap.org/node/1";
  it("prefiere el móvil del enlace de WhatsApp", () => {
    const r = elegirTelefono(
      [{ e164: "+34655000000", origen: "osm" }],
      osmUrl,
      [
        { e164: "+34611000000", origen: "tel", url: "https://a.es" },
        { e164: "+34622000000", origen: "whatsapp", url: "https://a.es/contacto" },
      ],
    );
    expect(r).toEqual({ e164: "+34622000000", prioridad: 3, fuente: "whatsapp_web", url: "https://a.es/contacto", whatsapp: true });
  });
  it("después el móvil de su web, luego el de OSM", () => {
    expect(elegirTelefono([], osmUrl, [{ e164: "+34611000000", origen: "texto", url: "https://a.es" }]).prioridad).toBe(2);
    expect(elegirTelefono([{ e164: "+34655000000", origen: "osm" }], osmUrl, []).url).toBe(osmUrl);
  });
  it("sin móvil se queda con un fijo y prioridad 0", () => {
    const r = elegirTelefono([{ e164: "+34961000000", origen: "osm" }], osmUrl, []);
    expect(r.prioridad).toBe(0);
    expect(r.e164).toBe("+34961000000");
  });
  it("sin nada, nada", () => {
    expect(elegirTelefono([], osmUrl, []).e164).toBeNull();
  });
});

describe("consultaOverpass", () => {
  it("provincia", () => {
    const q = consultaOverpass(['["leisure"="fitness_centre"]'], { tipo: "provincia", iso: "ES-V" });
    expect(q).toContain('area["ISO3166-2"="ES-V"]->.z;');
    expect(q).toContain('nwr["leisure"="fitness_centre"](area.z);');
  });
  it("municipio dentro de su provincia, sin comillas inyectadas", () => {
    const q = consultaOverpass(['["amenity"="cafe"]'], { tipo: "municipio", nombre: 'Tor"rent', provincia_iso: "ES-V" });
    expect(q).toContain('["name"="Torrent"]');
    expect(q).toContain("map_to_area->.z;");
  });
  it("radio", () => {
    const q = consultaOverpass(['["amenity"="cafe"]'], { tipo: "radio", lat: 39.47, lng: -0.37, km: 2 });
    expect(q).toContain("(around:2000,39.47,-0.37)");
  });
  it("rechaza filtros raros y zonas inválidas", () => {
    expect(filtroOsmValido('["amenity"="cafe"];out;')).toBe(false);
    expect(() => consultaOverpass(['["a"="b"];out body;'], { tipo: "provincia", iso: "ES-V" })).toThrow();
    expect(zonaValida({ tipo: "provincia", iso: "FR-75" })).toBe(false);
    expect(zonaValida({ tipo: "radio", lat: 39, lng: 0, km: 500 })).toBe(false);
  });
  it("los filtros de las tipologías sembradas son válidos", () => {
    expect(filtroOsmValido('["office"~"^(company|lawyer|accountant)$"]')).toBe(true);
    expect(filtroOsmValido('["amenity"~"^(clinic|dentist|doctors)$"]')).toBe(true);
  });
});

describe("fichaDeElemento", () => {
  it("convierte un elemento de OSM", () => {
    const f = fichaDeElemento({
      type: "node",
      id: 42,
      lat: 39.4,
      lon: -0.3,
      tags: {
        name: "Gimnasio Uno",
        "addr:street": "Calle Mayor",
        "addr:housenumber": "3",
        "addr:city": "Torrent",
        "addr:postcode": "46900",
        phone: "+34 961 11 22 33; +34 611 22 33 44",
        website: "gimnasiouno.es",
        email: "info@gimnasiouno.es",
      },
    });
    expect(f).toMatchObject({
      nombre: "Gimnasio Uno",
      osm_id: "node/42",
      direccion: "Calle Mayor, 3",
      codigo_postal: "46900",
      web: "https://gimnasiouno.es/",
      telefonos_osm: ["+34 961 11 22 33", "+34 611 22 33 44"],
    });
  });
  it("sin nombre no hay ficha; usa el centro de las vías", () => {
    expect(fichaDeElemento({ type: "node", id: 1, tags: {} })).toBeNull();
    expect(fichaDeElemento({ type: "way", id: 2, center: { lat: 1, lon: 2 }, tags: { name: "X" } })?.lat).toBe(1);
  });
});

describe("web y dominio", () => {
  it("normaliza y saca el dominio sin www", () => {
    expect(normalizarWeb("www.ejemplo.es")).toBe("https://www.ejemplo.es/");
    expect(normalizarWeb("javascript:alert(1)")).toBeNull();
    expect(dominioDe("https://www.Ejemplo.es/contacto")).toBe("ejemplo.es");
  });
});

describe("Places", () => {
  it("nombre desde la web: og:site_name, og:title o title sin eslogan", async () => {
    const { nombreDeHtml } = await import("./busqueda-logica");
    expect(nombreDeHtml(`<meta property="og:site_name" content="Hotel Mar &amp; Sol">`)).toBe("Hotel Mar & Sol");
    expect(nombreDeHtml(`<title>Gestoría Pérez | Asesoría fiscal en Andratx</title>`)).toBe("Gestoría Pérez");
    expect(nombreDeHtml(`<title>Inicio</title>`)).toBeNull();
    expect(nombreDeHtml(`<p>sin título</p>`)).toBeNull();
  });
  it("cuerpo con sesgo de círculo para el radio y texto con lugar para municipio", async () => {
    const { cuerpoPlaces } = await import("./busqueda-logica");
    const r = cuerpoPlaces("hotel", { tipo: "radio", lat: 39.57, lng: 2.42, km: 15 });
    expect(r).toMatchObject({ textQuery: "hotel", locationBias: { circle: { radius: 15000 } }, pageSize: 20 });
    const m = cuerpoPlaces("hotel", { tipo: "municipio", nombre: "Andratx", provincia_iso: "ES-PM" }, "tok");
    expect(m).toMatchObject({ textQuery: "hotel en Andratx, Illes Balears", pageToken: "tok" });
  });
  it("distancia", async () => {
    const { distanciaKm } = await import("./busqueda-logica");
    const d = distanciaKm({ lat: 39.5746, lng: 2.4202 }, { lat: 39.5696, lng: 2.6502 }); // Andratx → Palma
    expect(d).toBeGreaterThan(18);
    expect(d).toBeLessThan(22);
  });
});

describe("fijo con WhatsApp (decisión del 25-11-2026)", () => {
  it("un fijo en un enlace wa.me vale; un fijo suelto, no", async () => {
    const { elegirTelefono, contactablePorWhatsapp } = await import("./busqueda-logica");
    const wa = elegirTelefono([], null, [{ e164: "+34971123456", origen: "whatsapp", url: "https://hotel.es" }]);
    expect(wa).toMatchObject({ e164: "+34971123456", prioridad: 3, fuente: "whatsapp_web", whatsapp: true });
    expect(contactablePorWhatsapp(wa)).toBe(true);
    const fijo = elegirTelefono([{ e164: "+34971123456", origen: "osm" }], "https://osm", []);
    expect(contactablePorWhatsapp(fijo)).toBe(false);
    const movil = elegirTelefono([{ e164: "+34611223344", origen: "osm" }], "https://osm", []);
    expect(contactablePorWhatsapp(movil)).toBe(true);
  });
});
