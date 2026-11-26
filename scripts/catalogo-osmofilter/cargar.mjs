#!/usr/bin/env node
// =============================================================================
// Carga del catálogo de Osmofilter en el catálogo MAESTRO (superadmin).
// Plan: docs/PLAN_CATALOGO_MAESTRO.md (§E, adaptado a las respuestas de §H).
//
// Uso:
//   node scripts/catalogo-osmofilter/cargar.mjs              # prueba en seco (por defecto)
//   node scripts/catalogo-osmofilter/cargar.mjs --aplicar    # escribe (service-role)
//     --paso=atributos,productos,gamas,valores,fotos,ventajas,recambios,enlaces,documentos
//     --solo=AT6925,RO1073P      limitar a unas refs (equipos y/o recambios)
//     --origen=D:\OSMONOVA\catalogo
//     --estado=api|respaldo      de dónde lee la prueba en seco el estado actual:
//                                api = Management API, solo SELECT (por defecto);
//                                respaldo = supabase/datos/respaldo-catalogo-2026-11-25
//     --sin-hash                 no calcula el sha1 de los PDF (más rápido; no deduplica)
//     --lista=nuevos_residencial.json --carpeta=Residencial
//                                modo LISTA: lee esa lista (en --origen) y las fichas de
//                                <origen>/<carpeta>/<p.carpeta> en vez de productos.json y los
//                                catálogos. Solo COMPLETA filas que ya existen en el maestro
//                                (nunca crea ninguna), respeta «excluir» de
//                                nuevos-residencial-mapa.json, toma nombre y rasgos de ese mapa
//                                y no hace gamas, recambios ni enlaces (eso es de
//                                cargar-nuevos-residencial.mjs). Pasos por defecto: atributos,
//                                productos, valores, fotos, ventajas, documentos.
//
// Reglas (no se negocian):
//   - Sin --aplicar no hay ni una escritura en base de datos ni en Storage.
//   - Idempotente. Nunca borra. Nunca pisa un campo no nulo. Nunca envía «version».
//   - Solo escribe en tablas del maestro (catalog_*, product_attributes_global*) y
//     en el bucket catalog-global. Ninguna tabla con company_id.
//   - Las refs que ya existen solo se completan (nombre, tipo, categoría, fabricante,
//     activo, versión, fotos actuales y valores existentes no se tocan).
//   - Lee D:\OSMONOVA\catalogo solo en lectura.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const ORIGEN_CARGA_POR_DEFECTO = 'osmofilter-2026-11-25';
const BUCKET = 'catalog-global';
const PROYECTO = 'pkgvzwunazzkstlfubnq';
const LIMITE_SUBIDA_BYTES = 50 * 1024 * 1024; // límite por defecto de Supabase por fichero [sin verificar en este proyecto]
const PASOS = ['atributos', 'productos', 'gamas', 'valores', 'fotos', 'ventajas', 'recambios', 'enlaces', 'documentos'];

// ---------------------------------------------------------------- argumentos
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APLICAR = args.aplicar === true;
const ORIGEN = args.origen || 'D:/OSMONOVA/catalogo';
const SOLO = args.solo ? new Set(String(args.solo).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
const LISTA = typeof args.lista === 'string' ? args.lista : null;
const CARPETA = typeof args.carpeta === 'string' ? args.carpeta : null;
if (!!LISTA !== !!CARPETA) salir('--lista y --carpeta van juntas');
const PASOS_LISTA = ['atributos', 'productos', 'valores', 'fotos', 'ventajas', 'documentos'];
const PASOS_ACTIVOS = args.paso ? String(args.paso).split(',').map((s) => s.trim()) : (LISTA ? PASOS_LISTA : PASOS);
const ESTADO = args.estado || 'api';
const SIN_HASH = args['sin-hash'] === true;
for (const p of PASOS_ACTIVOS) if (!PASOS.includes(p)) salir(`Paso desconocido: ${p}`);
if (LISTA) for (const p of PASOS_ACTIVOS) if (!PASOS_LISTA.includes(p)) salir(`En modo --lista no hay paso «${p}» (gamas, recambios y enlaces son de cargar-nuevos-residencial.mjs)`);
if (LISTA && ESTADO === 'respaldo') salir('El modo --lista necesita el estado actual (--estado=api)');
// En modo lista solo se usa para rellenar origen_carga si estuviera vacío (es el de cargar-nuevos-residencial.mjs)
const ORIGEN_CARGA = LISTA ? 'osmofilter-residencial-2026-11-26' : ORIGEN_CARGA_POR_DEFECTO;

function salir(msg) { console.error('ERROR: ' + msg); process.exit(1); }
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- entorno
function leerEnv() {
  const f = path.join(RAIZ, '.env.local');
  if (!fs.existsSync(f)) return {};
  const env = {};
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = leerEnv();

// ---------------------------------------------------------------- utilidades
const leerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lower = (s) => String(s).toLowerCase();
const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slug = (s) => sinTildes(String(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const RE_FIN_EXISTENCIAS = /\(?\s*hasta fin (de )?existencias\s*\)?/i;
const limpiarTexto = (d) => String(d || '').replace(RE_FIN_EXISTENCIAS, '').replace(/\s*\bOsmofilter\b/gi, '').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
const normUnidad = (u) => sinTildes(String(u || '')).replace(/³/g, '3').replace(/[°º]/g, 'o').replace(/\s+/g, '').toLowerCase();

function numero(s) {
  const t = String(s).trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

async function enParalelo(items, n, fn) {
  const res = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
}

async function conReintento(fn, intentos = 4) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try { return await fn(); } catch (e) { ultimo = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw ultimo;
}

// ---------------------------------------------------------------- ficheros de configuración
const MAPA_ATR = leerJson(path.join(AQUI, 'mapa-atributos.json'));
const MAPA_FAM = leerJson(path.join(AQUI, 'mapa-familias.json'));
const GAMAS = leerJson(path.join(AQUI, 'gamas.json'));
const ALIAS = leerJson(path.join(AQUI, 'alias.json')).alias;
const refMaestro = (ref) => ALIAS[ref] || ref;

// ---------------------------------------------------------------- origen (solo lectura)
const CATALOGOS = ['General', 'Especialista', 'Venta Directa', 'Horeca', 'Fuentes'];
const PRODUCTOS = leerJson(path.join(ORIGEN, LISTA || 'productos.json')).productos;
const RECAMBIOS_JSON = LISTA ? {} : leerJson(path.join(ORIGEN, 'recambios_por_equipo.json')).equipos;
// Modo lista: nombre y rasgos a mano, y refs que no se cargan nunca (Distribución y Retail)
const MAPA_RES = LISTA ? leerJson(path.join(AQUI, 'nuevos-residencial-mapa.json')) : null;
const EXCLUIR = new Set((MAPA_RES?.excluir || []).map(lower));

function carpetaDe(p) {
  if (LISTA) {
    if (!p.carpeta) return null;
    const d = path.join(ORIGEN, CARPETA, p.carpeta);
    return fs.existsSync(path.join(d, 'ficha.json')) ? d : null;
  }
  for (const c of [...(p.catalogos || []), ...CATALOGOS]) {
    const d = path.join(ORIGEN, c, p.carpeta);
    if (fs.existsSync(path.join(d, 'ficha.json'))) return d;
  }
  return null;
}

function leerExcel() {
  const dir = path.join(ORIGEN, '_fuente');
  const xlsx = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^catalogo_.*\.xlsx$/i.test(f)).sort().pop() : null;
  if (!xlsx) return { error: 'No hay Excel en _fuente' };
  const codigo = [
    'import json, sys, openpyxl',
    'ws = openpyxl.load_workbook(sys.argv[1], read_only=True).worksheets[0]',
    'filas = []',
    'for i, r in enumerate(ws.iter_rows(values_only=True)):',
    '    if i == 0: continue',
    '    r = list(r) + [None] * 6',
    '    filas.append({"tipo": r[0], "ref": r[1], "descripcion": r[2], "familia": r[3], "usado_en": r[5]})',
    'sys.stdout.write(json.dumps(filas, ensure_ascii=False))',
  ].join('\n');
  try {
    const out = execFileSync('python', ['-I', '-c', codigo, path.join(dir, xlsx)], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 64 * 1024 * 1024 });
    return { fichero: xlsx, filas: JSON.parse(out.toString('utf8')) };
  } catch (e) {
    return { error: 'No se pudo leer el Excel con python/openpyxl: ' + e.message.split('\n')[0] };
  }
}

// ---------------------------------------------------------------- estado de la base de datos
// En seco: Management API con SELECT. Con --aplicar: supabase-js con service-role.
const TABLAS_ESTADO = {
  catalog_products: ['id', 'supplier_reference', 'name', 'kind', 'category_global_key', 'manufacturer_id', 'short_description', 'long_description', 'dim_width_mm', 'dim_height_mm', 'dim_depth_mm', 'weight_grams', 'main_image_path', 'gama_id', 'rasgos_identificacion', 'version', 'is_active', '?modelo', '?familia_proveedor', '?catalogos_proveedor', '?descatalogado', '?origen_carga'],
  product_attributes_global: ['id', 'key', 'name_es', 'data_type', 'unit', 'enum_values', '?grupo'],
  product_attributes_global_categories: ['attribute_key', 'category_key'],
  product_categories_global: ['key', 'parent_key', 'default_kind'],
  catalog_product_attributes: ['catalog_product_id', 'attribute_global_key', 'value_text', 'value_number', 'value_boolean'],
  catalog_product_photos: ['catalog_product_id', 'storage_path', 'is_main', 'tipo_foto'],
  catalog_product_documents: ['catalog_product_id', 'storage_path', 'kind'],
  catalog_product_highlights: ['catalog_product_id'],
  catalog_product_compatibilities: ['spare_part_catalog_id', 'equipment_catalog_id'],
  manufacturers: ['id', 'name'],
};
// Columnas que pone la migración 20261126100000 (la carga no puede escribir sin ellas)
const COLUMNAS_MIGRACION = {
  catalog_products: ['modelo', 'familia_proveedor', 'catalogos_proveedor', 'descatalogado', 'origen_carga'],
  product_attributes_global: ['grupo'],
  catalog_product_photos: ['thumb_path', 'etiqueta', 'width_px', 'height_px'],
  catalog_product_documents: ['idioma', 'apartado'],
};

async function consultaApi(sql) {
  const token = ENV.SUPABASE_ACCESS_TOKEN;
  if (!token) salir('Falta SUPABASE_ACCESS_TOKEN en .env.local (prueba en seco con --estado=api)');
  if (!/^\s*(select|with)\b/i.test(sql)) salir('La prueba en seco solo lanza SELECT');
  let r, t;
  for (let i = 0; i < 6; i++) {
    r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    t = await r.text();
    if (r.status < 500) break;
    await new Promise((z) => setTimeout(z, 5000));
  }
  if (r.status >= 300) salir(`Management API ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

let SB = null; // cliente service-role (solo con --aplicar)
async function clienteServicio() {
  if (SB) return SB;
  const url = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const clave = ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_SECRET_KEY;
  if (!url || !clave) salir('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local');
  const { createClient } = await import('@supabase/supabase-js');
  SB = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
  return SB;
}

async function leerEstado() {
  const estado = { columnas: {}, origen: ESTADO };
  if (APLICAR) {
    const sb = await clienteServicio();
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const opcionales = cols.filter((c) => c.startsWith('?')).map((c) => c.slice(1));
      const fijas = cols.filter((c) => !c.startsWith('?'));
      const presentes = [];
      for (const c of opcionales) {
        const { error } = await sb.from(t).select(c).limit(1);
        if (!error) presentes.push(c);
      }
      estado.columnas[t] = new Set([...fijas, ...presentes]);
      const sel = [...estado.columnas[t]].join(',');
      const filas = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await sb.from(t).select(sel).range(desde, desde + 999);
        if (error) salir(`Leyendo ${t}: ${error.message}`);
        filas.push(...data);
        if (data.length < 1000) break;
      }
      estado[t] = filas;
    }
    // columnas de la migración en las tablas que no se leen enteras
    for (const [t, cols] of Object.entries(COLUMNAS_MIGRACION)) {
      if (estado.columnas[t] && cols.every((c) => estado.columnas[t].has(c))) continue;
      const presentes = new Set(estado.columnas[t] || []);
      for (const c of cols) { const { error } = await sb.from(t).select(c).limit(1); if (!error) presentes.add(c); }
      estado.columnas[t] = presentes;
    }
  } else if (ESTADO === 'respaldo') {
    const dir = path.join(RAIZ, 'supabase', 'datos', 'respaldo-catalogo-2026-11-25');
    for (const t of Object.keys(TABLAS_ESTADO)) {
      estado[t] = leerJson(path.join(dir, t + '.json'));
      estado.columnas[t] = new Set(Object.keys(estado[t][0] || {}));
    }
    for (const [t, cols] of Object.entries(COLUMNAS_MIGRACION)) estado.columnas[t] = new Set([...(estado.columnas[t] || []), ...cols.filter((c) => (estado.columnas[t] || new Set()).has(c))]);
  } else {
    const filasCols = await consultaApi(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in (${[...new Set([...Object.keys(TABLAS_ESTADO), ...Object.keys(COLUMNAS_MIGRACION)])].map((t) => `'${t}'`).join(',')})`);
    for (const { table_name, column_name } of filasCols) (estado.columnas[table_name] ||= new Set()).add(column_name);
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const sel = cols.map((c) => c.replace(/^\?/, '')).filter((c) => estado.columnas[t]?.has(c));
      const r = await consultaApi(`select coalesce(json_agg(x), '[]'::json) as filas from (select ${sel.map((c) => `"${c}"`).join(', ')} from public.${t}) x`);
      estado[t] = r[0].filas;
    }
  }
  // Modo lista: iconos y PDF que ya están en el bucket, para reutilizarlos sin volver a subirlos
  if (LISTA) {
    estado.enStorage = new Set();
    if (APLICAR) {
      const sb = await clienteServicio();
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await sb.storage.from(BUCKET).list('iconos/osmofilter', { limit: 1000, offset: desde });
        if (error) salir('Listando iconos del bucket: ' + error.message);
        for (const o of data) estado.enStorage.add(`iconos/osmofilter/${o.name}`);
        if (data.length < 1000) break;
      }
    } else {
      const r = await consultaApi(`select coalesce(json_agg(name), '[]'::json) as nombres from storage.objects where bucket_id = '${BUCKET}' and (name like 'iconos/osmofilter/%' or name like 'documentos/osmofilter/%')`);
      for (const n of r[0].nombres) estado.enStorage.add(n);
    }
  }
  return estado;
}

