/**
 * Lógica PURA de direcciones (sin red, sin BD, sin React). Importable desde
 * cliente, servidor y tests. NO marcar "use server" ni "server-only".
 *
 * Contiene:
 *  · normalización de textos y comparación de municipios con variantes
 *    («Palma» ≈ «Palma de Mallorca», «València» ≈ «Valencia»);
 *  · parecido de nombres de calle («Carrer de Sant Miquel» ≈ «CALLE SANT
 *    MIQUEL», pero «Carrer Monasteri» ≠ «Carrer de Ses Monges»);
 *  · parseo de las respuestas JSONP de CartoCiudad y elección de candidato;
 *  · separación calle / número / CP / población del texto escrito a mano;
 *  · cálculo del parche que aplica un reverse geocode sobre el formulario.
 */

import { detectStreetType } from "./street-type";
import { provinceFromPostalCode, provincesMatch } from "@/shared/lib/validations/spanish";

// ─────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────

/** Minúsculas, sin tildes, sin puntuación y con espacios simples. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distancia de edición (Levenshtein) entre dos cadenas. */
export function distanciaEdicion(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + coste);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

// ─────────────────────────────────────────────────────────────────────
// Municipios
// ─────────────────────────────────────────────────────────────────────

const ARTICULOS_INICIALES = new Set([
  "l", "la", "el", "els", "les", "los", "las", "a", "o", "os", "as", "s", "sa", "es", "ses",
]);

// Cada grupo: nombres del MISMO municipio que no se resuelven solo con
// quitar tildes ni con la regla «Palma» ⊂ «Palma de Mallorca».
const ALIAS_MUNICIPIOS: string[][] = [
  ["alicante", "alacant"],
  ["castellon de la plana", "castello de la plana", "castellon", "castello"],
  ["san sebastian", "donostia"],
  ["coruna", "a coruna", "la coruna"],
  ["girona", "gerona"],
  ["lleida", "lerida"],
  ["ourense", "orense"],
  ["elche", "elx"],
  ["xativa", "jativa"],
  ["sanxenxo", "sangenjo"],
  ["vitoria", "gasteiz", "vitoria gasteiz"],
  ["bilbao", "bilbo"],
  ["pamplona", "iruna"],
  ["mahon", "mao"],
  ["ibiza", "eivissa"],
];
const ALIAS_MAPA = new Map<string, string>();
for (const g of ALIAS_MUNICIPIOS) for (const n of g) ALIAS_MAPA.set(n, g[0]!);

function sinArticuloInicial(tokens: string[]): string[] {
  if (tokens.length > 1 && ARTICULOS_INICIALES.has(tokens[0]!)) return tokens.slice(1);
  return tokens;
}

/** Variantes de un nombre oficial: «València/Valencia», «Vitoria-Gasteiz»,
 *  «Villabuena (Cacabelos)» → cada parte por separado y el nombre entero. */
function variantesMunicipio(nombre: string): string[][] {
  const limpio = nombre.replace(/\([^)]*\)/g, " ");
  const partes = [limpio, ...limpio.split(/[/-]/)];
  const out: string[][] = [];
  for (const p of partes) {
    const n = normalizar(p);
    if (!n) continue;
    const alias = ALIAS_MAPA.get(n);
    out.push(sinArticuloInicial((alias ?? n).split(" ")));
  }
  return out;
}

const UNIONES = new Set(["de", "del", "d", "la", "el", "dels"]);

function tokensMunicipioIguales(a: string[], b: string[]): boolean {
  if (a.join(" ") === b.join(" ")) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length === 0 || corto.length === largo.length) return false;
  for (let i = 0; i < corto.length; i++) if (corto[i] !== largo[i]) return false;
  // «palma» ⊂ «palma de mallorca»: solo si lo que sigue empieza por «de…».
  return UNIONES.has(largo[corto.length]!);
}

