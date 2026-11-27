import { describe, expect, it } from "vitest";
import { contraste } from "@/modules/products/ficha/paleta";
import {
  cartaFinal,
  cartaPorDefecto,
  derivarPaletaPropuesta,
  enlaceWaMe,
  esAgenteAutomatico,
  esCodigoValido,
  estadoPropuesta,
  euros,
  fechaCorta,
  fechaLarga,
  fechaSello,
  filasDatos,
  formatoGarantia,
  formatoMedidas,
  generarCodigo,
  hashVisitante,
  hayPrecios,
  leerLineas,
  leerPulso,
  limpiarTextoPdf,
  lineaDesdeProducto,
  lineasQueIncluye,
  nombreFicheroPdf,
  recortarPorFrase,
  referenciaDe,
  referenciaEnTexto,
  textoPedirActualizada,
  textoQueMeLlameis,
  type PlanLista,
  type ProductoLista,
} from "./propuesta-logica";

describe("código público", () => {
  it("12 caracteres base32 minúscula y distintos entre sí", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generarCodigo();
      expect(esCodigoValido(c), c).toBe(true);
      vistos.add(c);
    }
    expect(vistos.size).toBe(500);
  });

  it("usa 60 bits: todo ceros → «aaaaaaaaaaaa», todo unos → «777777777777»", () => {
    expect(generarCodigo(() => new Uint8Array(8))).toBe("aaaaaaaaaaaa");
    expect(generarCodigo(() => new Uint8Array(8).fill(255))).toBe("777777777777");
  });

  it("rechaza lo que no es un código", () => {
    for (const v of ["", "ABCDEFGHIJKL", "abcdefghijk", "abcdefghijk1", "abcdefghijklm", null, 12]) {
      expect(esCodigoValido(v)).toBe(false);
    }
  });

  it("la referencia son los seis primeros en mayúscula y se reconoce en el texto del wa.me", () => {
    const c = "k7m2q4abcdef";
    const ref = referenciaDe(c);
    expect(ref).toBe("K7M2Q4");
    expect(referenciaEnTexto(textoQueMeLlameis("Ca'n Toni", ref))).toBe("k7m2q4");
    expect(referenciaEnTexto(textoPedirActualizada("caducada", "Ca'n Toni", ref))).toBe("k7m2q4");
    expect(referenciaEnTexto("hola, ref K7M2Q4 por favor")).toBe("k7m2q4");
    expect(referenciaEnTexto("Hola, ¿cuánto cuesta?")).toBeNull();
    expect(referenciaEnTexto("referencia del pedido 123")).toBeNull();
    expect(referenciaEnTexto(null)).toBeNull();
  });
});

describe("estado", () => {
  const ahora = new Date("2026-11-27T12:00:00Z");
  it("válida, caducada y revocada", () => {
    expect(estadoPropuesta({ caduca_at: "2026-12-27T12:00:00Z", revocada_at: null }, ahora)).toBe("valida");
    expect(estadoPropuesta({ caduca_at: "2026-11-27T12:00:00Z", revocada_at: null }, ahora)).toBe("caducada");
    expect(estadoPropuesta({ caduca_at: "2026-12-27T12:00:00Z", revocada_at: "2026-11-27T10:00:00Z" }, ahora)).toBe("revocada");
  });
});

describe("fechas en hora de Madrid", () => {
  it("formatos del sello, la casilla y el texto", () => {
    // 23:30 UTC del 26 ya es día 27 en Madrid.
    const d = "2026-12-26T23:30:00Z";
    expect(fechaCorta(d)).toBe("27-12-2026");
    expect(fechaSello(d)).toBe("27 DIC 2026");
    expect(fechaLarga(d)).toBe("27 de diciembre de 2026");
  });
});

const producto: ProductoLista = {
  id: "p1",
  name: "  Osmosis   compacta ",
  short_description: "Agua filtrada en el grifo.",
  marketing_claim: "Sin garrafas",
  main_image_url: "https://x.supabase.co/storage/v1/object/public/product-images/a.webp",
  dim_width_mm: 260,
  dim_depth_mm: 455,
  dim_height_mm: 410,
  warranty_months_general: 24,
};

const plan = (o: Partial<PlanLista>): PlanLista => ({
  product_id: "p1",
  plan_type: "rental",
  duration_months: null,
  display_order: 0,
  monthly_price_cents: null,
  total_price_cents: null,
  monthly_price_individual_cents: null,
  total_price_individual_cents: null,
  monthly_price_business_cents: null,
  total_price_business_cents: null,
  ...o,
});

