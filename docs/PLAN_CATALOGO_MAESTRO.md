# Plan: catálogo maestro (Osmofilter) y superadmin

Fecha: 2026-11-25 · Estado: **plan, nada ejecutado** · Autor: agente de diseño (la ejecución la hace otro agente)

Leyenda: **[verificado]** = lo he visto en el código, en la base de datos de producción (solo SELECT) o en los ficheros de `D:\OSMONOVA\catalogo`. **[sin verificar]** = deducción que el ejecutor debe comprobar. **[decide]** = decisión rutinaria que tomo yo; se puede cambiar sin rehacer el plan.

---

## 0. Lo que hay hoy (resumen de la investigación)

### 0.1 Datos de producción [verificado, 2026-11-25]

- Maestro: 18 productos, 4 fabricantes (tabla `manufacturers`, no `catalog_manufacturers`). De Osmofilter hay **11**: FRO1046, FRO1093, HO1128, RO1073P, RO5048, RO5064, RO5089, RO5102 (las 8 que están en la descarga) y **EN0901, RO5063.1 y RO5098.1**, que no están en la descarga con esa referencia.
- `catalog_products` tiene único global `lower(supplier_reference)`: no puede haber dos productos con la misma ref aunque sean de fabricantes distintos.
- Atributos globales: **106** (no 112). Sin campo de grupo. Se enlazan a categorías por `product_attributes_global_categories` (N a N).
- En el maestro solo 3 productos tienen valores de atributo (14 filas en total). FRO1046 tiene 7 y RO1073P tiene 4.
- Infinity: 41 productos, 13 enganchados, 12 fotos, 15 valores de atributo, 60 atributos (53 clonados de globales), 12 categorías, 6 documentos, **0 compatibilidades**, 0 recambios.
- **Las gamas de Infinity están al revés que las de Osmofilter.** En Infinity la gama es el producto comercial enganchado y las variantes son nombres propios: «Infinity Basic S (Compact)» (FRO1046) es gama de FIORD S, SOBREMESA, 750 S, 630, S PREMIUM y COMPACT; «Infinity Indic» (FRO1093) es gama de FIORD PLUS, INDIC, INFINITY PLUS e Infinity 1300. Por tanto la gama del maestro **no se puede proyectar nunca** sobre productos ya existentes de una empresa.
- `company_settings.datasheet_template` vale **`standard` en las cinco empresas, Infinity incluida**. La plantilla IAGUA no está activa para nadie ahora mismo.
- Buckets: `catalog-global` privado (URL firmada de 1 h), `product-images` público, `product-documents` privado.
- Línea base de Infinity tomada hoy: 41 productos · huella `md5` de `products` = `112f46dcea20e7d7db982c9cd444a2e0` · 12 imágenes · 15 valores · 60 atributos · 12 categorías · 6 documentos. Cambia en cuanto alguien de Infinity edite algo: hay que volver a tomarla justo antes de cada fase (§F).

### 0.2 Código [verificado por lectura]

- La `version` del maestro **la sube el código, no un trigger**: `bumpVersion` en `src/modules/superadmin/catalogo/master-products-actions.ts:28-36`, llamado en cada edición, foto y documento. Guardar el formulario suma +2. Una carga por SQL o service-role directo **no sube nada**.
- Importar (`src/modules/products/catalog-import-actions.ts`, `catalog-copy-helpers.ts`): copia nombre, tipo, categoría, ref, descripciones, medidas, peso, atributos, fotos (descarga de `catalog-global` y sube a `product-images`) y documentos. **No copia** gama, rasgos, `tipo_foto`, ventajas, compatibilidades, `alt_text` ni fabricante. Los errores al insertar valores de atributo no se comprueban.
- Aplicar actualización (`catalog-update-actions.ts`): respeta nombre, textos (si no están vacíos), categoría, precio, stock y fotos; **pisa siempre `kind`, medidas y peso**; añade atributos y documentos nuevos.
- `tipo_foto`, `catalog_product_highlights`, `catalog_product_compatibilities` y `catalog_products.gama_id` tienen **0 usos** en `src/`. `product_compatibilities` tampoco se usa en ninguna pantalla.
- Ficha IAGUA (`datasheet-iagua.ts`, `datasheet-iagua-html.tsx`): una sola foto (`main_image_url`), no usa medidas ni `product_images`, y **pide la columna `data_type` a `product_attribute_values`, que no existe** en la base de datos (comprobado en `information_schema`). Lo esperable es que la tabla técnica salga vacía [sin verificar en ejecución].
- Superadmin: menú con solo «Empresas» y «Catálogo global» (`_shell.tsx:14-17`); `/superadmin/audit` y `/superadmin/errores` no están en el menú. Tablas con `min-w-[800px]` y `min-w-[560px]` que hacen scroll horizontal a 390 px. La lista de productos no tiene miniatura, ni filtro por categoría, ni paginación. El detalle es solo un formulario: **no existe vista de ficha**. No se ve en ningún sitio qué ha importado cada empresa.
- `src/modules/superadmin/catalogo/actions.ts` usa el cliente del usuario y no comprueba `error`: si RLS deniega, devuelve `ok:true`.
- `AttributeCategoriesDialog` (`manager.tsx:359-364`) hace `setState` y fetch durante el render.

### 0.3 La descarga de Osmofilter [verificado]

- 174 equipos en 9 familias: Dispensadores 46 · Descalcificación 28 · Grifos 27 · Horeca 25 · Flujo directo 18 · Ósmosis doméstica 16 · Ozonos 8 · Desincrustadores 4 · Hidrogenador 2.
- 100 atributos distintos en 4 grupos con orden: Características físicas (20), eléctricas (30), técnicas (40) y extra (60). En `ficha.json` el valor y la unidad vienen **separados** (`grupos_ft[].items[]`: atributo, unidad, valor); en `productos.json` vienen pegados. El script debe leer de `ficha.json`.
- 503 ventajas, todas con icono; solo **82 iconos distintos** por nombre. 31 fichas sin ventajas.
- Fotos: 150 principal, 343 ambiente, 147 medidas, 151 «ficha-tecnica», 108 banner, 77 detalles, 31 proyecciones, 12 miniatura. 1.522 `.webp`, 38 MB.
- `medidas.webp` es un dibujo de línea neutro con las cotas **a, b, c**, que casan con «Dimensión Ancho (a) / Alto (b) / Fondo (c)». `ficha-tecnica.webp` es un render del equipo sobre fondo gris. Comprobado solo en RO1073P.
- 13 artículos llevan «(Hasta fin de existencias)» en la descripción.
- Nombres: `nombre` es corto y se repite en las variantes («BLUE MOUNTAIN» ×7); `descripcion` es largo y único («Dispensador Ósmosis Inversa Sobremesa BLUE MOUNTAIN s/Bomba»). En 7 artículos `nombre` es igual a la descripción o a la ref («AT6928»).

### 0.4 Lo que no cuadra con el encargo

| Encargo | Realidad |
|---|---|
| Recambios con miniatura, cantidad y despiece | `recambios_por_equipo.json` trae **0 imágenes, 0 cantidades y ningún despiece**. Su propia cabecera dice «pendiente completar con bom_tarifa.php». La tarifa bloquea a partir de 100 artículos por hora. |
| Proyecciones X/Y/«sin carátula» | Solo hay proyecciones en unos 15 equipos (X 15, Y 10, Z 4) y **«sin carátula» en 2**. |
| 1.809 enlaces equipo→recambio | Cubren 161 equipos, pero solo **126 están entre los 174 descargados**. 35 equipos del Excel no están en `productos.json` (DNOVO, FRO1003P, MI0038…) y 48 equipos descargados no tienen recambios. |
| 112 atributos globales | Hay 106. |
| «Plantilla de Infinity (IAGUA)» | Infinity tiene `datasheet_template = 'standard'`. |
| 8 refs existentes | Además están EN0901, RO5063.1 y RO5098.1. En la descarga hay **RO5063** y **RO5098** (sin `.1`), las dos sin características ni foto principal: si no se tratan como alias, se duplican. |

