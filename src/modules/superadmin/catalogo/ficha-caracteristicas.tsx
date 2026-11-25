import { formatearNumero } from "./catalogo-etiquetas";

/**
 * Características del producto en cuatro bloques (Físicas, Eléctricas,
 * Técnicas, Extra). Los pares mín./máx. van en una fila («Presión de trabajo:
 * 2–6 bar»). Un bloque sin datos no se pinta. Tabla de dos columnas
 * etiqueta / valor, sin desplazamiento lateral.
 *
 * Sin datos de la base: recibe atributos ya leídos, para poder usarse también
 * en la ficha de la empresa.
 */

export interface AtributoVista {
  clave: string;
  nombre: string;
  /** fisicas | electricas | tecnicas | extra. Null se pinta en Técnicas. */
  grupo: string | null;
  unidad: string | null;
  tipoDato: string;
  valorTexto: string | null;
  valorNumero: number | null;
  valorBooleano: boolean | null;
  orden: number;
}

export interface FilaCaracteristica {
  etiqueta: string;
  valor: string;
}

export interface BloqueCaracteristicas {
  clave: "fisicas" | "electricas" | "tecnicas" | "extra";
  titulo: string;
  filas: FilaCaracteristica[];
}

const BLOQUES: Array<{ clave: BloqueCaracteristicas["clave"]; titulo: string }> = [
  { clave: "fisicas", titulo: "Físicas" },
  { clave: "electricas", titulo: "Eléctricas" },
  { clave: "tecnicas", titulo: "Técnicas" },
  { clave: "extra", titulo: "Extra" },
];

const RE_MIN_MAX = /^(.*?)\s+(m[ií]n(?:ima|imo)?|m[aá]x(?:ima|imo)?)\.?$/i;

function conUnidad(valor: string, unidad: string | null): string {
  if (!unidad) return valor;
  const v = valor.trim();
  if (v.toLowerCase().endsWith(unidad.toLowerCase())) return v;
  return `${v} ${unidad}`;
}

function valorCrudo(a: AtributoVista): string | null {
  if (a.valorBooleano != null) return a.valorBooleano ? "Sí" : "No";
  if (a.valorNumero != null) return formatearNumero(Number(a.valorNumero));
  const t = a.valorTexto?.trim();
  return t ? t : null;
}

function valorConUnidad(a: AtributoVista): string | null {
  const v = valorCrudo(a);
  if (v == null) return null;
  if (a.valorBooleano != null) return v;
  return conUnidad(v, a.unidad);
}

/** Convierte atributos en bloques, uniendo los pares mínimo / máximo. */
export function agruparCaracteristicas(
  atributos: AtributoVista[],
  fisicasExtra: FilaCaracteristica[] = [],
): BloqueCaracteristicas[] {
  const porBloque = new Map<string, AtributoVista[]>();
  for (const a of [...atributos].sort((x, y) => x.orden - y.orden)) {
    const g = a.grupo && BLOQUES.some((b) => b.clave === a.grupo) ? a.grupo : "tecnicas";
    if (!porBloque.has(g)) porBloque.set(g, []);
    porBloque.get(g)!.push(a);
  }

  return BLOQUES.map(({ clave, titulo }) => {
    const lista = porBloque.get(clave) ?? [];
    // Emparejar mín./máx. por nombre base + unidad.
    const pares = new Map<string, { min?: AtributoVista; max?: AtributoVista }>();
    for (const a of lista) {
      const m = a.nombre.match(RE_MIN_MAX);
      if (!m) continue;
      const k = `${(m[1] ?? "").trim().toLowerCase()}|${a.unidad ?? ""}`;
      const esMin = /^m[ií]n/i.test(m[2] ?? "");
      const p = pares.get(k) ?? {};
      if (esMin) p.min = a;
      else p.max = a;
      pares.set(k, p);
    }
    const hechos = new Set<string>();
    const filas: FilaCaracteristica[] = clave === "fisicas" ? [...fisicasExtra] : [];
    for (const a of lista) {
      if (hechos.has(a.clave)) continue;
      const m = a.nombre.match(RE_MIN_MAX);
      const k = m ? `${(m[1] ?? "").trim().toLowerCase()}|${a.unidad ?? ""}` : null;
      const par = k ? pares.get(k) : undefined;
      if (m && par?.min && par?.max) {
        const vMin = valorCrudo(par.min);
        const vMax = valorCrudo(par.max);
        hechos.add(par.min.clave);
        hechos.add(par.max.clave);
        if (vMin == null && vMax == null) continue;
        const rango = vMin != null && vMax != null ? `${vMin}–${vMax}` : (vMin ?? vMax)!;
        filas.push({ etiqueta: (m[1] ?? "").trim(), valor: conUnidad(rango, a.unidad) });
        continue;
      }
      hechos.add(a.clave);
      const v = valorConUnidad(a);
      if (v != null) filas.push({ etiqueta: a.nombre, valor: v });
    }
    return { clave, titulo, filas };
  }).filter((b) => b.filas.length > 0);
}

export function TablaCaracteristicas({
  bloque,
  imagenMedidas,
}: {
  bloque: BloqueCaracteristicas;
  /** Dibujo con las cotas a/b/c, junto a las físicas. */
  imagenMedidas?: string | null;
}) {
  const tabla = (
    <dl className="divide-y text-sm">
      {bloque.filas.map((f, i) => (
        <div key={`${f.etiqueta}-${i}`} className="grid grid-cols-2 gap-3 py-2">
          <dt className="min-w-0 break-words text-muted-foreground">{f.etiqueta}</dt>
          <dd className="min-w-0 break-words text-right font-medium">{f.valor}</dd>
        </div>
      ))}
    </dl>
  );
  if (bloque.clave !== "fisicas" || !imagenMedidas) return tabla;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start">
      {tabla}
      <div className="order-first overflow-hidden rounded-lg border bg-card sm:order-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagenMedidas}
          alt="Medidas: cotas a, b y c"
          loading="lazy"
          className="mx-auto max-h-56 w-full object-contain p-2"
        />
      </div>
    </div>
  );
}

/** Todos los bloques seguidos (vista de escritorio). */
export function FichaCaracteristicas({
  bloques,
  imagenMedidas,
}: {
  bloques: BloqueCaracteristicas[];
  imagenMedidas?: string | null;
}) {
  if (bloques.length === 0) return null;
  return (
    <div className="space-y-6">
      {bloques.map((b) => (
        <section key={b.clave} aria-labelledby={`caract-${b.clave}`}>
          <h3 id={`caract-${b.clave}`} className="mb-1 text-sm font-bold">
            {b.titulo} <span className="font-normal text-muted-foreground">· {b.filas.length}</span>
          </h3>
          <TablaCaracteristicas bloque={b} imagenMedidas={imagenMedidas} />
        </section>
      ))}
    </div>
  );
}
