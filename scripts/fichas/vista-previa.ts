/**
 * Vista previa LOCAL de las fichas técnicas nuevas con datos reales de
 * producción, en SOLO LECTURA (solo SELECT y URLs firmadas de lectura).
 *
 *   npx vite-node --config scripts/fichas/vite.config.mts scripts/fichas/vista-previa.ts
 *
 * Genera en .revision-fichas/ un PDF por producto y plantilla (Tarifa,
 * Escaparate, Placa) con la paleta de la marca de la empresa, y una captura
 * PNG de la primera hoja (pdftoppm).
 *
 * --simular-maestro: aplica EN MEMORIA lo que haría
 * supabase/datos/20261127_infinity_valores_maestro.sql (valores del maestro,
 * propios duplicados ocultos, medidas y peso del maestro), para ver la ficha
 * como quedará. No escribe nada.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { generarFichaConCliente } from "../../src/modules/products/ficha/generar-ficha";
import { PLANTILLAS_NUEVAS } from "../../src/modules/products/ficha/modelo";
import type { CaracteristicaEmpresa } from "../../src/modules/products/productos-vista";

const RAIZ = path.resolve(__dirname, "../..");
const SALIDA = path.join(RAIZ, ".revision-fichas");

function leerEnv(): Record<string, string> {
  const txt = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const out: Record<string, string> = {};
  for (const l of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m) out[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  return out;
}

const PRODUCTOS: Array<{ id: string; archivo: string }> = [
  { id: "c64e6cc1-49ec-4175-80bb-52d125b5d06d", archivo: "infinity-indic" },
  { id: "4a44b563-9443-4678-ac73-1cac9c90baad", archivo: "infinity-basic-s-compact" },
  { id: "68aae429-02d8-461d-8c01-4504beb1f8b5", archivo: "grifo-zagreb" },
];

/** Corrección del maestro que trae el SQL (paso 0): Osmofilter da 3,5 L en FRO1046. */
const CORRECCION_MAESTRO: Record<string, Record<string, number>> = {
  FRO1046: { dispenser_cold_tank_l: 3.5 },
};
/** Propios que chocan con uno del maestro (paso 2 del SQL): se ocultan. */
const CHOQUES: Array<{ propio: RegExp; maestro: string }> = [
  { propio: /^(dispenser|common)_voltage_v$/, maestro: "common_power_supply" },
  { propio: /^(dispenser|common)_frequency_hz$/, maestro: "common_power_supply" },
  { propio: /^[0-9]_vias$/, maestro: "tap_ways" },
];