---

## A. Estructura del maestro

### A.1 Principios

1. **Todo aditivo.** No se cambia ni se borra ninguna columna, restricción, categoría o atributo existente.
2. **La carga no sube `version`.** Se escribe con service-role directo, nunca por las acciones del superadmin.
3. **Reutilizar antes que crear**, pero sin forzar: si el significado, la unidad o los valores no casan, se crea un atributo nuevo (§A.5).
4. **Un producto por referencia.** La gama es una relación, no un producto inventado.

### A.2 Migración aditiva propuesta: `supabase/migrations/20261126100000_catalogo_maestro_fase2.sql`

| Tabla | Columna o índice nuevo | Para qué |
|---|---|---|
| `product_attributes_global` | `grupo text` con check `fisicas / electricas / tecnicas / extra`, nullable | Agrupar la ficha. Null se pinta en «Técnicas». |
| `product_attributes` (empresa) | `grupo text`, mismo check, nullable | Se copia al clonar. Las 60 filas de Infinity se quedan en null. |
| `catalog_products` | `modelo text` | Nombre corto del fabricante («BLUE MOUNTAIN»). Al importar va a `products.manufacturer_model`. |
| | `familia_proveedor text` | Familia tal cual la da el proveedor. Filtro y trazabilidad; imprescindible en recambios (20 familias). |
| | `catalogos_proveedor text[]` | General, Especialista, Venta Directa, Horeca, Fuentes. |
| | `descatalogado boolean not null default false` | Los 13 «hasta fin de existencias». |
| | `origen_carga text` | `osmofilter-2026-11-25`. Distingue lo cargado por script de lo creado a mano. |
| | `cambios_sin_publicar boolean not null default false` | Para el botón «Publicar actualización» (§B.6). |
| `catalog_product_photos` | `thumb_path text` | Miniatura de 400 px en el mismo bucket. |
| | `etiqueta text` | «Proyección X», «Sin carátula», «Detalle 2». |
| | `width_px int`, `height_px int` | Evitar saltos de maquetación. |
| | índice único en `storage_path` | Idempotencia de la carga. Comprobar antes que no hay repetidos [sin verificar]. |
| `catalog_product_documents` | `idioma text` | ES, EN… |
| `product_compatibilities` (empresa) | `cantidad int` (check > 0, nullable), `display_order int not null default 0` | Igualarla a la del maestro. Hoy tiene 0 filas en Infinity. |

No hace falta columna para «Consumible / Repuesto»: sale del `kind` del recambio (`consumable` o `spare_part`), que ya existe en el enum.

No se toca `tipo_foto`: «sin carátula» es `tipo_foto = 'proyeccion'` con `etiqueta = 'Sin carátula'`. `despiece` ya está en el check y queda vacío hasta que haya imágenes.

**Stock del proveedor (solo diseño, no se crea ahora).** Cuando se aclare la parte legal:

```
catalog_product_supplier_stock
  catalog_product_id uuid pk → catalog_products
  unidades integer
  fecha_dato date not null          -- el día al que corresponde el dato
  origen text not null              -- 'feed-osmofilter', 'manual'
  llegadas jsonb                    -- [{fecha, unidades}]
  actualizado_en timestamptz
```

Una fila por producto, con su fecha siempre visible al lado del número. `productos.json` ya trae `stock_foto` y `llegadas`: **no se cargan**.

**Precios:** no se cargan. El script ignora `pvp`, `precio_unidad` y `netos_por_cantidad`.

### A.3 Fabricante, nombre y referencia

- Fabricante: `manufacturers`, fila «Osmofilter» (`f56eb6cf-aed9-439a-a73e-6c1c5e83a77b`), ya existe.
- `supplier_reference` = ref de Osmofilter tal cual.
- **Nombre** (pregunta G1): propongo `name` = `descripcion` de Osmofilter sin el paréntesis de fin de existencias ni el sufijo « Osmofilter», y `modelo` = `nombre` de Osmofilter. Motivo: con `nombre` habría siete «BLUE MOUNTAIN» iguales en la lista.
- `short_description` = `grupos[0]` «Descripcion» de `ficha.json`. `long_description` queda vacía: Osmofilter no da texto largo; las ventajas van aparte.

### A.4 Gama y variantes

Se mantiene lo aplicado: `catalog_products.gama_id` autorreferenciado, un nivel. **La cabeza de gama es una referencia real**, no una fila inventada (una fila sintética necesitaría una ref falsa, porque `supplier_reference` es obligatoria y única).

Reglas:

1. Las gamas salen de un fichero revisable, `scripts/catalogo-osmofilter/gamas.json`, **no** de agrupar por `nombre` a ciegas. La agrupación automática da 27 grupos, pero con errores visibles: «BLUE STORM» y «BLUE STROM» (errata) son la misma gama; «COSMOS» y «COSMOS Negro» también; «HORIZON» y «HORIZON ALKA» probablemente [sin verificar].
2. Cabeza de gama: si alguna ref del grupo ya existe en el maestro, es ella (FRO1046 en BLUE MOUNTAIN: así su `gama_id` sigue en null y la fila no cambia). Si no, la que tenga ficha más completa; a igualdad, la ref más baja.
3. `rasgos_identificacion` de cada variante: lo que distingue su descripción de las demás («s/Bomba», «c/Bomba», «Negro», «22L»). El script propone y el fichero manda.
4. En pantalla la gama se enseña **simétrica**: «Variantes de esta gama (7)» lista a todas, cabeza incluida, con la actual marcada. El usuario no tiene que saber cuál es la cabeza.
5. Orden de carga: primero las cabezas, luego las variantes (lo exige el trigger).

### A.5 Atributos: grupo, unidad, tipo y emparejamiento

**Grupo.** Sí hace falta. Los cuatro de Osmofilter con su orden: Físicas, Eléctricas, Técnicas, Extra. Dentro de cada grupo se ordena por `sort_order`. Los 106 globales actuales se quedan con `grupo` null salvo los que se reutilicen, a los que el script se lo pone solo si está en null.

**Dónde va cada dato.**

- Ancho, Alto, Fondo y Peso **no son atributos**: van a `dim_width_mm`, `dim_height_mm`, `dim_depth_mm` y `weight_grams` (kg × 1000). `common_dimensions_mm` y `common_weight_kg` no se rellenan, para no tener el dato dos veces.
- El resto va a `catalog_product_attributes`, una fila por (producto, clave).

**Tipo de valor.** Regla por el contenido real, no por el nombre:

| Lo que trae Osmofilter | Tipo | Cómo se guarda |
|---|---|---|
| Número con unidad aparte («32» + «kg») | `number` | `value_number`; la unidad en el atributo global |
| «Sí» / «No» | `boolean` | `value_boolean` |
| Rango frecuente («2–6» bar, «4–40» ºC: más de 130 equipos cada uno) | dos `number` | par `…_min_…` / `…_max_…`; la ficha los junta en una fila «2–6 bar» |
| Rango raro (menos de 15 equipos: Presión CO₂, ORP, Producción ozono) | `text` | `value_text` «4,1–4,5» y la unidad en el atributo |
| Texto libre o vocabulario pequeño («Noryl», «Contracorriente») | `text` | `value_text` |
| Coincide con un `enum` global ya existente | `enum` | `value_text` normalizado a un valor de `enum_values` |
| «No» o «0» en un atributo numérico (Capacidad depósito caliente «0 L», Temperatura agua caliente «No») | — | **no se crea fila**: significa «no tiene» [decide] |

