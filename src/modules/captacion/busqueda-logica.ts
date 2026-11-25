/**
 * Lógica pura de la búsqueda de negocios (fase 6): teléfonos, consulta de
 * Overpass y fichas. Sin red ni base de datos, para probarla con vitest.
 * Portada de D:\THERAMIC_WEB\herramientas\buscar-en-mapa.mjs.
 */

// -----------------------------------------------------------------------------
// Teléfonos (solo España en el MVP)
// -----------------------------------------------------------------------------

/** «+34 682 66 37 97», «0034682663797», «682-663-797» → «+34682663797». Lo demás, null. */
export function normalizarTelefonoES(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  let d = String(bruto).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("34")) d = d.slice(2);
  if (!/^[6789]\d{8}$/.test(d)) return null;
  // 80x y 90x son números de tarificación especial: no son de un negocio al que escribir.
  if (/^(80|90)/.test(d)) return null;
  return `+34${d}`;
}

/** Móvil español: 6xx o 71x–74x (el 70 es numeración personal). */
export function esMovilES(e164: string | null | undefined): boolean {
  return Boolean(e164 && /^\+34(6\d|7[1-4])\d{7}$/.test(e164));
}

export type OrigenTelefono = "whatsapp" | "tel" | "jsonld" | "texto" | "osm";

export interface CandidatoTelefono {
  e164: string;
  origen: OrigenTelefono;
}

/** Quita etiquetas, scripts y estilos para buscar teléfonos en el texto visible. */
function textoVisible(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#43;|&plus;/gi, "+");
}

/**
 * Teléfonos publicados en una página, en este orden de confianza:
 * enlaces de WhatsApp (wa.me / api.whatsapp.com), enlaces tel:, el
 * `telephone` del JSON-LD y, por último, el texto. Nunca se adivina nada:
 * solo lo que está escrito.
 */
export function telefonosDeHtml(html: string): CandidatoTelefono[] {
  const out: CandidatoTelefono[] = [];
  const vistos = new Set<string>();
  const meter = (bruto: string, origen: OrigenTelefono) => {
    const e = normalizarTelefonoES(decodeURIComponentSeguro(bruto));
    if (e && !vistos.has(e)) {
      vistos.add(e);
      out.push({ e164: e, origen });
    }
  };

  for (const m of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'>\s]*&(?:amp;)?)?phone=)(\+?\d[\d%+]{7,16})/gi)) {
    meter(m[1]!, "whatsapp");
  }
  for (const m of html.matchAll(/href\s*=\s*["']\s*tel:([^"']+)["']/gi)) meter(m[1]!, "tel");
  for (const m of html.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)) meter(m[1]!, "jsonld");
  const texto = textoVisible(html);
  for (const m of texto.matchAll(/(?:\+34|0034)?[\s.\-()]*[6789](?:[\s.\-]*\d){8}(?!\d)/g)) {
    meter(m[0], "texto");
  }
  return out;
}

