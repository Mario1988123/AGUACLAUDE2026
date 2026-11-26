#!/usr/bin/env node
// =============================================================================
// Carga de los equipos RESIDENCIALES de Osmofilter que faltaban en el catálogo MAESTRO
// (superadmin). Fuente: D:\OSMONOVA\catalogo\nuevos_residencial.json (2026-11-26).
// Mismas reglas que cargar.mjs (la carga de los 174 del 25-11).
//
// Uso:
//   node scripts/catalogo-osmofilter/cargar-nuevos-residencial.mjs             # prueba en seco (por defecto)
//   node scripts/catalogo-osmofilter/cargar-nuevos-residencial.mjs --aplicar   # escribe (service-role)
//     --origen=D:\OSMONOVA\catalogo\nuevos_residencial.json
//     --solo=AT6925SA,DNOVO      limitar a unas refs de equipo
//
// Qué hace:
//   1. Crea en catalog_products cada equipo que no exista (por lower(supplier_reference), con alias.json).
//      kind y categoría salen de mapa-familias.json; nombre, rasgos y gama de nuevos-residencial-mapa.json.
//   2. Engancha como variante (gama_id) las refs cuya gama ya existe en el maestro, y las de
//      «gamas_nuevas» marcadas con «aplicar»: true.
//   3. Crea los enlaces de recambio en catalog_product_compatibilities (on conflict do nothing).
//   Vienen sin fotos, sin atributos y sin precios: la lista del superadmin los marca «Incompleto».
//
// Reglas (no se negocian):
//   - Sin --aplicar no hay ni una escritura: solo SELECT por la Management API.
//   - Idempotente. Nunca borra. Nunca pisa un campo no nulo. Nunca envía «version».
//   - Solo escribe en catalog_products y catalog_product_compatibilities. Ninguna tabla con company_id.
//   - En filas que ya existen no toca name, kind, categoría, fabricante, is_active ni version.
//   - Reutiliza el fabricante «Osmofilter» que ya existe. Nunca crea recambios: si falta uno, lo informa.
//   - Lee el fichero de origen solo en lectura. No usa precios, stock ni nada de la web de Osmofilter.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const ORIGEN_CARGA = 'osmofilter-residencial-2026-11-26';
const PROYECTO = 'pkgvzwunazzkstlfubnq';