No se crean enums nuevos: Osmofilter escribe «Forma de L» y «Forma en L», y un enum rompería la carga.

**Criterios de emparejamiento con los 106 globales.**

1. Se reutiliza un global solo si coinciden **significado, unidad y tipo**. Si hay que convertir o interpretar, no se reutiliza.
2. Un atributo de Osmofilter se empareja **por categoría**: el mismo «Presión de trabajo» va a `softener_working_pressure_*` en descalcificadores y a `osmosis_pressure_*` en ósmosis, porque esos pares ya existen y son críticos. En las categorías que no tienen par propio se crea uno común.
3. Nunca se modifica un global existente salvo para rellenar `grupo` o `unit` que estén en null. No se cambian nombres, tipos ni `enum_values`.
4. A un global existente sí se le pueden **añadir enlaces de categoría** (insert en `product_attributes_global_categories`). No afecta a Infinity: sus atributos son copias por categoría y solo se crean al importar.
5. Las claves nuevas siguen la convención actual: prefijo de familia (`dispenser_`, `softener_`, `osmosis_`, `ozone_`, `tap_`, `horeca_`, `hydrogen_`) o `common_` si cruza familias, en inglés y con la unidad al final.
6. El emparejamiento vive en `scripts/catalogo-osmofilter/mapa-atributos.json`, clave `(atributo Osmofilter, categoría global)` → clave global, tipo, transformación. Atributo sin entrada = la prueba en seco lo lista y no se carga.
7. Infinity tiene atributos propios no clonados en Grifos (`3_vias`, `4_vias`, `extensible`, `negro`…). No chocan: las claves nuevas son distintas (`tap_ways`, `tap_finish`).

Estimación: 4 a columnas, unos 22 reutilizados, unos 75 nuevos. El maestro pasaría de 106 a unos 180 atributos globales.

**Muestra con casos reales.**

| Osmofilter (grupo · atributo) | Ejemplo | N | Destino | Decisión |
|---|---|---|---|---|
| Físicas · Dimensión Ancho (a) | 290 mm | 154 | columna `dim_width_mm` | Columna, no atributo |
| Físicas · Peso | 32 kg | 135 | columna `weight_grams` = 32000 | Columna |
| Físicas · Altura dispensación (d) | 230 mm | 62 | **nuevo** `dispenser_dispense_height_mm` (number) | No existe |
| Técnicas · Litros de resina | 25 L | 19 | `softener_resin_volume_l` | Reutiliza: mismo dato y unidad |
| Técnicas · Consumo de sal por regeneración | 3 kg | 19 | `softener_salt_per_regen_kg` | Reutiliza |
| Técnicas · Caudal nominal | 1.75 m3/h | 9 | `softener_nominal_flow_m3h` | Reutiliza |
| Técnicas · Caudal máx. de la válvula | 4.5 m3/h | 17 | **nuevo** `softener_valve_max_flow_m3h` | No es «Caudal punta» del equipo: no se fuerza |
| Técnicas · Rendimiento del equipo | 132 ºHf x m3 | 17 | `softener_cycle_capacity_fm3` | Reutiliza; rellena `unit` (está en null) |
| Técnicas · Modelo de válvula | TM69 | 19 | `softener_valve_brand_model` | Reutiliza |
| Extra · Regeneración | Volumétrica | 16 | `softener_regen_type` (enum) | Reutiliza, normalizado a «volumétrica» |
| Técnicas · Funcionamiento de la válvula | Contracorriente | 19 | **nuevo** `softener_flow_direction` (text) | El enum existente mezcla este concepto con otro |
| Extra · Bypass incluido | Sí | 15 | `softener_bypass_integrated` | Reutiliza |
| Técnicas · Presión de trabajo | 2–6 bar | 132 | descalcificador: `softener_working_pressure_min_bar` / `max`; ósmosis: `osmosis_pressure_min_bar` / `max`; resto: **nuevos** `common_pressure_min_bar` / `max` | Rango frecuente → par numérico |
| Técnicas · Temperatura del agua entrada | 4–40 ºC | 134 | `softener_temp_min_c` / `max`, `osmosis_temp_min_c` / `max`; resto: **nuevos** `common_inlet_temp_min_c` / `max` | Igual |
| Técnicas · TDS Entrada Max | 1000 ppm | 73 | `osmosis_max_tds_in_ppm` (+ enlaces a flujo directo y dispensadores) | Reutiliza |
| Técnicas · Producción | 75 GPD - 0,2 L/min | 78 | `osmosis_production_gpd` = 75 y **nuevo** `common_production_lmin` = 0.2 | Un valor compuesto se parte en dos. 6 valen «No»: sin fila |
| Técnicas · Capacidad del depósito frío | 3.5 L | 43 | `dispenser_cold_tank_l` | Reutiliza (Infinity ya lo usa) |
| Eléctricas · Potencia enfriamiento | 200 W | 71 | `dispenser_cooling_power_w` (+ enlace a horeca) | Reutiliza |
| Eléctricas · Potencia total | 640 W | 105 | dispensador y horeca: `dispenser_power_total_w`; ozono: `ozone_power_w`; resto: **nuevo** `common_power_total_w` | Por categoría |
| Eléctricas · Alimentación eléctrica | 220-240V~50/60Hz | 126 | **nuevo** `common_power_supply` (text) | No se parte en `dispenser_voltage_v` y `_frequency_hz`: es un rango |
| Técnicas · Refrigerante | R290a | 68 | `dispenser_refrigerant` (enum R134a/R600a/R290) | «R290a» → «R290» [a confirmar; si no, texto nuevo] |
| Técnicas · Capacidad de enfriamiento <10ºC | 10 L/h | 38 | `dispenser_cold_prod_lh` | Reutiliza |
| Técnicas · Capacidad de enfriamiento Delta 5ºC | 20 L/h | 69 | **nuevo** `dispenser_cold_prod_delta5_lh` | Dos medidas distintas no caben en un atributo |
| Técnicas · Temperatura del agua caliente | 80–85 ºC | 45 | **nuevos** `dispenser_hot_temp_min_c` / `max` | `dispenser_hot_temp_c` es un número único: no se toca. 5 «No»: sin fila |
| Extra · UV | Sí | 40 | **nuevo** `common_uv` (boolean) | No se convierte a `dispenser_sanitization = 'UV'`: sería deducir |
| Técnicas · Instalación | Sobre encimera | 42 | **nuevo** `common_mounting` (text) | Los valores no casan con el enum `common_installation_type` |
| Técnicas · Número de vías | 3 | 18 | **nuevo** `tap_ways` (number) | No existe; no choca con `3_vias` de Infinity |
| Técnicas · Tipo de acabado | Níquel cepillado | 18 | **nuevo** `tap_finish` (text) | No es `common_color` |
| Técnicas · Presión CO₂ | 4,1–4,5 bar | 12 | **nuevo** `horeca_co2_pressure_bar` (text) | Rango raro → texto |
| Técnicas · Producción Ozono | 0,5 ~ 1 mg/l | 4 | **nuevo** `ozone_output_mgl` (text) | `ozone_production_gh` va en g/h: otra magnitud |

