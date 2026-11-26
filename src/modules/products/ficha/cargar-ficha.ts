/**
 * Cargador ÚNICO de la ficha técnica nueva (Tarifa, Escaparate, Placa). Lee
 * las tablas de la empresa y, para lo que el maestro tiene y la empresa aún no
 * (las ventajas con su icono), el producto del maestro al que está enganchado.
 *
 * Recibe el cliente por parámetro (en la app, el admin client tras comprobar
 * que el producto es de la empresa; en el script de vista previa, uno de solo
 * lectura). Todas las consultas miran `error`. Nunca lee `manufacturer_*`.
 */

import { hayColumnaOrigen } from "../atributos-origen";
import {
  caracteristicasDeEmpresa,
  type CaracteristicaEmpresa,
  type FilaAtributoEmpresa,
  type FilaValorEmpresa,
} from "../productos-vista";
import {
  bloquesDeFicha,
  cotasDeFicha,
  esPlantillaNueva,
  fechaRevision,
  formatearTelefono,
  leerOpcionesFicha,
  leerSeccionesProducto,
  rasgosDe,
  seccionesEfectivas,
  referenciaImprimible,
  sinProveedor,
  textoImprimible,
  type FichaModelo,
  type OpcionesFicha,
  type PlantillaFicha,
  type RecambioFicha,
  type VentajaFicha,
} from "./modelo";
import { leerPaletaGuardada, normalizarHex, type PaletaGuardada } from "./paleta";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

const BUCKET_FOTOS = "product-images";
const BUCKET_MAESTRO = "catalog-global";
/** Nombres que nunca salen en la ficha, aunque no estén en `manufacturers`. */
const PROVEEDORES_FIJOS = ["Osmofilter", "Corsa"];

