/**
 * Lógica pura de la fase 7 (mando completo): costes, tope de gasto mensual,
 * cortacircuitos, escalado tras una pausa, reintento de propuestas y tasas
 * del embudo. Sin base de datos ni red, para probarla con vitest.
 */

// -----------------------------------------------------------------------------
// Tarifas
// -----------------------------------------------------------------------------

/**
 * Tarifas de Meta para España, en milésimas de céntimo por mensaje entregado
 * (5,85 céntimos = 5850). Fuente: plan §7, «Tarifas del encargo, verificadas
 * a 2026-11-25»: marketing 0,0585 € y utility 0,0166 €. [NV] No se han vuelto a
 * comprobar hoy (2026-11-27) en la tabla de precios de Meta; si cambian, se
 * cambian aquí y en el plan.
 *
 * Los mensajes de servicio (texto libre dentro de la ventana de 24 h) no se
 * apuntan aquí: no pasan por captacion_envios. [NV] Que sean gratis depende
 * del modelo de precios vigente de Meta y no se ha comprobado.
 */
export const TARIFAS_ES_MILICENTIMOS = {
  marketing: 5850,
  utility: 1660,
} as const;

export const TARIFAS_FUENTE = "Plan §7, tarifas del encargo verificadas a 2026-11-25";

/** Lo que trae `statuses[].pricing` del webhook de Meta (si lo trae). */
export interface PrecioMeta {
  facturable: boolean | null;
  categoria: string | null;
  tipo: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

/**
 * Precio de cada estado del webhook `messages`, por wamid. Se leen
 * `pricing.billable`, `pricing.category` y `pricing.type`. [NV] Los nombres
 * de los campos son los de la documentación del webhook de estados tal como
 * se conocía; no se ha podido comprobar hoy la lista completa de valores de
 * `category` ni de `type` con el modelo de precio por mensaje.
 */
export function extraerPreciosEstados(valor: unknown): Map<string, PrecioMeta> {
  const out = new Map<string, PrecioMeta>();
  const estados = obj(valor).statuses;
  if (!Array.isArray(estados)) return out;
  for (const s of estados) {
    const o = obj(s);
    const wamid = typeof o.id === "string" ? o.id : null;
    const p = obj(o.pricing);
    if (!wamid || Object.keys(p).length === 0) continue;
    out.set(wamid, {
      facturable: typeof p.billable === "boolean" ? p.billable : null,
      categoria: typeof p.category === "string" ? p.category.toLowerCase() : null,
      tipo: typeof p.type === "string" ? p.type.toLowerCase() : null,
    });
  }
  return out;
}

/**
 * Coste de un envío entregado. Si Meta dice que no es facturable (o que es de
 * un tipo gratuito), 0. Si dice la categoría, su tarifa. Si no dice nada, la
 * de marketing, que es la categoría de nuestras plantillas: mejor pasarse en
 * la estimación que quedarse corto con el tope.
 */
export function costeEnvio(precio: PrecioMeta | null): { milicentimos: number; categoria: string } {
  const categoria = precio?.categoria ?? "marketing";
  if (precio?.facturable === false) return { milicentimos: 0, categoria };
  if (precio?.tipo && precio.tipo.startsWith("free")) return { milicentimos: 0, categoria };
  if (categoria === "service") return { milicentimos: 0, categoria };
  if (categoria === "utility") return { milicentimos: TARIFAS_ES_MILICENTIMOS.utility, categoria };
  // marketing, marketing_lite [NV], authentication [NV] o desconocida: la más cara.
  return { milicentimos: TARIFAS_ES_MILICENTIMOS.marketing, categoria };
}

/** Para la columna entera coste_cents (compatibilidad): redondeado. */
export function milicentimosACents(m: number): number {
  return Math.round(m / 1000);
}

// -----------------------------------------------------------------------------
// Mes en hora de Madrid
// -----------------------------------------------------------------------------

function partesMadrid(d: Date): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? "0");
  return { y: p("year"), m: p("month"), d: p("day"), h: p("hour"), mi: p("minute"), s: p("second") };
}