// ---------------------------------------------------------------- comprobaciones de seguridad (§E.3)
const TABLAS_PERMITIDAS = new Set(['product_attributes_global', 'product_attributes_global_categories', 'catalog_products', 'catalog_product_attributes', 'catalog_product_photos', 'catalog_product_highlights', 'catalog_product_compatibilities', 'catalog_product_documents']);
const INTOCABLES_EXISTENTE = new Set(['name', 'kind', 'category_global_key', 'manufacturer_id', 'is_active', 'version', 'main_image_path_existente', 'supplier_reference']);
const comprobaciones = { payloads: 0, fallos: [] };
function comprobarPayload(tabla, payload, { actualizaExistente = false } = {}) {
  comprobaciones.payloads++;
  const filas = Array.isArray(payload) ? payload : [payload];
  if (!TABLAS_PERMITIDAS.has(tabla)) comprobaciones.fallos.push(`Tabla no permitida: ${tabla}`);
  for (const f of filas) {
    if ('version' in f) comprobaciones.fallos.push(`${tabla}: payload con «version»`);
    if ('company_id' in f) comprobaciones.fallos.push(`${tabla}: payload con «company_id»`);
    if (actualizaExistente) for (const k of Object.keys(f)) if (INTOCABLES_EXISTENTE.has(k)) comprobaciones.fallos.push(`${tabla}: se intentaba escribir «${k}» en una fila existente`);
  }
  if (comprobaciones.fallos.length) salir('Comprobación previa fallida:\n  ' + [...new Set(comprobaciones.fallos)].join('\n  '));
}

// ---------------------------------------------------------------- transformaciones
const GRUPOS = MAPA_ATR.grupos;
const TIPO_ESPERADO = { numero: 'number', booleano: 'boolean', texto: 'text', enum: 'enum', rango: 'number', rango_con_unidad: 'number', produccion: 'number' };

function categoriaDe(p) {
  const porRef = MAPA_FAM.por_ref[p.ref];
  const fam = MAPA_FAM.familias[p.familia];
  if (!fam) return null;
  return { categoria: porRef?.categoria || fam.categoria, kind: porRef?.kind || fam.kind };
}

function destinoPara(entrada, categoria, padres) {
  const d = entrada.destino;
  if (d[categoria]) return d[categoria];
  if ((categoria === 'osmosis' || padres.get(categoria) === 'osmosis') && d['osmosis*']) return d['osmosis*'];
  return d['*'];
}

// Devuelve { filas: [{key, value_text|value_number|value_boolean}], sinFila?: motivo, error?: motivo }
function convertir(entrada, valorBruto, destino) {
  const v = String(valorBruto ?? '').trim();
  const t = entrada.transformacion;
  if (v === '') return { sinFila: 'vacío' };
  const esNo = /^no$/i.test(v);
  switch (t) {
    case 'numero': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const n = numero(v);
      if (n === null) return { error: 'no es un número' };
      if (n === 0) return { sinFila: '«0» = no tiene' };
      return { filas: [{ key: destino, value_number: n }] };
    }
    case 'booleano': {
      if (/^s[ií]$/i.test(v)) return { filas: [{ key: destino, value_boolean: true }] };
      if (esNo) return { filas: [{ key: destino, value_boolean: false }] };
      return { error: 'no es Sí/No' };
    }
    case 'texto': {
      if (esNo && entrada.no_es_sin_fila) return { sinFila: '«No» = no tiene' };
      return { filas: [{ key: destino, value_text: v }] };
    }
    case 'enum': {
      const norm = entrada.valores?.[v];
      if (!norm) return { error: 'valor fuera del enum' };
      return { filas: [{ key: destino, value_text: norm, _enum: true }] };
    }
    case 'rango': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const partes = v.split(/\s*[–~-]\s*/);
      if (partes.length !== 2) return { error: 'no es un rango «a–b»' };
      const [a, b] = partes.map(numero);
      if (a === null || b === null) return { error: 'rango con valores no numéricos' };
      return { filas: [{ key: destino[0], value_number: a }, { key: destino[1], value_number: b }] };
    }
    case 'rango_con_unidad': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const sinU = v.replace(/\s*[º°]\s*C\b/gi, '').trim();
      const max = sinU.match(/^m[aá]ximo de\s*(\d+(?:[.,]\d+)?)$/i);
      if (max) return { filas: [{ key: destino[1], value_number: numero(max[1]) }] };
      const partes = sinU.split(/\s*[–~-]\s*/);
      if (partes.length !== 2) return { error: 'no es un rango «a–b ºC»' };
      const [a, b] = partes.map(numero);
      if (a === null || b === null) return { error: 'rango con valores no numéricos' };
      return { filas: [{ key: destino[0], value_number: a }, { key: destino[1], value_number: b }] };
    }
    case 'produccion': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const gpd = v.match(/(\d+(?:[.,]\d+)?)\s*GPD/i);
      const lmin = v.match(/(\d+(?:[.,]\d+)?)\s*L\s*\/\s*m(?:in)?\b/i);
      if (!gpd && !lmin) return { error: 'no se reconoce «N GPD - M L/min»' };
      const filas = [];
      if (gpd) filas.push({ key: destino.gpd, value_number: numero(gpd[1]) });
      if (lmin) filas.push({ key: destino.lmin, value_number: numero(lmin[1]) });
      return { filas };
    }
    default:
      return { error: `transformación desconocida «${t}»` };
  }
}

