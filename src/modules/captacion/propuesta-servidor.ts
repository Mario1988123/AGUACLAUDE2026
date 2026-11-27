import "server-only";
import { admin } from "./servidor";
import { leerAjustesFicha } from "@/modules/products/ficha/cargar-ficha";
import { coloresDeFicha } from "@/modules/products/ficha/generar-ficha";
import {
  caducidadDesde,
  diaMadrid,
  hashVisitante,
  salDeVisitas,
  cartaFinal,
  COLUMNAS_PLAN_LISTA,
  COLUMNAS_PRODUCTO_LISTA,
  esCodigoValido,
  generarCodigo,
  leerLineas,
  lineaDesdeProducto,
  lineasQueIncluye,
  MAX_EQUIPOS,
  type LineaPropuesta,
  type PlanLista,
  type ProductoLista,
  type TipoPrecio,
} from "./propuesta-logica";

/**
 * Propuesta de captación en el servidor (cliente de servicio, sin sesión).
 * Siempre con company_id explícito: el cliente de servicio se salta la RLS.
 */

export const BUCKET_PROPUESTAS = "captacion-propuestas";

// -----------------------------------------------------------------------------
// Empresa (membrete, pie, colores y el número de captación)
// -----------------------------------------------------------------------------

export interface EmpresaPropuesta {
  id: string;
  nombre: string;
  razonSocial: string | null;
  nif: string | null;
  calle: string | null;
  codigoPostal: string | null;
  ciudad: string | null;
  email: string | null;
  /** Teléfono para «o llamad vosotros» (contacto de la empresa). */
  telefono: string | null;
  logoUrl: string | null;
  primario: string;
  acento: string;
  /** Número de WhatsApp de captación (E.164): el del wa.me, no el principal. */
  numeroCaptacion: string | null;
  urlPrivacidad: string | null;
  tiposPrecio: TipoPrecio[];
}

