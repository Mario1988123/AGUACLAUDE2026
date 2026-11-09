/**
 * Lógica PURA de la retirada de equipos (sin BD, sin sesión). Se comparte
 * entre el cierre normal de una orden kind='uninstall' y la retirada manual
 * (sin agendar), y es lo que cubren los tests de vitest.
 */

export type EstadoVuelta = "used" | "damaged" | "refurbished";
export type DestinoEquipo = "warehouse" | "lost" | "broken" | "stolen";

export const DESTINOS_EQUIPO: readonly DestinoEquipo[] = [
  "warehouse",
  "lost",
  "broken",
  "stolen",
] as const;

/** Marca que se añade a las notas de la orden creada por la retirada manual. */
export const MARCA_RETIRADA_MANUAL = "[RETIRADA MANUAL — sin agendar]";

/** Mínimo de caracteres del motivo (obligatorio). [decide] 5 caracteres. */
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 1000;

export interface ParametrosRetirada {
  /** Almacén destino serializado al crear la orden (null si no hay). */
  destinoAlmacenId: string | null;
  /** Estado con el que entra el stock devuelto. */
  estadoVuelta: EstadoVuelta;
  /** customer_equipment.id referenciados en las notas (`#UUID`). */
  equipoIds: string[];
}

/**
 * Lee de las notas de una orden de desinstalación los parámetros que
 * `createUninstallAction` serializó: `destination_warehouse_id=`,
 * `default_state=` y una línea `#UUID` por equipo. Si la clave aparece varias
 * veces gana la PRIMERA (la que escribió la creación de la orden).
 */