/** ¿Dos nombres de municipio son el mismo sitio? Vacío → false. */
export function municipiosCoinciden(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!normalizar(a) || !normalizar(b)) return false;
  const va = variantesMunicipio(a!);
  const vb = variantesMunicipio(b!);
  for (const x of va) for (const y of vb) if (tokensMunicipioIguales(x, y)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Calles
// ─────────────────────────────────────────────────────────────────────

/** Tipos de vía (normalizados) en castellano, catalán, gallego y euskera. */
const TIPOS_VIA = new Set([
  "calle", "c", "cl", "cll", "carrer", "carre", "cr", "kalea", "k", "rua",
  "avenida", "avinguda", "av", "avda", "avd", "avgda", "etorbidea",
  "plaza", "placa", "pl", "pza", "plz", "placeta", "plazuela", "praza", "enparantza",
  "paseo", "passeig", "pg", "ps", "pso", "po", "pasealekua",
  "camino", "cami", "cm", "cno", "cmno", "bidea",
  "carretera", "ctra", "cra", "crta",
  "ronda", "rda", "travesia", "travessera", "travessia", "trav", "tr", "trva",
  "glorieta", "urbanizacion", "urb", "poligono", "pol", "via",
  "pasaje", "passatge", "psje", "costa", "cuesta", "callejon", "carrero",
  "rambla", "lugar", "barrio", "barri", "partida", "diseminado", "diseminados", "sector",
]);

/** Partículas que no distinguen una calle de otra («de», «les», «ses»…). */
const PARTICULAS = new Set([
  "de", "del", "d", "la", "el", "les", "los", "las", "l", "els", "dels",
  "sa", "ses", "es", "s", "en", "na", "n", "i", "y", "da", "do", "das", "dos", "a", "o",
]);

const SINONIMOS: Record<string, string> = {
  sant: "san",
  sta: "santa",
  st: "san",
  nra: "nuestra",
  ntra: "nuestra",
  sra: "senora",
  sr: "senor",
};

/** Núcleo comparable de un nombre de calle: sin tipo de vía, sin partículas,
 *  sin números ni «s/n». «Carrer de Sant Miquel 30» → ["san", "miquel"]. */
export function nucleoCalle(nombre: string | null | undefined): string[] {
  let tokens = normalizar(nombre).split(" ").filter(Boolean);
  if (tokens.length > 1 && TIPOS_VIA.has(tokens[0]!)) tokens = tokens.slice(1);
  // «s/n» normalizado queda «s n»; los números sueltos tampoco cuentan.
  tokens = tokens.filter((t) => !/^\d+[a-z]?$/.test(t) && t !== "sn" && t !== "n" && t !== "s");
  return tokens
    .filter((t) => !PARTICULAS.has(t))
    .map((t) => SINONIMOS[t] ?? t);
}

function tokenParecido(a: string, b: string): boolean {
  if (a === b) return true;
  const max = Math.max(a.length, b.length);
  if (max < 4) return false;
  const tope = max >= 8 ? 2 : 1;
  return distanciaEdicion(a, b) <= tope;
}

function nucleosParecidos(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  if (a.length === b.length) return a.every((t, i) => tokenParecido(t, b[i]!));
  // Uno contiene al otro en orden («Gran Vía» ⊂ «Gran Vía Corts Catalanes»).
  const [corto, largo] = a.length < b.length ? [a, b] : [b, a];
  if (corto.join("").length < 4) return false;
  let j = 0;
  for (const t of largo) {
    if (j < corto.length && tokenParecido(corto[j]!, t)) j++;
  }
  return j === corto.length;
}

/**
 * ¿La calle escrita y la devuelta por un geocodificador son la misma?
 * Tolera tipo de vía en otro idioma, partículas, tildes y una errata.
 * Acepta nombres bilingües del mapa («SANT MIQUEL / SAN MIGUEL»).
 */
export function callesParecidas(
  escrita: string | null | undefined,
  devuelta: string | null | undefined,
): boolean {
  const a = nucleoCalle(escrita);
  if (!a.length) return false;
  const variantes = [devuelta ?? "", ...(devuelta ?? "").split("/")];
  return variantes.some((v) => nucleosParecidos(a, nucleoCalle(v)));
}

/** «DE LES MONGES» → «MONGES». CartoCiudad a veces guarda la misma calle con
 *  y sin partículas, y solo una de las dos versiones tiene todos los portales. */
export function quitarParticulasIniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/);
  let i = 0;
  while (i < palabras.length - 1 && PARTICULAS.has(normalizar(palabras[i]))) i++;
  return palabras.slice(i).join(" ");
}

