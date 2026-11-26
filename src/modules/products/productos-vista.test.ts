import { describe, expect, it } from "vitest";
import {
  caracteristicasDeEmpresa,
  contarGamas,
  esKioscoEmpresa,
  filtrarProductos,
  fotosDeEmpresa,
  leerFiltrosEmpresa,
  plegarGamas,
  reordenarEnGrupo,
  repartirFotos,
  resumenPrecio,
  valorAColumnas,
  type FilaAtributoEmpresa,
  type ProductoListaEmpresa,
} from "./productos-vista";
import { agruparCaracteristicas } from "@/modules/superadmin/catalogo/ficha-caracteristicas";

const url = (r: string) => `https://x/${r}`;

describe("fotosDeEmpresa", () => {
  it("da tipo a cada foto y añade la principal antigua si no está en product_images", () => {
    const fotos = fotosDeEmpresa(
      [
        { id: "a", storage_path: "e/p/m-1.webp", tipo_foto: "ambiente", alt_text: null, is_main: false, display_order: 2, width_px: null, height_px: null },
        { id: "b", storage_path: "e/p/m-2.webp", tipo_foto: "medidas", alt_text: null, is_main: false, display_order: 1, width_px: null, height_px: null },
      ],
      url,
      "https://x/e/p/0.png",
      "Zafiro",
    );
    expect(fotos.map((f) => f.tipo)).toEqual(["principal", "medidas", "ambiente"]);
    expect(fotos[0]!.url).toBe("https://x/e/p/0.png");
  });

  it("no duplica la principal si ya es una fila", () => {
    const fotos = fotosDeEmpresa(
      [{ id: "a", storage_path: "e/p/0.png", tipo_foto: null, alt_text: null, is_main: true, display_order: 0, width_px: null, height_px: null }],
      url,
      "https://x/e/p/0.png",
      "Zafiro",
    );
    expect(fotos).toHaveLength(1);
    expect(fotos[0]!.tipo).toBe("principal");
  });

  it("reparte como el maestro: portada, imágenes, medidas y proyecciones", () => {
    const fotos = fotosDeEmpresa(
      ["principal", "ficha", "ambiente", "ambiente", "medidas", "banner", "proyeccion"].map((t, i) => ({
        id: String(i),
        storage_path: `p/${i}.webp`,
        tipo_foto: t,
        alt_text: null,
        is_main: i === 0,
        display_order: i,
        width_px: null,
        height_px: null,
      })),
      url,
      null,
      "X",
    );
    const r = repartirFotos(fotos);
    expect(r.portada.map((f) => f.tipo)).toEqual(["principal", "ficha"]);
    expect(r.imagenes.map((f) => f.tipo)).toEqual(["ambiente", "ambiente", "medidas"]);
    expect(r.medidas).toBe("https://x/p/4.webp");
    expect(r.proyecciones).toHaveLength(1);
  });
});

describe("caracteristicasDeEmpresa", () => {
  const atributos = new Map<string, FilaAtributoEmpresa>([
    ["v", { id: "v", key: "common_power_supply", name: "Alimentación eléctrica", data_type: "number", unit: null, grupo: null, sort_order: 0, cloned_from_global_id: "g1" }],
    ["w", { id: "w", key: "dispenser_power_total_w", name: "Consumo eléctrico total", data_type: "number", unit: "W", grupo: null, sort_order: 0, cloned_from_global_id: "g2" }],
    ["h", { id: "h", key: "dispenser_dispense_height_mm", name: "Altura de dispensación (d)", data_type: "number", unit: "mm", grupo: "fisicas", sort_order: 0, cloned_from_global_id: null }],
  ]);
  const grupos = new Map([
    ["g1", "electricas"],
    ["g2", "electricas"],
  ]);

  it("lee el valor de la columna que tenga dato y el grupo del global si el suyo está vacío", () => {
    const c = caracteristicasDeEmpresa(
      [
        { id: "1", attribute_id: "v", value_text: "220-240V~50/60Hz", value_number: null, value_boolean: null, value_json: null, is_visible: true, display_order: 1 },
        { id: "2", attribute_id: "w", value_text: null, value_number: "640", value_boolean: null, value_json: null, is_visible: true, display_order: 2 },
        { id: "3", attribute_id: "h", value_text: null, value_number: 230, value_boolean: null, value_json: null, is_visible: true, display_order: 0 },
      ],
      atributos,
      grupos,
    );
    const bloques = agruparCaracteristicas(c, [{ etiqueta: "Ancho (a)", valor: "280 mm" }]);
    expect(bloques.map((b) => b.clave)).toEqual(["fisicas", "electricas"]);
    expect(bloques[0]!.filas).toEqual([
      { etiqueta: "Ancho (a)", valor: "280 mm" },
      { etiqueta: "Altura de dispensación (d)", valor: "230 mm" },
    ]);
    expect(bloques[1]!.filas).toEqual([
      { etiqueta: "Alimentación eléctrica", valor: "220-240V~50/60Hz" },
      { etiqueta: "Consumo eléctrico total", valor: "640 W" },
    ]);
    expect(c.find((x) => x.valorId === "1")!.heredado).toBe(true);
    expect(c.find((x) => x.valorId === "3")!.heredado).toBe(false);
  });

  it("usa value_json cuando no hay otro valor", () => {
    const c = caracteristicasDeEmpresa(
      [{ id: "1", attribute_id: "v", value_text: null, value_number: null, value_boolean: null, value_json: ["A", "B"], is_visible: true, display_order: 0 }],
      atributos,
      grupos,
    );
    expect(c[0]!.valorTexto).toBe("A, B");
  });
});