El ejecutor completa el fichero con los 100 atributos siguiendo estos criterios y lo presenta en el informe de la prueba en seco antes de escribir nada.

### A.6 Familias de Osmofilter → categorías globales

| Familia Osmofilter | N | Categoría global | `kind` |
|---|---|---|---|
| Dispensadores - Equipos | 46 | `dispensers` | equipment |
| Descalcificación - Equipos compactos | 28 | `softeners` | equipment |
| Grifos Osmofilter - Equipo | 27 | `Grifos` | accessory (no se cambia) |
| Horeca - Equipos | 25 | `horeca` | equipment |
| Flujo directo - Equipo | 18 | `osmosis_direct_flow` | equipment |
| Osmosis doméstica - Equipos | 16 | según descripción: «5 Etapas» → `osmosis_5_stages` (4); «Compacto» / COMPACT600 → `osmosis_compact` (7); MAXI 600GPD → `osmosis` (2); Ultrafiltración → `filters` (3) [decide] | equipment |
| Ozonos - Equipos | 8 | `ozone` | equipment |
| Desincrustadores - Equipos | 4 | `descalers` | equipment |
| Hidrogenador - Equipo | 2 | `hydrogen` | equipment |
| Recambios, tipo «Repuesto» | 483 | `spare_parts` | spare_part |
| Recambios, tipo «Consumible» | 73 | `spare_parts` | consumable |

`Enfriador`, `Gas` y `service` no reciben nada de Osmofilter. **HO1128 se queda en `Gas` / accessory** aunque Osmofilter lo ponga en Horeca: ya existe y no se toca. Las 20 familias de recambio quedan en `familia_proveedor` y son un filtro; no se crean subcategorías.

### A.7 Ventajas, fotos, documentos y recambios

**Ventajas** → `catalog_product_highlights`: `titulo` = texto_breve, `descripcion` = texto_largo, `display_order` = posición. Los 82 iconos se suben **una sola vez** a `catalog-global/iconos/osmofilter/<slug>.webp` y `icon_path` los repite.

**Fotos** → `catalog_product_photos`:

| Fichero | `tipo_foto` | `etiqueta` | Uso |
|---|---|---|---|
| `principal.webp` (fondo transparente) | principal | — | `is_main`, miniatura de la lista, portada de la ficha |
| `ambiente-N.webp` | ambiente | Ambiente N | Galería |
| `medidas.webp` | medidas | — | Junto a las cotas a/b/c |
| `ficha-tecnica.webp` | ficha | — | Galería. Sirve de principal si no hay `principal` |
| `banner.webp` | banner | — | Cabecera de la ficha en pantalla |
| `detalles/detalle-N.webp` | detalle | Detalle N | Galería |
| `proyecciones/proyeccion-x/y/z.webp` | proyeccion | Proyección X/Y/Z | Bloque de recambios |
| `proyecciones/sin-caratula.webp` | proyeccion | Sin carátula | Bloque de recambios |
| `miniatura.webp` (12 casos) | — | — | Solo si no hay principal ni ficha: se usa como principal |
| (no existe aún) | despiece | — | Vacío |

24 refs no tienen principal: se aplica la cadena principal → ficha → miniatura → sin foto. Las que queden sin foto salen en el filtro «Incompletos».

**Documentos.** Decisión tomada: no se usan los PDF de ficha de Osmofilter. Propongo cargar solo **manuales** (`manual_user`) y **certificados** CE/UNE/NSF (`certificate`), que no tienen sustituto, y dejar fuera fichas técnicas, fichas comerciales, trípticos, dípticos y flyers. Pregunta G3, porque llevan la marca.

**Recambios.** Cada recambio es un `catalog_product` (ref, nombre, `kind`, `spare_parts`, `familia_proveedor`), sin foto ni atributos por ahora. El enlace va en `catalog_product_compatibilities` con `cantidad` null. Los enlaces a equipos que no están en el maestro (35 equipos) se saltan y se listan en el informe.

Tamaño final previsto: 18 + 174 − 8 (ya existen) − 2 (alias) = **182 equipos**, más 556 recambios = **738 filas**. Por debajo del tope de 1.000 de PostgREST, pero cerca: la lista se pagina en servidor.

---

## B. Superadmin

Registro visual: **el del CRM**, sin estilo propio. Tailwind v4 con los tokens de `src/app/globals.css` (azul marino `--primary`, radio `.5rem`, Inter/Geist), utilidades `marco-px` / `marco-pb`, y los componentes de `src/shared/ui` y `src/shared/components`.

### B.1 Norte y reglas

**Norte: «el catálogo se mira como una tarifa, no como una tabla de base de datos».** Lo primero que se ve de un producto es su foto y su nombre; lo último, sus claves.

- **Regla de la foto primero.** Ninguna lista de productos sin miniatura. Ningún detalle que empiece por un formulario.
- **Regla de ver antes que editar.** El detalle es una ficha de lectura. Editar es una acción explícita, por secciones.
- **Regla de la empresa visible.** Donde aparece un producto maestro se ve cuántas empresas lo tienen y con qué nombre. Donde aparece una empresa se ve qué tiene del maestro.
- **Regla del dedo.** Todo lo pulsable mide 44 px o más.
- **Regla de publicar.** Editar no avisa a las empresas. Avisar es un botón aparte, con confirmación.

### B.2 Mapa de pantallas

```
/superadmin                                  Empresas (inicio)
/superadmin/empresas/nueva
/superadmin/empresas/[id]                    Resumen · Catálogo importado · Módulos · Integraciones · Usuarios
/superadmin/catalogo                         → redirige a /catalogo/productos
/superadmin/catalogo/productos               Lista (equipos por defecto)
/superadmin/catalogo/productos/[id]          Ficha (lectura)
/superadmin/catalogo/productos/[id]/editar   Edición por secciones
/superadmin/catalogo/productos/nuevo
/superadmin/catalogo/fabricantes
/superadmin/catalogo/categorias
/superadmin/catalogo/atributos
/superadmin/errores                          (existe; se añade al menú)
/superadmin/audit                            (existe; se añade al menú)
```

Menú (`_shell.tsx`): **Empresas · Catálogo · Errores · Auditoría**. Empresas primero. Dentro de Catálogo, una barra de secciones bajo la cabecera: Productos · Recambios · Fabricantes · Categorías · Atributos. «Recambios» es la misma lista con `tipo=recambios`.

### B.3 Empresas

**Lista `/superadmin`.**
- 390 px: cuatro indicadores en rejilla 2×2 con `KpiCard`; buscador; **tarjetas** (una por empresa): nombre y estado (`StatusPill`), usuarios n/máx, clientes, contratos y una línea «Catálogo: 41 productos · 13 del maestro · 2 con actualización pendiente». Toda la tarjeta es enlace. Botón «Nueva empresa» fijo abajo.
- Escritorio: indicadores en una fila; **tabla** (`hidden md:block`) con las mismas columnas más coste al mes y edad. Sin `min-w` que obligue a desplazar.

**Detalle `/superadmin/empresas/[id]`.**
- `BackButton` arriba. Cabecera: nombre, estado, slug.
- 390 px: secciones en `CollapsibleCard` (`src/modules/products/collapsible-card.tsx`), con «Resumen» y «Catálogo importado» abiertas. Escritorio: `ui/tabs` con las cinco secciones.
- **Catálogo importado** (nuevo): lista con miniatura, **nombre en la empresa** y debajo «Maestro: nombre · ref», versión sincronizada frente a versión del maestro e insignia «Actualización pendiente» si procede. Encima, el recuento: «13 del maestro · 28 propios». Solo lectura: desde aquí no se cambia nada de la empresa. Consulta: `products` por `company_id` con `catalog_product_id` no nulo, unida a `catalog_products`.