function trozos<T>(lista: T[], n = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

export interface AjustesFicha {
  plantilla: PlantillaFicha;
  paleta: PaletaGuardada | null;
  opciones: OpcionesFicha;
  /** companies.primary_color: el color de marca por defecto de las fichas nuevas. */
  colorEmpresa: string | null;
  /** company_settings.pdf_brand_color: el «Color base» de las plantillas anteriores. */
  colorBaseAnterior: string | null;
  acentoAnterior: string | null;
  logoUrl: string | null;
  /** ¿Están las columnas de la migración 20261129100000? */
  hayMigracion: boolean;
}

/**
 * Ajustes de ficha de una empresa. Tolerante: si la migración 20261129100000
 * no está aplicada, lee lo de antes y devuelve la paleta y las opciones vacías.
 */
export async function leerAjustesFicha(sb: Cliente, companyId: string): Promise<AjustesFicha> {
  const base =
    "datasheet_template, pdf_brand_color, pdf_accent_color, fiscal_logo_url, fiscal_legal_name, fiscal_phone, fiscal_email";
  let fila: Record<string, unknown> | null = null;
  let hayMigracion = true;
  const r1 = await sb
    .from("company_settings")
    .select(`${base}, datasheet_palette, datasheet_opciones`)
    .eq("company_id", companyId)
    .maybeSingle();
  if (r1.error) {
    hayMigracion = false;
    const r2 = await sb.from("company_settings").select(base).eq("company_id", companyId).maybeSingle();
    if (r2.error) console.error("[ficha] ajustes:", r2.error.message);
    fila = (r2.data as Record<string, unknown> | null) ?? null;
  } else {
    fila = (r1.data as Record<string, unknown> | null) ?? null;
  }
  const { data: co, error: eCo } = await sb
    .from("companies")
    .select("primary_color, logo_url")
    .eq("id", companyId)
    .maybeSingle();
  if (eCo) console.error("[ficha] empresa:", eCo.message);
  const t = fila?.datasheet_template;
  const plantilla: PlantillaFicha =
    t === "iagua" ? "iagua" : esPlantillaNueva(t) ? t : "standard";
  return {
    plantilla,
    paleta: leerPaletaGuardada(fila?.datasheet_palette),
    opciones: leerOpcionesFicha(fila?.datasheet_opciones),
    colorEmpresa: normalizarHex((co as { primary_color?: string } | null)?.primary_color),
    colorBaseAnterior: normalizarHex(fila?.pdf_brand_color),
    acentoAnterior: normalizarHex(fila?.pdf_accent_color),
    logoUrl:
      (fila?.fiscal_logo_url as string | null) ??
      ((co as { logo_url?: string | null } | null)?.logo_url ?? null),
    hayMigracion,
  };
}

/** Características (valores + definición + grupo del global) de un producto. */
export async function leerCaracteristicasFicha(sb: Cliente, productId: string): Promise<CaracteristicaEmpresa[]> {
  const hayOrigen = await hayColumnaOrigen(sb);
  const cols =
    "id, attribute_id, value_text, value_number, value_boolean, value_json, is_visible, is_featured, display_order" +
    (hayOrigen ? ", origen" : "");
  const { data: vals, error } = await sb
    .from("product_attribute_values")
    .select(cols)
    .eq("product_id", productId)
    .order("display_order")
    .limit(1000);
  if (error) throw new Error(`No se pudieron leer las características: ${error.message}`);
  const valores = (vals ?? []) as FilaValorEmpresa[];
  if (valores.length === 0) return [];
  const ids = Array.from(new Set(valores.map((v) => v.attribute_id)));
  const atributos = new Map<string, FilaAtributoEmpresa>();
  for (const t of trozos(ids)) {
    const { data, error: e2 } = await sb
      .from("product_attributes")
      .select("id, key, name, data_type, unit, grupo, sort_order, cloned_from_global_id")
      .in("id", t);
    if (e2) throw new Error(`No se pudieron leer los atributos: ${e2.message}`);
    for (const a of (data ?? []) as FilaAtributoEmpresa[]) atributos.set(a.id, a);
  }
  const idsGlobales = Array.from(
    new Set(
      Array.from(atributos.values())
        .filter((a) => !a.grupo && a.cloned_from_global_id)
        .map((a) => a.cloned_from_global_id as string),
    ),
  );
  const grupoGlobal = new Map<string, string | null>();
  for (const t of trozos(idsGlobales)) {
    const { data, error: e3 } = await sb.from("product_attributes_global").select("id, grupo").in("id", t);
    if (e3) console.error("[ficha] grupos globales:", e3.message);
    for (const g of (data ?? []) as Array<{ id: string; grupo: string | null }>) grupoGlobal.set(g.id, g.grupo);
  }
  return caracteristicasDeEmpresa(valores, atributos, grupoGlobal);
}

interface FilaProducto {
  id: string;
  company_id: string;
  name: string;
  kind: string | null;
  internal_reference: string | null;
  supplier_reference: string | null;
  rasgos_identificacion: string | null;
  short_description: string | null;
  long_description: string | null;
  main_image_url: string | null;
  dim_width_mm: number | null;
  dim_height_mm: number | null;
  dim_depth_mm: number | null;
  weight_grams: number | null;
  updated_at: string | null;
  gama_id: string | null;
  catalog_product_id: string | null;
  datasheet_extra: unknown;
}

export interface EntradaCargada {
  modelo: FichaModelo;
  ajustes: AjustesFicha;
  companyId: string;
}

/**
 * Producto → modelo de ficha. `simular` permite sustituir en memoria
 * características y medidas (solo lo usa el script de vista previa).
 */
export async function cargarFicha(
  sb: Cliente,
  productId: string,
  simular?: (e: {
    producto: FilaProducto;
    caracteristicas: CaracteristicaEmpresa[];
  }) => void,
): Promise<EntradaCargada> {
  const { data: p, error } = await sb
    .from("products")
    .select(
      "id, company_id, name, kind, internal_reference, supplier_reference, rasgos_identificacion, short_description, long_description, main_image_url, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, updated_at, gama_id, catalog_product_id, datasheet_extra",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`);
  if (!p) throw new Error("Producto no encontrado");
  const prod = p as FilaProducto;

  const [ajustes, caracteristicas, imgsR, fiscalR, coR, fabR, maestroR] = await Promise.all([
    leerAjustesFicha(sb, prod.company_id),
    leerCaracteristicasFicha(sb, productId),
    sb
      .from("product_images")
      .select("storage_path, tipo_foto, is_main, display_order")
      .eq("product_id", productId)
      .order("display_order")
      .limit(200),
    sb
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_phone, fiscal_email, fiscal_city, fiscal_province")
      .eq("company_id", prod.company_id)
      .maybeSingle(),
    sb.from("companies").select("name").eq("id", prod.company_id).maybeSingle(),
    sb.from("manufacturers").select("name").limit(500),
    prod.catalog_product_id
      ? sb
          .from("catalog_products")
          .select("name, modelo, familia_proveedor, gama_id")
          .eq("id", prod.catalog_product_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const [nombre, r] of [
    ["fotos", imgsR],
    ["datos fiscales", fiscalR],
    ["empresa", coR],
    ["fabricantes", fabR],
    ["maestro", maestroR],
  ] as const) {
    if ((r as { error?: { message: string } | null }).error)
      console.error(`[ficha] ${nombre}:`, (r as { error: { message: string } }).error.message);
  }

  simular?.({ producto: prod, caracteristicas });

  // Secciones: lo que diga el producto (datasheet_extra.ficha_secciones) manda
  // sobre lo de la empresa (datasheet_opciones).
  const secciones = seccionesEfectivas(ajustes.opciones, leerSeccionesProducto(prod.datasheet_extra));

  // --- Proveedor: lo que nunca se imprime -----------------------------------
  const fabricantes = Array.from(
    new Set([
      ...PROVEEDORES_FIJOS,
      ...((fabR.data ?? []) as Array<{ name: string }>).map((f) => f.name).filter(Boolean),
    ]),
  );
  const maestro = maestroR.data as
    | { name: string | null; modelo: string | null; familia_proveedor: string | null; gama_id: string | null }
    | null;
  const nombresProveedor: string[] = [];
  if (maestro?.modelo) nombresProveedor.push(maestro.modelo);
  if (maestro?.name) nombresProveedor.push(maestro.name);
  if (maestro?.gama_id) {
    const { data: g, error: eG } = await sb
      .from("catalog_products")
      .select("name, modelo")
      .eq("id", maestro.gama_id)
      .maybeSingle();
    if (eG) console.error("[ficha] gama del maestro:", eG.message);
    if (g?.modelo) nombresProveedor.push(g.modelo);
    if (g?.name) nombresProveedor.push(g.name);
  }
  // Los textos se limpian de fabricantes y del MODELO del proveedor (el nombre
  // completo del maestro, «DISPENSADOR BLUE MOUNTAIN», no: quitaría palabras comunes).
  const prohibidosTexto = [...fabricantes, ...(maestro?.modelo ? [maestro.modelo] : [])];
  const limpiar = (t: string | null) => sinProveedor(t, prohibidosTexto, prod.name);

  // ¿La referencia interna es el nombre de algún producto del proveedor?
  let refEnMaestro = false;
  const interna = prod.internal_reference?.trim();
  if (interna) {
    const palabras = interna
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .split(" ")
      .filter((x) => x.length > 2);
    if (palabras.length > 0) {
      const patron = `%${palabras.join("%")}%`;
      const { data: hit, error: eHit } = await sb
        .from("catalog_products")
        .select("id")
        .or(`name.ilike.${patron},modelo.ilike.${patron},familia_proveedor.ilike.${patron}`)
        .limit(1);
      if (eHit) console.error("[ficha] referencia en el maestro:", eHit.message);
      refEnMaestro = ((hit ?? []) as unknown[]).length > 0;
    }
  }

  // --- Fotos ---------------------------------------------------------------
  const urlPublica = (ruta: string) =>
    (sb.storage.from(BUCKET_FOTOS).getPublicUrl(ruta) as { data: { publicUrl: string } }).data.publicUrl;
  const imgs = (imgsR.data ?? []) as Array<{ storage_path: string; tipo_foto: string | null; is_main: boolean }>;
  const porTipo = (t: string) => imgs.find((i) => i.tipo_foto === t);
  const principal = porTipo("principal") ?? imgs.find((i) => i.is_main);
  const fotoUrl = principal ? urlPublica(principal.storage_path) : (prod.main_image_url ?? null);
  const medidasImg = porTipo("medidas");
  const medidasUrl = medidasImg && secciones.medidas ? urlPublica(medidasImg.storage_path) : null;

  const medidas = {
    anchoMm: prod.dim_width_mm,
    altoMm: prod.dim_height_mm,
    fondoMm: prod.dim_depth_mm,
    pesoG: prod.weight_grams,
  };
  const cotas = cotasDeFicha(medidas, caracteristicas);
  const tresCotas = cotas.a != null && cotas.b != null && cotas.c != null;
  // Sin dibujo de medidas (ocultado en el producto) tampoco van letras en la tabla.
  const hayDibujo = secciones.medidas && (!!medidasUrl || tresCotas);
  // «De la Cota»: la letra de la tabla tiene que estar en el dibujo. El
  // vectorial lleva a, b y c; en un plano del proveedor solo se ponen letras
  // si es de un equipo (los de Osmofilter van con letras) o si un atributo
  // trae la suya («Altura de dispensación (d)»). Los grifos van acotados en mm.
  const conLetras = !hayDibujo
    ? false
    : medidasUrl
    ? prod.kind === "equipment" || caracteristicas.some((c) => c.visible && /\([a-d]\)\s*$/i.test(c.nombre))
    : tresCotas;

  // --- Ventajas: las de la empresa; si no tiene, las del maestro --------------
  let ventajas: VentajaFicha[] = [];
  const extra = (prod.datasheet_extra ?? {}) as { features?: Array<{ title?: string; desc?: string }> };
  if (Array.isArray(extra.features) && extra.features.length > 0) {
    ventajas = extra.features
      .filter((f) => f?.title?.trim())
      .map((f) => ({ titulo: f.title!.trim(), descripcion: f.desc?.trim() || null, iconoUrl: null }));
  } else if (prod.catalog_product_id) {
    const { data: hs, error: eH } = await sb
      .from("catalog_product_highlights")
      .select("titulo, descripcion, icon_path, display_order")
      .eq("catalog_product_id", prod.catalog_product_id)
      .order("display_order")
      .limit(20);
    if (eH) console.error("[ficha] ventajas del maestro:", eH.message);
    const filas = (hs ?? []) as Array<{ titulo: string; descripcion: string | null; icon_path: string | null }>;
    const rutas = Array.from(new Set(filas.map((f) => f.icon_path).filter((x): x is string => !!x)));
    const firmas = new Map<string, string>();
    if (rutas.length > 0) {
      const { data: firmadas, error: eF } = await sb.storage.from(BUCKET_MAESTRO).createSignedUrls(rutas, 600);
      if (eF) console.error("[ficha] iconos:", eF.message);
      for (const f of (firmadas ?? []) as Array<{ path: string | null; signedUrl: string | null }>)
        if (f.path && f.signedUrl) firmas.set(f.path, f.signedUrl);
    }
    ventajas = filas.map((f) => ({
      titulo: f.titulo,
      descripcion: f.descripcion,
      iconoUrl: f.icon_path ? (firmas.get(f.icon_path) ?? null) : null,
    }));
  }
  ventajas = ventajas
    .map((v) => ({
      ...v,
      titulo: textoImprimible(limpiar(v.titulo) ?? ""),
      descripcion: v.descripcion ? textoImprimible(limpiar(v.descripcion) ?? "") || null : null,
    }))
    .filter((v) => v.titulo)
    .slice(0, 5);

  // --- Consumibles y recambios ------------------------------------------------
  const recambios: RecambioFicha[] = [];
  const leerFiltros = async (pid: string) => {
    const { data, error: eF } = await sb
      .from("product_filter_assignments")
      .select("stage_position, replacement_period_months, quantity_per_change, product_filters ( name )")
      .eq("product_id", pid)
      .order("stage_position");
    if (eF) console.error("[ficha] filtros:", eF.message);
    return (data ?? []) as Array<{
      replacement_period_months: number | null;
      quantity_per_change: number | null;
      product_filters: { name: string } | null;
    }>;
  };
  let filtros = await leerFiltros(productId);
  if (filtros.length === 0 && prod.gama_id) filtros = await leerFiltros(prod.gama_id);
  for (const f of filtros) {
    const nombre = limpiar(f.product_filters?.name ?? null);
    if (!nombre) continue;
    const meses = f.replacement_period_months;
    recambios.push({
      nombre: textoImprimible(nombre),
      detalle: meses ? `Cambio cada ${meses} ${meses === 1 ? "mes" : "meses"}` : null,
      cantidad: f.quantity_per_change ?? 1,
    });
  }
  {
    const { data: comp, error: eC } = await sb
      .from("product_compatibilities")
      .select("cantidad, display_order, spare_part_product_id")
      .eq("equipment_product_id", productId)
      .order("display_order")
      .limit(50);
    if (eC) console.error("[ficha] compatibilidades:", eC.message);
    const filas = (comp ?? []) as Array<{ cantidad: number | null; spare_part_product_id: string }>;
    if (filas.length > 0) {
      const { data: piezas, error: eP } = await sb
        .from("products")
        .select("id, name")
        .in(
          "id",
          filas.map((f) => f.spare_part_product_id),
        );
      if (eP) console.error("[ficha] piezas:", eP.message);
      const nombreDe = new Map(((piezas ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
      for (const f of filas) {
        const nombre = limpiar(nombreDe.get(f.spare_part_product_id) ?? null);
        if (!nombre || recambios.some((r) => r.nombre === nombre)) continue;
        recambios.push({ nombre: textoImprimible(nombre), detalle: null, cantidad: f.cantidad ?? 1 });
      }
    }
  }

  // --- Empresa -----------------------------------------------------------------
  const fi = (fiscalR.data ?? {}) as {
    fiscal_legal_name?: string | null;
    fiscal_phone?: string | null;
    fiscal_email?: string | null;
    fiscal_city?: string | null;
    fiscal_province?: string | null;
  };
  const nombreEmpresa = (coR.data as { name?: string } | null)?.name ?? fi.fiscal_legal_name ?? "Empresa";
  const localidad = [fi.fiscal_city, fi.fiscal_province && fi.fiscal_province !== fi.fiscal_city ? `(${fi.fiscal_province})` : null]
    .filter(Boolean)
    .join(" ");

  const modelo: FichaModelo = {
    productoId: prod.id,
    nombre: textoImprimible(prod.name),
    referencia: referenciaImprimible({
      interna: prod.internal_reference,
      proveedor: prod.supplier_reference,
      nombresProveedor,
      prohibidos: fabricantes,
      refEnMaestro,
    }),
    rasgos: rasgosDe(limpiar(prod.rasgos_identificacion)),
    descripcion: (() => {
      const d = limpiar(prod.short_description);
      return d ? textoImprimible(d) : null;
    })(),
    descripcionLarga: (() => {
      const d = limpiar(prod.long_description);
      return d ? textoImprimible(d).slice(0, 420) : null;
    })(),
    fotoUrl,
    medidasUrl,
    cotas,
    hayDibujo,
    bloques: bloquesDeFicha(caracteristicas, medidas, {
      conLetras,
      fabricantes,
      limpiar,
    }),
    ventajas: secciones.ventajas ? ventajas : [],
    recambios: secciones.recambios ? recambios.slice(0, 12) : [],
    empresa: {
      nombre: textoImprimible(nombreEmpresa),
      razonSocial: fi.fiscal_legal_name ? textoImprimible(fi.fiscal_legal_name) : null,
      telefono: formatearTelefono(ajustes.opciones.telefono ?? fi.fiscal_phone ?? null),
      correo: ajustes.opciones.correo ?? fi.fiscal_email ?? null,
      web: ajustes.opciones.web,
      localidad: localidad || null,
      logoUrl: ajustes.logoUrl,
    },
    revision: fechaRevision(prod.updated_at),
  };
  return { modelo, ajustes, companyId: prod.company_id };
}