function decodeURIComponentSeguro(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface TelefonoElegido {
  e164: string | null;
  /** 3 = móvil de enlace de WhatsApp · 2 = móvil de su web · 1 = móvil de OSM · 0 = sin móvil */
  prioridad: 0 | 1 | 2 | 3;
  fuente: "osm" | "web_propia" | "whatsapp_web" | null;
  url: string | null;
}

/**
 * Elige el teléfono: primero un móvil (con la prioridad del plan §4.2.8) y,
 * si no hay ninguno, el primer fijo (que irá a «revisar»).
 */
export function elegirTelefono(
  deOsm: CandidatoTelefono[],
  urlOsm: string,
  deWeb: Array<CandidatoTelefono & { url: string }>,
): TelefonoElegido {
  const waMovil = deWeb.find((c) => c.origen === "whatsapp" && esMovilES(c.e164));
  if (waMovil) return { e164: waMovil.e164, prioridad: 3, fuente: "whatsapp_web", url: waMovil.url };
  const webMovil = deWeb.find((c) => esMovilES(c.e164));
  if (webMovil) return { e164: webMovil.e164, prioridad: 2, fuente: "web_propia", url: webMovil.url };
  const osmMovil = deOsm.find((c) => esMovilES(c.e164));
  if (osmMovil) return { e164: osmMovil.e164, prioridad: 1, fuente: "osm", url: urlOsm };
  const osmFijo = deOsm[0];
  if (osmFijo) return { e164: osmFijo.e164, prioridad: 0, fuente: "osm", url: urlOsm };
  const webFijo = deWeb[0];
  if (webFijo) return { e164: webFijo.e164, prioridad: 0, fuente: "web_propia", url: webFijo.url };
  return { e164: null, prioridad: 0, fuente: null, url: null };
}

// -----------------------------------------------------------------------------
// Zonas y consulta de Overpass
// -----------------------------------------------------------------------------

export type Zona =
  | { tipo: "provincia"; iso: string; nombre?: string }
  | { tipo: "municipio"; nombre: string; provincia_iso: string }
  | { tipo: "radio"; lat: number; lng: number; km: number };

/** Provincias por su código ISO 3166-2, que es como las tiene OpenStreetMap. */
export const PROVINCIAS: ReadonlyArray<{ iso: string; nombre: string }> = [
  { iso: "ES-C", nombre: "A Coruña" }, { iso: "ES-VI", nombre: "Álava" }, { iso: "ES-AB", nombre: "Albacete" },
  { iso: "ES-A", nombre: "Alicante" }, { iso: "ES-AL", nombre: "Almería" }, { iso: "ES-O", nombre: "Asturias" },
  { iso: "ES-AV", nombre: "Ávila" }, { iso: "ES-BA", nombre: "Badajoz" }, { iso: "ES-PM", nombre: "Illes Balears" },
  { iso: "ES-B", nombre: "Barcelona" }, { iso: "ES-BI", nombre: "Bizkaia" }, { iso: "ES-BU", nombre: "Burgos" },
  { iso: "ES-CC", nombre: "Cáceres" }, { iso: "ES-CA", nombre: "Cádiz" }, { iso: "ES-S", nombre: "Cantabria" },
  { iso: "ES-CS", nombre: "Castellón" }, { iso: "ES-CE", nombre: "Ceuta" }, { iso: "ES-CR", nombre: "Ciudad Real" },
  { iso: "ES-CO", nombre: "Córdoba" }, { iso: "ES-CU", nombre: "Cuenca" }, { iso: "ES-SS", nombre: "Gipuzkoa" },
  { iso: "ES-GI", nombre: "Girona" }, { iso: "ES-GR", nombre: "Granada" }, { iso: "ES-GU", nombre: "Guadalajara" },
  { iso: "ES-H", nombre: "Huelva" }, { iso: "ES-HU", nombre: "Huesca" }, { iso: "ES-J", nombre: "Jaén" },
  { iso: "ES-LO", nombre: "La Rioja" }, { iso: "ES-GC", nombre: "Las Palmas" }, { iso: "ES-LE", nombre: "León" },
  { iso: "ES-L", nombre: "Lleida" }, { iso: "ES-LU", nombre: "Lugo" }, { iso: "ES-M", nombre: "Madrid" },
  { iso: "ES-MA", nombre: "Málaga" }, { iso: "ES-ML", nombre: "Melilla" }, { iso: "ES-MU", nombre: "Murcia" },
  { iso: "ES-NA", nombre: "Navarra" }, { iso: "ES-OR", nombre: "Ourense" }, { iso: "ES-P", nombre: "Palencia" },
  { iso: "ES-PO", nombre: "Pontevedra" }, { iso: "ES-SA", nombre: "Salamanca" },
  { iso: "ES-TF", nombre: "Santa Cruz de Tenerife" }, { iso: "ES-SG", nombre: "Segovia" },
  { iso: "ES-SE", nombre: "Sevilla" }, { iso: "ES-SO", nombre: "Soria" }, { iso: "ES-T", nombre: "Tarragona" },
  { iso: "ES-TE", nombre: "Teruel" }, { iso: "ES-TO", nombre: "Toledo" }, { iso: "ES-V", nombre: "Valencia" },
  { iso: "ES-VA", nombre: "Valladolid" }, { iso: "ES-ZA", nombre: "Zamora" }, { iso: "ES-Z", nombre: "Zaragoza" },
];

const ISO_VALIDOS = new Set(PROVINCIAS.map((p) => p.iso));

/** Un filtro de Overpass admitido: [“clave”=“valor”] o [“clave”~“regex”], encadenables. */
const FILTRO_OSM = /^(\["[a-z][a-z0-9:_]*"(=|~)"[A-Za-z0-9_:|^$() \-]+"\])+$/;

export function filtroOsmValido(f: string): boolean {
  return FILTRO_OSM.test(f);
}

/** Nombre de municipio sin nada que pueda romper la consulta. */
function nombreSeguro(n: string): string {
  return n.replace(/["\\\n\r]/g, "").trim().slice(0, 80);
}

export function zonaValida(z: Zona): boolean {
  if (z.tipo === "provincia") return ISO_VALIDOS.has(z.iso);
  if (z.tipo === "municipio") return ISO_VALIDOS.has(z.provincia_iso) && nombreSeguro(z.nombre).length > 1;
  if (z.tipo === "radio") {
    return (
      Number.isFinite(z.lat) && Number.isFinite(z.lng) && Math.abs(z.lat) <= 90 && Math.abs(z.lng) <= 180 &&
      Number.isFinite(z.km) && z.km > 0 && z.km <= 50
    );
  }
  return false;
}

export function describirZona(z: Zona): string {
  if (z.tipo === "provincia") return `Provincia de ${PROVINCIAS.find((p) => p.iso === z.iso)?.nombre ?? z.iso}`;
  if (z.tipo === "municipio") {
    const prov = PROVINCIAS.find((p) => p.iso === z.provincia_iso)?.nombre ?? z.provincia_iso;
    return `${z.nombre} (${prov})`;
  }
  return `${z.km} km alrededor de ${z.lat.toFixed(4)}, ${z.lng.toFixed(4)}`;
}

/** Tope de elementos que se piden a Overpass por búsqueda. */
export const MAX_ELEMENTOS = 600;

export function consultaOverpass(filtros: string[], z: Zona): string {
  const fs = filtros.filter(filtroOsmValido);
  if (fs.length === 0) throw new Error("La campaña no tiene etiquetas de OpenStreetMap válidas.");
  if (!zonaValida(z)) throw new Error("Zona no válida.");
  const cab = "[out:json][timeout:90];";
  let area = "";
  let sufijo: string;
  if (z.tipo === "provincia") {
    area = `area["ISO3166-2"="${z.iso}"]->.z;`;
    sufijo = "(area.z)";
  } else if (z.tipo === "municipio") {
    area =
      `area["ISO3166-2"="${z.provincia_iso}"]->.p;` +
      `rel(area.p)["boundary"="administrative"]["admin_level"="8"]["name"="${nombreSeguro(z.nombre)}"];` +
      `map_to_area->.z;`;
    sufijo = "(area.z)";
  } else {
    sufijo = `(around:${Math.round(z.km * 1000)},${z.lat},${z.lng})`;
  }
  const cuerpo = fs.map((f) => `nwr${f}${sufijo};`).join("");
  return `${cab}${area}(${cuerpo});out center tags ${MAX_ELEMENTOS};`;
}

// -----------------------------------------------------------------------------
// De elemento de OSM a ficha
// -----------------------------------------------------------------------------

export interface ElementoOsm {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface FichaNegocio {
  nombre: string;
  osm_id: string;
  osm_url: string;
  direccion: string | null;
  municipio: string | null;
  codigo_postal: string | null;
  lat: number | null;
  lng: number | null;
  web: string | null;
  email: string | null;
  telefonos_osm: string[];
}

const CORREO_BASURA = /(sentry|wixpress|example\.|\.png|\.jpe?g|\.webp|\.gif|@2x|domain\.com|email\.com|tuempresa|yourdomain)/i;

export function normalizarWeb(w: string | null | undefined): string | null {
  if (!w) return null;
  const t = String(w).trim().split(/[;\s]/)[0]!;
  if (!t) return null;
  const conEsquema = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(conEsquema);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Dominio principal sin «www.» (para no escribir dos veces a la misma web). */
export function dominioDe(web: string | null | undefined): string | null {
  if (!web) return null;
  try {
    return new URL(web).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function fichaDeElemento(el: ElementoOsm): FichaNegocio | null {
  const t = el.tags ?? {};
  const nombre = (t.name ?? t.brand ?? "").trim();
  if (!nombre) return null;
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const calle = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  const correo = (t.email ?? t["contact:email"] ?? "").toLowerCase().trim();
  const telefonos = [t.phone, t["contact:phone"], t["contact:mobile"], t.mobile, t["contact:whatsapp"]]
    .filter(Boolean)
    .flatMap((v) => String(v).split(/[;,/]/))
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    nombre: nombre.slice(0, 200),
    osm_id: `${el.type}/${el.id}`,
    osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    direccion: calle || null,
    municipio: t["addr:city"] ?? t["addr:town"] ?? t["addr:village"] ?? null,
    codigo_postal: /^\d{5}$/.test(t["addr:postcode"] ?? "") ? t["addr:postcode"]! : null,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    web: normalizarWeb(t.website ?? t["contact:website"] ?? t.url),
    email: correo && correo.includes("@") && !CORREO_BASURA.test(correo) ? correo : null,
    telefonos_osm: telefonos,
  };
}