/** Desfase de Madrid respecto a UTC en ese instante, en minutos (60 o 120). */
function desfaseMadrid(d: Date): number {
  const p = partesMadrid(d);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/** «AAAA-MM» del mes en curso en Madrid. */
export function claveMes(ahora: Date): string {
  const p = partesMadrid(ahora);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

/** Instante (UTC) del día 1 a las 00:00 de Madrid del mes en curso. */
export function inicioMesMadrid(ahora: Date): Date {
  const p = partesMadrid(ahora);
  const aprox = new Date(Date.UTC(p.y, p.m - 1, 1, 0, 0, 0));
  // El cambio de hora nunca cae en día 1, así que el desfase de ese día vale.
  return new Date(aprox.getTime() - desfaseMadrid(aprox) * 60_000);
}

/** Instante (UTC) de las 00:00 de hoy en Madrid (fase 8, «envíos de hoy»). */
export function inicioDiaMadrid(ahora: Date): Date {
  const p = partesMadrid(ahora);
  const aprox = new Date(Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0));
  // El cambio de hora es de madrugada (2:00 o 3:00): a medianoche rige el
  // desfase de la víspera, el de una hora antes de `aprox` leído en UTC.
  return new Date(aprox.getTime() - desfaseMadrid(new Date(aprox.getTime() - 3_600_000)) * 60_000);
}

// -----------------------------------------------------------------------------
// Tope de gasto mensual
// -----------------------------------------------------------------------------

export const AVISO_GASTO_PORCENTAJE = 80;

export interface EstadoGasto {
  /** Suma de coste_milicentimos del mes. */
  confirmadoMilicentimos: number;
  /** Enviados sin coste apuntado aún, a tarifa de marketing. */
  enVueloMilicentimos: number;
  comprometidoMilicentimos: number;
  topeCents: number;
  /** 0–100+ ; null si el tope es 0. */
  porcentaje: number | null;
  nivel: "ok" | "aviso" | "tope";
  /** Plantillas de marketing que aún caben este mes. */
  enviosQueCaben: number;
}

/**
 * Gasto del mes frente al tope. Lo enviado que aún no tiene estado de entrega
 * se cuenta a tarifa de marketing: si no, una tanda grande podría pasarse del
 * tope antes de que lleguen los «entregado».
 */
export function evaluarGasto(g: { confirmadoMilicentimos: number; enVuelo: number; topeCents: number }): EstadoGasto {
  const enVueloMilicentimos = Math.max(0, g.enVuelo) * TARIFAS_ES_MILICENTIMOS.marketing;
  const comprometido = Math.max(0, g.confirmadoMilicentimos) + enVueloMilicentimos;
  const topeMili = Math.max(0, g.topeCents) * 1000;
  const porcentaje = topeMili > 0 ? (comprometido / topeMili) * 100 : null;
  const nivel = topeMili <= 0 || comprometido >= topeMili ? "tope" : porcentaje! >= AVISO_GASTO_PORCENTAJE ? "aviso" : "ok";
  const enviosQueCaben = Math.max(0, Math.floor((topeMili - comprometido) / TARIFAS_ES_MILICENTIMOS.marketing));
  return {
    confirmadoMilicentimos: Math.max(0, g.confirmadoMilicentimos),
    enVueloMilicentimos,
    comprometidoMilicentimos: comprometido,
    topeCents: Math.max(0, g.topeCents),
    porcentaje,
    nivel,
    enviosQueCaben,
  };
}

// -----------------------------------------------------------------------------
// Cortacircuitos (§4.3.12)
// -----------------------------------------------------------------------------

/**
 * Umbrales: propuesta del plan para ajustar en el piloto. La muestra son los
 * últimos 100 envíos intentados de la campaña; por debajo de 30 no se juzga
 * [decide]: con 10 envíos, 3 «No» ya serían un 30 %.
 */
export const CORTACIRCUITOS = {
  muestra: 100,
  muestraMinima: 30,
  maxNo: 0.25,
  maxFallidos: 0.15,
} as const;

export interface MuestraCortacircuitos {
  intentos: number;
  fallidos: number;
  prospectos: number;
  noes: number;
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

export function evaluarCortacircuitos(m: MuestraCortacircuitos): { salta: false } | { salta: true; motivo: string } {
  if (m.intentos < CORTACIRCUITOS.muestraMinima) return { salta: false };
  const tasaFallidos = m.fallidos / m.intentos;
  if (tasaFallidos > CORTACIRCUITOS.maxFallidos) {
    return {
      salta: true,
      motivo: `Cortacircuitos: han fallado ${m.fallidos} de los últimos ${m.intentos} envíos (${pct(tasaFallidos)}; el máximo es ${pct(CORTACIRCUITOS.maxFallidos)}).`,
    };
  }
  const tasaNo = m.prospectos > 0 ? m.noes / m.prospectos : 0;
  if (tasaNo > CORTACIRCUITOS.maxNo) {
    return {
      salta: true,
      motivo: `Cortacircuitos: ${m.noes} de los últimos ${m.prospectos} negocios han dicho «No» o han pedido la baja (${pct(tasaNo)}; el máximo es ${pct(CORTACIRCUITOS.maxNo)}).`,
    };
  }
  return { salta: false };
}

/**
 * Motivo para pausar TODAS las campañas de la empresa por la conexión: que no
 * esté activa o que la calidad del número haya bajado. «desconocida» no
 * pausa (es lo que hay hasta la primera lectura de Meta). Amarillo pausa
 * también: §4.3.12 y «no avanzar el escalado con la calidad en amarillo».
 */
export function motivoPausaConexion(c: { estado: string; calidad: string } | null): string | null {
  if (!c) return "No hay conexión de WhatsApp.";
  if (c.estado !== "activa") return `La conexión de WhatsApp no está activa (${c.estado}).`;
  if (c.calidad === "roja") return "La calidad del número está en rojo.";
  if (c.calidad === "amarilla") return "La calidad del número ha bajado a amarillo.";
  return null;
}

/**
 * Días que cuentan para el escalado: desde el lanzamiento o, si la campaña se
 * reanudó tras una pausa automática, desde la reanudación (vuelve a empezar
 * por el primer tramo) [decide].
 */
export function diasEscalado(lanzadaAt: string | null, reanudadaAt: string | null, ahora: Date): number {
  const desde = [lanzadaAt, reanudadaAt]
    .filter((x): x is string => Boolean(x))
    .map((x) => new Date(x).getTime())
    .filter((t) => Number.isFinite(t));
  if (desde.length === 0) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - Math.max(...desde)) / 86_400_000));
}