### B.4 Catálogo: lista

`/superadmin/catalogo/productos?tipo=&fab=&cat=&gama=&estado=&q=&page=`. Filtros y paginación **en servidor** (`Pagination` de `src/shared/components/pagination.tsx`, 48 por página). Miniaturas firmadas en lote con `createSignedUrls` sobre `thumb_path`.

- Filtros: tipo (Equipos / Recambios / Todos), fabricante, categoría, gama, estado (Activos / Inactivos / Descatalogados / **Incompletos**: sin foto o sin atributos / Sin importar por nadie) y búsqueda por nombre, modelo o ref.
- 390 px: buscador a todo el ancho; botón «Filtros (2)» que abre `ui/sheet` desde abajo; los filtros activos como fichas que se quitan con un toque. Lista de **tarjetas horizontales**: miniatura 72×72 a la izquierda sobre fondo `bg-muted`; a la derecha nombre (dos líneas máximo), ref en mono, categoría e insignias («7 variantes», «Descatalogado», «3 empresas»).
- Escritorio: filtros en una fila sobre la lista; conmutador **rejilla / tabla**. Rejilla de 4 columnas con foto `aspect-square object-contain` (patrón de `products-list-client.tsx:316-388`, pero con `contain`, porque las fotos son transparentes). Tabla: miniatura 40 px, nombre, ref, fabricante, categoría, gama, empresas, versión, estado.
- Con el filtro de gama vacío las variantes salen sueltas; opción «Agrupar por gama» que pliega cada gama en una tarjeta con el número de variantes.

### B.5 Catálogo: ficha del producto (lectura)

`/superadmin/catalogo/productos/[id]`. Se lee de arriba abajo como la tarifa.

1. **Cabecera.** `BackButton`, fabricante, nombre, ref, modelo, categoría, estado, «versión N» y, si las hay, «cambios sin publicar». Acciones: **Editar** y **Publicar actualización**.
2. **Galería por tipo.** Foto grande (principal) y tira de miniaturas agrupadas con rótulo: Ambiente · Detalles · Medidas · Proyecciones. Tocar abre la foto a pantalla completa (`ui/dialog`).
3. **Ventajas.** Icono, título y texto.
4. **Características** en cuatro bloques: Físicas (con la imagen de medidas y las cotas a/b/c al lado), Eléctricas, Técnicas, Extra. Los pares mín./máx. en una fila («Presión de trabajo: 2–6 bar»). Bloque sin datos = no se pinta.
5. **Variantes de la gama.** Tira de tarjetas pequeñas (miniatura, ref, rasgo), la actual marcada.
6. **Consumibles y repuestos.** Proyecciones arriba si existen. Lista: miniatura (o el icono de la categoría si no hay foto), ref, etiqueta Consumible / Repuesto, nombre, cantidad si se conoce. Filtro Todos / Consumibles / Repuestos. En un recambio, la sección inversa: «Se usa en (12 equipos)».
7. **Documentos.** Tipo, título, idioma, tamaño, descargar.
8. **Empresas que lo tienen.** Empresa, **nombre que le ha puesto**, versión sincronizada, fecha de alta. Enlaza al detalle de la empresa.

- 390 px: una columna. Galería a todo el ancho con deslizamiento horizontal y `scroll-snap`, puntos de posición. Cada bloque es un `CollapsibleCard` con contador («Técnicas · 14»); abiertos Ventajas y Físicas. Tablas de características en dos columnas etiqueta / valor, sin desplazamiento lateral. Barra inferior fija con Editar y Publicar, respetando `--safe-*`.
- Escritorio: dos columnas. Izquierda fija (`sticky`) con galería y datos de cabecera; derecha con el resto, en `ui/tabs`: Ficha (ventajas + características) · Variantes · Recambios · Documentos · Empresas.

### B.6 Edición y carga

`/superadmin/catalogo/productos/[id]/editar`, por secciones que se guardan por separado (en móvil un `CollapsibleCard` por sección; en escritorio menú lateral de secciones):

- **Datos**: fabricante, ref (bloqueada), nombre, modelo, tipo, categoría, descripciones, medidas, peso, activo, descatalogado.
- **Gama**: elegir gama (buscador), rasgo que la distingue, o «es cabeza de gama».
- **Fotos**: subida múltiple; cada foto con su `tipo_foto` (selector), etiqueta, orden (subir / bajar) y «principal». Genera la miniatura al subir.
- **Ventajas**: lista ordenable; título, texto, icono elegido de la biblioteca de iconos ya subidos o subido nuevo.
- **Características**: inputs por atributo agrupados en los cuatro grupos; guarda **por diferencia** (hoy borra y reinserta todo).
- **Recambios**: buscador de productos `spare_part` / `consumable`, cantidad, orden.
- **Documentos**: como hoy, con idioma.

**Publicar.** Cualquier guardado pone `cambios_sin_publicar = true` y **no** sube `version`. El botón «Publicar actualización» enseña a cuántas empresas avisa, pide confirmación (`ConfirmDialog`), sube `version` en +1 de forma atómica (`update … set version = version + 1`) y limpia la marca. Sustituye a `bumpVersion`.

**Categorías y atributos.** Se parte `manager.tsx` en dos pantallas. Atributos: lista agrupada por grupo, con buscador, filtro por categoría, y en cada fila tipo, unidad, número de productos del maestro que lo usan y número de empresas que lo han clonado. Editor en `ui/sheet`: nombre, grupo, tipo, unidad, **valores del enum** (hoy no se pueden meter) y categorías. Se corrige el `setState` en render.

**Fabricantes.** Tarjetas con logo, número de productos (con `count`, no trayendo toda la tabla), activo y orden editables.

### B.7 Componentes a reutilizar

`BackButton`, `KpiCard`, `StatusPill`, `Pagination`, `ListSkeleton`, `ConfirmDialog`, `CajonLateral` (`src/shared/components`); `Card`, `Badge`, `Tabs`, `Sheet`, `Dialog`, `Button`, `Input`, `Select` (`src/shared/ui`); `CollapsibleCard` y el patrón rejilla / tarjetas / tabla de `src/modules/products/products-list-client.tsx`.

Nuevos, en `src/modules/superadmin/catalogo/`: `ficha-galeria.tsx`, `ficha-caracteristicas.tsx`, `ficha-ventajas.tsx`, `ficha-variantes.tsx`, `ficha-recambios.tsx`, `ficha-empresas.tsx`, `lista-filtros.tsx`, `tarjeta-producto.tsx`. `ficha-caracteristicas` y `ficha-ventajas` se escriben para poder usarse también en la ficha de producto de la empresa.

### B.8 Don't

