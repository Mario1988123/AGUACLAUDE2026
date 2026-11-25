import "server-only";
import { admin } from "./servidor";
import { captacionActiva } from "./guard";
import { AGENTE, telefonosDeWeb } from "./web";
import {
  consultaOverpass,
  dominioDe,
  elegirTelefono,
  esMovilES,
  fichaDeElemento,
  normalizarTelefonoES,
  type CandidatoTelefono,
  type ElementoOsm,
  type FichaNegocio,
  type Zona,
} from "./busqueda-logica";

/**
 * Cola de búsquedas de negocios (plan §4.2). Lo usan el cron
 * `captacion-diario` y el botón «Procesar ahora», con el mismo código.
 *
 * Una búsqueda = campaña × zona × fuente. Primera pasada: una consulta a
 * Overpass y las fichas se guardan en `cursor`. Pasadas siguientes: se lee
 * la web de cada ficha, se deduplica y se inserta el prospecto. Así una
 * provincia entera se reparte entre varias ejecuciones sin perder el sitio.
 *
 * Nada de esto escribe a nadie: los prospectos quedan en `nuevo` o
 * `revisar` y solo pasan a la cola de envío cuando una persona lo decide.
 */

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
/** Lo que se reserva al final del presupuesto: la lectura de una web tarda hasta ~17 s. */
const MARGEN_MS = 20_000;
/** Una búsqueda reservada y abandonada (función muerta) se puede volver a coger pasado esto. */
const RESERVA_CADUCA_MS = 6 * 60_000;

interface Cursor {
  fichas: FichaNegocio[];
  i: number;
  duplicados: number;
}

interface FilaBusqueda {
  id: string;
  company_id: string;
  campana_id: string;
  fuente: "osm" | "places";
  zona: Zona;
  estado: string;
  cursor: Cursor | null;
  encontrados: number;
  nuevos: number;
  revisar: number;
  descartados: number;
}

interface Campana {
  id: string;
  tipologia_clave: string | null;
  etiquetas_osm: string[];
}

export interface ResumenCola {
  busquedas: number;
  fichasLeidas: number;
  nuevos: number;
  revisar: number;
  descartados: number;
  duplicados: number;
  errores: string[];
}

type Resultado = "nuevo" | "revisar" | "descartado" | "duplicado";

/** Reserva una búsqueda pendiente o a medias. Atómico: dos pasadas no cogen la misma. */
async function reservar(filtro: { companyId?: string; campanaId?: string }): Promise<FilaBusqueda | null> {
  const db = admin();
  const caduca = new Date(Date.now() - RESERVA_CADUCA_MS).toISOString();
  let q = db
    .from("captacion_busquedas")
    .select("id")
    .in("estado", ["pendiente", "en_curso"])
    .or(`reclamada_at.is.null,reclamada_at.lt.${caduca}`)
    .order("created_at")
    .limit(5);
  if (filtro.companyId) q = q.eq("company_id", filtro.companyId);
  if (filtro.campanaId) q = q.eq("campana_id", filtro.campanaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const cand of (data ?? []) as Array<{ id: string }>) {
    const { data: fila } = await db
      .from("captacion_busquedas")
      .update({ reclamada_at: new Date().toISOString() })
      .eq("id", cand.id)
      .in("estado", ["pendiente", "en_curso"])
      .or(`reclamada_at.is.null,reclamada_at.lt.${caduca}`)
      .select("id, company_id, campana_id, fuente, zona, estado, cursor, encontrados, nuevos, revisar, descartados")
      .maybeSingle();
    if (fila) return fila as FilaBusqueda;
  }
  return null;
}

/**
 * Consulta con relevo entre servidores públicos de Overpass. El principal
 * (overpass-api.de) a veces va saturado: el 25-11-2026 tardaba 45 s en una
 * consulta que el espejo de mail.ru resolvía en 8 s con el mismo resultado.
 * Cada intento tiene como mucho lo que queda de presupuesto.
 */
async function consultarOverpass(consulta: string, quedanMs: () => number): Promise<ElementoOsm[]> {
  const fallos: string[] = [];
  for (const url of OVERPASS) {
    const limite = Math.min(60_000, quedanMs() - 5_000);
    if (limite < 8_000) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": AGENTE },
        body: `data=${encodeURIComponent(consulta)}`,
        signal: AbortSignal.timeout(limite),
        cache: "no-store",
      });
      if (!res.ok) {
        fallos.push(`${new URL(url).hostname} ${res.status}`);
        if (res.status === 400) break; // la consulta está mal: otro servidor dirá lo mismo
        continue;
      }
      const json = (await res.json()) as { elements?: ElementoOsm[]; remark?: string };
      if (json.remark && /runtime error|timed out/i.test(json.remark)) {
        fallos.push(`${new URL(url).hostname}: ${json.remark.slice(0, 80)}`);
        continue;
      }
      return json.elements ?? [];
    } catch (e) {
      fallos.push(`${new URL(url).hostname}: ${e instanceof Error && e.name === "TimeoutError" ? "no contestó a tiempo" : "sin respuesta"}`);
    }
  }
  const err = new Error(`El mapa no respondió (${fallos.join("; ") || "sin tiempo"})`) as Error & { reintentable?: boolean };
  err.reintentable = !fallos.some((f) => f.endsWith(" 400"));
  throw err;
}