function clasificarFoto(rel) {
  const f = rel.replace(/^imagenes\//, '');
  let m;
  if (f === 'principal.webp') return { tipo: 'principal', n: 1, orden: 0 };
  if (f === 'ficha-tecnica.webp') return { tipo: 'ficha', n: 1, orden: 1 };
  if ((m = f.match(/^ambiente-(\d+)\.webp$/))) return { tipo: 'ambiente', n: +m[1], etiqueta: `Ambiente ${m[1]}`, orden: 10 + +m[1] };
  if ((m = f.match(/^detalles\/detalle-(\d+)\.webp$/))) return { tipo: 'detalle', n: +m[1], etiqueta: `Detalle ${m[1]}`, orden: 20 + +m[1] };
  if (f === 'medidas.webp') return { tipo: 'medidas', n: 1, orden: 30 };
  if (f === 'banner.webp') return { tipo: 'banner', n: 1, orden: 40 };
  if ((m = f.match(/^proyecciones\/proyeccion-([a-z])\.webp$/))) return { tipo: 'proyeccion', n: m[1], etiqueta: `Proyección ${m[1].toUpperCase()}`, orden: 50 + m[1].charCodeAt(0) - 96 };
  if (f === 'proyecciones/sin-caratula.webp') return { tipo: 'proyeccion', n: 'sin-caratula', etiqueta: 'Sin carátula', orden: 59 };
  if (f === 'miniatura.webp') return { tipo: 'miniatura', n: 1, orden: 0 };
  return null;
}

function clasificarDocumento(nombre, categoriaOsmo) {
  const n = sinTildes(nombre).toLowerCase();
  if (/^ficha tecnica/.test(n)) return { kind: 'manufacturer_datasheet', apartado: 'ficha_tecnica' };
  if (/certi?f?i?cado|certficado|declaracion conformidad/.test(n)) return { kind: 'certificate', apartado: 'certificado' };
  if (/guia instalacion|guia rapida instalacion/.test(n)) return { kind: 'manual_installer', apartado: 'guia' };
  if (/guia rapida|quickguide/.test(n)) return { kind: 'manual_user', apartado: 'guia' };
  if (/manual/.test(n)) return { kind: 'manual_user', apartado: 'manual' };
  if (/ficha comercial|diptico|triptico|flyer|hoja comercial/.test(n)) return { kind: 'other', apartado: 'comercial' };
  if (categoriaOsmo === 'comercial') return { kind: 'other', apartado: 'comercial' };
  if (categoriaOsmo === 'manual') return { kind: 'manual_user', apartado: 'manual' };
  if (categoriaOsmo === 'tecnico') return { kind: 'certificate', apartado: 'certificado' };
  return { kind: 'other', apartado: 'otro' };
}

function idiomaDe(nombre) {
  const m = nombre.replace(/\.pdf$/i, '').match(/(?:^|[\s_-])((?:ES|EN|FR|IT|DE|PT)(?:_(?:ES|EN|FR|IT|DE|PT))*)(?=$|[\s_.-])/);
  return m ? m[1] : null;
}

const hashes = new Map();
function sha1(fichero) {
  if (SIN_HASH) return null;
  if (hashes.has(fichero)) return hashes.get(fichero);
  const h = crypto.createHash('sha1').update(fs.readFileSync(fichero)).digest('hex');
  hashes.set(fichero, h);
  return h;
}

// ---------------------------------------------------------------- construcción del plan
async function construirPlan(estado) {
  const sharp = (await import('sharp')).default;
  const informe = {
    fecha: new Date().toISOString(), modo: APLICAR ? 'aplicar' : 'seco', lista: LISTA ? { lista: LISTA, carpeta: CARPETA } : null, estado: estado.origen, solo: SOLO ? [...SOLO] : null, pasos: PASOS_ACTIVOS,
    migracion_pendiente: [], productos: { crear: [], completar: [], sin_cambios: [], saltar: [] }, atributos: {},
    sin_emparejar: {}, no_convertidos: [], sin_fila: {}, valores_existentes_conservados: [], conflictos: [], avisos: [],
    fotos: {}, sin_foto: [], sin_caracteristicas: [], ventajas: {}, recambios: {}, enlaces: {}, documentos: {}, gamas: [],
  };
  for (const [t, cols] of Object.entries(COLUMNAS_MIGRACION)) {
    const faltan = cols.filter((c) => !estado.columnas[t]?.has(c));
    if (faltan.length) informe.migracion_pendiente.push(`${t}: ${faltan.join(', ')}`);
  }

  const osmo = estado.manufacturers.find((m) => lower(m.name) === 'osmofilter');
  if (!osmo) salir('No existe el fabricante «Osmofilter» en manufacturers');
  const porRefBD = new Map(estado.catalog_products.map((p) => [lower(p.supplier_reference), p]));
  const globales = new Map(estado.product_attributes_global.map((g) => [g.key, g]));
  const padres = new Map(estado.product_categories_global.map((c) => [c.key, c.parent_key]));
  const enlacesCat = new Set(estado.product_attributes_global_categories.map((l) => `${l.attribute_key}|${l.category_key}`));
  const valoresBD = new Map(estado.catalog_product_attributes.map((v) => [`${v.catalog_product_id}|${v.attribute_global_key}`, v]));
  const fotosBD = new Set(estado.catalog_product_photos.map((f) => f.storage_path));
  const conPrincipal = new Set(estado.catalog_product_photos.filter((f) => f.is_main).map((f) => f.catalog_product_id));
  const docsBD = new Set(estado.catalog_product_documents.map((d) => `${d.catalog_product_id}|${d.storage_path}`));
  const conFichaTecnica = new Set(estado.catalog_product_documents.filter((d) => d.kind === 'manufacturer_datasheet').map((d) => d.catalog_product_id));
  const conVentajas = new Set(estado.catalog_product_highlights.map((h) => h.catalog_product_id));
  const compatBD = new Set(estado.catalog_product_compatibilities.map((c) => `${c.spare_part_catalog_id}|${c.equipment_catalog_id}`));
  const tieneGamaHijas = new Set(estado.catalog_products.filter((p) => p.gama_id).map((p) => p.gama_id));

  // Gamas: ref -> { gama, variante }
  const gamaDeRef = new Map();
  for (const g of GAMAS.gamas) for (const v of g.variantes) gamaDeRef.set(v.ref, { gama: g, variante: v });

  const incluido = (ref) => !SOLO || SOLO.has(lower(ref)) || SOLO.has(lower(refMaestro(ref)));
  const idDe = (refM) => porRefBD.get(lower(refM))?.id || `nuevo:${refM}`;

  const plan = { atributosNuevos: [], globalesRellenar: [], enlacesCategoria: [], productosNuevos: [], productosCompletar: [], gamas: [], valores: [], fotos: [], iconos: new Map(), ventajas: [], recambiosNuevos: [], recambiosCompletar: [], enlaces: [], documentos: [], subidasDocs: new Map() };
  const atributosUsados = new Map(); // key -> { veces, categorias:Set, unidadOsmo:Set, nombreOsmo }
  const equiposEnMaestro = new Set(estado.catalog_products.map((p) => lower(p.supplier_reference)));

  // ---------- equipos
  const equipos = [];
  if (LISTA) Object.assign(informe.productos, { excluidas: [], sin_fila_maestro: [], sin_datos: [], sin_descargar: [] });
  for (const p of PRODUCTOS) {
    if (!incluido(p.ref)) continue;
    if (LISTA) {
      // ---- modo lista: solo completa filas existentes con lo que traiga la ficha
      const refM = refMaestro(p.ref);
      if (EXCLUIR.has(lower(p.ref)) || EXCLUIR.has(lower(refM))) { informe.productos.excluidas.push(p.ref); continue; }
      const dir = carpetaDe(p);
      if (!dir) { informe.productos.sin_descargar.push(p.ref); continue; }
      const existente = porRefBD.get(lower(refM)) || null;
      if (!existente) { informe.productos.sin_fila_maestro.push(`${p.ref} (${p.nombre || p.descripcion})`); continue; }
      const ficha = leerJson(path.join(dir, 'ficha.json'));
      const nItems = (ficha.grupos_ft || []).reduce((a, g) => a + (g.items || []).length, 0);
      const nArchivos = (p.archivos || []).filter((a) => a.startsWith('imagenes/') || a.startsWith('documentos/')).length;
      if (!nItems && !(ficha.highlights || []).length && !nArchivos) {
        const txtF = path.join(dir, 'datos-para-cargar.txt');
        const txt = fs.existsSync(txtF) ? fs.readFileSync(txtF, 'utf8') : '';
        if (/^\s*(VENTAJAS|CARACTER[IÍ]STICAS)\b/m.test(txt)) informe.avisos.push(`${p.ref}: datos-para-cargar.txt trae ventajas o características pero ficha.json no; no se carga nada`);
        informe.productos.sin_datos.push(p.ref);
        continue;
      }
      const cat = { categoria: existente.category_global_key, kind: existente.kind };
      const catOsmo = categoriaDe(p);
      if (catOsmo && (catOsmo.categoria !== cat.categoria || catOsmo.kind !== cat.kind)) informe.avisos.push(`${refM}: se queda en ${cat.categoria}/${cat.kind} (mapa-familias: ${catOsmo.categoria}/${catOsmo.kind}); los atributos se enlazan a ${cat.categoria}`);
      const m = MAPA_RES.productos?.[p.ref] || {};
      const nrm = (x) => sinTildes(String(x || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (p.nombre && existente.name && !nrm(p.nombre).includes(nrm(existente.name)) && !nrm(existente.name).includes(nrm(p.nombre))) informe.avisos.push(`${refM}: la ficha de Osmofilter lo llama «${p.nombre}» y en el maestro es «${existente.name}»; el nombre no se toca, pero revisa que la ficha sea de este producto`);
      const nombre = existente.name || m.nombre || p.nombre;
      const gv = { gama: { modelo: m.nombre || nombre, cabeza: p.ref }, variante: { ref: p.ref, nombre, rasgos: existente.rasgos_identificacion || m.rasgos || null } };
      equipos.push({ p, dir, ficha, cat, gv, refM, existente });
      continue;
    }
    const dir = carpetaDe(p);
    const cat = categoriaDe(p);
    const gv = gamaDeRef.get(p.ref);
    const refM = refMaestro(p.ref);
    const existente = porRefBD.get(lower(refM)) || null;
    if (!dir) { informe.productos.saltar.push({ ref: p.ref, motivo: 'sin ficha.json en la descarga' }); continue; }
    if (!cat) { informe.productos.saltar.push({ ref: p.ref, motivo: `familia sin mapa: ${p.familia}` }); continue; }
    if (!gv) { informe.productos.saltar.push({ ref: p.ref, motivo: 'no está en gamas.json' }); continue; }
    const ficha = leerJson(path.join(dir, 'ficha.json'));
    equipos.push({ p, dir, ficha, cat, gv, refM, existente });
    equiposEnMaestro.add(lower(refM));
  }

  if (LISTA) {
    // carpetas descargadas que no están en la lista (no se cargan; solo aviso)
    const enLista = new Set(PRODUCTOS.map((p) => p.carpeta).filter(Boolean));
    const dirBase = path.join(ORIGEN, CARPETA);
    for (const d of fs.existsSync(dirBase) ? fs.readdirSync(dirBase) : []) {
      if (enLista.has(d) || !fs.statSync(path.join(dirBase, d)).isDirectory()) continue;
      const ref = d.split(' - ')[0].trim();
      informe.avisos.push(EXCLUIR.has(lower(ref)) ? `${ref}: tiene carpeta en ${CARPETA}/ pero está en «excluir»; no se carga` : `${ref}: tiene carpeta en ${CARPETA}/ pero no está en ${LISTA}; no se carga`);
      if (EXCLUIR.has(lower(ref))) informe.productos.excluidas.push(ref + ' (solo carpeta)');
    }
  }
  for (const e of equipos) {
    const { p, ficha, cat, gv, refM, existente } = e;
    const nombre = gv.variante.nombre || gv.gama.modelo;
    const descLarga = limpiarTexto(p.descripcion);
    const descFicha = (ficha.grupos || []).flatMap((g) => g.items || []).find((i) => i.atributo === 'Descripcion')?.valor;
    const descCorta = !vacio(descFicha) ? limpiarTexto(descFicha) : descLarga;
    const columnas = {};
    const valores = [];
    const atributosOsmo = (ficha.grupos_ft || []).flatMap((g) => (g.items || []).map((i) => ({ ...i, grupo: GRUPOS[g.nombre] || null, grupoOsmo: g.nombre })));
    for (const it of atributosOsmo) {
      const col = MAPA_ATR.columnas[it.atributo];
      if (col) {
        const n = numero(it.valor);
        if (n === null || n <= 0) informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: it.valor, motivo: 'medida o peso no numérico o cero' });
        else columnas[col.columna] = Math.round(n * col.factor);
        continue;
      }
      const entrada = MAPA_ATR.atributos[it.atributo];
      if (!entrada) {
        const k = `${it.grupoOsmo} · ${it.atributo}`;
        (informe.sin_emparejar[k] ||= { veces: 0, ejemplos: new Set() }).veces++;
        informe.sin_emparejar[k].ejemplos.add(`${p.ref}: ${it.valor} ${it.unidad || ''}`.trim());
        continue;
      }
      const destino = destinoPara(entrada, cat.categoria, padres);
      const r = convertir(entrada, it.valor, destino);
      if (r.error) { informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: `${it.valor}${it.unidad ? ' ' + it.unidad : ''}`, motivo: r.error }); continue; }
      if (r.sinFila) { const k = `${it.atributo} (${r.sinFila})`; informe.sin_fila[k] = (informe.sin_fila[k] || 0) + 1; continue; }
      for (const f of r.filas) {
        const g = globales.get(f.key);
        const nuevo = MAPA_ATR.nuevos[f.key];
        if (!g && !nuevo) { informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: it.valor, motivo: `la clave ${f.key} no existe ni está en «nuevos»` }); continue; }
        const tipoBD = g?.data_type || nuevo.data_type;
        const esperado = f._enum ? 'enum' : TIPO_ESPERADO[entrada.transformacion];
        if (tipoBD !== esperado) { informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: it.valor, motivo: `tipo no casa: ${f.key} es ${tipoBD}, la transformación da ${esperado}` }); continue; }
        if (f._enum && g?.enum_values && !g.enum_values.includes(f.value_text)) { informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: it.valor, motivo: `«${f.value_text}» no está en enum_values de ${f.key}` }); continue; }
        const u = (atributosUsados.get(f.key) || { veces: 0, categorias: new Set(), unidadOsmo: new Set(), nombreOsmo: it.atributo, grupo: it.grupo });
        u.veces++; u.categorias.add(cat.categoria); if (it.unidad) u.unidadOsmo.add(it.unidad);
        atributosUsados.set(f.key, u);
        const { _enum, ...fila } = f;
        valores.push({ ...fila, display_order: valores.length });
      }
    }
    e.columnas = columnas; e.valores = valores; e.nombre = nombre; e.descCorta = descCorta; e.descLarga = descLarga;
    if (!valores.length && !Object.keys(columnas).length) informe.sin_caracteristicas.push(p.ref);
  }

  // ---------- paso atributos
  const ordenGrupo = MAPA_ATR.orden_grupos;
  let i = 0;
  for (const [key, u] of [...atributosUsados].sort((a, b) => a[0].localeCompare(b[0]))) {
    const g = globales.get(key);
    const nuevo = MAPA_ATR.nuevos[key];
    if (!g) {
      const fila = { key, name_es: nuevo.name_es, data_type: nuevo.data_type, unit: nuevo.unit, grupo: nuevo.grupo, sort_order: (ordenGrupo[nuevo.grupo] || 40) * 10 + (i++ % 10), default_visible: true };
      plan.atributosNuevos.push(fila);
      const uo = [...u.unidadOsmo].map(normUnidad);
      if (uo.length && !uo.every((x) => x === normUnidad(nuevo.unit))) informe.avisos.push(`Unidad: ${key} se crea con «${nuevo.unit ?? ''}» y Osmofilter da «${[...u.unidadOsmo].join(' / ')}»`);
    } else {
      const rell = {};
      if (estado.columnas.product_attributes_global?.has('grupo') && vacio(g.grupo) && u.grupo) rell.grupo = u.grupo;
      if (!estado.columnas.product_attributes_global?.has('grupo') && u.grupo) rell.grupo = u.grupo; // se escribirá tras la migración
      const extra = MAPA_ATR.rellenar_globales_existentes[key];
      if (extra?.unit && vacio(g.unit)) rell.unit = extra.unit;
      if (Object.keys(rell).length) plan.globalesRellenar.push({ key, ...rell });
      const uo = [...u.unidadOsmo].map(normUnidad);
      const ub = normUnidad(rell.unit ?? g.unit);
      if (uo.length && ub && !uo.every((x) => x === ub)) informe.avisos.push(`Unidad: ${key} reutilizado tiene «${g.unit}» y Osmofilter da «${[...u.unidadOsmo].join(' / ')}»`);
    }
    for (const c of u.categorias) {
      const padre = padres.get(c);
      if (enlacesCat.has(`${key}|${c}`) || (padre && enlacesCat.has(`${key}|${padre}`))) continue;
      plan.enlacesCategoria.push({ attribute_key: key, category_key: c });
      enlacesCat.add(`${key}|${c}`);
    }
  }
  informe.atributos = {
    usados: atributosUsados.size,
    nuevos: plan.atributosNuevos.length,
    reutilizados: atributosUsados.size - plan.atributosNuevos.length,
    reutilizados_lista: [...atributosUsados.keys()].filter((k) => globales.has(k)).sort(),
    globales_a_rellenar: plan.globalesRellenar,
    enlaces_categoria_nuevos: plan.enlacesCategoria.length,
    nuevos_en_mapa_sin_usar: Object.keys(MAPA_ATR.nuevos).filter((k) => !atributosUsados.has(k)),
  };

  // ---------- paso productos
  for (const e of equipos) {
    const { p, cat, gv, refM, existente } = e;
    const descatalogado = RE_FIN_EXISTENCIAS.test(p.descripcion);
    const base = {
      modelo: gv.variante.nombre || gv.gama.modelo,
      familia_proveedor: p.familia,
      catalogos_proveedor: p.catalogos,
      origen_carga: ORIGEN_CARGA,
      short_description: e.descCorta,
      long_description: e.descLarga !== e.descCorta ? e.descLarga : null,
      ...e.columnas,
    };
    if (LISTA) {
      // La carga residencial ya puso short_description con la descripción del ERP: si la ficha trae
      // otra, va a long_description (vacía) para no repetir el mismo texto en las dos.
      base.modelo = gv.gama.modelo;
      base.catalogos_proveedor = [CARPETA];
      const corta = existente?.short_description;
      if (!vacio(corta)) base.long_description = [e.descCorta, e.descLarga].find((d) => !vacio(d) && d !== corta) || null;
    }
    if (!existente) {
      const fila = { manufacturer_id: osmo.id, supplier_reference: refM, name: e.nombre, kind: cat.kind, category_global_key: cat.categoria, is_active: true, descatalogado, ...base };
      for (const k of Object.keys(fila)) if (fila[k] === null || fila[k] === undefined) delete fila[k];
      plan.productosNuevos.push({ ref: p.ref, esCabeza: gv.gama.cabeza === p.ref, fila });
      informe.productos.crear.push({ ref: refM, nombre: e.nombre, categoria: cat.categoria, kind: cat.kind, descatalogado });
    } else {
      const rellenar = {};
      for (const [k, v] of Object.entries(base)) {
        if (v === null || v === undefined) continue;
        if (!estado.columnas.catalog_products.has(k) && COLUMNAS_MIGRACION.catalog_products.includes(k)) { rellenar[k] = v; continue; }
        if (vacio(existente[k]) || (Array.isArray(existente[k]) && !existente[k].length)) rellenar[k] = v;
      }
      if (existente.category_global_key !== cat.categoria || existente.kind !== cat.kind) informe.avisos.push(`${refM}: se queda en ${existente.category_global_key}/${existente.kind} (Osmofilter: ${cat.categoria}/${cat.kind}); no se toca`);
      if (descatalogado && existente.descatalogado === false) informe.avisos.push(`${refM}: Osmofilter lo da por descatalogado; en el maestro ya hay un valor y no se pisa`);
      for (const [k, v] of Object.entries(e.columnas)) if (!vacio(existente[k]) && existente[k] !== v) informe.avisos.push(`${refM}: ${k} se queda en ${existente[k]} (Osmofilter: ${v})`);
      if (Object.keys(rellenar).length) {
        plan.productosCompletar.push({ ref: p.ref, id: existente.id, rellenar });
        informe.productos.completar.push({ ref: refM, desde: p.ref, campos: Object.keys(rellenar) });
      } else informe.productos.sin_cambios.push(refM);
    }
  }

  // ---------- paso gamas (en modo lista no: las gamas las hizo cargar-nuevos-residencial.mjs)
  for (const g of LISTA ? [] : GAMAS.gamas) {
    const miembros = g.variantes.filter((v) => incluido(v.ref));
    const fila = { modelo: g.modelo, cabeza: refMaestro(g.cabeza), variantes: g.variantes.map((v) => `${refMaestro(v.ref)}${v.rasgos ? ' (' + v.rasgos + ')' : ''}`), revisar: g.revisar, nota: g.nota || null };
    informe.gamas.push(fila);
    if (g.variantes.length < 2 || !miembros.length) {
      for (const v of miembros) if (v.rasgos) plan.gamas.push({ ref: refMaestro(v.ref), gama: null, rasgos: v.rasgos });
      continue;
    }
    const cabezaM = refMaestro(g.cabeza);
    const cabezaBD = porRefBD.get(lower(cabezaM));
    if (!cabezaBD && !incluido(g.cabeza)) { informe.avisos.push(`Gama ${g.modelo}: la cabeza ${cabezaM} no existe ni se carga en esta pasada; sus variantes quedan sueltas`); }
    if (cabezaBD?.gama_id) { informe.conflictos.push(`Gama ${g.modelo}: la cabeza ${cabezaM} ya es variante de otra gama`); continue; }
    for (const v of miembros) {
      const refV = refMaestro(v.ref);
      const bd = porRefBD.get(lower(refV));
      const esCabeza = v.ref === g.cabeza;
      const op = { ref: refV, gama: esCabeza ? null : cabezaM, rasgos: v.rasgos };
      if (!esCabeza && bd?.gama_id && bd.gama_id !== cabezaBD?.id) { informe.conflictos.push(`${refV} ya es variante de otra gama: no se cambia`); op.gama = null; }
      if (!esCabeza && bd && tieneGamaHijas.has(bd.id)) { informe.conflictos.push(`${refV} tiene variantes propias: no puede ser variante de ${cabezaM}`); op.gama = null; }
      if (!esCabeza && !cabezaBD && !incluido(g.cabeza)) op.gama = null;
      plan.gamas.push(op);
    }
  }

  // ---------- paso valores
  for (const e of equipos) {
    const id = idDe(e.refM);
    for (const v of e.valores) {
      const bd = valoresBD.get(`${id}|${v.key}`);
      if (bd) {
        const igual = (v.value_number ?? null) === (bd.value_number === null ? null : Number(bd.value_number)) && (v.value_text ?? null) === bd.value_text && (v.value_boolean ?? null) === bd.value_boolean;
        if (!igual) informe.valores_existentes_conservados.push({ ref: e.refM, clave: v.key, maestro: bd.value_text ?? bd.value_number ?? bd.value_boolean, osmofilter: v.value_text ?? v.value_number ?? v.value_boolean });
        continue;
      }
      const { key, ...resto } = v;
      plan.valores.push({ ref: e.refM, fila: { attribute_global_key: key, ...resto } });
    }
  }

  // ---------- paso fotos
  const fotosPorTipo = {};
  let bytesFotos = 0;
  for (const e of equipos) {
    const id = idDe(e.refM);
    const imagenes = e.p.archivos.filter((a) => a.startsWith('imagenes/') && !a.includes('/iconos/'));
    const clasificadas = imagenes.map((rel) => ({ rel, c: clasificarFoto(rel) })).filter((x) => {
      if (!x.c) informe.avisos.push(`${e.p.ref}: imagen sin clasificar ${x.rel}`);
      return x.c;
    });
    const hay = (t) => clasificadas.some((x) => x.c.tipo === t);
    const yaTienePrincipal = conPrincipal.has(id);
    let principal = hay('principal') ? 'principal' : hay('ficha') ? 'ficha' : hay('miniatura') ? 'miniatura' : null;
    if (!principal) informe.sin_foto.push(e.p.ref);
    else if (principal !== 'principal' && !yaTienePrincipal) informe.avisos.push(`${e.p.ref}: sin principal.webp, la principal será «${principal}»`);
    for (const { rel, c } of clasificadas) {
      if (c.tipo === 'miniatura' && (principal !== 'miniatura' || yaTienePrincipal)) continue; // solo si no hay nada mejor y hace falta de principal
      const tipo = c.tipo === 'miniatura' ? 'principal' : c.tipo;
      const nombreF = `${tipo}-${c.n}.webp`;
      const storage_path = `products/${id}/osmo/${nombreF}`;
      if (fotosBD.has(storage_path)) continue;
      const local = path.join(e.dir, rel);
      const st = fs.statSync(local);
      let meta = {};
      try { meta = await sharp(local).metadata(); } catch (err) { informe.avisos.push(`${e.p.ref}: no se puede leer ${rel}: ${err.message}`); continue; }
      bytesFotos += st.size;
      fotosPorTipo[tipo] = (fotosPorTipo[tipo] || 0) + 1;
      const esMain = !yaTienePrincipal && c.tipo === principal;
      plan.fotos.push({
        ref: e.refM, local, esMain, ancho: meta.width, alto: meta.height, bytes: st.size,
        fila: {
          storage_path, thumb_path: `products/${id}/osmo/m/${nombreF}`,
          alt_text: [e.nombre, e.gv.variante.rasgos, c.etiqueta || null].filter(Boolean).join(' · '),
          is_main: esMain, display_order: c.orden, tipo_foto: tipo,
          etiqueta: c.tipo === 'miniatura' ? 'Miniatura' : (c.etiqueta || null),
        },
      });
    }
  }
  informe.fotos = { a_subir: plan.fotos.length, por_tipo: fotosPorTipo, mb_originales: +(bytesFotos / 1e6).toFixed(1), mayores_de_1200px: plan.fotos.filter((f) => f.ancho > 1200 || f.alto > 1200).length };

  // ---------- paso ventajas
  let sinIcono = 0;
  const iconosReutilizados = new Set();
  for (const e of equipos) {
    const id = idDe(e.refM);
    const hl = e.ficha.highlights || [];
    if (!hl.length) continue;
    if (conVentajas.has(id)) { informe.avisos.push(`${e.refM}: ya tiene ventajas; no se añaden`); continue; }
    const iconosLocales = e.p.archivos.filter((a) => a.startsWith('imagenes/iconos/'));
    hl.forEach((h, k) => {
      let icon_path = null;
      if (h.pico_url) {
        const base = path.basename(new URL(h.pico_url).pathname).replace(/\.webp$/i, '').replace(/_hl_orig_[0-9a-f]+$/i, '');
        const s = slug(base);
        const local = iconosLocales.find((a) => path.basename(a).startsWith(String(k + 1).padStart(2, '0') + ' '));
        icon_path = `iconos/osmofilter/${s}.webp`;
        if (local && LISTA && estado.enStorage.has(icon_path)) iconosReutilizados.add(icon_path);
        else if (local && !plan.iconos.has(icon_path)) plan.iconos.set(icon_path, path.join(e.dir, local));
        if (!local) { icon_path = null; sinIcono++; }
      } else sinIcono++;
      plan.ventajas.push({ ref: e.refM, fila: { titulo: h.texto_breve, descripcion: h.texto_largo || null, icon_path, display_order: k } });
    });
  }
  informe.ventajas = { filas: plan.ventajas.length, productos: new Set(plan.ventajas.map((v) => v.ref)).size, iconos_distintos: plan.iconos.size, iconos_reutilizados: iconosReutilizados.size, sin_icono: sinIcono, fichas_sin_ventajas: equipos.filter((e) => !(e.ficha.highlights || []).length).map((e) => e.p.ref) };

  // ---------- recambios (JSON + Excel)
  const excel = LISTA ? {} : leerExcel(); // modo lista: sin recambios ni enlaces
  const recambios = new Map(); // ref -> { ref, tipo, nombre, familia }
  const enlacesFuente = new Map(); // `${recambio}|${equipo}` -> origen
  for (const [equipo, lista] of Object.entries(RECAMBIOS_JSON)) {
    lista.forEach((r) => {
      if (!recambios.has(r.ref)) recambios.set(r.ref, { ref: r.ref, tipo: r.tipo, nombre: r.nombre, familia: r.familia });
      enlacesFuente.set(`${r.ref}|${equipo}`, 'json');
    });
  }
  const cruce = { fichero: excel.fichero || null, error: excel.error || null, solo_en_excel: [], solo_en_json: 0, recambios_solo_en_excel: [] };
  if (excel.filas) {
    const enExcel = new Set();
    for (const f of excel.filas) {
      if (!f.ref || !['Repuesto', 'Consumible'].includes(f.tipo) || !f.usado_en) continue;
      for (const eq of String(f.usado_en).split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        const k = `${f.ref}|${eq}`;
        enExcel.add(k);
        if (!enlacesFuente.has(k)) { enlacesFuente.set(k, 'excel'); cruce.solo_en_excel.push(k); }
        if (!recambios.has(f.ref)) { recambios.set(f.ref, { ref: f.ref, tipo: f.tipo, nombre: f.descripcion, familia: f.familia }); cruce.recambios_solo_en_excel.push(f.ref); }
      }
    }
    cruce.solo_en_json = [...enlacesFuente.entries()].filter(([k, o]) => o === 'json' && !enExcel.has(k)).length;
  }
  informe.recambios.cruce_excel = cruce;

  const refsEquipo174 = new Set(PRODUCTOS.map((p) => lower(p.ref)));
  let recConsumible = 0, recRepuesto = 0;
  for (const r of recambios.values()) {
    if (!incluido(r.ref)) continue;
    const tipo = MAPA_FAM.recambios[r.tipo];
    if (!tipo) { informe.avisos.push(`Recambio ${r.ref}: tipo desconocido «${r.tipo}»`); continue; }
    if (refsEquipo174.has(lower(r.ref))) { informe.conflictos.push(`Recambio ${r.ref}: su ref es la de un equipo; no se crea`); continue; }
    const bd = porRefBD.get(lower(r.ref));
    const descatalogado = RE_FIN_EXISTENCIAS.test(r.nombre || '');
    if (!bd) {
      plan.recambiosNuevos.push({ ref: r.ref, fila: { manufacturer_id: osmo.id, supplier_reference: r.ref, name: limpiarTexto(r.nombre) || r.ref, kind: tipo.kind, category_global_key: tipo.categoria, is_active: true, descatalogado, familia_proveedor: r.familia, origen_carga: ORIGEN_CARGA } });
      if (tipo.kind === 'consumable') recConsumible++; else recRepuesto++;
    } else {
      const rellenar = {};
      if (vacio(bd.familia_proveedor) && r.familia) rellenar.familia_proveedor = r.familia;
      if (vacio(bd.origen_carga)) rellenar.origen_carga = ORIGEN_CARGA;
      if (Object.keys(rellenar).length) plan.recambiosCompletar.push({ ref: r.ref, id: bd.id, rellenar });
    }
  }
  informe.recambios = { ...informe.recambios, distintos: recambios.size, crear: plan.recambiosNuevos.length, consumibles: recConsumible, repuestos: recRepuesto, completar: plan.recambiosCompletar.length, familias: [...new Set([...recambios.values()].map((r) => r.familia))].length };

  // ---------- paso enlaces
  const recambiosEnMaestro = new Set([...estado.catalog_products.map((p) => lower(p.supplier_reference)), ...plan.recambiosNuevos.map((r) => lower(r.ref))]);
  const perdidos = new Map();
  let enlacesTotal = 0, yaExisten = 0, fueraDeSolo = 0;
  const orden = new Map();
  for (const k of enlacesFuente.keys()) {
    enlacesTotal++;
    const [rec, eqOrig] = k.split('|');
    const eq = refMaestro(eqOrig);
    if (SOLO && !(incluido(rec) || incluido(eqOrig))) { fueraDeSolo++; continue; }
    if (!equiposEnMaestro.has(lower(eq))) { perdidos.set(eqOrig, (perdidos.get(eqOrig) || 0) + 1); continue; }
    if (!recambiosEnMaestro.has(lower(rec))) { fueraDeSolo++; continue; }
    const idR = idDe(rec), idE = idDe(eq);
    if (compatBD.has(`${idR}|${idE}`)) { yaExisten++; continue; }
    const n = orden.get(eq) || 0; orden.set(eq, n + 1);
    plan.enlaces.push({ recambio: rec, equipo: eq, fila: { cantidad: null, display_order: n } });
  }
  const perdidosTotal = [...perdidos.values()].reduce((a, b) => a + b, 0);
  informe.enlaces = { en_origen: enlacesTotal, crear: plan.enlaces.length, ya_existen: yaExisten, perdidos: perdidosTotal, fuera_de_solo: fueraDeSolo, perdidos_por_equipo: Object.fromEntries([...perdidos].sort((a, b) => b[1] - a[1])), equipos_descargados_sin_recambios: LISTA ? [] : PRODUCTOS.filter((p) => !RECAMBIOS_JSON[p.ref]).map((p) => p.ref) };

  // ---------- paso documentos
  const docsPorApartado = {};
  let bytesDocsFilas = 0;
  const grandes = [];
  for (const e of equipos) {
    const id = idDe(e.refM);
    const enFicha = new Map((e.ficha.documentos || []).map((d) => [d.nombre, d.categoria]));
    const pdfs = e.p.archivos.filter((a) => a.startsWith('documentos/'));
    let k = 0;
    for (const rel of pdfs) {
      const nombre = path.basename(rel);
      const local = path.join(e.dir, rel);
      if (!fs.existsSync(local)) { informe.avisos.push(`${e.p.ref}: falta el fichero ${rel}`); continue; }
      const { kind, apartado } = clasificarDocumento(nombre, enFicha.get(nombre));
      if (apartado === 'ficha_tecnica' && conFichaTecnica.has(id)) { informe.avisos.push(`${e.refM}: ya tiene ficha técnica subida a mano; no se añade «${nombre}»`); continue; }
      const st = fs.statSync(local);
      const h = sha1(local);
      const clave = h ? h.slice(0, 16) : slug(e.p.ref);
      const storage_path = `documentos/osmofilter/${clave}/${slug(nombre.replace(/\.pdf$/i, ''))}.pdf`;
      if (docsBD.has(`${id}|${storage_path}`)) continue;
      if (!plan.subidasDocs.has(storage_path)) {
        plan.subidasDocs.set(storage_path, { local, bytes: st.size });
        if (st.size > LIMITE_SUBIDA_BYTES) grandes.push(`${nombre} (${(st.size / 1e6).toFixed(1)} MB)`);
      }
      bytesDocsFilas += st.size;
      docsPorApartado[apartado] = (docsPorApartado[apartado] || 0) + 1;
      plan.documentos.push({ ref: e.refM, fila: { kind, title: nombre.replace(/\.pdf$/i, ''), storage_path, file_size_bytes: st.size, mime_type: 'application/pdf', display_order: k++, idioma: idiomaDe(nombre), apartado } });
    }
  }
  const bytesSubir = [...plan.subidasDocs.values()].reduce((a, b) => a + b.bytes, 0);
  const docsYaEnStorage = LISTA ? [...plan.subidasDocs.keys()].filter((k) => estado.enStorage.has(k)).length : null;
  informe.documentos = { filas: plan.documentos.length, ficheros_distintos: plan.subidasDocs.size, por_apartado: docsPorApartado, mb_sin_deduplicar: +(bytesDocsFilas / 1e6).toFixed(1), mb_a_subir: +(bytesSubir / 1e6).toFixed(1), deduplicado_por_sha1: !SIN_HASH, mayores_que_limite: grandes, ...(LISTA ? { ficheros_ya_en_storage: docsYaEnStorage } : {}) };

  // ---------- comprobación previa de todos los payloads
  for (const x of plan.atributosNuevos) comprobarPayload('product_attributes_global', x);
  for (const x of plan.globalesRellenar) comprobarPayload('product_attributes_global', x);
  for (const x of plan.enlacesCategoria) comprobarPayload('product_attributes_global_categories', x);
  for (const x of plan.productosNuevos) comprobarPayload('catalog_products', x.fila);
  for (const x of plan.productosCompletar) comprobarPayload('catalog_products', x.rellenar, { actualizaExistente: true });
  for (const x of plan.gamas) comprobarPayload('catalog_products', { gama_id: x.gama, rasgos_identificacion: x.rasgos }, { actualizaExistente: true });
  for (const x of plan.valores) comprobarPayload('catalog_product_attributes', x.fila);
  for (const x of plan.fotos) comprobarPayload('catalog_product_photos', x.fila);
  for (const x of plan.ventajas) comprobarPayload('catalog_product_highlights', x.fila);
  for (const x of plan.recambiosNuevos) comprobarPayload('catalog_products', x.fila);
  for (const x of plan.recambiosCompletar) comprobarPayload('catalog_products', x.rellenar, { actualizaExistente: true });
  for (const x of plan.enlaces) comprobarPayload('catalog_product_compatibilities', x.fila);
  for (const x of plan.documentos) comprobarPayload('catalog_product_documents', x.fila);
  informe.comprobacion_previa = { payloads: comprobaciones.payloads, fallos: comprobaciones.fallos.length, regla: 'ningún payload lleva version ni company_id; ninguna fila existente recibe name, kind, categoría, fabricante, is_active ni version; solo tablas del maestro' };

  informe.recuentos = {
    equipos_en_descarga: PRODUCTOS.length,
    equipos_procesados: equipos.length,
    equipos_crear: plan.productosNuevos.length,
    equipos_completar: plan.productosCompletar.length,
    equipos_sin_cambios: informe.productos.sin_cambios.length,
    equipos_saltados: informe.productos.saltar.length,
    alias_aplicados: equipos.filter((e) => e.refM !== e.p.ref).map((e) => `${e.p.ref} -> ${e.refM}`),
    atributos_globales_nuevos: plan.atributosNuevos.length,
    atributos_globales_reutilizados: informe.atributos.reutilizados,
    enlaces_atributo_categoria: plan.enlacesCategoria.length,
    valores_atributo: plan.valores.length,
    gamas_con_variantes: LISTA ? 0 : GAMAS.gamas.filter((g) => g.variantes.length > 1).length,
    variantes_a_enlazar: plan.gamas.filter((g) => g.gama).length,
    fotos: plan.fotos.length,
    ventajas: plan.ventajas.length,
    iconos: plan.iconos.size,
    ...(LISTA ? { iconos_reutilizados: informe.ventajas.iconos_reutilizados, refs_en_lista: PRODUCTOS.length, excluidas: informe.productos.excluidas.length, sin_fila_en_maestro: informe.productos.sin_fila_maestro.length, sin_datos_que_cargar: informe.productos.sin_datos.length, sin_descargar_aun: informe.productos.sin_descargar.length } : {}),
    recambios_crear: plan.recambiosNuevos.length,
    enlaces_recambio_crear: plan.enlaces.length,
    enlaces_recambio_perdidos: perdidosTotal,
    documentos_filas: plan.documentos.length,
    documentos_ficheros: plan.subidasDocs.size,
    filas_catalog_products_tras_la_carga: estado.catalog_products.length + plan.productosNuevos.length + plan.recambiosNuevos.length,
  };
  return { plan, informe, porRefBD };
}

