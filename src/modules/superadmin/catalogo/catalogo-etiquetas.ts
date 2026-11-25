/**
 * Etiquetas y utilidades puras del catálogo maestro (lista y ficha).
 * Sin "use server" ni "server-only": las usan también los componentes de cliente.
 */

export const KIND_ETIQUETA: Record<string, string> = {
  equipment: "Equipo",
  accessory: "Accesorio",
  spare_part: "Repuesto",
  consumable: "Consumible",
  service: "Servicio",
};

export const KINDS_RECAMBIO = ["spare_part", "consumable"] as const;

export function esRecambio(kind: string | null | undefined): boolean {
  return kind === "spare_part" || kind === "consumable";
}

/** Tipo de foto → rótulo de la galería, en el orden en que se pintan. */
export const TIPO_FOTO_ETIQUETA: Record<string, string> = {
  principal: "Principal",
  ficha: "Ficha",
  ambiente: "Ambiente",
  detalle: "Detalles",
  medidas: "Medidas",
  banner: "Banner",
  proyeccion: "Proyecciones",
  despiece: "Despiece",
  otras: "Otras",
};

export const ORDEN_TIPO_FOTO = [
  "principal",
  "ficha",
  "ambiente",
  "detalle",
  "medidas",
  "banner",
  "proyeccion",
  "despiece",
  "otras",
];

export const APARTADO_DOC_ETIQUETA: Record<string, string> = {
  ficha_tecnica: "Fichas técnicas",
  manual: "Manuales",
  guia: "Guías",
  certificado: "Certificados",
  comercial: "Material comercial",
  otro: "Otros",
};

export const ORDEN_APARTADO_DOC = [
  "ficha_tecnica",
  "manual",
  "guia",
  "certificado",
  "comercial",
  "otro",
];

/** Cuando el documento es anterior a la carga y no tiene `apartado`. */
export function apartadoDeKind(kind: string): string {
  switch (kind) {
    case "manufacturer_datasheet":
      return "ficha_tecnica";
    case "manual_user":
      return "manual";
    case "manual_installer":
      return "guia";
    case "certificate":
    case "compliance_doc":
      return "certificado";
    default:
      return "otro";
  }
}

/** «ES_EN_FR» → «ES · EN · FR». */
export function formatearIdioma(idioma: string | null): string | null {
  if (!idioma) return null;
  return idioma
    .split(/[_\s,/]+/)
    .filter(Boolean)
    .join(" · ");
}

export function formatearTamano(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

export function formatearNumero(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

export function formatearFecha(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Madrid",
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(s: string | null | undefined): s is string {
  return !!s && UUID_RE.test(s);
}

// =============================================================================
// Filtros de la lista (compartidos entre servidor y cliente)
// =============================================================================

export type TipoLista = "equipos" | "recambios" | "todos";
export type EstadoLista =
  | ""
  | "activos"
  | "inactivos"
  | "descatalogados"
  | "incompletos"
  | "sin_importar";

export interface FiltrosLista {
  tipo: TipoLista;
  fab: string;
  cat: string;
  fam: string;
  gama: string;
  estado: EstadoLista;
  q: string;
  agrupar: boolean;
  /** Elegida por el usuario; "" = la que toque (ver `vistaEfectiva`). */
  vista: "" | "rejilla" | "lista";
  page: number;
}

export const ESTADOS_LISTA: EstadoLista[] = [
  "activos",
  "inactivos",
  "descatalogados",
  "incompletos",
  "sin_importar",
];

/** Parámetros de URL que hay que conservar (sin `page`). */
export function filtrosAParams(f: FiltrosLista): Record<string, string | undefined> {
  return {
    tipo: f.tipo === "equipos" ? undefined : f.tipo,
    fab: f.fab || undefined,
    cat: f.cat || undefined,
    fam: f.fam || undefined,
    gama: f.gama || undefined,
    estado: f.estado || undefined,
    q: f.q || undefined,
    agrupar: f.agrupar ? "1" : undefined,
    vista: f.vista || undefined,
  };
}


/** Entrada sin filtros: se enseña el kiosco de categorías. */
export function esKiosco(f: FiltrosLista): boolean {
  return (
    f.tipo === "equipos" &&
    !f.cat &&
    !f.fam &&
    !f.gama &&
    !f.fab &&
    !f.estado &&
    !f.q &&
    !f.agrupar &&
    !f.vista
  );
}

/** Rejilla dentro de una categoría; lista en búsquedas y recambios. */
export function vistaEfectiva(f: FiltrosLista): "rejilla" | "lista" {
  if (f.vista) return f.vista;
  return f.q || f.tipo === "recambios" ? "lista" : "rejilla";
}

/** En rejilla, las gamas salen como carpeta (solo cabezas y sueltos). */
export function agruparEfectivo(f: FiltrosLista): boolean {
  if (f.agrupar) return true;
  return vistaEfectiva(f) === "rejilla" && !f.gama && !f.q && f.tipo !== "recambios";
}