async function procesarFicha(
  b: FilaBusqueda,
  campana: Campana,
  f: FichaNegocio,
): Promise<Resultado> {
  const db = admin();
  const companyId = b.company_id;

  // 1) ¿Ya lo tenemos por el elemento del mapa? No hace falta ni leer su web.
  const { data: porOsm } = await db
    .from("captacion_prospectos")
    .select("id")
    .eq("company_id", companyId)
    .eq("osm_id", f.osm_id)
    .limit(1);
  if ((porOsm ?? []).length) return "duplicado";

  const dominio = dominioDe(f.web);
  if (dominio) {
    const { data: porDominio } = await db
      .from("captacion_prospectos")
      .select("id")
      .eq("company_id", companyId)
      .eq("dominio", dominio)
      .limit(1);
    if ((porDominio ?? []).length) return "duplicado";
  }

  // 2) Teléfonos: los del mapa y los que publica su web.
  const deOsm: CandidatoTelefono[] = f.telefonos_osm
    .map((t) => normalizarTelefonoES(t))
    .filter((t): t is string => Boolean(t))
    .map((e164) => ({ e164, origen: "osm" as const }));
  const deWeb = f.web ? await telefonosDeWeb(f.web) : [];
  const tel = elegirTelefono(deOsm, f.osm_url, deWeb);

  // 3) Bloqueos (de este módulo y del agente de voz): ni se guarda.
  if (tel.e164) {
    const [{ data: bloq }, { data: dnc }, { data: porTel }] = await Promise.all([
      db.from("captacion_bloqueos").select("id").eq("company_id", companyId).eq("ambito", "telefono").eq("valor", tel.e164).limit(1),
      db.from("voice_do_not_call").select("id").eq("company_id", companyId).eq("phone_e164", tel.e164).limit(1),
      db.from("captacion_prospectos").select("id").eq("company_id", companyId).eq("telefono_e164", tel.e164).limit(1),
    ]);
    if ((bloq ?? []).length || (dnc ?? []).length) return "descartado";
    if ((porTel ?? []).length) return "duplicado";
  }

  // 4) ¿Ya es cliente o lead? Nunca entra en `nuevo`.
  const { data: coinc, error: eCoinc } = await db.rpc("captacion_coincidencias", {
    p_company_id: companyId,
    p_tel9: tel.e164 ? tel.e164.slice(-9) : null,
    p_nombre: f.nombre,
    p_cp: f.codigo_postal,
  });
  if (eCoinc) throw new Error(`Deduplicación: ${eCoinc.message}`);
  const coincidencias = (coinc ?? []) as Array<{ customer_id: string | null; lead_id: string | null; motivo: string }>;
  const cliente = coincidencias.find((c) => c.customer_id)?.customer_id ?? null;
  const lead = coincidencias.find((c) => c.lead_id)?.lead_id ?? null;
  const porTelefono = coincidencias.some((c) => c.motivo === "telefono");

  let etapa: "nuevo" | "revisar" = "nuevo";
  let motivo: string | null = null;
  if (cliente || lead) {
    etapa = "revisar";
    motivo = porTelefono
      ? cliente ? "Su teléfono ya es de un cliente" : "Su teléfono ya es de un lead"
      : "Nombre parecido a un cliente o lead del mismo código postal";
  } else if (!tel.e164) {
    etapa = "revisar";
    motivo = "No publica ningún teléfono";
  } else if (!esMovilES(tel.e164)) {
    etapa = "revisar";
    motivo = "Solo tiene fijo";
  }

  const { error } = await db.from("captacion_prospectos").insert({
    company_id: companyId,
    campana_id: campana.id,
    busqueda_id: b.id,
    nombre_negocio: f.nombre,
    tipologia_clave: campana.tipologia_clave,
    direccion: f.direccion,
    municipio: f.municipio ?? (b.zona.tipo === "municipio" ? b.zona.nombre : null),
    codigo_postal: f.codigo_postal,
    lat: f.lat,
    lng: f.lng,
    telefono_e164: tel.e164,
    telefono_fuente: tel.fuente,
    telefono_url_fuente: tel.url,
    prioridad: tel.prioridad,
    web: f.web,
    dominio,
    email: f.email,
    osm_id: f.osm_id,
    etapa,
    revisar_motivo: motivo,
    cliente_coincidente_id: cliente,
    lead_coincidente_id: lead,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") return "duplicado";
    throw new Error(error.message);
  }
  return etapa;
}

async function guardarAvance(b: FilaBusqueda, cursor: Cursor | null, extra: Record<string, unknown> = {}) {
  const { error } = await admin()
    .from("captacion_busquedas")
    .update({
      cursor,
      encontrados: b.encontrados,
      nuevos: b.nuevos,
      revisar: b.revisar,
      descartados: b.descartados,
      ...extra,
    })
    .eq("id", b.id);
  if (error) throw new Error(error.message);
}

/**
 * Procesa la cola hasta agotar el presupuesto de tiempo. Solo empresas con
 * el módulo activo de forma explícita (guard estricto).
 */
export async function procesarColaBusquedas(opciones: {
  presupuestoMs: number;
  companyId?: string;
  campanaId?: string;
}): Promise<ResumenCola> {
  const inicio = Date.now();
  const quedan = () => opciones.presupuestoMs - (Date.now() - inicio);
  const r: ResumenCola = { busquedas: 0, fichasLeidas: 0, nuevos: 0, revisar: 0, descartados: 0, duplicados: 0, errores: [] };
  const db = admin();
  const activas = new Map<string, boolean>();

  while (quedan() > MARGEN_MS) {
    const b = await reservar(opciones);
    if (!b) break;
    r.busquedas++;

    if (!activas.has(b.company_id)) activas.set(b.company_id, await captacionActiva(b.company_id));
    if (!activas.get(b.company_id)) {
      await guardarAvance(b, null, { estado: "fallida", error: "Módulo de captación no activo", terminada_at: new Date().toISOString() });
      continue;
    }

    const { data: camp } = await db
      .from("captacion_campanas")
      .select("id, tipologia_clave, etiquetas_osm, estado")
      .eq("id", b.campana_id)
      .eq("company_id", b.company_id)
      .maybeSingle();
    const campana = camp as (Campana & { estado: string }) | null;
    if (!campana || campana.estado === "terminada") {
      await guardarAvance(b, null, { estado: "fallida", error: "Campaña terminada o borrada", terminada_at: new Date().toISOString() });
      continue;
    }
    if (b.fuente !== "osm") {
      // Places queda apagado (decisión de Mario n.º 7): no se busca ahí.
      await guardarAvance(b, null, { estado: "fallida", error: "Google Places no está activado", terminada_at: new Date().toISOString() });
      continue;
    }

    let cursor = b.cursor;
    try {
      // Primera pasada: el mapa.
      if (!cursor) {
        const elementos = await consultarOverpass(consultaOverpass(campana.etiquetas_osm, b.zona), quedan);
        const vistos = new Set<string>();
        const fichas: FichaNegocio[] = [];
        for (const el of elementos) {
          const f = fichaDeElemento(el);
          if (f && !vistos.has(f.osm_id)) {
            vistos.add(f.osm_id);
            fichas.push(f);
          }
        }
        cursor = { fichas, i: 0, duplicados: 0 };
        b.encontrados = fichas.length;
        await guardarAvance(b, cursor, { estado: "en_curso", error: null });
      }

      // Pasadas siguientes: la web de cada negocio y la deduplicación.
      let desdeGuardado = 0;
      while (cursor.i < cursor.fichas.length && quedan() > MARGEN_MS) {
        const f = cursor.fichas[cursor.i]!;
        let res: Resultado;
        try {
          res = await procesarFicha(b, campana, f);
        } catch (e) {
          // Un negocio que falla no tumba la búsqueda: se salta y se anota.
          r.errores.push(`${f.nombre}: ${e instanceof Error ? e.message : "error"}`);
          res = "descartado";
        }
        cursor.i++;
        r.fichasLeidas++;
        if (res === "nuevo") { b.nuevos++; r.nuevos++; }
        else if (res === "revisar") { b.revisar++; r.revisar++; }
        else if (res === "descartado") { b.descartados++; r.descartados++; }
        else { cursor.duplicados++; r.duplicados++; }
        if (++desdeGuardado >= 10) {
          await guardarAvance(b, cursor);
          desdeGuardado = 0;
        }
      }

      if (cursor.i >= cursor.fichas.length) {
        await guardarAvance(b, null, {
          estado: "hecha",
          terminada_at: new Date().toISOString(),
          reclamada_at: null,
          error: cursor.duplicados ? `${cursor.duplicados} ya estaban en la lista` : null,
        });
      } else {
        await guardarAvance(b, cursor, { reclamada_at: null });
      }
    } catch (e) {
      const err = e as Error & { reintentable?: boolean };
      r.errores.push(err.message);
      // Reintentable: se suelta y se corta esta ejecución, para no martillear
      // a los servidores del mapa; la siguiente pasada (o el botón) la retoma.
      await guardarAvance(b, cursor, err.reintentable
        ? { error: `${err.message}. Se reintentará.`, reclamada_at: null }
        : { estado: "fallida", error: err.message.slice(0, 500), terminada_at: new Date().toISOString() });
      if (err.reintentable) break;
    }
  }
  return r;
}