// ---------------------------------------------------------------- escritura (solo --aplicar)
async function aplicar(plan, estadoInicial) {
  const sb = await clienteServicio();
  const sharp = (await import('sharp')).default;
  const res = {};
  const faltan = Object.entries(COLUMNAS_MIGRACION).flatMap(([t, cols]) => cols.filter((c) => !estadoInicial.columnas[t]?.has(c)).map((c) => `${t}.${c}`));
  if (faltan.length) salir('Falta aplicar la migración 20261126100000_catalogo_maestro_fase2.sql: ' + faltan.join(', '));
  const activo = (p) => PASOS_ACTIVOS.includes(p);
  const idsPorRef = async () => {
    const m = new Map();
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from('catalog_products').select('id, supplier_reference, gama_id, rasgos_identificacion').range(desde, desde + 999);
      if (error) salir('Leyendo catalog_products: ' + error.message);
      for (const p of data) m.set(lower(p.supplier_reference), p);
      if (data.length < 1000) break;
    }
    return m;
  };
  const ok = (error, que) => { if (error) salir(`${que}: ${error.message}`); };
  const rellenarSiVacio = async (id, campos) => {
    let n = 0;
    for (const [k, v] of Object.entries(campos)) {
      let q = sb.from('catalog_products').update({ [k]: v }).eq('id', id);
      q = typeof v === 'string' && ['short_description', 'long_description', 'modelo', 'familia_proveedor', 'origen_carga', 'rasgos_identificacion'].includes(k) ? q.or(`${k}.is.null,${k}.eq.`) : q.is(k, null);
      const { data, error } = await q.select('id');
      ok(error, `Rellenar ${k}`);
      n += data.length;
    }
    return n;
  };
  const subir = (destino, cuerpo, tipo, upsert = true) => conReintento(async () => {
    const { error } = await sb.storage.from(BUCKET).upload(destino, cuerpo, { contentType: tipo, cacheControl: '31536000', upsert });
    if (error && !(upsert === false && /exists|duplicate/i.test(error.message))) throw new Error(`${destino}: ${error.message}`);
  });

  if (activo('atributos')) {
    if (plan.atributosNuevos.length) { const { error } = await sb.from('product_attributes_global').upsert(plan.atributosNuevos, { onConflict: 'key', ignoreDuplicates: true }); ok(error, 'Atributos nuevos'); }
    let n = 0;
    for (const { key, ...campos } of plan.globalesRellenar) for (const [k, v] of Object.entries(campos)) {
      const { data, error } = await sb.from('product_attributes_global').update({ [k]: v }).eq('key', key).is(k, null).select('key'); ok(error, `Rellenar ${key}.${k}`); n += data.length;
    }
    if (plan.enlacesCategoria.length) { const { error } = await sb.from('product_attributes_global_categories').upsert(plan.enlacesCategoria, { onConflict: 'attribute_key,category_key', ignoreDuplicates: true }); ok(error, 'Enlaces atributo-categoría'); }
    res.atributos = { nuevos: plan.atributosNuevos.length, campos_rellenados: n, enlaces: plan.enlacesCategoria.length };
  }

  if (activo('productos')) {
    let creados = 0, saltados = 0, rellenados = 0;
    const ordenados = [...plan.productosNuevos].sort((a, b) => Number(b.esCabeza) - Number(a.esCabeza));
    for (const x of ordenados) {
      const { error } = await sb.from('catalog_products').insert(x.fila);
      if (error && /duplicate|unique/i.test(error.message)) { saltados++; continue; }
      ok(error, `Crear ${x.fila.supplier_reference}`); creados++;
    }
    for (const x of plan.productosCompletar) rellenados += await rellenarSiVacio(x.id, x.rellenar);
    res.productos = { creados, ya_existian: saltados, campos_rellenados: rellenados };
  }

  let ids = await idsPorRef();
  const idDe = (ref) => ids.get(lower(ref))?.id;

  if (activo('gamas')) {
    let enlazadas = 0, rasgos = 0;
    for (const g of plan.gamas) {
      const id = idDe(g.ref); if (!id) continue;
      if (g.rasgos) rasgos += await rellenarSiVacio(id, { rasgos_identificacion: g.rasgos });
      if (g.gama) {
        const cab = idDe(g.gama); if (!cab) continue;
        const { data, error } = await sb.from('catalog_products').update({ gama_id: cab }).eq('id', id).is('gama_id', null).select('id');
        ok(error, `Gama de ${g.ref}`); enlazadas += data.length;
      }
    }
    res.gamas = { variantes_enlazadas: enlazadas, rasgos_rellenados: rasgos };
  }

  if (activo('valores')) {
    const filas = plan.valores.map((v) => ({ catalog_product_id: idDe(v.ref), ...v.fila })).filter((f) => f.catalog_product_id);
    for (let i = 0; i < filas.length; i += 500) { const { error } = await sb.from('catalog_product_attributes').upsert(filas.slice(i, i + 500), { onConflict: 'catalog_product_id,attribute_global_key', ignoreDuplicates: true }); ok(error, 'Valores'); }
    res.valores = filas.length;
  }

  if (activo('fotos')) {
    let subidas = 0, principales = 0;
    await enParalelo(plan.fotos, 4, async (f) => {
      const id = idDe(f.ref); if (!id) return;
      const fila = { ...f.fila, storage_path: f.fila.storage_path.replace(/products\/nuevo:[^/]+\//, `products/${id}/`), thumb_path: f.fila.thumb_path.replace(/products\/nuevo:[^/]+\//, `products/${id}/`) };
      let original = fs.readFileSync(f.local);
      let meta = await sharp(original).metadata();
      if (meta.width > 1200 || meta.height > 1200) { original = await sharp(original).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); meta = await sharp(original).metadata(); }
      const mini = await sharp(original).resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      await subir(fila.storage_path, original, 'image/webp');
      await subir(fila.thumb_path, mini, 'image/webp');
      const { error } = await sb.from('catalog_product_photos').upsert({ catalog_product_id: id, ...fila, width_px: meta.width, height_px: meta.height }, { onConflict: 'storage_path', ignoreDuplicates: true });
      ok(error, `Foto ${fila.storage_path}`);
      subidas++;
      if (fila.is_main) { const { data, error: e2 } = await sb.from('catalog_products').update({ main_image_path: fila.storage_path }).eq('id', id).is('main_image_path', null).select('id'); ok(e2, 'main_image_path'); principales += data.length; }
    });
    res.fotos = { subidas, main_image_path_rellenados: principales };
  }

  if (activo('ventajas')) {
    await enParalelo([...plan.iconos], 4, async ([destino, local]) => subir(destino, fs.readFileSync(local), 'image/webp', !LISTA)); // modo lista: no pisa iconos ya subidos
    const porProducto = new Map();
    for (const v of plan.ventajas) { const id = idDe(v.ref); if (id) (porProducto.get(id) || porProducto.set(id, []).get(id)).push({ catalog_product_id: id, ...v.fila }); }
    let insertadas = 0;
    for (const [id, filas] of porProducto) {
      const { count, error } = await sb.from('catalog_product_highlights').select('id', { count: 'exact', head: true }).eq('catalog_product_id', id); ok(error, 'Contar ventajas');
      if (count > 0) continue;
      const { error: e2 } = await sb.from('catalog_product_highlights').insert(filas); ok(e2, 'Ventajas'); insertadas += filas.length;
    }
    res.ventajas = { iconos: plan.iconos.size, filas: insertadas };
  }

  if (activo('recambios')) {
    let creados = 0, saltados = 0, rellenados = 0;
    for (let i = 0; i < plan.recambiosNuevos.length; i += 200) {
      const lote = plan.recambiosNuevos.slice(i, i + 200).map((x) => x.fila).filter((f) => !ids.has(lower(f.supplier_reference)));
      if (!lote.length) continue;
      const { error } = await sb.from('catalog_products').insert(lote);
      if (error) { // si choca alguno, de uno en uno
        for (const f of lote) { const { error: e } = await sb.from('catalog_products').insert(f); if (e && /duplicate|unique/i.test(e.message)) saltados++; else { ok(e, `Recambio ${f.supplier_reference}`); creados++; } }
      } else creados += lote.length;
    }
    for (const x of plan.recambiosCompletar) rellenados += await rellenarSiVacio(x.id, x.rellenar);
    res.recambios = { creados, ya_existian: saltados, campos_rellenados: rellenados };
    ids = await idsPorRef();
  }

  if (activo('enlaces')) {
    const filas = plan.enlaces.map((x) => ({ spare_part_catalog_id: idDe(x.recambio), equipment_catalog_id: idDe(x.equipo), ...x.fila })).filter((f) => f.spare_part_catalog_id && f.equipment_catalog_id);
    for (let i = 0; i < filas.length; i += 500) { const { error } = await sb.from('catalog_product_compatibilities').upsert(filas.slice(i, i + 500), { onConflict: 'spare_part_catalog_id,equipment_catalog_id', ignoreDuplicates: true }); ok(error, 'Enlaces'); }
    res.enlaces = filas.length;
  }

  if (activo('documentos')) {
    let subidos = 0;
    await enParalelo([...plan.subidasDocs], 2, async ([destino, { local, bytes }]) => {
      if (bytes > LIMITE_SUBIDA_BYTES) return;
      await subir(destino, fs.readFileSync(local), 'application/pdf', false); // no se re-sube si ya está
      subidos++;
    });
    const filas = plan.documentos.map((d) => ({ catalog_product_id: idDe(d.ref), ...d.fila, storage_path: d.fila.storage_path })).filter((f) => f.catalog_product_id && plan.subidasDocs.get(f.storage_path)?.bytes <= LIMITE_SUBIDA_BYTES);
    for (let i = 0; i < filas.length; i += 300) { const { error } = await sb.from('catalog_product_documents').upsert(filas.slice(i, i + 300), { onConflict: 'catalog_product_id,storage_path', ignoreDuplicates: true }); ok(error, 'Documentos'); }
    res.documentos = { ficheros: subidos, filas: filas.length };
  }
  return res;
}