// ---------------------------------------------------------------- argumentos
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APLICAR = args.aplicar === true;
const ORIGEN = args.origen || 'D:/OSMONOVA/catalogo/nuevos_residencial.json';
const SOLO = args.solo ? new Set(String(args.solo).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;

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

// ---------------------------------------------------------------- utilidades (iguales que cargar.mjs)
const leerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lower = (s) => String(s).toLowerCase();
const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const RE_FIN_EXISTENCIAS = /\(?\s*hasta fin (de )?existencias\s*\)?/i;
const limpiarTexto = (d) => String(d || '').replace(RE_FIN_EXISTENCIAS, '').replace(/\s*\bOsmofilter\b/gi, '').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();

// ---------------------------------------------------------------- mapas y origen
const MAPA_FAM = leerJson(path.join(AQUI, 'mapa-familias.json'));
const ALIAS = leerJson(path.join(AQUI, 'alias.json')).alias;
const MAPA = leerJson(path.join(AQUI, 'nuevos-residencial-mapa.json'));
const refMaestro = (ref) => ALIAS[ref] || ref;
if (!fs.existsSync(ORIGEN)) salir(`No existe ${ORIGEN}`);
const FUENTE = leerJson(ORIGEN);
const PRODUCTOS = FUENTE.productos || salir('El origen no trae «productos»');
const EXCLUIR = new Set((MAPA.excluir || []).map(lower));

function categoriaDe(p) {
  const porRef = MAPA_FAM.por_ref[p.ref];
  const fam = MAPA_FAM.familias[p.familia];
  if (!fam) return null;
  const c = MAPA.productos[p.ref]?.categoria;
  // El encargo pide kind 'equipment' para todos; la familia de los residenciales ya lo da.
  return { categoria: c || porRef?.categoria || fam.categoria, kind: porRef?.kind || fam.kind };
}

// ---------------------------------------------------------------- estado de la base de datos
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

let SB = null;
async function clienteServicio() {
  if (SB) return SB;
  const url = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const clave = ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_SECRET_KEY;
  if (!url || !clave) salir('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local');
  const { createClient } = await import('@supabase/supabase-js');
  SB = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
  return SB;
}

const TABLAS_ESTADO = {
  catalog_products: ['id', 'supplier_reference', 'name', 'kind', 'category_global_key', 'manufacturer_id', 'short_description', 'main_image_path', 'gama_id', 'rasgos_identificacion', 'version', 'is_active', 'modelo', 'familia_proveedor', 'descatalogado', 'origen_carga', 'cambios_sin_publicar'],
  product_categories_global: ['key', 'parent_key', 'default_kind'],
  catalog_product_compatibilities: ['spare_part_catalog_id', 'equipment_catalog_id'],
  catalog_product_photos: ['catalog_product_id', 'is_main'],
  catalog_product_attributes: ['catalog_product_id'],
  manufacturers: ['id', 'name'],
};

async function leerEstado() {
  const estado = {};
  if (APLICAR) {
    const sb = await clienteServicio();
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const filas = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await sb.from(t).select(cols.join(',')).range(desde, desde + 999);
        if (error) salir(`Leyendo ${t}: ${error.message}`);
        filas.push(...data);
        if (data.length < 1000) break;
      }
      estado[t] = filas;
    }
  } else {
    for (const [t, cols] of Object.entries(TABLAS_ESTADO)) {
      const r = await consultaApi(`select coalesce(json_agg(x), '[]'::json) as filas from (select ${cols.map((c) => `"${c}"`).join(', ')} from public.${t}) x`);
      estado[t] = r[0].filas;
    }
  }
  return estado;
}

// ---------------------------------------------------------------- comprobaciones de seguridad
const TABLAS_PERMITIDAS = new Set(['catalog_products', 'catalog_product_compatibilities']);
const INTOCABLES_EXISTENTE = new Set(['name', 'kind', 'category_global_key', 'manufacturer_id', 'is_active', 'version', 'supplier_reference', 'main_image_path']);
const comprobaciones = { payloads: 0, fallos: [] };
function comprobarPayload(tabla, payload, { actualizaExistente = false } = {}) {
  comprobaciones.payloads++;
  if (!TABLAS_PERMITIDAS.has(tabla)) comprobaciones.fallos.push(`Tabla no permitida: ${tabla}`);
  if ('version' in payload) comprobaciones.fallos.push(`${tabla}: payload con «version»`);
  if ('company_id' in payload) comprobaciones.fallos.push(`${tabla}: payload con «company_id»`);
  if (actualizaExistente) for (const k of Object.keys(payload)) if (INTOCABLES_EXISTENTE.has(k)) comprobaciones.fallos.push(`${tabla}: se intentaba escribir «${k}» en una fila existente`);
  if (comprobaciones.fallos.length) salir('Comprobación previa fallida:\n  ' + [...new Set(comprobaciones.fallos)].join('\n  '));
}

