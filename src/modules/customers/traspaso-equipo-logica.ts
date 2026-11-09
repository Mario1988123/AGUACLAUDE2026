/**
 * TRASPASO DE UN EQUIPO A OTRO CLIENTE — lógica pura (sin base de datos).
 *
 * Caso: "nos equivocamos de ficha". El equipo se dio de alta (o se instaló)
 * a nombre de un cliente y es de otro de la misma empresa usuaria. Se
 * arrastra todo lo que cuelga del equipo: contrato de alquiler/renting/venta,
 * instalación, mantenimientos, contratos de mantenimiento, incidencias y lo
 * pendiente de cobro que aún no se ha facturado. Lo único que NO se mueve son
 * las facturas ya emitidas (y sus cobros): fiscalmente son de quien las
 * recibió.
 *
 * La parte de base de datos está en `transfer-equipment-actions.ts` y en la
 * función SQL `traspasar_equipo_a_cliente` (migración 20261110090000).
 */

import { isPlaceholderTaxId } from "@/shared/lib/validations/spanish";

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;

/** Contrato que cuelga de los equipos que se traspasan. */
export interface ContratoLigado {
  id: string;
  reference_code: string | null;
  plan_type: string;
  status: string;
  financier_id: string | null;
  /** Equipos ACTIVOS del mismo cliente que cubre el contrato y que NO viajan. */
  otros_equipos: number;
}

export interface ClienteFacturacion {
  party_kind: "individual" | "company";
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
  tax_id: string | null;
}

export interface DireccionFacturacion {
  street: string | null;
  postal_code: string | null;
  city: string | null;
}

export function validarMotivo(motivo: string | null | undefined): string | null {
  const m = (motivo ?? "").trim();
  if (m.length < MOTIVO_MIN) return "Escribe el motivo del traspaso (obligatorio).";
  if (m.length > MOTIVO_MAX) return `El motivo no puede pasar de ${MOTIVO_MAX} caracteres.`;
  return null;
}

/**
 * Un contrato es UNA unidad: si cubre más equipos del mismo cliente que los
 * que se traspasan, moverlo partiría el contrato entre dos clientes. Se
 * bloquea y se pide traspasarlos juntos.
 */
export function bloqueoPorContratoCompartido(contratos: ContratoLigado[]): string | null {
  const compartidos = contratos.filter((c) => c.otros_equipos > 0 && c.status !== "cancelled");
  if (compartidos.length === 0) return null;
  const refs = compartidos.map((c) => c.reference_code ?? c.id.slice(0, 8)).join(", ");
  return `El contrato ${refs} cubre también otros equipos de este cliente. Un contrato no se parte entre dos clientes: traspasa todos sus equipos (o retira antes los que no van).`;
}

/** Contratos que seguirán emitiendo cuotas al cliente (al destino, tras el traspaso). */
export function contratosConCuotas(contratos: ContratoLigado[]): ContratoLigado[] {
  return contratos.filter(
    (c) =>
      (c.plan_type === "rental" || (c.plan_type === "renting" && !c.financier_id)) &&
      (c.status === "signed" || c.status === "active"),
  );
}

/**
 * Lo que necesita el destino para que se le pueda emitir una factura
 * completa: identificación fiscal, nombre o razón social y dirección
 * principal (la que usa la factura).
 */
export function faltanDatosFacturacion(
  c: ClienteFacturacion,
  dir: DireccionFacturacion | null,
): string[] {
  const faltan: string[] = [];
  const empresa = c.party_kind === "company";
  const nif = (c.tax_id ?? "").trim();
  if (!nif || isPlaceholderTaxId(nif)) faltan.push(empresa ? "CIF" : "DNI/NIE");
  if (empresa) {
    if (!(c.legal_name ?? "").trim()) faltan.push("razón social");
  } else if (!`${c.first_name ?? ""}${c.last_name ?? ""}`.trim()) {
    faltan.push("nombre y apellidos");
  }
  if (!dir || !(dir.street ?? "").trim() || !(dir.postal_code ?? "").trim() || !(dir.city ?? "").trim()) {
    faltan.push("dirección principal (calle, código postal y población)");
  }
  return faltan;
}