describe("líneas (lista blanca)", () => {
  it("sin tipos de precio no lleva precios", () => {
    const l = lineaDesdeProducto(producto, [plan({ monthly_price_business_cents: 2900 })], []);
    expect(l.precios).toEqual([]);
    expect(l.nombre).toBe("Osmosis compacta");
    expect(hayPrecios([l], true)).toBe(false);
  });

  it("precio de empresa: base + IVA; sin él, el de particular con IVA incluido", () => {
    const l = lineaDesdeProducto(
      producto,
      [
        plan({ plan_type: "rental", monthly_price_business_cents: 2900, monthly_price_individual_cents: 3509 }),
        plan({ plan_type: "cash", total_price_individual_cents: 119000, total_price_cents: 119000 }),
      ],
      ["rental", "cash"],
    );
    expect(l.precios).toEqual([
      { tipo: "rental", mensual_cents: 2900, total_cents: null, meses: null, mas_iva: true },
      { tipo: "cash", mensual_cents: null, total_cents: 119000, meses: null, mas_iva: false },
    ]);
    const filas = filasDatos(l, true);
    expect(filas.map((f) => f.rotulo)).toEqual(["medidas", "garantía", "alquiler", "compra"]);
    expect(filas[2]!.valor).toBe("29,00 €/mes + IVA");
    expect(filas[3]!.valor).toBe("1.190,00 €, IVA incluido");
    // Con los precios apagados, las filas de precio no existen.
    expect(filasDatos(l, false).map((f) => f.rotulo)).toEqual(["medidas", "garantía"]);
  });

  it("el primer plan del tipo por display_order", () => {
    const l = lineaDesdeProducto(
      producto,
      [
        plan({ plan_type: "renting", display_order: 2, duration_months: 60, monthly_price_business_cents: 1500 }),
        plan({ plan_type: "renting", display_order: 1, duration_months: 36, monthly_price_business_cents: 2200 }),
      ],
      ["renting"],
    );
    expect(l.precios[0]).toMatchObject({ mensual_cents: 2200, meses: 36 });
    expect(filasDatos(l, true)[2]!.valor).toBe("22,00 €/mes + IVA · 36 meses");
  });

  it("nunca deja pasar costes ni márgenes, aunque lleguen en el objeto", () => {
    const sucio = { ...producto, cost_cents: 1, margin_cents: 2, supplier_price_cents: 3, manufacturer_name: "X" } as ProductoLista;
    const planSucio = { ...plan({ monthly_price_business_cents: 2900 }), min_authorized_cents: 9, absolute_min_cents: 8 } as PlanLista;
    const json = JSON.stringify(lineaDesdeProducto(sucio, [planSucio], ["rental"]));
    for (const k of ["cost", "margin", "supplier", "manufacturer", "min_authorized", "absolute_min"]) {
      expect(json).not.toContain(k);
    }
  });

  it("leerLineas es tolerante con basura", () => {
    expect(leerLineas(null)).toEqual([]);
    expect(leerLineas([null, 3, { nombre: "A", precios: [{ tipo: "otro" }] }])).toEqual([
      { product_id: "", nombre: "A", descripcion: null, lema: null, imagen_url: null, medidas: null, garantia_meses: null, precios: [] },
    ]);
  });
});

describe("formato", () => {
  it("medidas en cm con coma, solo las cotas que hay", () => {
    expect(formatoMedidas({ ancho_mm: 260, fondo_mm: 455, alto_mm: 410 })).toEqual({
      valor: "26 × 45,5 × 41 cm",
      leyenda: "ancho × fondo × alto",
    });
    expect(formatoMedidas({ ancho_mm: 260, fondo_mm: null, alto_mm: 410 })).toEqual({ valor: "26 × 41 cm", leyenda: "ancho × alto" });
    expect(formatoMedidas({ ancho_mm: null, fondo_mm: null, alto_mm: null })).toBeNull();
  });

  it("garantía y euros", () => {
    expect(formatoGarantia(24)).toBe("2 años");
    expect(formatoGarantia(12)).toBe("1 año");
    expect(formatoGarantia(18)).toBe("18 meses");
    expect(formatoGarantia(null)).toBeNull();
    expect(euros(119000)).toBe("1.190,00 €");
    expect(euros(2900)).toBe("29,00 €");
    expect(euros(123456789)).toBe("1.234.567,89 €");
  });
});