// ---------------------------------------------------------------- plan
function construirPlan(estado) {
  const informe = {
    fecha: new Date().toISOString(), modo: APLICAR ? 'aplicar' : 'seco', origen: ORIGEN, generado_origen: FUENTE.generado || null, nota_origen: FUENTE.nota || null, solo: SOLO ? [...SOLO] : null,
    productos: { crear: [], completar: [], sin_cambios: [], saltar: [], excluidos: [] },
    familias: {}, gamas: { a_enlazar: [], conflictos: [], propuestas: [] }, enlaces: {}, recambios_inexistentes: [],
    incompletos: [], dudas: [], avisos: [],
  };

  const osmo = estado.manufacturers.find((m) => lower(m.name) === 'osmofilter');
  if (!osmo) salir('No existe el fabricante «Osmofilter» en manufacturers');
  informe.fabricante = { id: osmo.id, name: osmo.name };
  const porRefBD = new Map(estado.catalog_products.map((p) => [lower(p.supplier_reference), p]));
  const porIdBD = new Map(estado.catalog_products.map((p) => [p.id, p]));
  const categorias = new Map(estado.product_categories_global.map((c) => [c.key, c]));
  const compatBD = new Set(estado.catalog_product_compatibilities.map((c) => `${c.spare_part_catalog_id}|${c.equipment_catalog_id}`));
  const conHijas = new Set(estado.catalog_products.filter((p) => p.gama_id).map((p) => p.gama_id));
  const conPrincipal = new Set(estado.catalog_product_photos.filter((f) => f.is_main).map((f) => f.catalog_product_id));
  const nAtributos = new Map();
  for (const a of estado.catalog_product_attributes) nAtributos.set(a.catalog_product_id, (nAtributos.get(a.catalog_product_id) || 0) + 1);

  const incluido = (ref) => !SOLO || SOLO.has(lower(ref)) || SOLO.has(lower(refMaestro(ref)));
  const plan = { productosNuevos: [], productosCompletar: [], gamas: [], enlaces: [] };

  // Propuestas de gama nueva aprobadas: ref -> { modelo, cabeza, rasgos }
  const propuestaDe = new Map();
  for (const g of MAPA.gamas_nuevas || []) {
    informe.gamas.propuestas.push({ modelo: g.modelo, cabeza: g.cabeza, aplicar: g.aplicar === true, motivo: g.motivo || null, variantes: g.variantes.map((v) => `${v.ref} (${v.rasgos})`) });
    if (g.aplicar !== true) continue;
    for (const v of g.variantes) propuestaDe.set(v.ref, { modelo: g.modelo, cabeza: g.cabeza, rasgos: v.rasgos });
  }

  // ---------- equipos
  const refsOrigen = new Set();
  const equipos = [];
  for (const p of PRODUCTOS) {
    if (!incluido(p.ref)) continue;
    if (refsOrigen.has(lower(p.ref))) { informe.avisos.push(`${p.ref}: repetida en el origen; se usa la primera`); continue; }
    refsOrigen.add(lower(p.ref));
    if (EXCLUIR.has(lower(p.ref))) { informe.productos.excluidos.push(p.ref); continue; }
    const cat = categoriaDe(p);
    if (!cat) { informe.productos.saltar.push({ ref: p.ref, motivo: `familia sin mapa: ${p.familia}` }); continue; }
    if (!categorias.has(cat.categoria)) { informe.productos.saltar.push({ ref: p.ref, motivo: `la categoría ${cat.categoria} no existe en product_categories_global` }); continue; }
    const m = MAPA.productos[p.ref];
    if (!m) informe.avisos.push(`${p.ref}: no está en nuevos-residencial-mapa.json; nombre = descripción limpia`);
    const refM = refMaestro(p.ref);
    const descCorta = limpiarTexto(p.descripcion);
    const prop = propuestaDe.get(p.ref);
    const nombre = prop?.modelo || m?.nombre || descCorta;
    const rasgos = prop ? prop.rasgos : (m?.rasgos ?? null);
    const gama = prop ? (prop.cabeza === p.ref ? null : prop.cabeza) : (m?.gama ?? null);
    if (m?.duda) informe.dudas.push(`${p.ref} (${nombre}): ${m.duda}`);
    equipos.push({ p, cat, refM, existente: porRefBD.get(lower(refM)) || null, nombre, rasgos, gama, descCorta, descatalogado: RE_FIN_EXISTENCIAS.test(p.descripcion) });
    const f = (informe.familias[p.familia] ||= { categoria: new Set(), kind: cat.kind, equipos: 0 });
    f.categoria.add(cat.categoria); f.equipos++;
  }

  // ---------- productos
  for (const e of equipos) {
    const { p, cat, refM, existente } = e;
    const base = { modelo: e.nombre, familia_proveedor: p.familia, origen_carga: ORIGEN_CARGA, short_description: e.descCorta, rasgos_identificacion: e.rasgos };
    if (!existente) {
      const fila = { manufacturer_id: osmo.id, supplier_reference: refM, name: e.nombre, kind: cat.kind, category_global_key: cat.categoria, is_active: true, descatalogado: e.descatalogado, ...base };
      for (const k of Object.keys(fila)) if (fila[k] === null || fila[k] === undefined) delete fila[k];
      plan.productosNuevos.push({ ref: p.ref, fila });
      informe.productos.crear.push({ ref: refM, nombre: e.nombre, rasgos: e.rasgos, categoria: cat.categoria, kind: cat.kind, descatalogado: e.descatalogado, descripcion: e.descCorta });
    } else {
      const rellenar = {};
      for (const [k, v] of Object.entries(base)) if (!vacio(v) && vacio(existente[k])) rellenar[k] = v;
      if (existente.category_global_key !== cat.categoria || existente.kind !== cat.kind) informe.avisos.push(`${refM}: ya existe en ${existente.category_global_key}/${existente.kind} (mapa: ${cat.categoria}/${cat.kind}); no se toca`);
      if (Object.keys(rellenar).length) { plan.productosCompletar.push({ ref: refM, id: existente.id, rellenar }); informe.productos.completar.push({ ref: refM, campos: Object.keys(rellenar) }); }
      else informe.productos.sin_cambios.push(refM);
    }
  }

  // ---------- gamas (solo cabezas que ya existen en el maestro o que se crean ahora por una propuesta aprobada)
  const refsNuevas = new Set(plan.productosNuevos.map((x) => lower(x.fila.supplier_reference)));
  for (const e of equipos) {
    if (!e.gama) continue;
    const cabM = refMaestro(e.gama);
    const cab = porRefBD.get(lower(cabM));
    const yo = e.existente;
    const motivo = (m) => { informe.gamas.conflictos.push(`${e.refM} → gama ${cabM}: ${m}; queda suelto`); };
    if (!cab && !refsNuevas.has(lower(cabM))) { motivo('la cabeza no existe en el maestro'); continue; }
    if (cab?.gama_id) { motivo('la cabeza ya es variante de otra gama'); continue; }
    if (yo?.gama_id && yo.gama_id !== cab?.id) { motivo('ya es variante de otra gama'); continue; }
    if (yo && conHijas.has(yo.id)) { motivo('tiene variantes propias'); continue; }
    if (yo?.gama_id && yo.gama_id === cab?.id) continue; // ya enganchada
    plan.gamas.push({ ref: e.refM, cabeza: cabM });
    informe.gamas.a_enlazar.push({ ref: e.refM, cabeza: cabM, modelo_cabeza: cab?.modelo || cab?.name || '(nueva)', nombre: e.nombre, rasgos: e.rasgos, categoria_cabeza: cab?.category_global_key || null, categoria: e.cat.categoria });
    if (cab && cab.category_global_key !== e.cat.categoria) informe.avisos.push(`${e.refM}: su categoría (${e.cat.categoria}) no es la de la cabeza ${cabM} (${cab.category_global_key})`);
  }

  // ---------- enlaces de recambio
  let enOrigen = 0, yaExisten = 0, repetidos = 0;
  const inexistentes = new Map();
  const vistos = new Set();
  const orden = new Map();
  const equipoValido = new Set(equipos.map((e) => lower(e.refM)));
  for (const p of PRODUCTOS) {
    if (!incluido(p.ref)) continue;
    const eq = refMaestro(p.ref);
    for (const r of p.recambios || []) {
      enOrigen++;
      if (!equipoValido.has(lower(eq))) continue; // excluido o saltado
      const k = `${lower(r.ref)}|${lower(eq)}`;
      if (vistos.has(k)) { repetidos++; continue; }
      vistos.add(k);
      const rec = porRefBD.get(lower(r.ref));
      if (!rec) { const x = inexistentes.get(r.ref) || { ref: r.ref, tipo: r.tipo, nombre: r.nombre, familia: r.familia, equipos: [] }; x.equipos.push(eq); inexistentes.set(r.ref, x); continue; }
      if (!['spare_part', 'consumable'].includes(rec.kind)) informe.avisos.push(`Recambio ${r.ref}: en el maestro es kind «${rec.kind}»; se enlaza igual`);
      const eqBD = porRefBD.get(lower(eq));
      if (eqBD && compatBD.has(`${rec.id}|${eqBD.id}`)) { yaExisten++; continue; }
      const n = orden.get(eq) || 0; orden.set(eq, n + 1);
      plan.enlaces.push({ recambio: rec.supplier_reference, equipo: eq, fila: { cantidad: null, display_order: n } });
    }
  }
  informe.recambios_inexistentes = [...inexistentes.values()];
  informe.enlaces = {
    en_origen: enOrigen, crear: plan.enlaces.length, ya_existen: yaExisten, repetidos_en_origen: repetidos,
    recambios_distintos: new Set(PRODUCTOS.flatMap((p) => (p.recambios || []).map((r) => lower(r.ref)))).size,
    recambios_inexistentes: inexistentes.size,
    equipos_con_recambios: PRODUCTOS.filter((p) => incluido(p.ref) && (p.recambios || []).length).length,
    por_equipo: Object.fromEntries([...orden].sort((a, b) => b[1] - a[1])),
  };

  // ---------- «Incompleto» (misma regla que fila-producto.tsx: sin miniatura o 0 atributos)
  for (const e of equipos) {
    const bd = e.existente;
    const tieneFoto = bd ? (conPrincipal.has(bd.id) || !vacio(bd.main_image_path)) : false;
    const atr = bd ? (nAtributos.get(bd.id) || 0) : 0;
    const motivos = [];
    if (!tieneFoto) motivos.push('sin foto principal');
    if (atr === 0) motivos.push('0 atributos');
    if (motivos.length) informe.incompletos.push(`${e.refM}: ${motivos.join(' y ')}`);
  }

  // ---------- comprobación previa
  for (const x of plan.productosNuevos) comprobarPayload('catalog_products', x.fila);
  for (const x of plan.productosCompletar) comprobarPayload('catalog_products', x.rellenar, { actualizaExistente: true });
  for (const x of plan.gamas) comprobarPayload('catalog_products', { gama_id: x.cabeza }, { actualizaExistente: true });
  for (const x of plan.enlaces) comprobarPayload('catalog_product_compatibilities', x.fila);
  informe.comprobacion_previa = { payloads: comprobaciones.payloads, fallos: comprobaciones.fallos.length, regla: 'ningún payload lleva version ni company_id; ninguna fila existente recibe name, kind, categoría, fabricante, is_active, main_image_path ni version; solo catalog_products y catalog_product_compatibilities' };

  informe.recuentos = {
    equipos_en_origen: PRODUCTOS.length,
    equipos_procesados: equipos.length,
    equipos_crear: plan.productosNuevos.length,
    equipos_ya_existentes: plan.productosCompletar.length + informe.productos.sin_cambios.length,
    equipos_completar: plan.productosCompletar.length,
    equipos_saltados: informe.productos.saltar.length,
    equipos_excluidos: informe.productos.excluidos.length,
    alias_aplicados: equipos.filter((e) => e.refM !== e.p.ref).map((e) => `${e.p.ref} -> ${e.refM}`),
    variantes_a_enlazar: plan.gamas.length,
    conflictos_de_gama: informe.gamas.conflictos.length,
    propuestas_de_gama_nueva: (MAPA.gamas_nuevas || []).length,
    propuestas_aprobadas: (MAPA.gamas_nuevas || []).filter((g) => g.aplicar === true).length,
    enlaces_recambio_en_origen: enOrigen,
    enlaces_recambio_crear: plan.enlaces.length,
    enlaces_recambio_ya_existen: yaExisten,
    recambios_inexistentes: inexistentes.size,
    descatalogados: equipos.filter((e) => e.descatalogado).length,
    incompletos: informe.incompletos.length,
    filas_catalog_products_tras_la_carga: estado.catalog_products.length + plan.productosNuevos.length,
  };
  return { plan, informe, porIdBD };
}

