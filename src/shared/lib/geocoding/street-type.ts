/**
 * Parser del tipo de vía (calle / avenida / plaza / paseo / ...) reutilizable
 * tanto en server (reverse geocoding) como en cliente (autocompletado +
 * detección al tipear). NO marcar "use server" — debe ser importable desde
 * client components.
 */

export const STREET_TYPE_MAP: Record<string, string> = {
  calle: "calle",
  c: "calle",
  "c.": "calle",
  avenida: "avenida",
  avda: "avenida",
  "avda.": "avenida",
  av: "avenida",
  "av.": "avenida",
  plaza: "plaza",
  pza: "plaza",
  "pza.": "plaza",
  pl: "plaza",
  "pl.": "plaza",
  paseo: "paseo",
  ps: "paseo",
  "ps.": "paseo",
  pº: "paseo",
  ronda: "ronda",
  rda: "ronda",
  "rda.": "ronda",
  camino: "camino",
  cm: "camino",
  "cm.": "camino",
  cmno: "camino",
  carretera: "carretera",
  ctra: "carretera",
  "ctra.": "carretera",
  glorieta: "glorieta",
  travesia: "travesia",
  travesía: "travesia",
  tr: "travesia",
  "tr.": "travesia",
  urbanización: "urbanizacion",
  urbanizacion: "urbanizacion",
  urb: "urbanizacion",
  "urb.": "urbanizacion",
  polígono: "poligono",
  poligono: "poligono",
  pol: "poligono",
  "pol.": "poligono",
  vía: "via",
  via: "via",
};

/**
 * Dado un string como "Avenida de la Constitución 14" devuelve
 * `{ type: "avenida", rest: "de la Constitución 14" }`. Si no detecta
 * prefijo conocido, asume `calle` y deja el resto intacto.
 */
export function detectStreetType(road: string): { type: string; rest: string } {
  const lower = road.toLowerCase().trim();
  // Buscar coincidencias por longitud descendente para que "avda" gane
  // a "av" cuando se escribe "avda. de la Paz".
  const keys = Object.keys(STREET_TYPE_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.startsWith(`${key} `) || lower === key) {
      return {
        type: STREET_TYPE_MAP[key]!,
        rest: road.slice(key.length).trim(),
      };
    }
  }
  return { type: "calle", rest: road };
}
