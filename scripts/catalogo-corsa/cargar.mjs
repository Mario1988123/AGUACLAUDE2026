#!/usr/bin/env node
// =============================================================================
// Carga del catálogo de Corsa (PDF nacional V.01) en el catálogo MAESTRO (superadmin).
// Copia las reglas de scripts/catalogo-osmofilter/cargar.mjs.
//
// Uso:
//   node scripts/catalogo-corsa/cargar.mjs              # prueba en seco (por defecto)
//   node scripts/catalogo-corsa/cargar.mjs --aplicar    # escribe (service-role)
//     --paso=categorias,atributos,productos,gamas,valores,fotos,ventajas
//     --solo=A-253106,A-253107   limitar a unas refs
//     --origen=D:\CORSA\catalogo
//
// Reglas (no se negocian):
//   - Sin --aplicar no hay ni una escritura en base de datos ni en Storage (la prueba en seco
//     lee el estado con la Management API y solo lanza SELECT).
//   - Idempotente. Nunca borra. Nunca pisa un campo no nulo. Nunca envía «version».
//   - Solo escribe en tablas del maestro (catalog_*, product_attributes_global*) y en el
//     bucket catalog-global. Ninguna tabla con company_id.
//   - Las refs que ya existen solo se completan (nombre, tipo, categoría, fabricante, activo,
//     versión, fotos actuales y valores existentes no se tocan). Si la ref existe con OTRO
//     fabricante, no se toca y sale como conflicto.
//   - Los productos cuya categoría del mapa no existe en product_categories_global (categoría
//     propuesta) se saltan: primero Mario la aprueba y se crea.
//   - Lee D:\CORSA\catalogo solo en lectura.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const ORIGEN_CARGA = 'corsa-2026-11-26';
const FABRICANTE = 'corsa';
const BUCKET = 'catalog-global';
const PROYECTO = 'pkgvzwunazzkstlfubnq';
const PASOS = ['categorias', 'atributos', 'productos', 'gamas', 'valores', 'fotos', 'ventajas'];