- No tablas con `min-w` en móvil. Por debajo de `md`, tarjetas.
- No listas sin paginar ni filtradas en cliente: con 738 filas el tope de 1.000 de PostgREST está a la vuelta.
- No pedir una URL firmada por foto en bucle: siempre en lote y sobre la miniatura.
- No cargar la imagen de 1.200 px en la lista.
- No `object-cover` en fotos de producto: recorta los equipos. `object-contain` sobre fondo neutro.
- No subir `version` al guardar. Solo al publicar.
- No borrar y reinsertar todos los atributos al guardar.
- No enseñar claves (`softener_resin_volume_l`) ni tipos en inglés (`equipment`) al usuario; el nombre en español y la clave en pequeño solo en la pantalla de atributos.
- No acciones que devuelvan `ok:true` sin comprobar `error`.
- No botones de 28 o 32 px.
- No esconder la gama detrás del concepto «cabeza»: siempre la lista completa de variantes.
- No permitir desde el superadmin tocar productos de una empresa: «Catálogo importado» es de solo lectura.
- No mostrar precios ni stock de Osmofilter en ninguna pantalla.
- No degradados, sombras fuertes ni colores fuera de los tokens: es una herramienta interna del mismo CRM.

---

## C. Importación a la empresa

Cambios en `catalog-import-actions.ts` y `catalog-copy-helpers.ts`. **Solo afectan a importaciones nuevas.**

### C.1 Qué se copia

| Dato | Destino | Regla |
|---|---|---|
| Nombre, tipo, categoría, ref, descripciones, medidas, peso | `products` | Como hoy. El nombre lo cambia la empresa después |
| Fabricante y modelo | `products.manufacturer_name`, `manufacturer_model` | Nuevo |
| Fotos | `product_images` con `tipo_foto`, `alt_text`, orden | Una sola `is_main` (hay único parcial). Se copia la de 1.200 px |
| Atributos y valores | `product_attributes` (clon con `grupo`) y `product_attribute_values` | Comprobando errores; si existe un atributo local con la misma clave hecho a mano, se usa ese en vez de fallar |
| Ventajas | `products.datasheet_extra.features` = `[{title, desc, icon}]` | Solo si `features` está vacío. `icon` es nuevo y opcional; el icono se copia a `product-images/<empresa>/_iconos/<slug>.webp` una vez por empresa |
| Gama | `products.gama_id`, `rasgos_identificacion` | Ver C.2 |
| Recambios | `product_compatibilities` con `cantidad` y `display_order` | Ver C.3 |
| Documentos | `product_documents` | Como hoy, con orden |

### C.2 Gama y variantes

Al importar un producto que pertenece a una gama se pregunta: **«Solo este» o «La gama entera (7)»**.

- Gama entera: se importa la cabeza y después las variantes, con `gama_id` apuntando a la cabeza local.
- Solo este: si la empresa ya tiene la cabeza importada **y esa cabeza local no es a su vez variante de otra**, se enlaza; si no, queda suelto. Importar más tarde otra variante no reordena nada: se ofrece un botón «Enlazar con su gama» que el usuario pulsa si quiere.
- **Nunca** se escribe `gama_id` en un producto que ya existía antes de esta importación.

### C.3 Recambios

- Al importar un **equipo**: se crean las compatibilidades con los recambios del maestro que la empresa **ya tenga** importados. Se ofrece «Importar también sus 9 consumibles» (solo `consumable`, que es lo que se vende en mantenimientos); los repuestos, uno a uno o por selección.
- Al importar un **recambio**: se enlaza con los equipos que la empresa ya tenga enganchados al maestro.
- Se inserta con `on conflict do nothing`: no se borra ni se modifica una compatibilidad que la empresa haya puesto a mano.

### C.4 Lo que no se toca nunca

- Productos ya existentes de cualquier empresa: nombre, descripciones, categoría, precios, costes, stock, `gama_id`, `tipo_equipo`, fotos, valores de atributo, `datasheet_extra` no vacío, documentos existentes.
- **No hay relleno retroactivo.** Los 13 productos enganchados de Infinity no reciben ventajas, fotos tipadas ni recambios por el hecho de cargar el maestro. Solo si alguien de Infinity pulsa «Aplicar actualización», y entonces con las reglas de hoy.
- Categorías y atributos de la empresa: solo se crean los que falten; no se renombran ni se reordenan.

### C.5 Dos correcciones recomendadas en «Aplicar actualización»

1. Hoy pisa siempre `kind`, medidas y peso. Propongo que rellene **solo si están vacíos**, igual que las descripciones. Riesgo real: el maestro pasará a tener medidas donde hoy hay null.
2. Avisar si hay un producto local sin enganchar con la misma `supplier_reference`, en vez de crear un duplicado.

---

## D. Ficha técnica neutra

Plantilla **nueva**, `datasheet_template = 'neutra'`, en ficheros nuevos: `src/modules/products/datasheet-neutra.tsx` (motor satori → sharp → pdf-lib, partiendo de `datasheet-iagua-html.tsx`) y su entrada en `datasheet-pick.ts`. **No se modifican** `datasheet-iagua*` ni `datasheet-pdf-v2.ts`. Infinity sigue en `standard` hasta que Mario diga otra cosa (G6).

Colores: `pdf_brand_color` y `datasheet_color_accent ?? pdf_accent_color` de la empresa; por defecto, gris pizarra y un solo acento. Sin el azul y el verde de IAGUA ni su imagen fija `iagua-hero-p2.png`. Ningún texto, logo ni documento de Osmofilter.

| Sección | Qué lleva | De dónde sale |
|---|---|---|
| **Cabecera** (todas las páginas) | **Logo de la empresa arriba a la izquierda**, 34 pt de alto; a la derecha, ref interna de la empresa (o la del proveedor si no tiene). Regla fina | `company_settings.fiscal_logo_url`; si falta, el nombre de la empresa en texto |
| **Título** | Nombre **que le ha puesto la empresa**; debajo, el reclamo | `products.name`, `marketing_claim` |
| **Portada** | Foto principal grande sobre fondo claro; texto de presentación a un lado | `product_images` con `tipo_foto = 'principal'` (si no hay, `main_image_url`); `datasheet_extra.hero_text ?? long_description ?? short_description` |
| **Ventajas** | Hasta 6, en rejilla de 2 o 3: icono, título, texto | `datasheet_extra.features` (con `icon`); si está vacío, atributos `is_featured` |
| **Medidas** | Dibujo de cotas con la tabla a / b / c / peso al lado | `tipo_foto = 'medidas'`; `dim_width_mm` (a), `dim_height_mm` (b), `dim_depth_mm` (c), `weight_grams` |
| **Características** | Cuatro bloques con título: Físicas, Eléctricas, Técnicas, Extra. Dos columnas. Pares mín./máx. unidos. Sí/No como texto | `product_attribute_values` visibles + `product_attributes (name, unit, data_type, grupo, sort_order)`. `data_type` se pide **al atributo**, no al valor |
| **Variantes** (si el producto tiene gama) | Tabla corta: nombre, ref, rasgo | `products.gama_id` y hermanas |
| **Consumibles y repuestos** (página opcional, `?recambios=1`) | Proyecciones arriba; lista con miniatura, ref, etiqueta, nombre y cantidad | `product_compatibilities` + `product_images` del recambio; `tipo_foto = 'proyeccion'` |
| **Certificaciones** | Sellos o lista | `product_certifications` |
| **Pie** (todas las páginas) | Razón social, teléfono, web de la empresa · «Página X de N» | `company_settings` [sin verificar qué columnas de contacto existen] |

Sección sin datos = no se pinta ni deja hueco. El logo que va serigrafiado en la carcasa de algunos equipos se ve en la foto: no se retoca.

La página de recambios va apagada por defecto en la ficha que se comparte con clientes; la usa el técnico.

---

## E. Script de carga

`scripts/catalogo-osmofilter/cargar.mjs` (Node; `@supabase/supabase-js` con service-role y `sharp`, que ya están en el proyecto). Lee `D:\OSMONOVA\catalogo` **solo en lectura**: no escribe, renombra ni borra nada allí.