describe("reordenarEnGrupo", () => {
  const lista = [
    { valorId: "f1", grupo: "fisicas", orden: 0 },
    { valorId: "t1", grupo: null, orden: 1 },
    { valorId: "f2", grupo: "fisicas", orden: 2 },
    { valorId: "e1", grupo: "electricas", orden: 3 },
  ];
  it("sube dentro de su grupo y numera grupo a grupo", () => {
    expect(reordenarEnGrupo(lista, "f2", "subir")).toEqual(["f2", "f1", "e1", "t1"]);
  });
  it("no mueve la primera hacia arriba ni la última hacia abajo", () => {
    expect(reordenarEnGrupo(lista, "f1", "subir")).toBeNull();
    expect(reordenarEnGrupo(lista, "t1", "bajar")).toBeNull();
  });
});

describe("valorAColumnas", () => {
  it("número con coma, número que no es número y sí/no", () => {
    expect(valorAColumnas("number", "0,27").value_number).toBe(0.27);
    expect(valorAColumnas("number", "220-240V").value_text).toBe("220-240V");
    expect(valorAColumnas("boolean", "Sí").value_boolean).toBe(true);
    expect(valorAColumnas("text", "  ").value_text).toBeNull();
  });
});

describe("resumenPrecio", () => {
  it("contado y la cuota más baja", () => {
    expect(
      resumenPrecio([
        { plan_type: "cash", total_price_cents: 129000 },
        { plan_type: "renting", total_price_cents: 0, monthly_price_cents: 4500 },
        { plan_type: "rental", total_price_cents: 0, monthly_price_individual_cents: 3900 },
        { plan_type: "renting", is_active: false, total_price_cents: 0, monthly_price_cents: 100 },
      ]),
    ).toEqual({ contadoCents: 129000, desdeMesCents: 3900 });
  });
});

describe("lista por categorías", () => {
  const p = (id: string, extra: Partial<ProductoListaEmpresa> = {}): ProductoListaEmpresa => ({
    id,
    name: id,
    kind: "equipment",
    category_id: "c",
    internal_reference: null,
    supplier_reference: null,
    is_active: true,
    main_image_url: null,
    gama_id: null,
    rasgos_identificacion: null,
    tags: [],
    cash_price_cents: null,
    ...extra,
  });
  const todos = [p("FIORD"), p("FIORD S", { gama_id: "FIORD" }), p("FIORD BLACK", { gama_id: "FIORD" }), p("Zafiro", { cash_price_cents: 100 })];

  it("pliega las gamas: la cabeza como carpeta, sin variantes sueltas", () => {
    expect(plegarGamas(todos).map((x) => x.id)).toEqual(["FIORD", "Zafiro"]);
    expect(contarGamas(todos).get("FIORD")).toBe(3);
  });

  it("filtra y busca sin tildes", () => {
    const f = leerFiltrosEmpresa({ q: "fiórd", sinprecio: "1" });
    expect(esKioscoEmpresa(f)).toBe(false);
    expect(filtrarProductos(todos, f, new Set()).map((x) => x.id)).toEqual(["FIORD", "FIORD S", "FIORD BLACK"]);
    expect(esKioscoEmpresa(leerFiltrosEmpresa({}))).toBe(true);
  });
});