describe("textos", () => {
  it("carta por defecto según el número de equipos", () => {
    expect(cartaPorDefecto(1)).toContain("Este es el equipo");
    expect(cartaPorDefecto(3)).toContain("los tres equipos");
    expect(cartaPorDefecto(3).length).toBeLessThanOrEqual(280);
  });

  it("carta de campaña con {{negocio}} y recorte por frase", () => {
    expect(cartaFinal("Hola {{ negocio }}. Mirad esto.", "Ca'n Toni", 2)).toBe("Hola Ca'n Toni. Mirad esto.");
    expect(cartaFinal("   ", "X", 2)).toBe(cartaPorDefecto(2));
    const larga = `${"Frase corta. ".repeat(30)}`;
    const r = cartaFinal(larga, "X", 1);
    expect(r.length).toBeLessThanOrEqual(280);
    expect(r.endsWith(".")).toBe(true);
    expect(r).not.toContain("…");
  });

  it("recortarPorFrase sin puntos suspensivos", () => {
    expect(recortarPorFrase("Una. Dos. Tres.", 10)).toBe("Una. Dos.");
    expect(recortarPorFrase("palabra ".repeat(10), 20)).toMatch(/^[a-z ]+\.$/);
  });

  it("qué incluye: sin rayas, como mucho cuatro", () => {
    expect(lineasQueIncluye("— Instalación\n- Mantenimiento\n\n• Filtros\n* Uno\nCinco")).toEqual([
      "Instalación",
      "Mantenimiento",
      "Filtros",
      "Uno",
    ]);
    expect(lineasQueIncluye(null)).toEqual([]);
  });

  it("wa.me con el número de captación", () => {
    expect(enlaceWaMe("+34 682 66 37 97", "Hola, ¿qué tal?")).toBe("https://wa.me/34682663797?text=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F");
    expect(enlaceWaMe(null, "x")).toBeNull();
  });

  it("el PDF quita los emoji y conserva ’ y ·", () => {
    expect(limpiarTextoPdf("Ca’n Pastil·la 🍕")).toBe("Ca’n Pastil·la");
    expect(limpiarTextoPdf("Es Molí d’en Sopa")).toBe("Es Molí d’en Sopa");
    expect(limpiarTextoPdf("Bar 👨‍👩‍👧 Pepe")).toBe("Bar Pepe");
    expect(limpiarTextoPdf("中文")).toBe("");
    expect(nombreFicheroPdf("Restaurante Ca'n Toni")).toBe("Propuesta Restaurante Ca'n Toni.pdf");
    expect(nombreFicheroPdf("A/B: C?")).toBe("Propuesta A B C.pdf");
    expect(nombreFicheroPdf("🍕")).toBe("Propuesta de equipos.pdf");
  });
});

describe("visitas", () => {
  it("hash estable, de 64 hex, y distinto por día", () => {
    const a = hashVisitante("1.2.3.4", "UA", "2026-11-27", "sal");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVisitante("1.2.3.4", "UA", "2026-11-27", "sal")).toBe(a);
    expect(hashVisitante("1.2.3.4", "UA", "2026-11-28", "sal")).not.toBe(a);
    expect(a).not.toContain("1.2.3.4");
  });

  it("la vista previa de WhatsApp y los bots no cuentan", () => {
    expect(esAgenteAutomatico("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(esAgenteAutomatico("facebookexternalhit/1.1")).toBe(true);
    expect(esAgenteAutomatico("")).toBe(true);
    expect(
      esAgenteAutomatico("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"),
    ).toBe(false);
  });

  it("leerPulso valida y recorta", () => {
    expect(leerPulso('{"c":"k7m2q4abcdef","s":12.7,"y":140}')).toEqual({ codigo: "k7m2q4abcdef", segundos: 12, scroll: 100 });
    expect(leerPulso({ c: "k7m2q4abcdef", s: -5, y: 3 })).toEqual({ codigo: "k7m2q4abcdef", segundos: 0, scroll: 3 });
    expect(leerPulso('{"c":"MAL","s":1,"y":1}')).toBeNull();
    expect(leerPulso("no json")).toBeNull();
    expect(leerPulso({ c: "k7m2q4abcdef", s: "1", y: 1 })).toBeNull();
  });
});

describe("paleta de la página (Del Contraste Calculado)", () => {
  it("con 4.096 colores, todos los pares de §4.1 llegan a su mínimo", () => {
    const pasos = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    const fallos: string[] = [];
    for (const r of pasos)
      for (const g of pasos)
        for (const b of pasos) {
          const color = `#${hex(r)}${hex(g)}${hex(b)}`;
          const p = derivarPaletaPropuesta(color);
          const pares: Array<[string, string, string, number]> = [
            ["tinta/hoja", p.tinta, p.hoja, 7],
            ["tinta/mesa", p.tinta, p.mesa, 7],
            ["tintaSuave/hoja", p.tintaSuave, p.hoja, 4.5],
            ["tintaSuave/velo", p.tintaSuave, p.velo, 4.5],
            ["tintaSuave/mesa", p.tintaSuave, p.mesa, 4.5],
            ["sobreCampo/campo", p.sobreCampo, p.primarioCampo, 4.5],
            ["sobreCampo/campoHover", p.sobreCampo, p.campoHover, 4.5],
            ["trazo/hoja", p.trazo, p.hoja, 4.5],
            ["trazo/velo", p.trazo, p.velo, 4.5],
            ["borde del botón (tinta)/hoja", p.tinta, p.hoja, 3],
          ];
          for (const [n, a, f, min] of pares) {
            if (contraste(a, f) < min) fallos.push(`${color} ${n} ${contraste(a, f).toFixed(2)}`);
          }
        }
    expect(fallos.slice(0, 10)).toEqual([]);
  });

  it("arregla el caso medido en el diseño (#28bce2 daba 4,35 y 4,12)", () => {
    const p = derivarPaletaPropuesta("#28bce2");
    expect(contraste(p.trazo, p.hoja)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(p.trazo, p.velo)).toBeGreaterThanOrEqual(4.5);
  });
});