export function leerParametrosRetirada(
  notas: string | null | undefined,
): ParametrosRetirada {
  const texto = notas ?? "";
  const destino = texto.match(/destination_warehouse_id=([0-9a-f-]{36})/i);
  const estado = texto.match(/default_state=(used|damaged|refurbished)/i);
  const ids = Array.from(texto.matchAll(/#([0-9a-f-]{36})/gi)).map((m) =>
    m[1]!.toLowerCase(),
  );
  return {
    destinoAlmacenId: destino?.[1]?.toLowerCase() ?? null,
    estadoVuelta: ((estado?.[1]?.toLowerCase() ?? "used") as EstadoVuelta),
    equipoIds: Array.from(new Set(ids)),
  };
}

/**
 * Notas con las que se guarda la orden al cerrarla. El cierre normal
 * (completeInstallation) SUSTITUÍA las notas por las del parte del técnico, y
 * así se perdían `destination_warehouse_id=` y los `#UUID` que el cierre de
 * la desinstalación lee DESPUÉS: el equipo no se daba de baja ni el stock
 * volvía. En una desinstalación conservamos las originales y añadimos las
 * nuevas debajo; en el resto de tipos se mantiene el comportamiento de siempre.
 */
export function notasAlCerrar(
  tipo: string,
  notasPrevias: string | null | undefined,
  notasNuevas: string | null | undefined,
): string | null {
  if (tipo !== "uninstall") return notasNuevas ?? null;
  const previas = (notasPrevias ?? "").trim();
  const nuevas = (notasNuevas ?? "").trim();
  if (!nuevas) return previas || null;
  if (!previas) return nuevas;
  return `${previas}\n---\n${nuevas}`;
}

export interface EntradaRetiradaManual {
  customer_id: string;
  equipment_ids: string[];
  /** YYYY-MM-DD (día de Madrid). */
  fecha_retirada: string;
  destination_warehouse_id?: string | null;
  /** Estado físico: operative | damaged | needs_review (por defecto operative). */
  estado_equipo?: string | null;
  motivo: string;
  destinos?: Array<{ equipment_id: string; destino: string }> | null;
}

export interface RetiradaManualValidada {
  customer_id: string;
  equipment_ids: string[];
  fecha_retirada: string;
  destination_warehouse_id: string | null;
  estado_equipo: EstadoEquipoRetirado;
  /** Estado de stock con el que entra (traducido de estado_equipo). */
  estado_vuelta: "used" | "damaged";
  /** Nota extra para el movimiento de stock ("PARA REVISAR") o null. */
  nota_estado: string | null;
  motivo: string;
  destinos: Map<string, DestinoEquipo>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fechaValida(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/**
 * Valida y normaliza la entrada de la retirada manual. `hoyMadrid` es el día
 * de hoy en Europe/Madrid (YYYY-MM-DD) para impedir fechas futuras.
 */
export function validarRetiradaManual(
  entrada: EntradaRetiradaManual,
  hoyMadrid: string,
): { ok: true; datos: RetiradaManualValidada } | { ok: false; error: string } {
  if (!entrada || !UUID.test(entrada.customer_id ?? "")) {
    return { ok: false, error: "Cliente no válido" };
  }
  const ids = Array.from(
    new Set((entrada.equipment_ids ?? []).map((x) => String(x).toLowerCase())),
  );
  if (ids.length === 0) return { ok: false, error: "Selecciona al menos un equipo" };
  if (ids.some((x) => !UUID.test(x))) return { ok: false, error: "Equipo no válido" };

  const fecha = (entrada.fecha_retirada ?? "").trim();
  if (!fechaValida(fecha)) return { ok: false, error: "Fecha de retirada no válida" };
  if (fecha > hoyMadrid) {
    return { ok: false, error: "La fecha de retirada no puede ser futura" };
  }

  const motivo = (entrada.motivo ?? "").trim();
  if (motivo.length < MOTIVO_MIN) {
    return {
      ok: false,
      error: `Indica el motivo de la retirada (mínimo ${MOTIVO_MIN} caracteres)`,
    };
  }
  if (motivo.length > MOTIVO_MAX) {
    return { ok: false, error: `El motivo no puede pasar de ${MOTIVO_MAX} caracteres` };
  }

  const estadoEquipo = entrada.estado_equipo ?? "operative";
  if (!esEstadoEquipo(estadoEquipo)) {
    return { ok: false, error: "Estado del equipo no válido" };
  }
  const { estado, nota: notaEstado } = estadoStockDeEquipo(estadoEquipo);

  const destinos = new Map<string, DestinoEquipo>();
  for (const d of entrada.destinos ?? []) {
    const id = String(d.equipment_id).toLowerCase();
    if (!ids.includes(id)) continue;
    if (!DESTINOS_EQUIPO.includes(d.destino as DestinoEquipo)) {
      return { ok: false, error: "Destino del equipo no válido" };
    }
    destinos.set(id, d.destino as DestinoEquipo);
  }

  const almacen = (entrada.destination_warehouse_id ?? "").trim().toLowerCase();
  if (almacen && !UUID.test(almacen)) return { ok: false, error: "Almacén no válido" };

  return {
    ok: true,
    datos: {
      customer_id: entrada.customer_id.toLowerCase(),
      equipment_ids: ids,
      fecha_retirada: fecha,
      destination_warehouse_id: almacen || null,
      estado_equipo: estadoEquipo,
      estado_vuelta: estado,
      nota_estado: notaEstado,
      motivo,
      destinos,
    },
  };
}

/**
 * ¿Hace falta almacén? Solo si algún equipo NUESTRO (con producto) vuelve al
 * almacén. Los externos y los marcados perdida/rota/robada no entran en stock
 * (mismo criterio que createUninstallAction).
 */
export function necesitaAlmacen(
  equipos: Array<{ id: string; product_id: string | null }>,
  destinos: Map<string, DestinoEquipo>,
): boolean {
  return equipos.some(
    (e) => !!e.product_id && (destinos.get(e.id.toLowerCase()) ?? "warehouse") === "warehouse",
  );
}

export interface OrdenAbierta {
  id: string;
  reference_code: string | null;
  notes: string | null;
}

/**
 * Reparte las órdenes de desinstalación ABIERTAS del cliente respecto a los
 * equipos que se retiran a mano:
 *  - `cancelar`: órdenes cuyos equipos quedan TODOS cubiertos por la retirada
 *    manual → se cancelan para que no queden colgando en agenda / Mi día (y
 *    para que, si el técnico la cerrara, no devolviera el stock otra vez).
 *  - `bloquean`: órdenes que mezclan equipos retirados con otros que NO se
 *    retiran ahora → no se pueden cancelar sin dejar los otros sin retirar ni
 *    cerrar sin devolver el stock dos veces; el usuario debe decidir.
 * Las que no tocan ningún equipo seleccionado se ignoran.
 */
export function clasificarOrdenesAbiertas(
  ordenes: OrdenAbierta[],
  seleccion: string[],
): { cancelar: OrdenAbierta[]; bloquean: OrdenAbierta[] } {
  const sel = new Set(seleccion.map((x) => x.toLowerCase()));
  const cancelar: OrdenAbierta[] = [];
  const bloquean: OrdenAbierta[] = [];
  for (const o of ordenes) {
    const ids = leerParametrosRetirada(o.notes).equipoIds;
    if (ids.length === 0 || !ids.some((x) => sel.has(x))) continue;
    if (ids.every((x) => sel.has(x))) cancelar.push(o);
    else bloquean.push(o);
  }
  return { cancelar, bloquean };
}

/**
 * Instante (ISO UTC) que se guarda como fecha de la retirada. Si es hoy, la
 * hora actual; si es un día pasado, las 12:00 de Madrid de ese día (evita que
 * un cambio de zona lo mueva al día anterior o siguiente).
 */
export function instanteRetirada(
  fecha: string,
  hoyMadrid: string,
  ahora: Date,
  aUtc: (local: string) => string | null,
): string {
  if (fecha === hoyMadrid) return ahora.toISOString();
  return aUtc(`${fecha}T12:00`) ?? `${fecha}T12:00:00.000Z`;
}

/**
 * Quién puede retirar equipos (programar, dar por hecha o retirar a mano):
 * superadmin, company_admin y technical_director. Mismo criterio que la
 * orden de desinstalación de siempre.
 */
export function puedeRetirar(s: { is_superadmin: boolean; roles: string[] }): boolean {
  return (
    s.is_superadmin ||
    s.roles.includes("company_admin") ||
    s.roles.includes("technical_director")
  );
}

/** Estado físico del equipo que se elige en la retirada manual. */
export type EstadoEquipoRetirado = "operative" | "damaged" | "needs_review";

export const ESTADO_EQUIPO_LABEL: Record<EstadoEquipoRetirado, string> = {
  operative: "Operativo",
  damaged: "Dañado",
  needs_review: "Para revisar",
};

/**
 * Traduce el estado físico al estado de stock con el que entra al almacén.
 * Estados de stock que existen: new / used / damaged / refurbished; no hay
 * estado ni almacén de cuarentena. [decide] "Para revisar" entra como
 * `damaged` (no vendible, no se reutiliza por error) con la nota
 * "PARA REVISAR" en el movimiento; tras revisarlo se pasa a used /
 * refurbished con "cambiar estado" del almacén.
 */
export function estadoStockDeEquipo(e: EstadoEquipoRetirado): {
  estado: "used" | "damaged";
  nota: string | null;
} {
  if (e === "operative") return { estado: "used", nota: null };
  if (e === "damaged") return { estado: "damaged", nota: null };
  return { estado: "damaged", nota: "PARA REVISAR" };
}

export function esEstadoEquipo(v: unknown): v is EstadoEquipoRetirado {
  return v === "operative" || v === "damaged" || v === "needs_review";
}

/** Estados de una prueba gratuita en los que el equipo está en casa del cliente. */
export const ESTADOS_PRUEBA_RETIRABLES = ["installed", "expired", "rejected"] as const;

export function pruebaRetirable(estado: string): boolean {
  return (ESTADOS_PRUEBA_RETIRABLES as readonly string[]).includes(estado);
}

/**
 * ¿Se puede finalizar el contrato al retirar estos equipos? Solo si, tras la
 * retirada, no le queda NINGÚN otro equipo activo enlazado. Si le quedan,
 * se deja como está (sigue cobrando) y se avisa.
 */
export function decidirContrato(equiposActivosRestantes: number): "finalizar" | "mantener" {
  return equiposActivosRestantes > 0 ? "mantener" : "finalizar";
}

/** Añade una línea a unas notas existentes. */
export function anadirNota(previas: string | null | undefined, linea: string): string {
  const p = (previas ?? "").trim();
  return p ? `${p}\n${linea}` : linea;
}

export interface EntradaRetiradaPrueba {
  trial_id: string;
  fecha_retirada: string;
  destination_warehouse_id: string;
  estado_equipo?: string | null;
  motivo: string;
}

/** Valida la retirada manual de una PRUEBA GRATUITA (mismas reglas). */
export function validarRetiradaPrueba(
  entrada: EntradaRetiradaPrueba,
  hoyMadrid: string,
):
  | {
      ok: true;
      datos: {
        trial_id: string;
        fecha_retirada: string;
        destination_warehouse_id: string;
        estado_equipo: EstadoEquipoRetirado;
        estado_vuelta: "used" | "damaged";
        nota_estado: string | null;
        motivo: string;
      };
    }
  | { ok: false; error: string } {
  if (!entrada || !UUID.test(entrada.trial_id ?? "")) {
    return { ok: false, error: "Prueba no válida" };
  }
  const almacen = (entrada.destination_warehouse_id ?? "").trim().toLowerCase();
  if (!UUID.test(almacen)) return { ok: false, error: "Elige el almacén al que vuelve el equipo" };
  // Reutiliza las reglas de fecha / motivo / estado de la retirada de cliente.
  const v = validarRetiradaManual(
    {
      customer_id: entrada.trial_id,
      equipment_ids: [entrada.trial_id],
      fecha_retirada: entrada.fecha_retirada,
      destination_warehouse_id: almacen,
      estado_equipo: entrada.estado_equipo,
      motivo: entrada.motivo,
    },
    hoyMadrid,
  );
  if (!v.ok) return v;
  return {
    ok: true,
    datos: {
      trial_id: entrada.trial_id.toLowerCase(),
      fecha_retirada: v.datos.fecha_retirada,
      destination_warehouse_id: almacen,
      estado_equipo: v.datos.estado_equipo,
      estado_vuelta: v.datos.estado_vuelta,
      nota_estado: v.datos.nota_estado,
      motivo: v.datos.motivo,
    },
  };
}