// -----------------------------------------------------------------------------
// Reintento del PDF de la propuesta
// -----------------------------------------------------------------------------

export const MAX_REINTENTOS_PROPUESTA = 3;
export const MINUTOS_ENTRE_REINTENTOS = 10;
/** Margen antes del cierre de la ventana de 24 h: no se apura hasta el último minuto. */
export const MARGEN_VENTANA_MIN = 5;

export interface PropuestaPendiente {
  envioError: string | null;
  enviadaAt: string | null;
  revocadaAt: string | null;
  caducaAt: string;
  intentos: number;
  ultimoIntentoAt: string | null;
  /** captacion_conversaciones.ventana_hasta */
  ventanaHasta: string | null;
  modoConversacion: string | null;
  /**
   * Fase 8: la empresa tiene una plantilla aprobada de uso «documento». Permite
   * mandar el PDF con la ventana cerrada.
   */
  plantillaDocumento?: boolean;
}

export type DecisionReintento =
  | { reintentar: true; via: "servicio" | "plantilla" }
  | { reintentar: false; agotar: boolean; motivo: string };

/** ¿Sigue abierta la ventana de 24 h (con el margen de seguridad)? */
export function ventanaAbierta(ventanaHasta: string | null, ahora: Date): boolean {
  if (!ventanaHasta) return false;
  const t = new Date(ventanaHasta).getTime();
  return Number.isFinite(t) && t - MARGEN_VENTANA_MIN * 60_000 > ahora.getTime();
}

/**
 * Cómo se manda la propuesta ahora mismo (fase 8): con la ventana abierta,
 * como documento normal; cerrada, con la plantilla de documento si la hay; si
 * no hay, no se puede y queda pendiente (null).
 */
export function viaEnvioPropuesta(
  ventanaHasta: string | null,
  hayPlantillaDocumento: boolean,
  ahora: Date,
): "servicio" | "plantilla" | null {
  if (ventanaAbierta(ventanaHasta, ahora)) return "servicio";
  return hayPlantillaDocumento ? "plantilla" : null;
}