// ---------------------------------------------------------------- argumentos
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APLICAR = args.aplicar === true;
const ORIGEN = args.origen || 'D:/CORSA/catalogo';
const SOLO = args.solo ? new Set(String(args.solo).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
const PASOS_ACTIVOS = args.paso ? String(args.paso).split(',').map((s) => s.trim()) : PASOS;
for (const p of PASOS_ACTIVOS) if (!PASOS.includes(p)) salir(`Paso desconocido: ${p}`);

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
const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const limpiarTexto = (d) => String(d || '').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
const normUnidad = (u) => sinTildes(String(u || '')).replace(/³/g, '3').replace(/²/g, '2').replace(/[°º]/g, 'o').replace(/\s+/g, '').toLowerCase();

function numero(s) {
  const t = String(s).trim().replace(/^(hasta|m[aá]x\.?|m[ií]n\.?|aprox\.?)\s*/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
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

// ---------------------------------------------------------------- origen (solo lectura)
const PRODUCTOS = leerJson(path.join(ORIGEN, 'productos.json')).productos;
const carpetaDe = (p) => { const d = path.join(ORIGEN, p.carpeta); return fs.existsSync(path.join(d, 'ficha.json')) ? d : null; };

// ---------------------------------------------------------------- estado de la base de datos
const TABLAS_ESTADO = {
  catalog_products: ['id', 'supplier_reference', 'name', 'kind', 'category_global_key', 'manufacturer_id', 'short_description', 'long_description', 'dim_width_mm', 'dim_height_mm', 'dim_depth_mm', 'weight_grams', 'main_image_path', 'gama_id', 'rasgos_identificacion', 'version', 'is_active', '?modelo', '?familia_proveedor', '?catalogos_proveedor', '?descatalogado', '?origen_carga'],
  product_attributes_global: ['id', 'key', 'name_es', 'data_type', 'unit', 'enum_values', '?grupo'],
  product_attributes_global_categories: ['attribute_key', 'category_key'],
  product_categories_global: ['key', 'parent_key', 'default_kind', 'name_es'],
  catalog_product_attributes: ['catalog_product_id', 'attribute_global_key', 'value_text', 'value_number', 'value_boolean'],
  catalog_product_photos: ['catalog_product_id', 'storage_path', 'is_main', 'tipo_foto'],
  catalog_product_highlights: ['catalog_product_id'],
  manufacturers: ['id', 'name'],
};
const COLUMNAS_MIGRACION = {
  catalog_products: ['modelo', 'familia_proveedor', 'catalogos_proveedor', 'descatalogado', 'origen_carga'],
  product_attributes_global: ['grupo'],
  catalog_product_photos: ['thumb_path', 'etiqueta', 'width_px', 'height_px'],
};

async function consultaApi(sql) {
  const token = ENV.SUPABASE_ACCESS_TOKEN;
  if (!token) salir('Falta SUPABASE_ACCESS_TOKEN en .env.local');
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
  const estado = { columnas: {}, origen: APLICAR ? 'service-role' : 'api' };
  if (APLICAR) {
    const sb = await clienteServicio();
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const opcionales = cols.filter((c) => c.startsWith('?')).map((c) => c.slice(1));
      const fijas = cols.filter((c) => !c.startsWith('?'));
      const presentes = [];
      for (const c of opcionales) { const { error } = await sb.from(t).select(c).limit(1); if (!error) presentes.push(c); }
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
    for (const [t, cols] of Object.entries(COLUMNAS_MIGRACION)) {
      if (estado.columnas[t] && cols.every((c) => estado.columnas[t].has(c))) continue;
      const presentes = new Set(estado.columnas[t] || []);
      for (const c of cols) { const { error } = await sb.from(t).select(c).limit(1); if (!error) presentes.add(c); }
      estado.columnas[t] = presentes;
    }
  } else {
    const tablas = [...new Set([...Object.keys(TABLAS_ESTADO), ...Object.keys(COLUMNAS_MIGRACION)])];
    const filasCols = await consultaApi(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in (${tablas.map((t) => `'${t}'`).join(',')})`);
    for (const { table_name, column_name } of filasCols) (estado.columnas[table_name] ||= new Set()).add(column_name);
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const sel = cols.map((c) => c.replace(/^\?/, '')).filter((c) => estado.columnas[t]?.has(c));
      const r = await consultaApi(`select coalesce(json_agg(x), '[]'::json) as filas from (select ${sel.map((c) => `"${c}"`).join(', ')} from public.${t}) x`);
      estado[t] = r[0].filas;
    }
  }
  return estado;
}

// ---------------------------------------------------------------- comprobaciones de seguridad
const TABLAS_PERMITIDAS = new Set(['product_categories_global', 'product_attributes_global', 'product_attributes_global_categories', 'catalog_products', 'catalog_product_attributes', 'catalog_product_photos', 'catalog_product_highlights']);
const INTOCABLES_EXISTENTE = new Set(['name', 'kind', 'category_global_key', 'manufacturer_id', 'is_active', 'version', 'supplier_reference']);
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
const TIPO_ESPERADO = { numero: 'number', booleano: 'boolean', texto: 'text', enum: 'enum', rango: 'number', presente: 'boolean' };
const sinPorcion = (e) => { const { por_unidad, por_valor, ...r } = e; return r; };

function categoriaDe(p) {
  const porRef = MAPA_FAM.por_ref?.[p.ref];
  const porModelo = MAPA_FAM.por_modelo?.[p.modelo];
  const fam = MAPA_FAM.familias[`${p.capitulo} / ${p.subfamilia}`] || MAPA_FAM.familias[p.capitulo];
  const r = porRef || porModelo || fam;
  if (!r) return null;
  return { categoria: r.categoria, kind: r.kind || fam?.kind, propuesta: r.propuesta || null };
}

function destinoPara(entrada, categoria, padres) {
  const d = entrada.destino;
  if (typeof d === 'string' || Array.isArray(d)) return d;
  if (d[categoria]) return d[categoria];
  const padre = padres.get(categoria);
  if (padre && d[padre + '*']) return d[padre + '*'];
  if (d[categoria + '*']) return d[categoria + '*'];
  return d['*'];
}

// Elige la entrada según la unidad si el atributo trae «por_unidad».
function entradaSegunUnidad(entrada, unidad, valor) {
  if (entrada.por_valor) {
    const v = String(valor || '').trim().toLowerCase();
    const k = Object.keys(entrada.por_valor).find((x) => x !== '*' && (x.startsWith('/') ? new RegExp(x.slice(1, -1), 'i').test(valor) : x.toLowerCase() === v));
    const sub = entrada.por_valor[k ?? '*'];
    if (!sub) return { error: `valor «${valor}» sin destino` };
    return entradaSegunUnidad({ ...sinPorcion(entrada), ...sub }, unidad, valor);
  }
  if (!entrada.por_unidad) return { entrada };
  const u = normUnidad(unidad);
  const k = Object.keys(entrada.por_unidad).find((x) => normUnidad(x) === u);
  if (k) return { entrada: { ...entrada, ...entrada.por_unidad[k], por_unidad: undefined } };
  if (entrada.por_unidad['*']) return { entrada: { ...entrada, ...entrada.por_unidad['*'], por_unidad: undefined } };
  return { error: `unidad «${unidad}» sin destino` };
}

// factor: número, «a/b» o { clave_destino: factor } (cuando cada destino guarda otra unidad)
function factorDe(f, destino) {
  if (f && typeof f === 'object') f = f[destino] ?? 1;
  if (typeof f === 'string' && f.includes('/')) { const [a, b] = f.split('/').map(Number); return a / b; }
  return f === undefined || f === null ? 1 : Number(f);
}

function convertir(entrada, valorBruto, unidad, destino) {
  const v = String(valorBruto ?? '').trim();
  const t = entrada.transformacion;
  const factor = factorDe(entrada.factor, Array.isArray(destino) ? destino[0] : destino);
  if (v === '' || v === '-' || v === '—') return { sinFila: 'vacío' };
  if (!destino) return { error: 'sin destino para esta categoría' };
  const esNo = /^no$/i.test(v);
  switch (t) {
    case 'numero': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const n = numero(v);
      if (n === null) return { error: 'no es un número' };
      if (n === 0) return { sinFila: '«0» = no tiene' };
      return { filas: [{ key: destino, value_number: +(n * factor).toFixed(3) }] };
    }
    case 'booleano': {
      if (/^s[ií]$/i.test(v)) return { filas: [{ key: destino, value_boolean: true }] };
      if (esNo) return { filas: [{ key: destino, value_boolean: false }] };
      return { error: 'no es Sí/No' };
    }
    case 'presente': // el catálogo solo lo menciona cuando lo tiene (texto libre) -> true
      return { filas: [{ key: destino, value_boolean: !/^no(\s|\(|,|$)/i.test(v) }] };
    case 'texto': {
      if (esNo && entrada.no_es_sin_fila) return { sinFila: '«No» = no tiene' };
      const base = entrada.valores?.[v] ?? v;
      const conUnidad = unidad && !entrada.sin_unidad && !base.includes(unidad) ? `${base} ${unidad}` : base;
      return { filas: [{ key: destino, value_text: conUnidad }] };
    }
    case 'enum': {
      const norm = entrada.valores?.[v];
      if (!norm) return { error: 'valor fuera del enum' };
      return { filas: [{ key: destino, value_text: norm, _enum: true }] };
    }
    case 'rango': {
      if (esNo) return { sinFila: '«No» = no tiene' };
      const partes = v.replace(/\s*[º°]\s*C\b/gi, '').split(/\s*[–~-]\s*|\s+a\s+/);
      if (partes.length === 1 && numero(partes[0]) !== null && entrada.uno_es) {
        const n = numero(partes[0]);
        return { filas: [{ key: destino[entrada.uno_es === 'max' ? 1 : 0], value_number: +(n * factor).toFixed(3) }] };
      }
      if (partes.length !== 2) return { error: 'no es un rango «a–b»' };
      const [a, b] = partes.map(numero);
      if (a === null || b === null) return { error: 'rango con valores no numéricos' };
      return { filas: [{ key: destino[0], value_number: +(a * factor).toFixed(3) }, { key: destino[1], value_number: +(b * factor).toFixed(3) }] };
    }
    default:
      return { error: `transformación desconocida «${t}»` };
  }
}

// ---------------------------------------------------------------- construcción del plan
async function construirPlan(estado) {
  const sharp = (await import('sharp')).default;
  const informe = {
    fecha: new Date().toISOString(), modo: APLICAR ? 'aplicar' : 'seco', estado: estado.origen, solo: SOLO ? [...SOLO] : null, pasos: PASOS_ACTIVOS,
    migracion_pendiente: [], productos: { crear: [], completar: [], sin_cambios: [], saltar: [] }, atributos: {},
    sin_emparejar: {}, ignorados: {}, a_ventaja: {}, no_convertidos: [], sin_fila: {}, valores_existentes_conservados: [], conflictos: [], avisos: [],
    fotos: {}, sin_foto: [], sin_caracteristicas: [], ventajas: {}, gamas: [], coincidencias: [], corsa_en_maestro_sin_pdf: [],
  };
  for (const [t, cols] of Object.entries(COLUMNAS_MIGRACION)) {
    const faltan = cols.filter((c) => !estado.columnas[t]?.has(c));
    if (faltan.length) informe.migracion_pendiente.push(`${t}: ${faltan.join(', ')}`);
  }

  const corsa = estado.manufacturers.find((m) => lower(m.name) === FABRICANTE);
  if (!corsa) salir('No existe el fabricante «Corsa» en manufacturers');
  const porRefBD = new Map(estado.catalog_products.map((p) => [lower(p.supplier_reference), p]));
  const globales = new Map(estado.product_attributes_global.map((g) => [g.key, g]));
  // Categorías nuevas aprobadas (mapa-familias.json «categorias_nuevas»): en seco se dan por creadas.
  const nuevasCat = (MAPA_FAM.categorias_nuevas || []).filter((c) => !estado.product_categories_global.some((x) => x.key === c.key));
  const clavesNuevasCat = new Set((MAPA_FAM.categorias_nuevas || []).map((c) => c.key));
  const todasCat = [...estado.product_categories_global, ...nuevasCat.map(({ enlazar_atributos, ...c }) => c)];
  const categorias = new Map(todasCat.map((c) => [c.key, c]));
  const padres = new Map(todasCat.map((c) => [c.key, c.parent_key]));
  const enlacesCat = new Set(estado.product_attributes_global_categories.map((l) => `${l.attribute_key}|${l.category_key}`));
  const valoresBD = new Map(estado.catalog_product_attributes.map((v) => [`${v.catalog_product_id}|${v.attribute_global_key}`, v]));
  const fotosBD = new Set(estado.catalog_product_photos.map((f) => f.storage_path));
  const conPrincipal = new Set(estado.catalog_product_photos.filter((f) => f.is_main).map((f) => f.catalog_product_id));
  const conVentajas = new Set(estado.catalog_product_highlights.map((h) => h.catalog_product_id));
  const tieneGamaHijas = new Set(estado.catalog_products.filter((p) => p.gama_id).map((p) => p.gama_id));

  const gamaDeRef = new Map();
  for (const g of GAMAS.gamas) for (const v of g.variantes) gamaDeRef.set(v.ref, { gama: g, variante: v });

  const incluido = (ref) => !SOLO || SOLO.has(lower(ref));
  const idDe = (ref) => porRefBD.get(lower(ref))?.id || `nuevo:${ref}`;
  const plan = { categoriasNuevas: nuevasCat.map(({ enlazar_atributos, ...c }) => ({ ...c, is_active: true })), atributosNuevos: [], globalesRellenar: [], enlacesCategoria: [], productosNuevos: [], productosCompletar: [], gamas: [], valores: [], fotos: [], ventajas: [] };
  const atributosUsados = new Map();
  const refsSaltadas = new Set();

  // Productos de Corsa que ya están en el maestro y no salen en el PDF
  const refsPdf = new Set(PRODUCTOS.map((p) => lower(p.ref)));
  for (const p of estado.catalog_products.filter((x) => x.manufacturer_id === corsa.id)) {
    if (!refsPdf.has(lower(p.supplier_reference))) informe.corsa_en_maestro_sin_pdf.push(`${p.supplier_reference} · ${p.name} · ${p.category_global_key}/${p.kind}`);
  }

  // ---------- equipos
  const equipos = [];
  for (const p of PRODUCTOS) {
    if (!incluido(p.ref)) continue;
    const dir = carpetaDe(p);
    const cat = categoriaDe(p);
    const gv = gamaDeRef.get(p.ref);
    const existente = porRefBD.get(lower(p.ref)) || null;
    const saltar = (motivo) => { informe.productos.saltar.push({ ref: p.ref, nombre: p.nombre, motivo }); refsSaltadas.add(p.ref); };
    if (!dir) { saltar('sin ficha.json'); continue; }
    if (!cat) { saltar(`familia sin mapa: ${p.capitulo} / ${p.subfamilia}`); continue; }
    if (cat.categoria === null || cat.excluir) { saltar(`excluido en mapa-familias (${cat.propuesta || 'sin motivo'})`); continue; }
    if (!categorias.has(cat.categoria)) { saltar(`categoría «${cat.categoria}» no existe en el maestro (propuesta: ${cat.propuesta || '—'})`); continue; }
    if (!gv) { saltar('no está en gamas.json'); continue; }
    if (existente && existente.manufacturer_id !== corsa.id) { informe.conflictos.push(`${p.ref}: ya existe en el maestro con otro fabricante («${existente.name}»); no se toca`); refsSaltadas.add(p.ref); continue; }
    if (existente) informe.coincidencias.push({ ref: p.ref, maestro: existente.name, corsa: p.nombre, categoria_maestro: `${existente.category_global_key}/${existente.kind}` });
    const ficha = leerJson(path.join(dir, 'ficha.json'));
    equipos.push({ p, dir, ficha, cat, gv, existente });
  }

  for (const e of equipos) {
    const { p, ficha, cat } = e;
    const columnas = {};
    const valores = [];
    e.ventajasExtra = [];
    const items = (ficha.grupos_ft || []).flatMap((g) => (g.items || []).map((i) => ({ ...i, grupo: GRUPOS[g.nombre] || null, grupoCorsa: g.nombre })));
    for (const it of items) {
      if ((MAPA_ATR.ignorar || []).includes(it.atributo)) { informe.ignorados[it.atributo] = (informe.ignorados[it.atributo] || 0) + 1; continue; }
      const col = MAPA_ATR.columnas[it.atributo];
      if (col) {
        const n = numero(it.valor);
        const f = col.unidades?.[normUnidad(it.unidad)] ?? (vacio(it.unidad) ? col.unidades?.[''] : undefined);
        if (n === null || n <= 0) informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: `${it.valor} ${it.unidad}`, motivo: 'medida o peso no numérico o cero' });
        else if (f === undefined) informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: `${it.valor} ${it.unidad}`, motivo: `unidad «${it.unidad}» no prevista para ${col.columna}` });
        else columnas[col.columna] = Math.round(n * f);
        continue;
      }
      const base = MAPA_ATR.atributos[it.atributo];
      if (!base) {
        const k = `${it.grupoCorsa} · ${it.atributo}`;
        (informe.sin_emparejar[k] ||= { veces: 0, ejemplos: new Set() }).veces++;
        informe.sin_emparejar[k].ejemplos.add(`${p.ref}: ${it.valor} ${it.unidad || ''}`.trim());
        continue;
      }
      const sel = entradaSegunUnidad(base, it.unidad, it.valor);
      if (sel.error) { informe.no_convertidos.push({ ref: p.ref, atributo: it.atributo, valor: `${it.valor} ${it.unidad}`, motivo: sel.error }); continue; }
      const entrada = sel.entrada;
      if (entrada.transformacion === 'ventaja' || entrada.ventaja) {
        const v = String(it.valor ?? '').trim();
        if (/^no$/i.test(v) && entrada.titulo_no) { e.ventajasExtra.push(entrada.titulo_no); informe.a_ventaja[it.atributo] = (informe.a_ventaja[it.atributo] || 0) + 1; continue; }
        if (!v || /^no$/i.test(v)) { const k = `${it.atributo} (ventaja «No»: no se añade)`; informe.sin_fila[k] = (informe.sin_fila[k] || 0) + 1; continue; }
        const titulo = /^s[ií]$/i.test(v) ? (entrada.titulo || it.atributo) : `${entrada.titulo || it.atributo}: ${v}${it.unidad && !v.includes(it.unidad) ? ' ' + it.unidad : ''}`;
        e.ventajasExtra.push(titulo);
        informe.a_ventaja[it.atributo] = (informe.a_ventaja[it.atributo] || 0) + 1;
        continue;
      }
      const destino = destinoPara(entrada, cat.categoria, padres);
      const r = convertir(entrada, it.valor, it.unidad, destino);
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
        if (valores.some((x) => x.key === f.key)) { informe.avisos.push(`${p.ref}: ${f.key} sale dos veces (${it.atributo}); se queda el primero`); continue; }
        const u = atributosUsados.get(f.key) || { veces: 0, categorias: new Set(), unidadCorsa: new Set(), nombreCorsa: it.atributo, grupo: it.grupo };
        u.veces++; u.categorias.add(cat.categoria); if (it.unidad) u.unidadCorsa.add(it.unidad);
        atributosUsados.set(f.key, u);
        const { _enum, ...fila } = f;
        valores.push({ ...fila, display_order: valores.length });
      }
    }
    e.columnas = columnas; e.valores = valores;
    e.nombre = e.gv.variante.nombre || e.gv.gama.modelo;
    e.descCorta = limpiarTexto(ficha.descripcion) || null;
    const etapas = (ficha.etapas || []).length ? 'Etapas: ' + ficha.etapas.join(' · ') : '';
    e.descLarga = limpiarTexto([ficha.descripcion, etapas].filter(Boolean).join(' ')) || null;
    if (!valores.length && !Object.keys(columnas).length) informe.sin_caracteristicas.push(p.ref);
  }

  // ---------- paso atributos
  const ordenGrupo = MAPA_ATR.orden_grupos;
  let i = 0;
  for (const [key, u] of [...atributosUsados].sort((a, b) => a[0].localeCompare(b[0]))) {
    const g = globales.get(key);
    const nuevo = MAPA_ATR.nuevos[key];
    if (!g) {
      plan.atributosNuevos.push({ key, name_es: nuevo.name_es, data_type: nuevo.data_type, unit: nuevo.unit, grupo: nuevo.grupo, sort_order: (ordenGrupo[nuevo.grupo] || 40) * 10 + (i++ % 10), default_visible: true });
    } else {
      const rell = {};
      if (estado.columnas.product_attributes_global?.has('grupo') && vacio(g.grupo) && u.grupo) rell.grupo = u.grupo;
      if (Object.keys(rell).length) plan.globalesRellenar.push({ key, ...rell });
    }
    for (const c of u.categorias) {
      const padre = padres.get(c);
      if (enlacesCat.has(`${key}|${c}`) || (padre && !clavesNuevasCat.has(c) && enlacesCat.has(`${key}|${padre}`))) continue;
      plan.enlacesCategoria.push({ attribute_key: key, category_key: c });
      enlacesCat.add(`${key}|${c}`);
    }
  }
  // Enlaces pedidos a mano para las categorías nuevas (p. ej. todos los uv_* también a «uv»)
  for (const c of MAPA_FAM.categorias_nuevas || []) {
    if (!c.enlazar_atributos || !c.enlazar_atributos.length) continue;
    const pref = String(c.enlazar_atributos).replace(/\*$/, '');
    const claves = new Set([...globales.keys(), ...plan.atributosNuevos.map((a) => a.key)]);
    for (const key of [...claves].filter((k) => k.startsWith(pref)).sort()) {
      if (enlacesCat.has(`${key}|${c.key}`)) continue;
      plan.enlacesCategoria.push({ attribute_key: key, category_key: c.key });
      enlacesCat.add(`${key}|${c.key}`);
    }
  }
  informe.categorias_nuevas = plan.categoriasNuevas.map((c) => `${c.key} («${c.name_es}», ${c.parent_key ? 'hija de ' + c.parent_key : 'raíz'}, ${c.default_kind})`);
  informe.atributos = {
    usados: atributosUsados.size, nuevos: plan.atributosNuevos.length, reutilizados: atributosUsados.size - plan.atributosNuevos.length,
    reutilizados_lista: [...atributosUsados.keys()].filter((k) => globales.has(k)).sort(),
    nuevos_lista: plan.atributosNuevos.map((a) => `${a.key} (${a.name_es}${a.unit ? ', ' + a.unit : ''}, ${a.data_type}, ${a.grupo})`),
    globales_a_rellenar: plan.globalesRellenar, enlaces_categoria_nuevos: plan.enlacesCategoria.length,
    nuevos_en_mapa_sin_usar: Object.keys(MAPA_ATR.nuevos).filter((k) => !k.startsWith('_') && !atributosUsados.has(k)),
  };

  // ---------- paso productos
  for (const e of equipos) {
    const { p, cat, gv, existente } = e;
    const base = {
      modelo: gv.gama.modelo, familia_proveedor: [p.capitulo, p.subfamilia].filter(Boolean).join(' / '),
      catalogos_proveedor: ['Corsa · Catálogo Nacional V.01'], origen_carga: ORIGEN_CARGA,
      short_description: e.descCorta, long_description: e.descLarga !== e.descCorta ? e.descLarga : null, ...e.columnas,
    };
    if (!existente) {
      const fila = { manufacturer_id: corsa.id, supplier_reference: p.ref, name: e.nombre, kind: cat.kind, category_global_key: cat.categoria, is_active: true, descatalogado: false, ...base };
      for (const k of Object.keys(fila)) if (fila[k] === null || fila[k] === undefined) delete fila[k];
      plan.productosNuevos.push({ ref: p.ref, esCabeza: gv.gama.cabeza === p.ref, fila });
      informe.productos.crear.push({ ref: p.ref, nombre: e.nombre, rasgos: gv.variante.rasgos, categoria: cat.categoria, kind: cat.kind });
    } else {
      const rellenar = {};
      for (const [k, v] of Object.entries(base)) {
        if (v === null || v === undefined) continue;
        if (vacio(existente[k]) || (Array.isArray(existente[k]) && !existente[k].length)) rellenar[k] = v;
      }
      if (existente.category_global_key !== cat.categoria || existente.kind !== cat.kind) informe.avisos.push(`${p.ref}: se queda en ${existente.category_global_key}/${existente.kind} (Corsa: ${cat.categoria}/${cat.kind}); no se toca`);
      for (const [k, v] of Object.entries(e.columnas)) if (!vacio(existente[k]) && existente[k] !== v) informe.avisos.push(`${p.ref}: ${k} se queda en ${existente[k]} (Corsa: ${v})`);
      if (Object.keys(rellenar).length) { plan.productosCompletar.push({ ref: p.ref, id: existente.id, rellenar }); informe.productos.completar.push({ ref: p.ref, campos: Object.keys(rellenar) }); }
      else informe.productos.sin_cambios.push(p.ref);
    }
  }

  // ---------- paso gamas
  for (const g of GAMAS.gamas) {
    const miembros = g.variantes.filter((v) => incluido(v.ref) && !refsSaltadas.has(v.ref));
    informe.gamas.push({ modelo: g.modelo, cabeza: g.cabeza, variantes: g.variantes.map((v) => `${v.ref}${v.rasgos ? ' (' + v.rasgos + ')' : ''}`), revisar: g.revisar, nota: g.nota || null, capitulo: g.capitulo });
    if (g.variantes.length < 2 || !miembros.length) { for (const v of miembros) if (v.rasgos) plan.gamas.push({ ref: v.ref, gama: null, rasgos: v.rasgos }); continue; }
    if (refsSaltadas.has(g.cabeza)) { informe.avisos.push(`Gama ${g.modelo}: la cabeza ${g.cabeza} se salta; sus variantes quedan sueltas`); for (const v of miembros) plan.gamas.push({ ref: v.ref, gama: null, rasgos: v.rasgos }); continue; }
    const cabezaBD = porRefBD.get(lower(g.cabeza));
    if (cabezaBD?.gama_id) { informe.conflictos.push(`Gama ${g.modelo}: la cabeza ${g.cabeza} ya es variante de otra gama`); continue; }
    for (const v of miembros) {
      const bd = porRefBD.get(lower(v.ref));
      const esCabeza = v.ref === g.cabeza;
      const op = { ref: v.ref, gama: esCabeza ? null : g.cabeza, rasgos: v.rasgos };
      if (!esCabeza && bd?.gama_id && bd.gama_id !== cabezaBD?.id) { informe.conflictos.push(`${v.ref} ya es variante de otra gama: no se cambia`); op.gama = null; }
      if (!esCabeza && bd && tieneGamaHijas.has(bd.id)) { informe.conflictos.push(`${v.ref} tiene variantes propias: no puede ser variante de ${g.cabeza}`); op.gama = null; }
      if (!esCabeza && !cabezaBD && !incluido(g.cabeza)) op.gama = null;
      plan.gamas.push(op);
    }
  }

  // ---------- paso valores
  for (const e of equipos) {
    const id = idDe(e.p.ref);
    for (const v of e.valores) {
      const bd = valoresBD.get(`${id}|${v.key}`);
      if (bd) {
        const igual = (v.value_number ?? null) === (bd.value_number === null ? null : Number(bd.value_number)) && (v.value_text ?? null) === bd.value_text && (v.value_boolean ?? null) === bd.value_boolean;
        if (!igual) informe.valores_existentes_conservados.push({ ref: e.p.ref, clave: v.key, maestro: bd.value_text ?? bd.value_number ?? bd.value_boolean, corsa: v.value_text ?? v.value_number ?? v.value_boolean });
        continue;
      }
      const { key, ...resto } = v;
      plan.valores.push({ ref: e.p.ref, fila: { attribute_global_key: key, ...resto } });
    }
  }

  // ---------- paso fotos
  const fotosPorTipo = {};
  let bytesFotos = 0;
  const lados = [];
  for (const e of equipos) {
    const id = idDe(e.p.ref);
    const yaTienePrincipal = conPrincipal.has(id);
    const imgs = e.ficha.imagenes || [];
    const hayPrincipal = imgs.some((x) => x.tipo === 'principal');
    if (!imgs.length) informe.sin_foto.push(e.p.ref);
    else if (!hayPrincipal && !yaTienePrincipal) informe.avisos.push(`${e.p.ref}: sin foto principal; la primera foto (${imgs[0].tipo}) hará de principal`);
    let principalPuesta = yaTienePrincipal;
    for (const [k, im] of imgs.entries()) {
      const nombreF = path.basename(im.fichero).replace(/\.webp$/, '') + '.webp';
      const sub = im.tipo === 'detalle' ? 'detalles/' : '';
      const storage_path = `products/${id}/corsa/${sub}${nombreF}`;
      if (fotosBD.has(storage_path)) continue;
      const local = path.join(e.dir, im.fichero);
      if (!fs.existsSync(local)) { informe.avisos.push(`${e.p.ref}: falta el fichero ${im.fichero}`); continue; }
      const st = fs.statSync(local);
      let meta = {};
      try { meta = await sharp(local).metadata(); } catch (err) { informe.avisos.push(`${e.p.ref}: no se puede leer ${im.fichero}: ${err.message}`); continue; }
      bytesFotos += st.size; lados.push(Math.max(meta.width, meta.height));
      fotosPorTipo[im.tipo] = (fotosPorTipo[im.tipo] || 0) + 1;
      const esMain = !principalPuesta && (im.tipo === 'principal' || (!hayPrincipal && k === 0));
      if (esMain) principalPuesta = true;
      const etiqueta = im.tipo === 'detalle' ? (im.nota ? im.nota[0].toUpperCase() + im.nota.slice(1) : 'Detalle') : im.tipo === 'medidas' ? 'Guía de medidas' : null;
      plan.fotos.push({
        ref: e.p.ref, local, esMain, ancho: meta.width, alto: meta.height, bytes: st.size,
        fila: {
          storage_path, thumb_path: `products/${id}/corsa/m/${sub}${nombreF}`,
          alt_text: [e.nombre, e.gv.variante.rasgos, etiqueta].filter(Boolean).join(' · '),
          is_main: esMain, display_order: { principal: 0, ambiente: 10, detalle: 20, medidas: 30 }[im.tipo] + k, tipo_foto: im.tipo, etiqueta,
        },
      });
    }
  }
  lados.sort((a, b) => a - b);
  informe.fotos = { a_subir: plan.fotos.length, por_tipo: fotosPorTipo, mb_originales: +(bytesFotos / 1e6).toFixed(1), lado_mayor_px: lados.length ? { min: lados[0], mediana: lados[Math.floor(lados.length / 2)], max: lados[lados.length - 1] } : null, menores_de_300px: lados.filter((x) => x < 300).length };

  // ---------- paso ventajas (sin iconos: el PDF los trae como dibujo vectorial)
  for (const e of equipos) {
    const id = idDe(e.p.ref);
    const hl = [...(e.ficha.highlights || []).filter((h) => !vacio(h.texto_breve)), ...e.ventajasExtra.map((t) => ({ texto_breve: t, texto_largo: null }))];
    if (!hl.length) continue;
    if (conVentajas.has(id)) { informe.avisos.push(`${e.p.ref}: ya tiene ventajas; no se añaden`); continue; }
    hl.forEach((h, k) => plan.ventajas.push({ ref: e.p.ref, fila: { titulo: limpiarTexto(h.texto_breve).slice(0, 200), descripcion: h.texto_largo ? limpiarTexto(h.texto_largo) : null, icon_path: null, display_order: k } }));
  }
  informe.ventajas = { filas: plan.ventajas.length, productos: new Set(plan.ventajas.map((v) => v.ref)).size, de_caracteristicas: equipos.reduce((a, e) => a + e.ventajasExtra.length, 0), fichas_sin_ventajas: equipos.filter((e) => !(e.ficha.highlights || []).length && !e.ventajasExtra.length).map((e) => e.p.ref) };

  // ---------- comprobación previa
  for (const x of plan.categoriasNuevas) comprobarPayload('product_categories_global', x);
  for (const x of plan.atributosNuevos) comprobarPayload('product_attributes_global', x);
  for (const x of plan.globalesRellenar) comprobarPayload('product_attributes_global', x);
  for (const x of plan.enlacesCategoria) comprobarPayload('product_attributes_global_categories', x);
  for (const x of plan.productosNuevos) comprobarPayload('catalog_products', x.fila);
  for (const x of plan.productosCompletar) comprobarPayload('catalog_products', x.rellenar, { actualizaExistente: true });
  for (const x of plan.gamas) comprobarPayload('catalog_products', { gama_id: x.gama, rasgos_identificacion: x.rasgos }, { actualizaExistente: true });
  for (const x of plan.valores) comprobarPayload('catalog_product_attributes', x.fila);
  for (const x of plan.fotos) comprobarPayload('catalog_product_photos', x.fila);
  for (const x of plan.ventajas) comprobarPayload('catalog_product_highlights', x.fila);
  informe.comprobacion_previa = { payloads: comprobaciones.payloads, fallos: comprobaciones.fallos.length, regla: 'ningún payload lleva version ni company_id; ninguna fila existente recibe name, kind, categoría, fabricante, is_active ni version; solo tablas del maestro' };

  const porCategoria = {};
  for (const x of plan.productosNuevos) porCategoria[`${x.fila.category_global_key}/${x.fila.kind}`] = (porCategoria[`${x.fila.category_global_key}/${x.fila.kind}`] || 0) + 1;
  informe.recuentos = {
    categorias_nuevas: plan.categoriasNuevas.map((c) => c.key),
    equipos_en_extraccion: PRODUCTOS.length, equipos_procesados: equipos.length, equipos_crear: plan.productosNuevos.length,
    equipos_completar: plan.productosCompletar.length, equipos_sin_cambios: informe.productos.sin_cambios.length, equipos_saltados: informe.productos.saltar.length,
    crear_por_categoria: Object.entries(porCategoria).map(([k, v]) => `${k} ${v}`),
    atributos_globales_nuevos: plan.atributosNuevos.length, atributos_globales_reutilizados: informe.atributos.reutilizados,
    enlaces_atributo_categoria: plan.enlacesCategoria.length, valores_atributo: plan.valores.length,
    gamas_con_variantes: GAMAS.gamas.filter((g) => g.variantes.length > 1).length, variantes_a_enlazar: plan.gamas.filter((g) => g.gama).length,
    fotos: plan.fotos.length, ventajas: plan.ventajas.length,
    filas_catalog_products_tras_la_carga: estado.catalog_products.length + plan.productosNuevos.length,
  };
  return { plan, informe };
}

// ---------------------------------------------------------------- escritura (solo --aplicar)
async function aplicar(plan, estadoInicial) {
  const sb = await clienteServicio();
  const sharp = (await import('sharp')).default;
  const res = {};
  const faltan = Object.entries(COLUMNAS_MIGRACION).flatMap(([t, cols]) => cols.filter((c) => !estadoInicial.columnas[t]?.has(c)).map((c) => `${t}.${c}`));
  if (faltan.length) salir('Faltan columnas de la migración 20261126100000_catalogo_maestro_fase2.sql: ' + faltan.join(', '));
  const activo = (p) => PASOS_ACTIVOS.includes(p);
  const idsPorRef = async () => {
    const m = new Map();
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from('catalog_products').select('id, supplier_reference, gama_id').range(desde, desde + 999);
      if (error) salir('Leyendo catalog_products: ' + error.message);
      for (const p of data) m.set(lower(p.supplier_reference), p);
      if (data.length < 1000) break;
    }
    return m;
  };
  const ok = (error, que) => { if (error) salir(`${que}: ${error.message}`); };
  const TEXTOS = ['short_description', 'long_description', 'modelo', 'familia_proveedor', 'origen_carga', 'rasgos_identificacion'];
  const rellenarSiVacio = async (id, campos) => {
    let n = 0;
    for (const [k, v] of Object.entries(campos)) {
      let q = sb.from('catalog_products').update({ [k]: v }).eq('id', id);
      q = typeof v === 'string' && TEXTOS.includes(k) ? q.or(`${k}.is.null,${k}.eq.`) : q.is(k, null);
      const { data, error } = await q.select('id');
      ok(error, `Rellenar ${k}`);
      n += data.length;
    }
    return n;
  };
  const subir = (destino, cuerpo, tipo) => conReintento(async () => {
    const { error } = await sb.storage.from(BUCKET).upload(destino, cuerpo, { contentType: tipo, cacheControl: '31536000', upsert: true });
    if (error) throw new Error(`${destino}: ${error.message}`);
  });

  if (activo('categorias')) {
    if (plan.categoriasNuevas.length) { const { error } = await sb.from('product_categories_global').upsert(plan.categoriasNuevas, { onConflict: 'key', ignoreDuplicates: true }); ok(error, 'Categorías nuevas'); }
    res.categorias = plan.categoriasNuevas.map((c) => c.key);
  }

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

  const ids = await idsPorRef();
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
    const porProducto = new Map();
    for (const v of plan.ventajas) { const id = idDe(v.ref); if (id) (porProducto.get(id) || porProducto.set(id, []).get(id)).push({ catalog_product_id: id, ...v.fila }); }
    let insertadas = 0;
    for (const [id, filas] of porProducto) {
      const { count, error } = await sb.from('catalog_product_highlights').select('id', { count: 'exact', head: true }).eq('catalog_product_id', id); ok(error, 'Contar ventajas');
      if (count > 0) continue;
      const { error: e2 } = await sb.from('catalog_product_highlights').insert(filas); ok(e2, 'Ventajas'); insertadas += filas.length;
    }
    res.ventajas = { filas: insertadas };
  }
  return res;
}

// ---------------------------------------------------------------- informe en Markdown
function informeMd(inf) {
  const L = [];
  const p = (s = '') => L.push(s);
  const lista = (arr, max = 600) => { if (!arr.length) p('- (ninguno)'); arr.slice(0, max).forEach((x) => p(`- ${x}`)); if (arr.length > max) p(`- … y ${arr.length - max} más`); };
  p(`# Informe de la carga de Corsa — ${inf.modo === 'seco' ? 'prueba en seco' : 'aplicada'}`);
  p();
  p(`Fecha: ${inf.fecha} · Estado leído de: ${inf.estado} · Solo: ${inf.solo ? inf.solo.join(', ') : 'todo'} · Pasos: ${inf.pasos.join(', ')}`);
  p();
  p('Generado por `scripts/catalogo-corsa/cargar.mjs`. En seco no se ha escrito nada en la base de datos ni en Storage.');
  p();
  if (inf.migracion_pendiente.length) { p('> **Migración pendiente.** Faltan columnas:'); inf.migracion_pendiente.forEach((m) => p(`> - ${m}`)); p(); }
  p('## 1. Recuentos'); p();
  p('| Qué | N |'); p('|---|---|');
  for (const [k, v] of Object.entries(inf.recuentos)) p(`| ${k.replace(/_/g, ' ')} | ${Array.isArray(v) ? v.join(', ') || '—' : v} |`);
  p();
  p(`Comprobación previa: ${inf.comprobacion_previa.payloads} payloads revisados, ${inf.comprobacion_previa.fallos} fallos (${inf.comprobacion_previa.regla}).`);
  p();
  p(`Categorías nuevas que se crean con --aplicar (paso «categorias»): ${inf.categorias_nuevas.join(' · ') || 'ninguna'}.`);
  p();
  p('## 2. Atributos'); p();
  const se = Object.entries(inf.sin_emparejar);
  p(`Sin emparejar (no se cargan): ${se.length}`);
  se.forEach(([k, v]) => p(`- ${k} (${v.veces}): ${[...v.ejemplos].slice(0, 3).join(' · ')}`));
  p();
  p(`Ignorados a propósito: ${Object.entries(inf.ignorados).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}.`);
  p();
  p(`Atributos globales: ${inf.atributos.nuevos} nuevos, ${inf.atributos.reutilizados} reutilizados, ${inf.atributos.enlaces_categoria_nuevos} enlaces nuevos atributo–categoría.`);
  p();
  p('Nuevos (propuestos, se crean con --aplicar):'); lista(inf.atributos.nuevos_lista); p();
  p(`Reutilizados: ${inf.atributos.reutilizados_lista.join(', ')}.`);
  p();
  if (inf.atributos.nuevos_en_mapa_sin_usar.length) { p(`Claves nuevas del mapa que no usa ningún producto: ${inf.atributos.nuevos_en_mapa_sin_usar.join(', ')}.`); p(); }
  p('## 3. Valores que no se han podido convertir'); p();
  if (!inf.no_convertidos.length) p('Ninguno.');
  else { p('| Ref | Atributo | Valor | Motivo |'); p('|---|---|---|---|'); inf.no_convertidos.forEach((x) => p(`| ${x.ref} | ${x.atributo} | ${String(x.valor).replace(/\|/g, '/')} | ${x.motivo} |`)); }
  p();
  p('Valores que no crean fila a propósito:'); p();
  Object.entries(inf.sin_fila).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => p(`- ${k}: ${v}`));
  p();
  if (inf.valores_existentes_conservados.length) { p('Valores que ya estaban en el maestro y **no se pisan**:'); p(); inf.valores_existentes_conservados.forEach((v) => p(`- ${v.ref} · ${v.clave}: se queda ${v.maestro} (Corsa: ${v.corsa})`)); p(); }
  p('## 4. Fotos, ventajas y productos sin datos'); p();
  p(`Fotos a subir: ${inf.fotos.a_subir} (${inf.fotos.mb_originales} MB, más miniaturas de 400 px). Por tipo: ${Object.entries(inf.fotos.por_tipo).map(([k, v]) => `${k} ${v}`).join(' · ')}. Lado mayor en px: ${JSON.stringify(inf.fotos.lado_mayor_px)}; menores de 300 px: ${inf.fotos.menores_de_300px}.`);
  p();
  p(`Sin ninguna foto: ${inf.sin_foto.length}`); lista(inf.sin_foto); p();
  p(`Sin características: ${inf.sin_caracteristicas.length}`); lista(inf.sin_caracteristicas); p();
  p(`Características que pasan a ventaja (texto): ${Object.entries(inf.a_ventaja).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}.`);
  p();
  p(`Ventajas: ${inf.ventajas.filas} en ${inf.ventajas.productos} productos (sin icono; ${inf.ventajas.de_caracteristicas} salen de características sí/no o sueltas). Fichas sin ventajas: ${inf.ventajas.fichas_sin_ventajas.length}.`);
  p();
  p('## 5. Gamas'); p();
  const conV = inf.gamas.filter((g) => g.variantes.length > 1);
  p(`${conV.length} gamas con variantes y ${inf.gamas.length - conV.length} productos sueltos. **Revisar** = dudosa.`);
  p();
  p('| Modelo | Cabeza | Variantes (rasgos) | Revisar | Nota |'); p('|---|---|---|---|---|');
  conV.forEach((g) => p(`| ${g.modelo} | ${g.cabeza} | ${g.variantes.join('<br>')} | ${g.revisar ? '**Sí**' : ''} | ${g.nota || ''} |`));
  p();
  p(`Sueltos: ${inf.gamas.filter((g) => g.variantes.length === 1).map((g) => `${g.modelo} (${g.cabeza})`).join(' · ')}.`);
  p();
  p('## 6. Coincidencias con el maestro'); p();
  p('Refs del PDF que ya existen en el maestro (se completan, no se pisan):'); lista(inf.coincidencias.map((c) => `${c.ref}: maestro «${c.maestro}» (${c.categoria_maestro}) · Corsa «${c.corsa}»`)); p();
  p('Productos de Corsa del maestro que NO salen en el PDF:'); lista(inf.corsa_en_maestro_sin_pdf); p();
  p('## 7. Productos'); p();
  p(`Crear (${inf.productos.crear.length}):`); lista(inf.productos.crear.map((x) => `${x.ref} · ${x.nombre}${x.rasgos ? ' · ' + x.rasgos : ''} · ${x.categoria}/${x.kind}`)); p();
  p(`Completar (${inf.productos.completar.length}):`); lista(inf.productos.completar.map((x) => `${x.ref}: ${x.campos.join(', ')}`)); p();
  p(`Saltados (${inf.productos.saltar.length}):`); lista(inf.productos.saltar.map((x) => `${x.ref} · ${x.nombre}: ${x.motivo}`)); p();
  p('## 8. Conflictos y avisos'); p();
  p('Conflictos:'); lista(inf.conflictos); p();
  p('Avisos:'); lista(inf.avisos); p();
  if (inf.resultado) { p('## 9. Resultado de la escritura'); p(); p('```json'); p(JSON.stringify(inf.resultado, null, 2)); p('```'); }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- principal
async function main() {
  log(`Carga Corsa · modo ${APLICAR ? 'APLICAR (escribe)' : 'en seco (no escribe nada)'}`);
  const estado = await leerEstado();
  log(`Estado: ${estado.catalog_products.length} productos maestros, ${estado.product_attributes_global.length} atributos globales`);
  const { plan, informe } = await construirPlan(estado);
  if (APLICAR) informe.resultado = await aplicar(plan, estado);
  const dirInf = path.join(AQUI, 'informes');
  fs.mkdirSync(dirInf, { recursive: true });
  const sello = informe.fecha.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dirInf, `${sello}-${informe.modo}.json`), JSON.stringify(informe, (k, v) => (v instanceof Set ? [...v] : v), 2));
  fs.writeFileSync(path.join(dirInf, `${sello}-${informe.modo}.md`), informeMd(informe));
  log(JSON.stringify(informe.recuentos, null, 2));
  log(`Informe: ${path.join(dirInf, `${sello}-${informe.modo}.md`)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
