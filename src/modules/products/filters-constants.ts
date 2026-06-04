/**
 * Constantes y tipos del módulo de filtros — separados de filters-actions.ts
 * porque un archivo `"use server"` solo puede exportar funciones async.
 */

export type FilterType =
  | "sediment"
  | "gac"
  | "cto"
  | "membrane"
  | "postcarbon"
  | "remineralizer"
  | "softener_resin"
  | "uv_lamp"
  | "uf"
  | "other";

export const FILTER_TYPES: FilterType[] = [
  "sediment",
  "gac",
  "cto",
  "membrane",
  "postcarbon",
  "remineralizer",
  "softener_resin",
  "uv_lamp",
  "uf",
  "other",
];

export const FILTER_TYPE_LABEL: Record<FilterType, string> = {
  sediment: "Sedimentos",
  gac: "Carbón activo granular (GAC)",
  cto: "Carbón en bloque (CTO)",
  membrane: "Membrana ósmosis",
  postcarbon: "Post-carbón",
  remineralizer: "Remineralizador",
  softener_resin: "Resina descalcificador",
  uv_lamp: "Lámpara UV",
  uf: "Ultrafiltración (UF)",
  other: "Otro",
};