/**
 * ¿Se vuelve a intentar mandar el PDF? Dentro de la ventana de 24 h, como
 * mensaje de servicio; fuera de ella, solo con plantilla de documento (fase
 * 8). Como mucho 3 veces y con 10 minutos entre intentos. `agotar` = no se
 * podrá nunca: se deja de mirar.
 */
export function decidirReintento(p: PropuestaPendiente, ahora: Date): DecisionReintento {
  const t = ahora.getTime();
  if (p.enviadaAt) return { reintentar: false, agotar: true, motivo: "Ya se mandó." };
  if (!p.envioError) return { reintentar: false, agotar: false, motivo: "No ha fallado." };
  if (p.revocadaAt) return { reintentar: false, agotar: true, motivo: "Propuesta revocada." };
  if (new Date(p.caducaAt).getTime() <= t) return { reintentar: false, agotar: true, motivo: "Propuesta caducada." };
  if (p.intentos >= MAX_REINTENTOS_PROPUESTA) return { reintentar: false, agotar: true, motivo: "Sin intentos." };
  if (/equipos asignados/i.test(p.envioError)) {
    return { reintentar: false, agotar: true, motivo: "La campaña no tiene equipos: reintentar no lo arregla." };
  }
  if (p.modoConversacion === "cerrada") return { reintentar: false, agotar: true, motivo: "Conversación cerrada." };
  const via = viaEnvioPropuesta(p.ventanaHasta, Boolean(p.plantillaDocumento), ahora);
  if (!via) {
    return { reintentar: false, agotar: true, motivo: "La ventana de 24 h está cerrada y no hay plantilla de documento." };
  }
  if (p.ultimoIntentoAt && t - new Date(p.ultimoIntentoAt).getTime() < MINUTOS_ENTRE_REINTENTOS * 60_000) {
    return { reintentar: false, agotar: false, motivo: "Aún no toca." };
  }
  return { reintentar: true, via };
}

// -----------------------------------------------------------------------------
// Embudo
// -----------------------------------------------------------------------------

export interface Embudo {
  prospectos: number;
  enCola: number;
  contactados: number;
  entregados: number;
  recordados: number;
  si: number;
  no: number;
  interesados: number;
  leads: number;
  conversando: number;
  sinRespuesta: number;
  fallidos: number;
}

export const EMBUDO_VACIO: Embudo = {
  prospectos: 0,
  enCola: 0,
  contactados: 0,
  entregados: 0,
  recordados: 0,
  si: 0,
  no: 0,
  interesados: 0,
  leads: 0,
  conversando: 0,
  sinRespuesta: 0,
  fallidos: 0,
};

/** Fila de public.captacion_embudo() → Embudo. */
export function leerEmbudo(fila: unknown): Embudo {
  const f = obj(fila);
  const n = (k: string) => (Number.isFinite(Number(f[k])) ? Number(f[k]) : 0);
  return {
    prospectos: n("prospectos"),
    enCola: n("en_cola"),
    contactados: n("contactados"),
    entregados: n("entregados"),
    recordados: n("recordados"),
    si: n("si"),
    no: n("no"),
    interesados: n("interesados"),
    leads: n("leads"),
    conversando: n("conversando"),
    sinRespuesta: n("sin_respuesta"),
    fallidos: n("fallidos"),
  };
}

export interface TasasEmbudo {
  /** Sobre contactados. */
  entrega: number | null;
  /** Las siguientes, sobre entregados. */
  si: number | null;
  no: number | null;
  interes: number | null;
  sinRespuesta: number | null;
}

function tasa(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function tasasEmbudo(e: Embudo): TasasEmbudo {
  return {
    entrega: tasa(e.entregados, e.contactados),
    si: tasa(e.si, e.entregados),
    no: tasa(e.no, e.entregados),
    interes: tasa(e.interesados, e.entregados),
    sinRespuesta: tasa(e.sinRespuesta, e.entregados),
  };
}

/** «12,5 %» o «—». */
export function formatoTasa(t: number | null): string {
  if (t == null) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(t * 100)} %`;
}

/** Euros desde milésimas de céntimo: «123,45 €». */
export function formatoEuros(milicentimos: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(milicentimos / 100_000);
}
