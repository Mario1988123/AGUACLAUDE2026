import { describe, expect, it } from "vitest";
import {
  estadoIdentificacion,
  etiquetaModelo,
  gamasDeTipo,
  productoDeFiltros,
  tipoEfectivoProducto,
  validarModeloElegido,
  variantesDe,
  type CatalogoModelo,
  type ProductoModelo,
} from "./logica";

const prod = (p: Partial<ProductoModelo> & { id: string; name: string }): ProductoModelo => ({
  tipo_equipo: null,
  gama_id: null,
  category_id: null,
  rasgos_identificacion: null,
  main_image_url: null,
  is_active: true,
  ...p,
});

const cat: CatalogoModelo = {
  tipoCategoria: { CF: "fuente", CO: "osmosis", CG: null },
  productos: [
    prod({ id: "basic", name: "Infinity Basic", category_id: "CF" }),
    prod({ id: "fiord", name: "FIORD", gama_id: "basic" }),
    prod({ id: "425", name: "425", gama_id: "basic" }),
    prod({ id: "direct", name: "Infinity Direct basic", category_id: "CO" }),
    prod({ id: "cool", name: "Infinity Cool", gama_id: "direct", category_id: "CG" }),
    // Regla 0: Blue sigue en la categoría Fuente pero es ósmosis.
    prod({ id: "blue", name: "Infinity Blue", category_id: "CF", tipo_equipo: "osmosis" }),
    prod({ id: "grifo", name: "Grifo", category_id: "CG" }),
    prod({ id: "vieja", name: "Vieja", gama_id: "basic", is_active: false }),
  ],
};

describe("tipoEfectivoProducto", () => {
  it("el producto manda sobre la categoría", () => {
    expect(tipoEfectivoProducto("blue", cat)).toBe("osmosis");
  });
  it("la variante hereda de la gama antes que de su propia categoría", () => {
    expect(tipoEfectivoProducto("fiord", cat)).toBe("fuente");
    expect(tipoEfectivoProducto("cool", cat)).toBe("osmosis");
  });
  it("lo que no es equipo principal queda en null", () => {
    expect(tipoEfectivoProducto("grifo", cat)).toBeNull();
    expect(tipoEfectivoProducto(null, cat)).toBeNull();
  });
});

describe("gamas y variantes", () => {
  it("lista las variantes activas", () => {
    expect(variantesDe("basic", cat).map((p) => p.id)).toEqual(["425", "fiord"]);
  });
  it("las gamas de ósmosis incluyen Blue y no las variantes", () => {
    expect(gamasDeTipo("osmosis", cat).map((p) => p.id)).toEqual(["blue", "direct"]);
  });
});

describe("estadoIdentificacion", () => {
  it("sin modelo → pendiente de modelo, con el tipo si se sabe", () => {
    const e = estadoIdentificacion(
      { product_id: null, external_equipment_model_id: null, pendiente_identificar: true, tipo_equipo: "fuente" },
      cat,
    );
    expect(e).toMatchObject({ pendiente: true, falta: "modelo", tipo: "fuente" });
    expect(etiquetaModelo(e)).toBe("Fuente · pendiente de identificar");
  });
  it("gama con variantes → falta la variante aunque la marca diga false", () => {
    const e = estadoIdentificacion(
      { product_id: "basic", external_equipment_model_id: null, pendiente_identificar: false },
      cat,
    );
    expect(e).toMatchObject({ pendiente: true, falta: "variante", tipo: "fuente" });
  });
  it("variante → identificado", () => {
    const e = estadoIdentificacion({ product_id: "cool", external_equipment_model_id: null }, cat);
    expect(e.pendiente).toBe(false);
    expect(etiquetaModelo(e)).toBe("Ósmosis · Infinity Direct basic · Infinity Cool");
  });
  it("gama sin variantes → identificado", () => {
    const e = estadoIdentificacion({ product_id: "blue", external_equipment_model_id: null }, cat);
    expect(e.pendiente).toBe(false);
  });
  it("externo → no pendiente", () => {
    const e = estadoIdentificacion({ product_id: null, external_equipment_model_id: "x" }, cat);
    expect(e).toMatchObject({ externo: true, pendiente: false });
  });
});

describe("validarModeloElegido", () => {
  it("rechaza una gama con variantes", () => {
    expect(validarModeloElegido("basic", cat)).toMatch(/variantes/);
  });
  it("acepta la variante y la gama sin variantes", () => {
    expect(validarModeloElegido("fiord", cat)).toBeNull();
    expect(validarModeloElegido("blue", cat)).toBeNull();
  });
  it("rechaza lo que no es fuente ni ósmosis y lo que no existe", () => {
    expect(validarModeloElegido("grifo", cat)).toMatch(/fuente/);
    expect(validarModeloElegido("nada", cat)).toMatch(/no existe/);
  });
});

describe("productoDeFiltros", () => {
  it("la variante sin filtros propios usa los de la gama", () => {
    expect(productoDeFiltros("fiord", "basic", () => false)).toBe("basic");
  });
  it("la variante con filtros propios usa los suyos", () => {
    expect(productoDeFiltros("fiord", "basic", (id) => id === "fiord")).toBe("fiord");
  });
  it("la gama usa los suyos", () => {
    expect(productoDeFiltros("basic", null, () => false)).toBe("basic");
  });
});