/** «CALLE DE LES MONGES» → «Calle de les Monges». */
export function capitalizarNombre(s: string): string {
  const minus = new Set([...PARTICULAS, "dels"]);
  return s
    .toLowerCase()
    .split(/(\s+|\/)/)
    .map((w, i) => {
      if (!w.trim() || w === "/") return w;
      if (i > 0 && minus.has(normalizar(w))) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join("")
    .replace(/\b(D|L)'(\p{L})/gu, (_m, a: string, b: string) => `${a.toLowerCase()}'${b.toUpperCase()}`);
}

/** ¿El número escrito («17», «17B», «17-19») corresponde al portal? */
export function numerosCoinciden(
  escrito: string | null | undefined,
  portal: number | string | null | undefined,
): boolean {
  const m = (escrito ?? "").trim().match(/^\d+/);
  if (!m || portal == null || portal === "") return false;
  return parseInt(m[0], 10) === parseInt(String(portal), 10);
}

// ─────────────────────────────────────────────────────────────────────
// CartoCiudad
// ─────────────────────────────────────────────────────────────────────

/** Campos verificados (curl 2026-11-09) de un candidato de CartoCiudad. */
export interface CandidatoCartociudad {
  id: string;
  /** "portal" | "callejero" | "Municipio" | "poblacion" | "toponimo" | "expendeduria" | "codpost"… */
  type: string;
  address: string;
  portalNumber: number | null;
  postalCode: string | null;
  muni: string | null;
  poblacion: string | null;
  province: string | null;
  tip_via: string | null;
  lat: number;
  lng: number;
}

/**
 * Parsea la respuesta de CartoCiudad: `callback([...])` (endpoints *Jsonp)
 * o JSON plano. Devuelve null si el texto está vacío (HTTP 204) o roto.
 */
export function parsearJsonp(texto: string | null | undefined): unknown {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const m = t.match(/^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/);
  try {
    return JSON.parse(m ? m[1]! : t);
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Valida y tipa un objeto crudo de CartoCiudad. */
export function aCandidato(x: unknown): CandidatoCartociudad | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const type = str(o.type);
  const address = str(o.address);
  if (!type || !address) return null;
  return {
    id: str(o.id) ?? String(o.id ?? ""),
    type,
    address,
    portalNumber: num(o.portalNumber),
    postalCode: str(o.postalCode),
    muni: str(o.muni),
    poblacion: str(o.poblacion),
    province: str(o.province),
    tip_via: str(o.tip_via),
    lat: num(o.lat) ?? 0,
    lng: num(o.lng) ?? 0,
  };
}

/** Lista de candidatos desde la respuesta cruda (array u objeto suelto). */
export function aCandidatos(raw: unknown): CandidatoCartociudad[] {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr.map(aCandidato).filter((c): c is CandidatoCartociudad => c !== null);
}

export function tieneCoordenadas(c: { lat: number; lng: number }): boolean {
  return c.lat !== 0 && c.lng !== 0;
}

/**
 * Nombre de la vía de un candidato, sin municipio ni número.
 * «CALLE SANT MIQUEL 30, Palma» → {tipo: "CALLE", nombre: "SANT MIQUEL"}.
 * En find/reverse el address ya viene limpio («MONGES») con tip_via aparte.
 */
export function partesCalle(c: CandidatoCartociudad): { tipo: string | null; nombre: string } {
  let s = c.address;
  const coma = s.lastIndexOf(", ");
  if (coma > 0) s = s.slice(0, coma);
  s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (c.portalNumber != null) {
    s = s.replace(new RegExp(`\\s+${c.portalNumber}\\s*[A-Za-z]?$`), "").trim();
  }
  const tipo = c.tip_via;
  if (tipo && s.toUpperCase().startsWith(`${tipo.toUpperCase()} `)) {
    s = s.slice(tipo.length).trim();
  }
  return { tipo, nombre: s };
}

/** ¿El candidato está en la población (o CP) que escribió el usuario? */
export function candidatoEnSitio(
  c: CandidatoCartociudad,
  sitio: { poblacion?: string | null; cp?: string | null },
): boolean {
  const pob = (sitio.poblacion ?? "").trim();
  if (pob) return municipiosCoinciden(c.muni, pob) || municipiosCoinciden(c.poblacion, pob);
  const cp = (sitio.cp ?? "").trim();
  return Boolean(cp && c.postalCode === cp);
}

export interface EleccionCalle {
  /** Portal con el número pedido en la calle y municipio pedidos. */
  exacto: CandidatoCartociudad | null;
  /** Algo de la misma calle (otro portal o el tramo de callejero). */
  mismaCalle: CandidatoCartociudad | null;
}

/** Elige entre candidatos de CartoCiudad descartando otros municipios y otras calles. */
export function elegirCandidatoCalle(
  cands: CandidatoCartociudad[],
  pedido: { calle: string; numero?: string | null; poblacion?: string | null; cp?: string | null },
): EleccionCalle {
  const validos = cands.filter(
    (c) =>
      (c.type === "portal" || c.type === "callejero") &&
      candidatoEnSitio(c, pedido) &&
      callesParecidas(pedido.calle, partesCalle(c).nombre),
  );
  const exacto =
    validos.find(
      (c) => c.type === "portal" && tieneCoordenadas(c) && numerosCoinciden(pedido.numero, c.portalNumber),
    ) ?? null;
  const n = parseInt((pedido.numero ?? "").match(/^\d+/)?.[0] ?? "", 10);
  const portales = validos
    .filter((c) => c.type === "portal" && tieneCoordenadas(c))
    .sort((a, b) =>
      Number.isFinite(n) ? Math.abs((a.portalNumber ?? 0) - n) - Math.abs((b.portalNumber ?? 0) - n) : 0,
    );
  const mismaCalle = portales[0] ?? validos.find((c) => c.type === "callejero") ?? null;
  return { exacto, mismaCalle };
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Provincia a mostrar: la del CP si es válido; si no, la primera variante del mapa. */
export function provinciaPreferida(cp: string | null | undefined, delMapa: string | null | undefined): string | null {
  const porCp = cp ? provinceFromPostalCode(cp) : null;
  const mapa = (delMapa ?? "").split("/")[0]?.trim() || null;
  if (porCp && mapa && provincesMatch(mapa, porCp)) return mapa;
  return porCp ?? mapa;
}

// ─────────────────────────────────────────────────────────────────────
// Texto escrito a mano («No aparece: escribirla a mano»)
// ─────────────────────────────────────────────────────────────────────

export interface DireccionSeparada {
  calle: string;
  numero: string;
  cp: string;
  poblacion: string;
  provincia: string;
}

const NUMERO_RE = /^(?:n[ºo°.]?\s*|num\.?\s*|número\s*)?(\d+\s*[a-zA-Z]?(?:\s*[-–]\s*\d+)?|s\s*\/\s*n|sn)$/i;

/**
 * «Carrer Monasteri 17, 07300 Inca» → {calle: "Carrer Monasteri", numero: "17",
 * cp: "07300", poblacion: "Inca"}. Tolera «C/ Mayor nº 3», «Calle X, 3, Madrid»
 * y «s/n». Lo que no reconoce lo deja vacío: nunca inventa.
 */
export function separarDireccion(texto: string): DireccionSeparada {
  const out: DireccionSeparada = { calle: "", numero: "", cp: "", poblacion: "", provincia: "" };
  const segs = texto
    .replace(/\s+/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (segs.length && /^(espa[ñn]a|spain)$/i.test(segs[segs.length - 1]!)) segs.pop();
  if (!segs.length) return out;

  let primero = segs.shift()!;
  // Número al final del primer tramo: «Carrer Monasteri 17», «C/ Mayor nº 3».
  const m = primero.match(
    /^(.*?\S)\s+(?:n[ºo°.]?\s*|num\.?\s*)?(\d+\s*[a-zA-Z]?(?:\s*[-–]\s*\d+)?|s\s*\/\s*n)$/i,
  );
  if (m && /\p{L}/u.test(m[1]!)) {
    primero = m[1]!;
    out.numero = m[2]!.replace(/\s+/g, "");
  } else if (segs.length && NUMERO_RE.test(segs[0]!)) {
    out.numero = segs.shift()!.match(NUMERO_RE)![1]!.replace(/\s+/g, "");
  }
  out.calle = primero.trim();
  if (/^s\/?n$/i.test(out.numero)) out.numero = "s/n";

  const resto: string[] = [];
  for (const s of segs) {
    const cp = s.match(/^(\d{5})\b\s*(.*)$/) ?? s.match(/^(.*?)\s*\b(\d{5})$/);
    if (!out.cp && cp) {
      const [codigo, otro] = /^\d{5}$/.test(cp[1]!) ? [cp[1]!, cp[2]!] : [cp[2]!, cp[1]!];
      out.cp = codigo;
      if (otro.trim()) resto.push(otro.trim());
      continue;
    }
    resto.push(s);
  }
  out.poblacion = resto[0] ?? "";
  out.provincia = resto[1] ?? "";
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Reverse geocode → parche del formulario
// ─────────────────────────────────────────────────────────────────────

export interface CamposDireccion {
  street_type: string;
  calle: string;
  numero: string;
  cp: string;
  poblacion: string;
  provincia: string;
}

export interface ReverseParaParche {
  street_type: string;
  street: string;
  street_number: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
}

export type CampoAuto = "cp" | "poblacion" | "provincia";

/**
 * Qué campos cambia un reverse geocode.
 *  · modo "todo": pisa todo lo que el mapa sabe (GPS, chincheta en leads).
 *  · modo "huecos": solo rellena lo vacío.
 *  · respetarCalle: la calle la escribió el usuario → nunca se tocan calle,
 *    tipo de vía ni número; CP/población/provincia solo si están vacíos o los
 *    puso la app (`autos`).
 * Devuelve el parche y, si la calle del mapa se llama distinto, ese nombre.
 */
export function parcheDesdeReverse(
  rev: ReverseParaParche,
  actual: CamposDireccion,
  opciones: { modo: "todo" | "huecos"; respetarCalle: boolean; autos?: ReadonlySet<CampoAuto> },
): { parche: Partial<CamposDireccion>; nombreEnMapa: string | null; rellenados: string[] } {
  const parche: Partial<CamposDireccion> = {};
  const rellenados: string[] = [];
  const autos = opciones.autos ?? new Set<CampoAuto>();
  const puede = (campo: keyof CamposDireccion, valorActual: string): boolean => {
    if (opciones.respetarCalle) {
      if (campo === "calle" || campo === "numero" || campo === "street_type") return false;
      return !valorActual.trim() || autos.has(campo as CampoAuto);
    }
    return opciones.modo === "todo" || !valorActual.trim();
  };

  const cpProv = rev.postal_code ? provinceFromPostalCode(rev.postal_code) : null;
  const provincia = cpProv && !provincesMatch(rev.province, cpProv) ? cpProv : rev.province;

  const pon = (campo: keyof CamposDireccion, valor: string | null | undefined, etiqueta: string) => {
    if (!valor) return;
    if (!puede(campo, actual[campo])) return;
    if (actual[campo] === valor) return;
    parche[campo] = valor;
    rellenados.push(etiqueta);
  };
  if (rev.street) {
    pon("street_type", rev.street_type, "tipo de vía");
    pon("calle", rev.street, "calle");
  }
  pon("numero", rev.street_number, "nº");
  pon("cp", rev.postal_code, "CP");
  pon("poblacion", rev.city, "población");
  pon("provincia", provincia, "provincia");

  let nombreEnMapa: string | null = null;
  if (opciones.respetarCalle && rev.street && actual.calle.trim()) {
    const delMapa = `${rev.street}${rev.street_number ? ` ${rev.street_number}` : ""}`;
    const mismaCalle = callesParecidas(actual.calle, rev.street);
    const mismoNumero = !rev.street_number || numerosCoinciden(actual.numero, rev.street_number);
    if (!mismaCalle || !mismoNumero) nombreEnMapa = delMapa;
  }
  return { parche, nombreEnMapa, rellenados };
}

/** Tipo de vía del formulario a partir del tip_via de CartoCiudad («CALLE», «AVENIDA»…). */
export function tipoViaDesde(tipVia: string | null | undefined): string {
  if (!tipVia) return "calle";
  return detectStreetType(`${tipVia} x`).type;
}

/** Clave para saber si ya resolvimos esta combinación. */
export function claveDireccion(c: { calle: string; numero: string; cp: string; poblacion: string }): string {
  return [c.calle, c.numero, c.cp, c.poblacion].map(normalizar).join("|");
}

/**
 * Para el filtro anti-«otra calle» de forwardGeocodeAction, que solo recibe un
 * texto: la calle es el primer tramo con letras que no sea solo el tipo de vía
 * («calle, Mayor, 3, …» → «Mayor»). Sin número ni CP. Puede ser un pueblo si la
 * consulta no lleva calle: por eso solo se compara cuando el resultado trae vía.
 */
export function calleDeConsulta(consulta: string): string | null {
  for (const seg of consulta.split(",")) {
    const n = normalizar(seg);
    if (!n || !/[a-z]/.test(n)) continue;
    if (TIPOS_VIA.has(n)) continue;
    return seg.replace(/\s+\d+\s*[a-zA-Z]?$/, "").trim();
  }
  return null;
}