### E.1 Ficheros

```
scripts/catalogo-osmofilter/
  cargar.mjs
  mapa-atributos.json      (atributo Osmofilter, categoría) → clave global, tipo, transformación
  mapa-categorias.json     familia → categoría y kind; excepciones por ref
  gamas.json               gama → cabeza, variantes y rasgo de cada una
  alias-refs.json          { "RO5063": "RO5063.1", "RO5098": "RO5098.1" }  (pendiente de G4)
  informes/                un JSON y un resumen en texto por ejecución
```

### E.2 Uso

```
node scripts/catalogo-osmofilter/cargar.mjs                  # prueba en seco: es el modo por defecto
node scripts/catalogo-osmofilter/cargar.mjs --aplicar        # escribe
   --paso=atributos|productos|gamas|valores|fotos|ventajas|recambios|enlaces|documentos
   --solo=AT6925,RO1073P     # limitar a unas refs
   --origen=D:\OSMONOVA\catalogo
```

Escribir exige `--aplicar`: sin él no hay ni una escritura en base de datos ni en Storage.

### E.3 Prueba en seco

Hace todas las lecturas y transformaciones y deja en `informes/`:

- productos que crearía, que completaría y que saltaría, con el motivo;
- atributos globales nuevos y reutilizados, y cada atributo de Osmofilter **sin emparejar**;
- valores que no ha podido convertir (ref, atributo, valor);
- gamas con su cabeza y variantes;
- fotos por tipo, refs sin foto principal, bytes a subir;
- recambios a crear, enlaces a crear y enlaces saltados por equipo inexistente;
- comprobación previa: ningún payload contiene `version`, `name` de una ref existente ni ninguna tabla con `company_id`.

### E.4 Idempotencia

| Qué | Clave | Segunda pasada |
|---|---|---|
| Producto | `lower(supplier_reference)` (tras aplicar alias) | No crea. Solo rellena campos que estén en **null** |
| Atributo global | `key` | `on conflict do nothing`; rellena `grupo` y `unit` solo si son null |
| Enlace atributo–categoría | (attribute_key, category_key) | `on conflict do nothing` |
| Valor de atributo | (catalog_product_id, attribute_global_key) | `on conflict do nothing`: nunca pisa un valor |
| Foto | ruta determinista `products/<id>/osmo/<tipo>-<n>.webp` y miniatura `…/osmo/m/<tipo>-<n>.webp`; único en `storage_path` | Storage con `upsert: true`; fila `on conflict do nothing` |
| Icono | `iconos/osmofilter/<slug>.webp` | Igual |
| Ventajas | por producto | Solo inserta si el producto tiene 0 ventajas |
| Compatibilidad | (spare_part_catalog_id, equipment_catalog_id) | `on conflict do nothing` |
| Gama | — | Solo pone `gama_id` si está en null |

El script **nunca** hace `delete` ni `update` de un campo no nulo, y nunca incluye `version` en un payload.

### E.5 Las 8 refs que ya existen

RO1073P, FRO1046, RO5064, RO5102, RO5089, RO5048, FRO1093, HO1128 (y RO5063.1 / RO5098.1 si se confirma el alias):

- **No se tocan:** `name`, `kind`, `category_global_key`, `manufacturer_id`, `version`, `is_active`, descripciones que ya tengan texto, medidas que ya tengan valor, la foto actual y su `is_main`, `main_image_path`, y los valores de atributo existentes (los 7 de FRO1046 y los 4 de RO1073P se quedan como están, aunque Osmofilter diga otra cosa).
- **Se añade:** `modelo`, `familia_proveedor`, `catalogos_proveedor`, `origen_carga`; medidas y peso si están en null; atributos que falten; fotos tipadas con `is_main = false`; ventajas; enlaces de recambio. FRO1046 queda como **cabeza** de BLUE MOUNTAIN, así que su `gama_id` no cambia.
- `version` no cambia, luego `version = catalog_version_synced` en Infinity y **no aparece ningún aviso**. `updated_at` sí cambia por el trigger; es inocuo.
- `cambios_sin_publicar` se deja en false: es una carga, no una edición.

### E.6 Imágenes

- Se sube el `.webp` de 1.200 px tal cual y una miniatura de 400 px generada con `sharp` (conservando la transparencia).
- Bucket `catalog-global`, privado. `contentType: image/webp`, `cacheControl` de un año (la ruta es determinista y el contenido no cambia).
- En serie con concurrencia 4 y reintento; si se corta, se relanza y continúa.
- Peso: 38 MB de originales más las miniaturas.

### E.7 Orden de ejecución

1. `atributos`: globales nuevos, enlaces a categorías, grupos.
2. `productos`: equipos; primero las cabezas de gama.
3. `gamas`: `gama_id` y `rasgos_identificacion` de las variantes.
4. `valores`: atributos de cada equipo.
5. `fotos`: originales, miniaturas, `main_image_path` donde esté en null.
6. `ventajas`: iconos (una vez) y filas.
7. `recambios`: los 556 productos `spare_part` / `consumable`.
8. `enlaces`: compatibilidades.
9. `documentos`: solo si G3 es sí.

Cada paso termina con sus recuentos y con la comprobación de §F.2.

---

## F. Fases

### F.1 Riesgos para Infinity

| Riesgo | Cómo se evita |
|---|---|
| Que salte un aviso de actualización en sus 13 productos | La carga no sube `version`. Se comprueba antes y después |
| Que se le cambie un nombre | El script no escribe `name` en refs existentes ni en ninguna tabla con `company_id` |
| Que se le aplique una gama del maestro | El script no toca `products`. La importación no escribe `gama_id` en productos existentes. Además el trigger de `products` lo impediría en FRO1046 y FRO1093, porque ya tienen variantes |
| Que una categoría global cambiada altere sus packs | No se modifica ninguna categoría global. `Grifos` sigue en `accessory` |
| Que un atributo global cambiado altere los suyos | Sus 53 clones son copias. Solo se rellenan `grupo` y `unit` en null de los globales |
| Que al pulsar «Aplicar actualización» se le pisen medidas o tipo | Corrección C.5 antes de publicar ninguna versión nueva |
| Que el despliegue del superadmin rompa algo suyo | El commit despliega a producción (hook). `npx tsc --noEmit` y `next lint` antes de cada commit, y comprobar que el deploy sale Ready |

### F.2 Comprobación de antes y después (solo SELECT)

Se lanza justo antes y justo después de cada fase que escribe. Las dos salidas tienen que ser idénticas.

```sql
-- 1) Huella de todo lo de Infinity
select 'products' t, count(*) n, md5(coalesce(string_agg(md5(x::text), '' order by id), '')) h
  from products x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_images', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_images x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_attributes', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_attributes x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_attribute_values', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_attribute_values x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_categories', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_categories x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_documents', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_documents x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
union all select 'product_compatibilities', count(*), md5(coalesce(string_agg(md5(x::text), '' order by id), ''))
  from product_compatibilities x where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';

-- 2) Los 18 del maestro: nada de esto puede cambiar
select supplier_reference, name, kind, category_global_key, manufacturer_id, version, is_active, main_image_path
  from catalog_products where created_at < '2026-11-25' order by 1;

-- 3) Ningún aviso nuevo: tiene que devolver 0 filas, antes y después
select c.name, p.name, p.catalog_version_synced, cp.version
  from products p join catalog_products cp on cp.id = p.catalog_product_id
  join companies c on c.id = p.company_id
 where p.deleted_at is null and cp.version > coalesce(p.catalog_version_synced, 0);

-- 4) Categorías y atributos globales que ya existían
select key, name_es, default_kind, parent_key, is_active from product_categories_global order by key;
select key, name_es, data_type, enum_values from product_attributes_global
 where key in (/* las 106 claves de la línea base */) order by key;
```