// ---------------------------------------------------------------- escritura (solo --aplicar)
async function aplicar(plan) {
  const sb = await clienteServicio();
  const ok = (error, que) => { if (error) salir(`${que}: ${error.message}`); };
  const res = {};
  const idsPorRef = async () => {
    const m = new Map();
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from('catalog_products').select('id, supplier_reference, gama_id').range(desde, desde + 999);
      ok(error, 'Leyendo catalog_products');
      for (const p of data) m.set(lower(p.supplier_reference), p);
      if (data.length < 1000) break;
    }
    return m;
  };

  // 1) productos: insert de uno en uno; si ya existe (unique lower(ref)), se salta
  let creados = 0, yaExistian = 0, rellenados = 0;
  for (const x of plan.productosNuevos) {
    const { error } = await sb.from('catalog_products').insert(x.fila);
    if (error && /duplicate|unique/i.test(error.message)) { yaExistian++; continue; }
    ok(error, `Crear ${x.fila.supplier_reference}`); creados++;
  }
  for (const x of plan.productosCompletar) for (const [k, v] of Object.entries(x.rellenar)) {
    const { data, error } = await sb.from('catalog_products').update({ [k]: v }).eq('id', x.id).or(`${k}.is.null,${k}.eq.`).select('id');
    ok(error, `Rellenar ${x.ref}.${k}`); rellenados += data.length;
  }
  res.productos = { creados, ya_existian: yaExistian, campos_rellenados: rellenados };

  // 2) gamas: solo si la variante aún no tiene gama
  let ids = await idsPorRef();
  let enlazadas = 0;
  for (const g of plan.gamas) {
    const yo = ids.get(lower(g.ref)); const cab = ids.get(lower(g.cabeza));
    if (!yo || !cab || cab.gama_id) continue;
    const { data, error } = await sb.from('catalog_products').update({ gama_id: cab.id }).eq('id', yo.id).is('gama_id', null).select('id');
    ok(error, `Gama de ${g.ref}`); enlazadas += data.length;
  }
  res.gamas = { variantes_enlazadas: enlazadas };

  // 3) enlaces de recambio: on conflict do nothing
  ids = await idsPorRef();
  const filas = plan.enlaces.map((x) => ({ spare_part_catalog_id: ids.get(lower(x.recambio))?.id, equipment_catalog_id: ids.get(lower(x.equipo))?.id, ...x.fila })).filter((f) => f.spare_part_catalog_id && f.equipment_catalog_id);
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb.from('catalog_product_compatibilities').upsert(filas.slice(i, i + 500), { onConflict: 'spare_part_catalog_id,equipment_catalog_id', ignoreDuplicates: true });
    ok(error, 'Enlaces');
  }
  res.enlaces = { enviados: filas.length, sin_id: plan.enlaces.length - filas.length };
  return res;
}