// ---------------------------------------------------------------- informe en Markdown
function informeMd(inf) {
  const L = [];
  const p = (s = '') => L.push(s);
  const lista = (arr, max = 400) => { if (!arr.length) p('- (ninguno)'); arr.slice(0, max).forEach((x) => p(`- ${x}`)); if (arr.length > max) p(`- … y ${arr.length - max} más`); };
  p(`# Informe de la carga de Osmofilter — ${inf.modo === 'seco' ? 'prueba en seco' : 'aplicada'}`);
  p();
  if (inf.lista) { p(`Modo lista: \`${inf.lista.lista}\` con las fichas de \`${inf.lista.carpeta}/\`. Solo se completan filas que ya existen en el maestro; no se crea ninguna, ni se tocan gamas, recambios ni enlaces.`); p(); }
  p(`Fecha: ${inf.fecha} · Estado leído de: ${inf.estado} · Solo: ${inf.solo ? inf.solo.join(', ') : 'todo'} · Pasos: ${inf.pasos.join(', ')}`);
  p();
  p('Generado por `scripts/catalogo-osmofilter/cargar.mjs`. En seco no se ha escrito nada en la base de datos ni en Storage.');
  p();
  if (inf.migracion_pendiente.length) { p('> **Migración pendiente.** Faltan columnas de `20261126100000_catalogo_maestro_fase2.sql`. La prueba en seco funciona igual; `--aplicar` se niega a escribir hasta que se aplique.'); inf.migracion_pendiente.forEach((m) => p(`> - ${m}`)); p(); }
  p('## 1. Recuentos'); p();
  p('| Qué | N |'); p('|---|---|');
  for (const [k, v] of Object.entries(inf.recuentos)) p(`| ${k.replace(/_/g, ' ')} | ${Array.isArray(v) ? v.join(', ') || '—' : v} |`);
  p();
  p(`Comprobación previa: ${inf.comprobacion_previa.payloads} payloads revisados, ${inf.comprobacion_previa.fallos} fallos (${inf.comprobacion_previa.regla}).`);
  p();
  p('## 2. Atributos de Osmofilter sin emparejar'); p();
  const se = Object.entries(inf.sin_emparejar);
  if (!se.length && inf.lista) p('Ninguno: todos los atributos de las fichas tienen entrada en `mapa-atributos.json` o van a columna (Ancho, Alto, Fondo y Peso).');
  else if (!se.length) p('Ninguno: los 100 atributos de la descarga tienen entrada en `mapa-atributos.json` (96) o van a columna (Ancho, Alto, Fondo y Peso).');
  else se.forEach(([k, v]) => p(`- ${k} (${v.veces}): ${[...v.ejemplos].slice(0, 3).join(' · ')}`));
  p();
  p(`Atributos globales: ${inf.atributos.nuevos} nuevos, ${inf.atributos.reutilizados} reutilizados, ${inf.atributos.enlaces_categoria_nuevos} enlaces nuevos atributo–categoría.`);
  p();
  p(`Reutilizados: ${inf.atributos.reutilizados_lista.join(', ')}.`);
  p();
  if (inf.atributos.globales_a_rellenar.length) { p('Globales existentes a los que se rellena un campo vacío (solo si está en null):'); inf.atributos.globales_a_rellenar.forEach((g) => p(`- ${g.key}: ${Object.entries(g).filter(([k]) => k !== 'key').map(([k, v]) => `${k} = ${v}`).join(', ')}`)); p(); }
  if (inf.atributos.nuevos_en_mapa_sin_usar.length) { p(`Claves nuevas del mapa que no usa ningún producto de esta pasada: ${inf.atributos.nuevos_en_mapa_sin_usar.join(', ')}.`); p(); }
  p('## 3. Valores que no se han podido convertir'); p();
  if (!inf.no_convertidos.length) p('Ninguno.');
  else { p('| Ref | Atributo | Valor | Motivo |'); p('|---|---|---|---|'); inf.no_convertidos.forEach((x) => p(`| ${x.ref} | ${x.atributo} | ${String(x.valor).replace(/\|/g, '/')} | ${x.motivo} |`)); }
  p();
  p('Valores que no crean fila a propósito (significan «no tiene»):'); p();
  Object.entries(inf.sin_fila).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => p(`- ${k}: ${v}`));
  p();
  if (inf.valores_existentes_conservados.length) { p('Valores que ya estaban en el maestro y **no se pisan** aunque Osmofilter diga otra cosa:'); p(); inf.valores_existentes_conservados.forEach((v) => p(`- ${v.ref} · ${v.clave}: se queda ${v.maestro} (Osmofilter: ${v.osmofilter})`)); p(); }
  p('## 4. Productos sin foto o sin características'); p();
  p(`Sin ninguna foto utilizable (ni principal, ni ficha, ni miniatura): ${inf.sin_foto.length}`); lista(inf.sin_foto); p();
  p(`Sin características (ni atributos ni medidas): ${inf.sin_caracteristicas.length}`); lista(inf.sin_caracteristicas); p();
  p(`Fotos a subir: ${inf.fotos.a_subir} (${inf.fotos.mb_originales} MB de originales, más miniaturas de 400 px). Por tipo: ${Object.entries(inf.fotos.por_tipo).map(([k, v]) => `${k} ${v}`).join(' · ')}. Mayores de 1.200 px que se reducen: ${inf.fotos.mayores_de_1200px}.`);
  p();
  p(`Ventajas: ${inf.ventajas.filas} en ${inf.ventajas.productos} productos, ${inf.ventajas.iconos_distintos} iconos nuevos a subir${inf.lista ? `, ${inf.ventajas.iconos_reutilizados} iconos reutilizados (ya en Storage)` : ''}, ${inf.ventajas.sin_icono} sin icono. Fichas sin ventajas: ${inf.ventajas.fichas_sin_ventajas.length}.`);
  p();
  if (inf.lista) { p('## 5. Recambios y enlaces'); p(); p('No aplica en modo lista (los hizo `cargar-nuevos-residencial.mjs`).'); p(); }
  else {
  p('## 5. Recambios y enlaces'); p();
  p(`Recambios distintos en el origen: ${inf.recambios.distintos} (${inf.recambios.familias} familias). A crear: ${inf.recambios.crear} (${inf.recambios.consumibles} consumibles, ${inf.recambios.repuestos} repuestos). A completar: ${inf.recambios.completar}.`);
  const c = inf.recambios.cruce_excel;
  p();
  p(`Cruce con el Excel (${c.fichero || 'no leído'}${c.error ? ': ' + c.error : ''}): enlaces solo en el Excel ${c.solo_en_excel.length}, solo en el JSON ${c.solo_en_json}, recambios solo en el Excel ${c.recambios_solo_en_excel.length}.`);
  p();
  p(`Enlaces equipo→recambio en el origen: ${inf.enlaces.en_origen}. A crear: ${inf.enlaces.crear}. Ya existen: ${inf.enlaces.ya_existen}. Fuera de --solo: ${inf.enlaces.fuera_de_solo}. **Se pierden: ${inf.enlaces.perdidos}** (equipo que no está en el maestro ni en la descarga):`);
  p();
  Object.entries(inf.enlaces.perdidos_por_equipo).forEach(([k, v]) => p(`- ${k}: ${v}`));
  p();
  p(`Equipos descargados sin ningún recambio en el origen (${inf.enlaces.equipos_descargados_sin_recambios.length}): ${inf.enlaces.equipos_descargados_sin_recambios.join(', ')}.`);
  p();
  }
  p('## 6. Documentos'); p();
  p(`Filas: ${inf.documentos.filas}. Ficheros distintos a subir: ${inf.documentos.ficheros_distintos} (${inf.documentos.mb_a_subir} MB; sin deduplicar serían ${inf.documentos.mb_sin_deduplicar} MB; deduplicado por sha1: ${inf.documentos.deduplicado_por_sha1 ? 'sí' : 'no'}).`);
  if (inf.lista) p(`De esos ficheros, ya estaban en Storage (se reutilizan, no se vuelven a subir): ${inf.documentos.ficheros_ya_en_storage}.`);
  p(`Por apartado: ${Object.entries(inf.documentos.por_apartado).map(([k, v]) => `${k} ${v}`).join(' · ')}.`);
  if (inf.documentos.mayores_que_limite.length) { p(); p('Mayores que el límite de subida de 50 MB (no se suben):'); lista(inf.documentos.mayores_que_limite); }
  p();
  if (!inf.lista) {
  p('## 7. Gamas'); p();
  const conV = inf.gamas.filter((g) => g.variantes.length > 1);
  p(`${conV.length} gamas con variantes y ${inf.gamas.length - conV.length} productos sueltos. **Revisar** = dudosa, la tiene que mirar Mario.`);
  p();
  p('| Modelo | Cabeza | Variantes (rasgos) | Revisar | Nota |'); p('|---|---|---|---|---|');
  conV.forEach((g) => p(`| ${g.modelo} | ${g.cabeza} | ${g.variantes.join('<br>')} | ${g.revisar ? '**Sí**' : ''} | ${g.nota || ''} |`));
  p();
  p(`Sueltos: ${inf.gamas.filter((g) => g.variantes.length === 1).map((g) => `${g.modelo} (${g.cabeza})`).join(' · ')}.`);
  p();
  }
  p('## 8. Productos'); p();
  if (inf.lista) {
    p(`Excluidas por \`nuevos-residencial-mapa.json\` (Distribución y Retail) (${inf.productos.excluidas.length}):`); lista(inf.productos.excluidas); p();
    p(`**Sin fila en el maestro** (no se crean; pregunta a Mario) (${inf.productos.sin_fila_maestro.length}):`); lista(inf.productos.sin_fila_maestro); p();
    p(`Con carpeta pero sin características, ventajas, fotos ni documentos: no se hace nada (${inf.productos.sin_datos.length}):`); lista(inf.productos.sin_datos); p();
    p(`En la lista pero sin carpeta descargada todavía (${inf.productos.sin_descargar.length}):`); lista(inf.productos.sin_descargar); p();
  }
  p(`Crear (${inf.productos.crear.length}):`); lista(inf.productos.crear.map((x) => `${x.ref} · ${x.nombre} · ${x.categoria}/${x.kind}${x.descatalogado ? ' · descatalogado' : ''}`)); p();
  p(`Completar (${inf.productos.completar.length}):`); lista(inf.productos.completar.map((x) => `${x.ref}${x.desde !== x.ref ? ` (descarga ${x.desde})` : ''}: ${x.campos.join(', ')}`)); p();
  if (inf.productos.saltar.length) { p('Saltados:'); lista(inf.productos.saltar.map((x) => `${x.ref}: ${x.motivo}`)); p(); }
  p('## 9. Conflictos y avisos'); p();
  p('Conflictos:'); lista(inf.conflictos); p();
  p('Avisos:'); lista(inf.avisos); p();
  if (inf.resultado) { p('## 10. Resultado de la escritura'); p(); p('```json'); p(JSON.stringify(inf.resultado, null, 2)); p('```'); }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- principal