async function main() {
  const simular = process.argv.includes("--simular-maestro");
  const env = leerEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  fs.mkdirSync(SALIDA, { recursive: true });
  const informe: string[] = [
    `Fichas generadas el ${new Date().toLocaleString("es-ES")} con datos de producción (solo lectura).`,
    simular
      ? "OJO: valores SIMULADOS en memoria como si se hubiera aplicado supabase/datos/20261127_infinity_valores_maestro.sql (ver «Simulado en memoria»)."
      : "Datos tal cual están hoy en producción.",
    "Paleta: «Marca sola» desde companies.primary_color (lo que sale sin migración ni paleta guardada).",
    "",
  ];

  for (const prod of PRODUCTOS) {
    // Lo del maestro, para la simulación (solo lectura).
    const cambios: string[] = [];
    let maestroVals = new Map<string, { t: string | null; n: number | null; b: boolean | null }>();
    let maestroMedidas: Record<string, number | null> = {};
    if (simular) {
      const { data: p } = await sb.from("products").select("catalog_product_id").eq("id", prod.id).maybeSingle();
      const cpId = (p as { catalog_product_id: string | null } | null)?.catalog_product_id;
      if (cpId) {
        const { data: cp } = await sb
          .from("catalog_products")
          .select("supplier_reference, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams")
          .eq("id", cpId)
          .maybeSingle();
        const { data: av } = await sb
          .from("catalog_product_attributes")
          .select("attribute_global_key, value_text, value_number, value_boolean")
          .eq("catalog_product_id", cpId);
        const correccion = CORRECCION_MAESTRO[(cp as { supplier_reference: string } | null)?.supplier_reference ?? ""] ?? {};
        maestroVals = new Map(
          ((av ?? []) as Array<{ attribute_global_key: string; value_text: string | null; value_number: number | null; value_boolean: boolean | null }>).map(
            (a) => [
              a.attribute_global_key,
              {
                t: a.value_text,
                n: correccion[a.attribute_global_key] ?? (a.value_number != null ? Number(a.value_number) : null),
                b: a.value_boolean,
              },
            ],
          ),
        );
        maestroMedidas = (cp ?? {}) as Record<string, number | null>;
      }
    }

    for (const plantilla of PLANTILLAS_NUEVAS) {
      const r = await generarFichaConCliente(sb, prod.id, {
        plantilla,
        simular: simular
          ? ({ producto, caracteristicas }) => {
              const claves = new Set(caracteristicas.filter((c) => c.visible).map((c) => c.clave));
              for (const c of caracteristicas as CaracteristicaEmpresa[]) {
                const m = maestroVals.get(c.clave);
                if (m) {
                  const antes = c.valorBooleano ?? c.valorNumero ?? c.valorTexto;
                  const distinto =
                    (m.b ?? null) !== (c.valorBooleano ?? null) ||
                    (m.n ?? null) !== (c.valorNumero != null ? Number(c.valorNumero) : null) ||
                    (m.t ?? null) !== (c.valorTexto ?? null);
                  if (distinto) {
                    c.valorBooleano = m.b;
                    c.valorNumero = m.n;
                    c.valorTexto = m.t;
                    if (plantilla === "tarifa") cambios.push(`${c.nombre}: ${antes} → ${m.b ?? m.n ?? m.t}`);
                  }
                }
                for (const ch of CHOQUES) {
                  if (ch.propio.test(c.clave) && claves.has(ch.maestro) && c.visible) {
                    c.visible = false;
                    if (plantilla === "tarifa") cambios.push(`${c.nombre} (${c.valorNumero ?? c.valorTexto}): oculta, la cubre ${ch.maestro}`);
                  }
                }
              }
              const dims: Array<[keyof typeof producto, string]> = [
                ["dim_width_mm", "Ancho"],
                ["dim_height_mm", "Alto"],
                ["dim_depth_mm", "Fondo"],
                ["weight_grams", "Peso (g)"],
              ];
              for (const [k, nombre] of dims) {
                const v = maestroMedidas[k as string];
                if (v != null && Number(v) > 0 && Number(producto[k]) !== Number(v)) {
                  if (plantilla === "tarifa") cambios.push(`${nombre}: ${producto[k]} → ${v}`);
                  (producto as unknown as Record<string, unknown>)[k] = Number(v);
                }
              }
            }
          : undefined,
      });
      const base = `${prod.archivo}-${plantilla}`;
      const pdfRuta = path.join(SALIDA, `${base}.pdf`);
      fs.writeFileSync(pdfRuta, r.bytes);
      try {
        execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", pdfRuta, path.join(SALIDA, base)]);
      } catch (e) {
        console.error("pdftoppm:", e instanceof Error ? e.message : e);
      }
      const hojas = (await PDFDocument.load(r.bytes)).getPageCount();
      informe.push(
        `${base}.pdf · ${hojas} hoja(s) · ${r.modelo.bloques.reduce((a, b) => a + b.filas.length, 0)} filas · ${r.modelo.ventajas.length} ventajas · ${r.modelo.recambios.length} recambios · ref: ${r.modelo.referencia ?? "(ninguna)"} · primario ${r.paleta.primario} acento ${r.paleta.acento}`,
      );
      console.log(informe[informe.length - 1]);
    }
    if (cambios.length) {
      informe.push(`  Simulado en memoria (${prod.archivo}):`);
      for (const c of cambios) informe.push(`    - ${c}`);
    }
  }
  fs.writeFileSync(path.join(SALIDA, "LEEME.txt"), informe.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