// ---------------------------------------------------------------- informe en Markdown
function informeMd(inf) {
  const L = [];
  const p = (s = '') => L.push(s);
  const lista = (arr) => { if (!arr.length) p('- (ninguno)'); arr.forEach((x) => p(`- ${x}`)); };
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
  p(`# Carga de los equipos residenciales nuevos de Osmofilter — ${inf.modo === 'seco' ? 'prueba en seco' : 'aplicada'}`);
  p();
  p(`Fecha: ${inf.fecha} · Origen: \`${inf.origen}\` (generado ${inf.generado_origen || '?'}) · Solo: ${inf.solo ? inf.solo.join(', ') : 'todo'}`);
  p();
  p(`Generado por \`scripts/catalogo-osmofilter/cargar-nuevos-residencial.mjs\` con \`nuevos-residencial-mapa.json\`. ${inf.modo === 'seco' ? 'En seco no se ha escrito nada: solo SELECT por la Management API.' : 'Escrito con service-role.'} origen_carga = \`${ORIGEN_CARGA}\`. Fabricante reutilizado: ${inf.fabricante.name} (${inf.fabricante.id}).`);
  p();
  p('## 1. Recuentos'); p();
  p('| Qué | N |'); p('|---|---|');
  for (const [k, v] of Object.entries(inf.recuentos)) p(`| ${k.replace(/_/g, ' ')} | ${Array.isArray(v) ? v.join(', ') || '—' : v} |`);
  p();
  p(`Comprobación previa: ${inf.comprobacion_previa.payloads} payloads revisados, ${inf.comprobacion_previa.fallos} fallos (${inf.comprobacion_previa.regla}).`);
  p();
  if (inf.resultado) { p('### Resultado de la escritura'); p(); p('```json'); p(JSON.stringify(inf.resultado, null, 2)); p('```'); p(); }
  p('## 2. Familia → categoría'); p();
  p('| Familia de Osmofilter | Categoría global | kind | Equipos |'); p('|---|---|---|---|');
  for (const [f, x] of Object.entries(inf.familias)) p(`| ${esc(f)} | ${[...x.categoria].join(', ')} | ${x.kind} | ${x.equipos} |`);
  p();
  p('Ósmosis doméstica por referencia (`por_ref` de mapa-familias.json): «5 Etapas» → osmosis_5_stages (RO1056, MI0006); ultrafiltración → filters (RO1070, RO1077); el resto → osmosis.');
  p();
  p('## 3. Equipos a crear'); p();
  p('| Ref | Nombre | Rasgos | Categoría | Fin de existencias | Descripción (short_description) |'); p('|---|---|---|---|---|---|');
  for (const x of inf.productos.crear) p(`| ${x.ref} | ${esc(x.nombre)} | ${esc(x.rasgos || '—')} | ${x.categoria} | ${x.descatalogado ? 'sí' : ''} | ${esc(x.descripcion)} |`);
  if (!inf.productos.crear.length) p('| — | | | | | |');
  p();
  p('### Ya existentes'); p();
  lista([...inf.productos.completar.map((x) => `${x.ref}: se rellenan ${x.campos.join(', ')}`), ...inf.productos.sin_cambios.map((r) => `${r}: sin cambios`)]);
  p();
  if (inf.productos.saltar.length || inf.productos.excluidos.length) {
    p('### Saltados o excluidos'); p();
    lista([...inf.productos.saltar.map((x) => `${x.ref}: ${x.motivo}`), ...inf.productos.excluidos.map((r) => `${r}: en «excluir»`)]);
    p();
  }
  p('## 4. Variantes de gamas que ya existen en el maestro'); p();
  p('Solo donde es evidente por el nombre. La cabeza no se toca; la ref nueva recibe `gama_id` y `rasgos_identificacion`.'); p();
  p('| Ref nueva | Gama (cabeza) | Nombre | Rasgos |'); p('|---|---|---|---|');
  for (const g of inf.gamas.a_enlazar) p(`| ${g.ref} | ${esc(g.modelo_cabeza)} (${g.cabeza}) | ${esc(g.nombre)} | ${esc(g.rasgos || '—')} |`);
  if (!inf.gamas.a_enlazar.length) p('| — | | | |');
  p();
  if (inf.gamas.conflictos.length) { p('### Conflictos'); p(); lista(inf.gamas.conflictos); p(); }
  p('### Gamas nuevas propuestas (solo entre refs nuevas; NO se aplican salvo «aplicar»: true en el mapa)'); p();
  for (const g of inf.gamas.propuestas) p(`- **${esc(g.modelo)}** (cabeza ${g.cabeza}) — ${g.aplicar ? 'SE APLICA' : 'no se aplica'}${g.motivo ? ' · ' + esc(g.motivo) : ''}: ${g.variantes.map(esc).join('; ')}`);
  if (!inf.gamas.propuestas.length) p('- (ninguna)');
  p();
  p('## 5. Enlaces de recambio (catalog_product_compatibilities)'); p();
  const en = inf.enlaces;
  p(`En el origen: ${en.en_origen} enlaces de ${en.equipos_con_recambios} equipos a ${en.recambios_distintos} recambios distintos. A crear: **${en.crear}**. Ya existían: ${en.ya_existen}. Repetidos en el origen: ${en.repetidos_en_origen}. Recambios que no existen en el maestro: **${en.recambios_inexistentes}**. \`cantidad\` va a null (el origen no la trae); insert con on conflict do nothing.`);
  p();
  p('| Equipo | Enlaces |'); p('|---|---|');
  for (const [k, v] of Object.entries(en.por_equipo)) p(`| ${k} | ${v} |`);
  p();
  p('### Recambios inexistentes'); p();
  lista(inf.recambios_inexistentes.map((r) => `${r.ref} (${r.tipo}) «${r.nombre}» — usado en ${r.equipos.join(', ')}`));
  p();
  p('## 6. «Incompleto» en el superadmin'); p();
  p('La fila de la lista (`fila-producto.tsx`) pone la píldora «Incompleto» si no hay miniatura o hay 0 atributos, y el filtro `?estado=incompletos` (`catalogo-lectura.ts`) busca `main_image_path is null` o sin filas en `catalog_product_attributes`. Estos equipos se crean sin fotos y sin atributos, así que salen como incompletos en la lista y en el filtro.');
  p();
  p('La ficha de lectura (`/superadmin/catalogo/productos/[id]`) NO tiene insignia «Incompleto»: se ve que no hay galería ni características, pero no lo dice con una etiqueta. No se usa `cambios_sin_publicar` (significa «ediciones guardadas sin publicar a las empresas» y dispararía otra cosa) ni se crea esquema.');
  p();
  p(`Quedan incompletos: ${inf.incompletos.length} de ${inf.recuentos.equipos_procesados}.`);
  p();
  p('<details><summary>Lista</summary>'); p(); lista(inf.incompletos); p(); p('</details>');
  p();
  p('## 7. Dudas para Mario'); p();
  lista(inf.dudas);
  p();
  p('## 8. Avisos'); p();
  lista(inf.avisos);
  p();
  return L.join('\n');
}

// ---------------------------------------------------------------- main
async function main() {
  log(`Carga residencial Osmofilter · modo ${APLICAR ? 'APLICAR (escribe)' : 'en seco (no escribe nada)'}`);
  const estado = await leerEstado();
  log(`Estado: ${estado.catalog_products.length} productos maestros`);
  const { plan, informe } = construirPlan(estado);
  if (APLICAR) informe.resultado = await aplicar(plan);

  const dirInf = path.join(AQUI, 'informes');
  fs.mkdirSync(dirInf, { recursive: true });
  const sello = informe.fecha.replace(/[:.]/g, '-');
  const base = path.join(dirInf, `${sello}-residencial-${informe.modo}`);
  fs.writeFileSync(base + '.json', JSON.stringify(informe, (k, v) => (v instanceof Set ? [...v] : v), 2));
  fs.writeFileSync(base + '.md', informeMd(informe));
  log(JSON.stringify(informe.recuentos, null, 2));
  log(`Informe: ${base}.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