async function main() {
  log(`Carga Osmofilter · modo ${APLICAR ? 'APLICAR (escribe)' : 'en seco (no escribe nada)'} · estado: ${APLICAR ? 'service-role' : ESTADO}`);
  const estado = await leerEstado();
  log(`Estado: ${estado.catalog_products.length} productos maestros, ${estado.product_attributes_global.length} atributos globales`);
  const { plan, informe } = await construirPlan(estado);
  if (APLICAR) informe.resultado = await aplicar(plan, estado);

  const dirInf = path.join(AQUI, 'informes');
  fs.mkdirSync(dirInf, { recursive: true });
  const sello = informe.fecha.replace(/[:.]/g, '-') + (LISTA ? '-' + slug(CARPETA) + '-fichas' : '');
  const json = JSON.stringify(informe, (k, v) => (v instanceof Set ? [...v] : v), 2);
  fs.writeFileSync(path.join(dirInf, `${sello}-${informe.modo}.json`), json);
  const md = informeMd(informe);
  fs.writeFileSync(path.join(dirInf, `${sello}-${informe.modo}.md`), md);
  if (!LISTA && !APLICAR && !SOLO && PASOS_ACTIVOS.length === PASOS.length) fs.writeFileSync(path.join(AQUI, 'informe-seco.md'), md);
  log(JSON.stringify(informe.recuentos, null, 2));
  log(`Informe: ${path.join(dirInf, `${sello}-${informe.modo}.md`)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