La fase 2 de la migración añade la columna `grupo` a `product_attributes` y dos columnas a `product_compatibilities`, así que la huella de `product_attributes` de Infinity **cambia una vez** con la migración (aparece `grupo` null). Para esa fase se compara con la lista explícita de columnas anteriores en lugar de `x::text`.

Si la huella de `products` cambia y no es por nosotros (alguien de Infinity trabajando), se localiza con `updated_at` y se anota; no se da la fase por buena sin explicarlo.

### F.3 Fases

| Fase | Qué | Cómo se verifica |
|---|---|---|
| **0. Línea base** | Lanzar F.2 y guardar la salida. Exportar a JSON las tablas `catalog_*`, `manufacturers` y los globales, a `supabase/datos/respaldo-catalogo-2026-11-25/` | Ficheros guardados |
| **1. Migración fase 2** | §A.2, con `scripts/aplicar-migracion.sh` (Mario acepta el aviso) | F.2 (1 con columnas explícitas); `\d` de las tablas |
| **2. Mapas y prueba en seco** | Escribir los cuatro JSON y `cargar.mjs`. Lanzar en seco | Informe sin atributos sin emparejar ni valores sin convertir. **Mario revisa gamas y nombres** |
| **3. Piloto** | `--aplicar --solo=` una ref nueva por familia: AT6925, RO1058, FRO1090, HO1064, OZ0052E | Ver los 5 en el superadmin actual; F.2 idéntico |
| **4. Equipos nuevos** | Pasos 1 a 6 para los 164 restantes | Recuentos del informe = base de datos; F.2 idéntico; segunda pasada = 0 cambios |
| **5. Las refs existentes** | Pasos 2 a 6 con `--solo=` las 8 (o 10) | F.2 consultas 2 y 3 idénticas; los 11 valores de atributo previos intactos |
| **6. Recambios y enlaces** | Pasos 7 y 8 | 556 productos; enlaces creados + saltados = 1.809 |
| **7. Superadmin: menú y empresas** | §B.2, §B.3 | A 390 px sin desplazamiento lateral; «Catálogo importado» de Infinity muestra 13 |
| **8. Superadmin: lista y ficha** | §B.4, §B.5 | A 390 px y en escritorio; página de 48 con miniaturas en una sola petición de firmas |
| **9. Superadmin: edición y publicar** | §B.6 | Guardar no cambia `version`; publicar suma exactamente 1 |
| **10. Importación ampliada** | §C, más C.5 | Probar en una empresa de prueba (Demo Revisión): importar una gama entera y un equipo con consumibles. F.2 de Infinity idéntico |
| **11. Ficha neutra** | §D | PDF de un producto por familia en la empresa de prueba; sin rastro de Osmofilter salvo en la foto |
| **12. Stock del proveedor** | Bloqueada hasta resolver la parte legal | — |

Cómo ver pantallas privadas en local: página temporal fuera de `(tenant)`, puerto 3456 (memoria `ver-pantallas-en-local`). Para `/superadmin` el autologin ya es superadmin [sin verificar].

Las fases 7 a 9 se pueden hacer antes que la 4 si Mario prefiere ver primero las pantallas; con el piloto de la fase 3 ya hay datos reales para maquetar.

---

## G. Preguntas para Mario

1. **Nombre en el maestro.** ¿`descripcion` de Osmofilter («Dispensador Ósmosis Inversa Sobremesa BLUE MOUNTAIN s/Bomba») como nombre y «BLUE MOUNTAIN» como modelo? Si prefieres el nombre corto, las 7 variantes se llamarían igual en la lista. *Recomiendo la descripción.*
2. **Recambios sin foto, sin cantidad y sin despiece.** Los datos descargados no los traen. ¿Cargamos ya los 556 con nombre, ref y etiqueta, y completamos fotos y cantidades cuando se pueda leer `bom_tarifa` (a menos de 100 artículos por hora son al menos dos días), o esperamos a tenerlo todo? *Recomiendo cargar ya.* Además, 35 equipos del Excel no están descargados: sus enlaces se pierden salvo que se bajen esas fichas.
3. **Documentos.** ¿Subimos manuales y certificados CE/UNE/NSF aunque lleven la marca de Osmofilter, o ningún PDF? *Recomiendo manuales y certificados.*
4. **RO5063.1 y RO5098.1.** ¿Son los mismos artículos que RO5063 (Durban 2.0 Mate) y RO5098 (Bilbao 2.0 Mate) de la descarga? Si sí, se completan los existentes; si no, se crean dos nuevos. EN0901 no está en la descarga: se queda como está.
5. **Gamas.** Necesito que revises `gamas.json` antes de cargar: BLUE STORM + BLUE STROM, COSMOS + COSMOS Negro, HORIZON + HORIZON ALKA, y las líneas NOVO (TM69, TM69 LED, CLACK, LOGIX).
6. **Ficha neutra e Infinity.** Infinity tiene hoy la plantilla `standard`, no IAGUA. ¿La neutra es para las empresas nuevas y Infinity se queda como está, o Infinity pasa también a la neutra cuando esté lista?
7. **Descatalogados.** Los 13 «hasta fin de existencias»: ¿se cargan marcados como descatalogados o se dejan fuera? *Recomiendo cargarlos marcados.*

Decisiones menores que tomo salvo que digas otra cosa: ultrafiltración en `filters`; HO1128 se queda en `Gas`; «R290a» se guarda como «R290»; los valores «No» y «0» de atributos numéricos no crean fila; miniaturas a 400 px en el bucket privado.

---

## H. Respuestas de Mario (2026-11-25) — mandan sobre lo anterior

1. **Nombre:** el nombre del modelo, corto, como lo da Osmofilter: «BLUE MOUNTAIN». Lo que distingue a cada variante
   (sobremesa, color, con o sin bomba…) tiene que verse en cada una (`rasgos_identificacion`), y la referencia
   también. Ejemplo: «BLUE MOUNTAIN · Sobremesa · Negro · c/Bomba — FRO1047». La descripción larga de Osmofilter se
   guarda en `short_description`/`long_description`, sin la marca.
2. **Recambios:** se cargan ya los 556 con lo que hay, y se completan fotos y cantidades cuando se puedan leer.
3. **Documentos:** se suben TODOS los PDF (manuales, certificados, fichas, dípticos, flyers), cada uno en su
   apartado de la ficha del producto (por `kind`/categoría del documento).
4. **Ficha técnica:** Fable diseña una nueva, o mejor 2-3 plantillas, y cada empresa elige la suya y puede cambiar
   la paleta de colores. Infinity sigue con la suya hasta que elija.
5. Sin respuesta todavía (se decide por defecto y se le enseña): alias RO5063.1/RO5098.1 = RO5063/RO5098 (hay que
   comprobarlo antes); `gamas.json` se le enseña para revisar; los descatalogados se cargan marcados.
6. **Regla para Infinity (25-11):** todo lo que pueda hacerle perder algo se le deja como está y se le PROPONE como
   actualización, enseñándole antes qué cambiaría (vista previa o comparación de antes y después). Solo se aplica si
   lo acepta. Vale para la plantilla de ficha, el arreglo de `data_type`, las gamas y los enlaces de recambios sobre
   sus productos existentes.
