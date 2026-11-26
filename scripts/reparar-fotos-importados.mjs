#!/usr/bin/env node
// Reparar las FOTOS de los productos ya importados del catálogo maestro (2026-11-26).
//
//   node scripts/reparar-fotos-importados.mjs            → EN SECO: solo cuenta y lista
//   node scripts/reparar-fotos-importados.mjs --aplicar  → copia de verdad
//   --empresa=<uuid>  limita a una empresa · --producto=<uuid> limita a un producto
//
// Por qué: los 14 productos enganchados al maestro se importaron entre junio y
// agosto, cuando su maestro tenía UNA foto. El 25-11 el maestro recibió todas las
// de Osmofilter (principal, ficha, ambiente, medidas, banner, proyecciones…) sin
// subir `version`, y la importación antigua tampoco copiaba el tipo de foto. Por
// eso en la empresa sale una foto y en el maestro 9-14.
//
// Qué hace (idempotente, mismo criterio que copyPhotos de
// src/modules/products/catalog-copy-helpers.ts):
//   - Copia cada foto del maestro de catalog-global (privado) a product-images
//     (público) en «<empresa>/<producto>/m-<id foto maestro>.<ext>» y crea su fila
//     en product_images con tipo_foto, alt_text y medidas.
//   - Se salta la que ya esté copiada (misma ruta) y las que el maestro ya tenía
//     al importar (creadas antes que el producto), que la importación antigua
//     copió como «0.png».
//   - NO borra ni cambia ninguna foto de la empresa. La principal de la empresa
//     sigue siendo la suya; solo si el producto no tiene ninguna, la principal
//     del maestro pasa a serlo (y a main_image_url).
// No toca nombres, precios, descripciones, características ni documentos.
//
// DESHACER: borrar las filas de product_images cuyo storage_path contenga «/m-»
// de esos productos y sus ficheros en product-images (el informe las lista).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APLICAR = process.argv.includes('--aplicar');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? null;
const SOLO_EMPRESA = arg('empresa');
const SOLO_PRODUCTO = arg('producto');

function leerEnv() {
  const f = path.join(RAIZ, '.env.local');
  const env = {};
  if (!fs.existsSync(f)) return env;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = { ...leerEnv(), ...process.env };
const URL_SB = ENV.NEXT_PUBLIC_SUPABASE_URL;
const CLAVE = ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !CLAVE) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
const sb = createClient(URL_SB, CLAVE, { auth: { persistSession: false, autoRefreshToken: false } });

const ORIGEN = 'catalog-global';
const DESTINO = 'product-images';
const TIPOS = new Set(['principal', 'ambiente', 'medidas', 'ficha', 'banner', 'proyeccion', 'detalle', 'despiece']);
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif' };
const RE_COPIA_ANTIGUA = /\/\d+\.[a-z0-9]+$/i;

function falla(msg, error) {
  if (error) throw new Error(`${msg}: ${error.message}`);
}

async function main() {
  console.log(APLICAR ? '== APLICANDO ==' : '== EN SECO (añade --aplicar para copiar) ==');
  let q = sb
    .from('products')
    .select('id, name, company_id, catalog_product_id, created_at, main_image_url')
    .not('catalog_product_id', 'is', null)
    .is('deleted_at', null)
    .order('company_id')
    .order('name');
  if (SOLO_EMPRESA) q = q.eq('company_id', SOLO_EMPRESA);
  if (SOLO_PRODUCTO) q = q.eq('id', SOLO_PRODUCTO);
  const { data: productos, error } = await q;
  falla('Productos', error);

  const resumen = [];
  for (const p of productos ?? []) {
    const [{ data: fotos, error: e1 }, { data: ya, error: e2 }] = await Promise.all([
      sb
        .from('catalog_product_photos')
        .select('id, storage_path, is_main, display_order, tipo_foto, alt_text, width_px, height_px, created_at')
        .eq('catalog_product_id', p.catalog_product_id)
        .order('is_main', { ascending: false })
        .order('display_order'),
      sb.from('product_images').select('storage_path, is_main').eq('product_id', p.id),
    ]);
    falla(`Fotos del maestro de ${p.name}`, e1);
    falla(`Fotos de ${p.name}`, e2);
    const rutas = new Set((ya ?? []).map((f) => f.storage_path));
    let tienePrincipal = (ya ?? []).some((f) => f.is_main);
    let tieneUrl = !!p.main_image_url;
    const copiaAntigua = (ya ?? []).some((f) => RE_COPIA_ANTIGUA.test(f.storage_path));

    const fila = { empresa: p.company_id, producto: p.name, id: p.id, maestro: (fotos ?? []).length, ya: 0, nuevas: 0, fallos: 0, tipos: {} };
    for (const f of fotos ?? []) {
      const ext = (f.storage_path.split('.').pop() || 'jpg').toLowerCase();
      const destino = `${p.company_id}/${p.id}/m-${f.id}.${ext}`;
      const antes = copiaAntigua && f.created_at && Date.parse(f.created_at) < Date.parse(p.created_at);
      if (rutas.has(destino) || antes) {
        fila.ya += 1;
        continue;
      }
      const tipo = f.tipo_foto && TIPOS.has(f.tipo_foto) ? f.tipo_foto : null;
      fila.tipos[tipo ?? 'sin tipo'] = (fila.tipos[tipo ?? 'sin tipo'] ?? 0) + 1;
      if (!APLICAR) {
        fila.nuevas += 1;
        continue;
      }
      try {
        const { data: blob, error: eD } = await sb.storage.from(ORIGEN).download(f.storage_path);
        falla('Descarga', eD);
        const buf = Buffer.from(await blob.arrayBuffer());
        const { error: eU } = await sb.storage
          .from(DESTINO)
          .upload(destino, buf, { contentType: blob.type || MIME[ext] || 'image/jpeg', upsert: true });
        falla('Subida', eU);
        const principal = !!f.is_main && !tienePrincipal;
        const { error: eI } = await sb.from('product_images').insert({
          company_id: p.company_id,
          product_id: p.id,
          storage_path: destino,
          is_main: principal,
          display_order: f.display_order,
          tipo_foto: tipo,
          alt_text: f.alt_text,
          width_px: f.width_px,
          height_px: f.height_px,
        });
        falla('Fila', eI);
        rutas.add(destino);
        fila.nuevas += 1;
        if (principal) {
          tienePrincipal = true;
          if (!tieneUrl) {
            const url = sb.storage.from(DESTINO).getPublicUrl(destino).data.publicUrl;
            const { error: eP } = await sb.from('products').update({ main_image_url: url }).eq('id', p.id);
            falla('main_image_url', eP);
            tieneUrl = true;
          }
        }
      } catch (e) {
        fila.fallos += 1;
        console.error(`  ✗ ${p.name} · ${f.storage_path}: ${e.message}`);
      }
    }
    resumen.push(fila);
    console.log(
      `${p.name} — maestro ${fila.maestro}, ya estaban ${fila.ya}, ${APLICAR ? 'copiadas' : 'a copiar'} ${fila.nuevas}` +
        (fila.fallos ? `, fallos ${fila.fallos}` : '') +
        (fila.nuevas ? ` · ${Object.entries(fila.tipos).map(([t, n]) => `${t} ${n}`).join(', ')}` : ''),
    );
  }
  const total = resumen.reduce((s, r) => s + r.nuevas, 0);
  console.log(`\nTotal ${APLICAR ? 'copiadas' : 'a copiar'}: ${total} fotos en ${resumen.length} productos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