export async function cargarEmpresaPropuesta(companyId: string): Promise<EmpresaPropuesta | null> {
  const db = admin();
  const [co, ajustes, cs, con] = await Promise.all([
    db.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
    leerAjustesFicha(db, companyId),
    db
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_email, fiscal_phone, contact_phone, contact_email")
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("captacion_conexiones")
      .select("numero_e164, url_privacidad, propuesta_precios")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  if (co.error || !co.data) {
    if (co.error) console.error("[captacion/propuesta] empresa:", co.error.message);
    return null;
  }
  if (cs.error) console.error("[captacion/propuesta] datos fiscales:", cs.error.message);
  if (con.error) console.error("[captacion/propuesta] conexión:", con.error.message);
  const f = (cs.data ?? {}) as Record<string, string | null>;
  const c = (con.data ?? {}) as { numero_e164?: string | null; url_privacidad?: string | null; propuesta_precios?: string[] | null };
  const { primario, acento } = coloresDeFicha(ajustes);
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    id: companyId,
    nombre: (co.data as { name: string }).name,
    razonSocial: v(f.fiscal_legal_name),
    nif: v(f.fiscal_tax_id),
    calle: v(f.fiscal_street),
    codigoPostal: v(f.fiscal_postal_code),
    ciudad: v(f.fiscal_city),
    email: v(f.fiscal_email) ?? v(f.contact_email),
    telefono: v(f.contact_phone) ?? v(f.fiscal_phone),
    logoUrl: ajustes.logoUrl,
    primario,
    acento,
    numeroCaptacion: v(c.numero_e164),
    urlPrivacidad: v(c.url_privacidad),
    tiposPrecio: ((c.propuesta_precios ?? []) as string[]).filter(
      (t): t is TipoPrecio => t === "cash" || t === "renting" || t === "rental",
    ),
  };
}

/** «Infinity Aqua, S.L., NIF B00000000, Carrer d'exemple 1, 07000 Palma.» (solo lo que haya). */
export function lineaFiscal(e: EmpresaPropuesta): string {
  const lugar = [e.codigoPostal, e.ciudad].filter(Boolean).join(" ");
  const partes = [e.razonSocial ?? e.nombre, e.nif ? `NIF ${e.nif}` : null, e.calle, lugar || null].filter(Boolean);
  return `${partes.join(", ")}.`;
}

// -----------------------------------------------------------------------------
// Propuesta
// -----------------------------------------------------------------------------

export interface FilaPropuesta {
  id: string;
  company_id: string;
  prospecto_id: string | null;
  campana_id: string | null;
  conversacion_id: string | null;
  codigo: string;
  nombre_negocio: string;
  tipo_negocio: string | null;
  localidad: string | null;
  lineas: LineaPropuesta[];
  carta: string | null;
  que_incluye: string[];
  con_precios: boolean;
  pdf_ruta: string | null;
  pdf_bytes: number | null;
  pdf_paginas: number | null;
  media_id_meta: string | null;
  enviada_at: string | null;
  caduca_at: string;
  revocada_at: string | null;
  created_at: string;
}

const COLUMNAS_PROPUESTA =
  "id, company_id, prospecto_id, campana_id, conversacion_id, codigo, nombre_negocio, tipo_negocio, localidad, lineas, carta, que_incluye, con_precios, pdf_ruta, pdf_bytes, pdf_paginas, media_id_meta, enviada_at, caduca_at, revocada_at, created_at";

function aFila(r: Record<string, unknown>): FilaPropuesta {
  return {
    ...(r as unknown as FilaPropuesta),
    lineas: leerLineas(r.lineas),
    que_incluye: lineasQueIncluye(r.que_incluye as string | null),
  };
}

/** Por código público. Null si no existe o si la lectura falla (es un 404, no una hoja vacía). */
export async function leerPropuestaPorCodigo(codigo: string): Promise<FilaPropuesta | null> {
  if (!esCodigoValido(codigo)) return null;
  const { data, error } = await admin().from("captacion_propuestas").select(COLUMNAS_PROPUESTA).eq("codigo", codigo).maybeSingle();
  if (error) {
    console.error("[captacion/propuesta] leer:", error.message);
    return null;
  }
  return data ? aFila(data as Record<string, unknown>) : null;
}

/** Equipos de la campaña, en orden, con la foto de sus precios (lista blanca). */
export async function lineasDeCampana(companyId: string, campanaId: string, tipos: TipoPrecio[]): Promise<LineaPropuesta[]> {
  const db = admin();
  const { data: cps, error } = await db
    .from("captacion_campana_productos")
    .select("product_id, orden")
    .eq("company_id", companyId)
    .eq("campana_id", campanaId)
    .order("orden")
    .limit(MAX_EQUIPOS);
  if (error) throw new Error(`No se pudieron leer los equipos de la campaña: ${error.message}`);
  const ids = ((cps ?? []) as Array<{ product_id: string }>).map((x) => x.product_id);
  if (ids.length === 0) return [];

  const [prods, planes] = await Promise.all([
    db
      .from("products")
      .select(COLUMNAS_PRODUCTO_LISTA)
      .eq("company_id", companyId)
      .in("id", ids)
      .eq("is_active", true)
      .is("deleted_at", null),
    tipos.length
      ? db
          .from("product_pricing_plans")
          .select(COLUMNAS_PLAN_LISTA)
          .eq("company_id", companyId)
          .in("product_id", ids)
          .in("plan_type", tipos)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (prods.error) throw new Error(`No se pudieron leer los productos: ${prods.error.message}`);
  if (planes.error) throw new Error(`No se pudieron leer los precios: ${planes.error.message}`);

  // La foto principal de la galería, si la hay (como la ficha técnica).
  const { data: imgs, error: eImg } = await db
    .from("product_images")
    .select("product_id, storage_path, tipo_foto, is_main, display_order")
    .in("product_id", ids)
    .order("display_order");
  if (eImg) console.error("[captacion/propuesta] fotos:", eImg.message);
  const fotoDe = (pid: string): string | null => {
    const deEste = ((imgs ?? []) as Array<{ product_id: string; storage_path: string; tipo_foto: string | null; is_main: boolean }>).filter(
      (i) => i.product_id === pid,
    );
    const p = deEste.find((i) => i.tipo_foto === "principal") ?? deEste.find((i) => i.is_main);
    return p ? (db.storage.from("product-images").getPublicUrl(p.storage_path) as { data: { publicUrl: string } }).data.publicUrl : null;
  };

  const porId = new Map(((prods.data ?? []) as ProductoLista[]).map((p) => [p.id, p]));
  return ids
    .map((id) => porId.get(id))
    .filter((p): p is ProductoLista => !!p)
    .map((p) => lineaDesdeProducto({ ...p, main_image_url: fotoDe(p.id) ?? p.main_image_url }, (planes.data ?? []) as PlanLista[], tipos));
}

/**
 * Crea la propuesta de un prospecto con la foto de las líneas. Si ya tiene
 * una viva (sin revocar ni caducar) de la misma campaña, devuelve esa: un
 * reintento no crea otra.
 */
export async function crearPropuesta(args: {
  companyId: string;
  prospecto: { id: string; campana_id: string | null; nombre_negocio: string; municipio: string | null };
  conversacionId: string | null;
  empresa: EmpresaPropuesta;
}): Promise<FilaPropuesta> {
  const db = admin();
  const { companyId, prospecto: p } = args;
  const ahora = new Date();

  const previa = await db
    .from("captacion_propuestas")
    .select(COLUMNAS_PROPUESTA)
    .eq("company_id", companyId)
    .eq("prospecto_id", p.id)
    .is("revocada_at", null)
    .gt("caduca_at", ahora.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previa.error) throw new Error(previa.error.message);
  if (previa.data && (previa.data as { campana_id: string | null }).campana_id === p.campana_id) {
    return aFila(previa.data as Record<string, unknown>);
  }

  type CampanaTextos = { texto_carta: string | null; que_incluye: string | null; tipologia_clave: string | null };
  let campana: CampanaTextos | null = null;
  if (p.campana_id) {
    const { data, error } = await db
      .from("captacion_campanas")
      .select("texto_carta, que_incluye, tipologia_clave")
      .eq("company_id", companyId)
      .eq("id", p.campana_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    campana = (data as CampanaTextos | null) ?? null;
  }
  let tipoNegocio: string | null = null;
  if (campana?.tipologia_clave) {
    const { data } = await db.from("captacion_tipologias").select("nombre").eq("clave", campana.tipologia_clave).maybeSingle();
    tipoNegocio = (data as { nombre: string } | null)?.nombre ?? null;
  }

  const tipos = args.empresa.tiposPrecio;
  const lineas = p.campana_id ? await lineasDeCampana(companyId, p.campana_id, tipos) : [];
  if (lineas.length === 0) throw new SinEquipos();
  const fila = {
    company_id: companyId,
    prospecto_id: p.id,
    campana_id: p.campana_id,
    conversacion_id: args.conversacionId,
    nombre_negocio: p.nombre_negocio.slice(0, 200),
    tipo_negocio: tipoNegocio,
    localidad: p.municipio,
    lineas,
    carta: cartaFinal(campana?.texto_carta, p.nombre_negocio, lineas.length),
    que_incluye: campana?.que_incluye ?? null,
    con_precios: tipos.length > 0,
    caduca_at: caducidadDesde(ahora).toISOString(),
  };

  // El código es único global: ante la (improbable) colisión, otro.
  for (let intento = 0; intento < 3; intento++) {
    const { data, error } = await db
      .from("captacion_propuestas")
      .insert({ ...fila, codigo: generarCodigo() })
      .select(COLUMNAS_PROPUESTA)
      .single();
    if (!error) return aFila(data as Record<string, unknown>);
    if (error.code !== "23505") throw new Error(`No se pudo crear la propuesta: ${error.message}`);
  }
  throw new Error("No se pudo generar un código único para la propuesta.");
}

/** La campaña no tiene equipos asignados (o están dados de baja): no hay propuesta que mandar. */
export class SinEquipos extends Error {
  constructor() {
    super("La campaña no tiene equipos asignados para la propuesta.");
    this.name = "SinEquipos";
  }
}

/** Propuesta por su referencia (los seis primeros caracteres del código). */
export async function propuestaPorReferencia(companyId: string, ref: string): Promise<FilaPropuesta | null> {
  if (!/^[a-z2-7]{6}$/.test(ref)) return null;
  const { data, error } = await admin()
    .from("captacion_propuestas")
    .select(COLUMNAS_PROPUESTA)
    .eq("company_id", companyId)
    .like("codigo", `${ref}%`)
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) {
    console.error("[captacion/propuesta] por referencia:", error.message);
    return null;
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  // Dos con la misma referencia en la empresa (1 entre 10⁹): no se adivina.
  return filas.length === 1 ? aFila(filas[0]!) : null;
}

/** Por id, dentro de la empresa (reintento del cron, fase 7). Null si no existe o si falla. */
export async function propuestaPorId(companyId: string, id: string): Promise<FilaPropuesta | null> {
  const { data, error } = await admin()
    .from("captacion_propuestas")
    .select(COLUMNAS_PROPUESTA)
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[captacion/propuesta] por id:", error.message);
    return null;
  }
  return data ? aFila(data as Record<string, unknown>) : null;
}

export function rutaPdf(f: Pick<FilaPropuesta, "company_id" | "prospecto_id" | "codigo">): string {
  return `${f.company_id}/${f.prospecto_id ?? "sin-prospecto"}/${f.codigo}.pdf`;
}

/** Sube el PDF al bucket privado y lo apunta en la propuesta. */
export async function guardarPdf(f: FilaPropuesta, bytes: Uint8Array, paginas: number): Promise<string> {
  const db = admin();
  const ruta = rutaPdf(f);
  const { error } = await db.storage
    .from(BUCKET_PROPUESTAS)
    .upload(ruta, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`No se pudo subir el PDF: ${error.message}`);
  const { error: e2 } = await db
    .from("captacion_propuestas")
    .update({ pdf_ruta: ruta, pdf_bytes: bytes.byteLength, pdf_paginas: paginas })
    .eq("company_id", f.company_id)
    .eq("id", f.id);
  if (e2) throw new Error(e2.message);
  return ruta;
}

/** El PDF guardado (para /p/[codigo]/pdf). Null si no hay o falla. */
export async function leerPdf(f: FilaPropuesta): Promise<Uint8Array | null> {
  if (!f.pdf_ruta) return null;
  const { data, error } = await admin().storage.from(BUCKET_PROPUESTAS).download(f.pdf_ruta);
  if (error || !data) {
    console.error("[captacion/propuesta] descargar PDF:", error?.message);
    return null;
  }
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

// -----------------------------------------------------------------------------
// Visitante (sin cookies): hash de IP + agente + día + sal. La IP no se guarda.
// -----------------------------------------------------------------------------

export function visitanteDe(h: Headers): { hash: string; dia: string; agente: string } {
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "";
  const agente = h.get("user-agent") ?? "";
  const dia = diaMadrid();
  return { hash: hashVisitante(ip, agente, dia, salDeVisitas(process.env)), dia, agente };
}