export interface ConteosTraspaso {
  origenNombre: string;
  destinoNombre: string;
  equipos: number;
  contratos: ContratoLigado[];
  instalaciones: number;
  mantenimientos: number;
  contratosMantenimiento: number;
  incidencias: number;
  /** Apuntes de monedero pendientes y sin factura de esos contratos. */
  apuntesPendientes: number;
  /** Cobros pendientes de cuotas YA facturadas al origen (no se mueven). */
  cobrosFacturadosPendientes: number;
  /** Mandatos SEPA vivos de esos contratos (se revocan). */
  mandatosVivos: number;
  /** La dirección se copia en la ficha destino (o ya tenía una igual). */
  direccion: "copia" | "reutiliza" | "sin_direccion" | "ya_es_suya";
  /** Se suelta de un pack que se queda en el origen. */
  seSueltaDelPack: boolean;
  /** Se parte un pack: los accesorios se quedan. */
  accesoriosQueSeQuedan: number;
}

export interface ResumenTraspaso {
  mueve: string[];
  noMueve: string[];
  avisos: string[];
}

const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Texto de "qué se mueve y qué no" que se enseña antes de confirmar. */
export function resumenTraspasoEquipo(c: ConteosTraspaso): ResumenTraspaso {
  const mueve: string[] = [];
  const noMueve: string[] = [];
  const avisos: string[] = [];
  const a = c.destinoNombre;

  mueve.push(pl(c.equipos, "equipo", "equipos") + (c.equipos > 1 ? " (con sus accesorios)" : ""));
  if (c.contratos.length > 0) {
    const refs = c.contratos.map((k) => k.reference_code ?? k.id.slice(0, 8)).join(", ");
    mueve.push(`${pl(c.contratos.length, "contrato", "contratos")} (${refs}): pasa a ser de ${a}`);
  }
  if (c.instalaciones > 0) mueve.push(pl(c.instalaciones, "instalación", "instalaciones"));
  if (c.mantenimientos > 0) mueve.push(`${pl(c.mantenimientos, "mantenimiento", "mantenimientos")} (pendientes e historial)`);
  if (c.contratosMantenimiento > 0) {
    mueve.push(pl(c.contratosMantenimiento, "contrato de mantenimiento", "contratos de mantenimiento"));
  }
  if (c.incidencias > 0) mueve.push(pl(c.incidencias, "incidencia", "incidencias"));
  if (c.apuntesPendientes > 0) {
    mueve.push(`${pl(c.apuntesPendientes, "cobro pendiente", "cobros pendientes")} aún sin facturar`);
  }
  if (contratosConCuotas(c.contratos).length > 0) {
    mueve.push(`Las próximas cuotas (las que aún no se han emitido, incluida la de este mes) se facturarán a ${a}`);
  }
  if (c.direccion === "copia") mueve.push(`La dirección de instalación se copia en la ficha de ${a} (el equipo no se mueve de sitio)`);
  if (c.direccion === "reutiliza") mueve.push(`Se usa la dirección igual que ${a} ya tiene en su ficha`);

  noMueve.push(`Las facturas ya emitidas siguen a nombre de ${c.origenNombre}, con sus cobros`);
  if (c.contratos.length > 0) {
    noMueve.push("El PDF y las firmas del contrato: quedan como registro de quién firmó (se anota el traspaso en el contrato)");
  }
  noMueve.push("Propuestas, comisiones y puntos del comercial");

  if (c.cobrosFacturadosPendientes > 0) {
    avisos.push(
      `${c.origenNombre} tiene ${pl(c.cobrosFacturadosPendientes, "cuota facturada pendiente", "cuotas facturadas pendientes")} de cobro de este contrato: siguen siendo suyas.` +
        (c.mandatosVivos > 0 ? " Como su mandato se revoca, habrá que cobrarlas por transferencia." : ""),
    );
  }
  if (c.mandatosVivos > 0) {
    avisos.push(
      `El mandato SEPA de ${c.origenNombre} se revoca (queda en el histórico). ${a} tiene que firmar su propio mandato en el contrato; hasta entonces sus cuotas NO entran en la remesa.`,
    );
  } else if (contratosConCuotas(c.contratos).length > 0) {
    avisos.push(`Si las cuotas se domicilian, ${a} tiene que firmar su mandato SEPA en el contrato; sin él no entran en la remesa.`);
  }
  if (c.seSueltaDelPack) avisos.push("Este equipo es un accesorio: se suelta del pack, que se queda en el cliente actual.");
  if (c.accesoriosQueSeQuedan > 0) {
    avisos.push(`El pack se parte: ${pl(c.accesoriosQueSeQuedan, "accesorio se queda", "accesorios se quedan")} en el cliente actual.`);
  }
  return { mueve, noMueve, avisos };
}
