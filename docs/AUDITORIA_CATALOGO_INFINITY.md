# Auditoría del catálogo de INFINITY AQUA

- Empresa: `f02d586c-0dc6-49e4-83e5-e0f6e688237c` (en `companies` se llama «INIFINITY AQUA », con la errata).
- Fecha: 2026-11-25. **Solo lectura**: SELECT por la Management API, lectura de `D:\OSMONOVA\catalogo` y de `scripts/catalogo-osmofilter/`. No se ha escrito nada en la base de datos ni en el código.
- Marcas: **[verificado]** = consultado en producción o en el fichero; **[inferido]** = deducido, sin comprobar; **[sin verificar]** = no se ha podido comprobar.
- Regla de Mario (§H.6 del plan): a Infinity no se le cambia nada por su cuenta. Todo lo de abajo son **propuestas** que se le enseñan con antes y después.

---

## 1. Resumen en cifras [verificado]

| Qué | Cifra |
|---|---|
| Productos | 41 (32 `equipment`, 9 `accessory`), todos activos, ninguno borrado |
| Enganchados al maestro | 13 (todos con `catalog_version_synced = version`: hoy no les sale ningún aviso de actualización) |
| Nombres de modelo sin ningún dato (variantes de gama) | 22: sin ref, sin foto, sin medidas, sin atributos |
| `supplier_reference` con el nombre del proveedor en vez de la ref | **6**: «Osmofilter» ×4 (Zafiro, Zafiro-S, Golden Eye, Infinity Beast), «Corsa» (Infinity Direct basic) y «COrsa» (Infinity Basic) |
| Pesos con los kilos metidos como gramos | **5**: Basic S (10 g), Zafiro-S (10 g), Infinity Cool (10 g), Enfriador (11 g), Infinity 1300 (23 g) |
| Pesos en la unidad correcta pero con un valor que no casa con Osmofilter | 3: Zafiro 10 kg (28 kg), Golden Eye 1 kg (8,8 kg), Beast 2 kg (8,7 kg) |
| Productos sin enganchar que corresponden a una ref de Osmofilter | **4**: Zafiro → FRO1090, Zafiro-S → FRO1091/FRO1104/FRO1098, Golden Eye → RO1131, Infinity Beast → RO1073P. Solo RO1073P está hoy en el maestro |
| Fotos | 12 filas en `product_images` (una por producto enganchado, ninguna con `tipo_foto`) + 6 productos con `main_image_url` pero **sin fila** en `product_images`. 23 productos sin ninguna foto |
| Atributos | 60 atributos de empresa, 15 valores en 5 productos. **3 valores erróneos** en Basic S (FRO1046), heredados del maestro |
| Ventajas (`datasheet_extra.features`) | 0 en los 41 (`datasheet_extra` es null en todos) |
| Documentos | 6 (uno por producto, todos `manufacturer_datasheet`, privados) |
| Recambios (`product_compatibilities`) | 0. Extras (`product_extra_targets`) 0. Certificaciones 0 |
| Filtros (`product_filters`) | 7 filtros, 6 asignaciones en 3 equipos. 1 filtro sin asignar («Filtro Golden Eye»). Las fuentes (Basic, Basic S, Indic, Zafiro) no tienen ningún filtro |
| Equipos de cliente (`customer_equipment`) | 307 en total; el 89 % (273) cuelga de 6 productos. 227 están `pendiente_identificar` |
| Ficha técnica | `datasheet_template = 'standard'` → generador v2. **La tabla de características sale vacía en todos los PDF** (fallo de `data_type`, §7) |

---

## 2. Correspondencia con Osmofilter: cómo se ha hecho

- Las medidas de Osmofilter vienen de `productos.json` (`Características físicas · Dimensión Ancho (a) / Alto (b) / Fondo (c)` y `Peso`). Una coincidencia **exacta en las tres cotas** se ha tomado como evidencia fuerte; el nombre interno (`internal_reference`) y los filtros que Infinity tiene puestos, como evidencia de apoyo.
- Infinity no tiene ninguna ref de Osmofilter en productos sin enganchar: la correspondencia se deduce, no se lee.
- Los nombres propios de Infinity («Infinity Indic», «Golden Eye», «Zafiro») **no son errores** y no se proponen cambiar.

| Producto Infinity | Ref Osmofilter | Evidencia | Confianza |
|---|---|---|---|
| Infinity Zafiro | **FRO1090** BLUE SEA 3.0 c/Bomba | 280 × 1260 × 390 mm idénticas; `internal_reference` «Blue sea » | Alta |
| Infinity Zafiro-S | FRO1091 (s/Bomba), FRO1104 (c/Bomba) o FRO1098 (ultrafiltración): los tres son BLUE SEA 3.0 sobremesa | 280 × 545 × 390 idénticas en los tres; `internal_reference` «Blue sea -S» | Alta para la gama, **no se puede elegir la ref sin Mario** |
| Golden Eye | **RO1131** GOLDEN HOOP 800 GPD | 135 × 393 × 392 idénticas; su membrana se llama «Membrana Golden eye 800 GDP» (RO1131 lleva la RO1133 de 800 GPD) | Alta |
| Infinity Beast | **RO1073P** QYRO 1000 GPD | En el maestro se llama «FLUJO DIRECTO QYRO 1000 GPD (BLACK BEAST)» y su `internal_reference` es «Black Beast»; filtro + «Membrana 1000 GDP», como RO4076 + RO4077. Medidas cercanas pero no iguales: 150 × 334 × 436 frente a 153 × 333 × 461. La alternativa RO1112 SILVER BEAST (130 × 430 × 460) casa peor | Media |
| Infinity Basic S (Compact) | FRO1046 (ya enganchado) | Ref | Cierta |
| Infinity Indic | FRO1093 (ya enganchado) | Ref; 380 × 1350 × 450 idénticas | Cierta |
| ECO25 ÉLITE | HO1128 (ya enganchado) | Ref; 280 × 500 × 479 idénticas | Cierta |
| Grifos Berlin, Durban, Bilbao, Lisboa, Zagreb, París Extensible | RO5048, RO5063(.1), RO5098(.1), RO5064, RO5089, RO5102 (ya enganchados) | Ref (alias `.1` según `alias.json`) | Cierta / alta |
| Grifo París | ¿RO5021 PARÍS o RO5066 PARÍS MATE? | Está enganchado al maestro `000005`, que se llama **«Grifo Oviedo»** y es de **CORSA**. No casa ni el nombre ni el fabricante | Dudosa: pregunta a Mario |
| Infinity Basic, Infinity Direct basic, Infinity Cool, Infinity 1300 | Ninguna | Son de Corsa o de Ionfilter. Las medidas de Basic (280 × 1210 × 380) no casan con ningún equipo de Osmofilter | — |
| Enfriador de Agua | EN0901 (ya enganchado) | No está en la descarga de Osmofilter | — |

---

## 3. Tabla por producto

Abreviaturas de uso: **eq** equipos de cliente (entre paréntesis, cuántos están pendientes de identificar) · **mant** trabajos de mantenimiento de esos equipos · **contr** líneas de contrato · **prop** líneas de propuesta · **inst** líneas de instalación · **prueba** líneas de prueba gratuita · **mov** movimientos de stock · **planes** planes de precio · **var** variantes que cuelgan de él. Stock actual en almacén: **0 en los 41**. Facturas, compras, reservas de carga, ventas perdidas y correcciones de modelo: 0 salvo donde se indica. [verificado]

### 3.1 Productos con datos (19)

| Nombre de Infinity | Ref (`supplier_reference` / `internal_reference`) | Maestro | Osmofilter | Problemas | Uso real |
|---|---|---|---|---|---|
| Infinity Basic␣ | «COrsa» / «Fiord» | No | Ninguna (Corsa) | Ref = nombre del proveedor (y en mayúscula rara); espacio al final del nombre; peso 10 kg sin poder verificar; sin foto, sin atributos, **sin filtros**; cabeza de 9 variantes | **eq 161 (155)**, mant 174, contr 3, inst 11, prueba 29, mov 6, reservas 1, planes 1, var 9 |
| Infinity Basic S (Compact) | FRO1046 | Sí (FRO1046, v4) | FRO1046 BLUE MOUNTAIN Sobremesa c/Bomba | Peso **10 g** (Osmofilter 15,8 kg); fondo 410 mm (400); atributos: depósito frío **2 L** (3,5 L), voltaje **230 V** (220-240 V), frecuencia **55 Hz** (50/60 Hz). Los tres errores están igual en el maestro. Tiene 7 de 35 atributos, 1 de 8 fotos, 1 de 22 PDF, 0 de 3 ventajas, 0 de 23 recambios (5 consumibles), 0 filtros | eq 19 (18), mant 22, prueba 16, mov 2, var 6 |
| Infinity Indic | FRO1093 | Sí (v5) | FRO1093 INDIC c/Bomba | Peso vacío (32,5 kg); 0 de 39 atributos; 1 de 8 fotos; 1 de 5 PDF; 0 de 4 ventajas; 0 de 13 recambios; 0 filtros. Su gama mezcla fabricantes (Infinity 1300 es Ionfilter) | eq 6 (6), mant 5, mov 2, var 4 |
| Infinity 1300 | 000006 | Sí (FUENTE 1300, Ionfilter) | No es de Osmofilter | Peso **23 g** (debe de ser 23 kg) [inferido]; la ref `000006` parece de relleno; es variante de Infinity Indic | eq 7, mant 9, prueba 6 |
| Infinity Zafiro | «Osmofilter» / «Blue sea » | No | **FRO1090** | Ref = proveedor; peso 10 kg (28 kg); categoría «Fuente» pero `tipo_equipo` = `osmosis` (Osmofilter lo da como dispensador); foto solo en `main_image_url`; 0 de 38 atributos, 0 de 6 PDF, 0 de 4 ventajas, 0 de 18 recambios, 0 filtros | **eq 23**, mant 19, contr 1, prop 1, inst 3, prueba 8, mov 4, planes 4 |
| Infinity Zafiro-S | «Osmofilter» / «Blue sea -S» | No | FRO1091 / FRO1104 / FRO1098 | Ref = proveedor; peso **10 g** (16 kg); mismo choque categoría ↔ `tipo_equipo`; foto solo en `main_image_url`; en Osmofilter es variante de la misma gama que Zafiro, en Infinity están sueltos | eq 2, mant 1, prueba 6, mov 2, planes 4 |
| Golden Eye | «Osmofilter» / «Golden» | No | **RO1131** GOLDEN HOOP | Ref = proveedor; peso 1 kg (8,8 kg); «Filtro Golden Eye» existe pero **no está asignado** (solo la membrana); foto solo en `main_image_url`; 0 de 24 atributos, 0 de 5 PDF, 0 de 4 ventajas | **eq 15** (14 activos), mant 14, inst 2, prueba 1, mov 6, planes 2 |
| Infinity Beast | «Osmofilter» / «Black Beast» | No | RO1073P (media) | Ref = proveedor; peso 2 kg (8,7 kg); **duplica** al maestro RO1073P (que hoy usa otra empresa, aquaroo); foto solo en `main_image_url` | mov 2, planes 1 — **ningún equipo de cliente** |
| Infinity Direct basic | «Corsa» / «Smart» | No | Ninguna (Corsa) | Ref = proveedor; peso 500 g dudoso; foto solo en `main_image_url`; candidato a enganchar al maestro A-253423 «INFINITY SMART» (Corsa, «Osmosis SMART 600 GDP», 0 usos) pero las medidas no casan (330 × 138 × 400 frente a 150 × 380 × 420) | **eq 48 (48)**, mant 63, contr 2, prop 1, inst 6, mov 2, reservas 2, planes 4, var 5 |
| Infinity Cool | A-253405 | Sí (INFINITY COOL, Corsa, v1) | No es de Osmofilter | Peso **10 g**; categoría «Ósmosis flujo directo» distinta de la de su cabeza (Osmosis Inversa); foto solo en `main_image_url` (el maestro no tiene foto); variante de Direct basic | 0 |
| ECO25 ÉLITE | HO1128 | Sí (v4) | HO1128 Enfriador HORECA | `kind` = accesorio y categoría «Gas»; en Osmofilter es un enfriador HORECA de 22 kg con carbonatador, es decir, un equipo. Puede ser intencionado (Infinity lo vende como extra, `configurator_extra`) [inferido]. Peso vacío; 0 de 30 atributos, 1 de 13 fotos, 0 de 5 PDF, 0 de 4 ventajas, 0 de 14 repuestos | eq 2, 1 recambio usado en mantenimiento |
| Enfriador de Agua | EN0901 | Sí (v3) | No está en la descarga | Peso **11 g** (igual en el maestro) | eq 3, mant 1, mov 2 |
| Grifo Berlin | RO5048 | Sí (v5) | RO5048 (sin datos en la descarga) | Sin ancho; fondo 250 mm (los grifos de Osmofilter solo traen ancho y alto) | eq 1, mov 2 |
| Grifo Bilbao | RO5098.1 | Sí (v4) | RO5098 (alias) | Sin PDF | eq 1, mov 2 |
| Grifo Durban | RO5063.1 | Sí (v5) | RO5063 (alias) | Atributos de texto «Si» sin tilde | eq 4, mov 2 |
| Grifo Lisboa | RO5064 | Sí (v2) | RO5064 LISBOA | Alto 410 mm (Osmofilter 415); 1 de 9 fotos; 0 de 2 PDF; 0 de 2 ventajas | eq 3, mov 3 |
| Grifo París | 000005 | Sí → maestro «**Grifo Oviedo**» (Corsa) | ¿RO5021 o RO5066? | Enganche dudoso: el nombre y el fabricante del maestro no casan con «París»; sin medidas | eq 4 |
| Grifo París Extensible | RO5102 | Sí (v3) | RO5102 PARÍS MATE EXT | Medidas correctas; atributos «Si» sin tilde | eq 1, mov 2 |
| Grifo Zagreb | RO5089 | Sí (v6) | RO5089 ZAGREB | Correcto; 1 de 9 fotos; 0 de 3 ventajas | mov 2 |

### 3.2 Nombres de modelo (22 variantes sin datos)

Son los nombres con los que Infinity identifica los equipos antiguos de sus clientes [inferido del flujo «pendiente de identificar»]. Ninguno tiene ref, foto, medidas, atributos ni filtros; heredan los filtros de su cabeza en la ficha técnica.

| Gama (cabeza) | Variantes | Categoría | Uso real | Observaciones |
|---|---|---|---|---|
| Infinity Basic | 425, 525, 725, ESSENTIAL, FIORD, FIORD BLACK, FUENTE, FUENTE DE PIE, REGULAR | Fuente | 525: eq 1, mant 1 · ESSENTIAL: eq 2 · FIORD: eq 2, mant 2 · FUENTE DE PIE: prueba 3 · resto 0 | «FIORD» repite el `internal_reference` de la cabeza |
| Infinity Basic S (Compact) | 630, 750 S, COMPACT, FIORD S, S PREMIUM, SOBREMESA | Dispensadores | COMPACT: eq 1 · FIORD S: eq 1, mant 1 · resto 0 | En Osmofilter, FRO1046 es cabeza de BLUE MOUNTAIN con 6 refs reales (FRO1047, FRO1055, FRO1056, FRO1059, FRO1060, FRO1075). Choque de gamas (§5) |
| Infinity Indic | FIORD PLUS, INDIC, INFINITY PLUS (+ Infinity 1300) | Dispensadores | 0 | «INDIC» es el mismo modelo que su cabeza |
| Infinity Direct basic | FLUJO DIRECTO, JAVA, SMART, STELLA (+ Infinity Cool) | Osmosis Inversa | 0 | JAVA, STELLA y SMART ya existen en el maestro (726239 y 12345S de Ionfilter, A-253423 de Corsa) sin enganchar |

---

## 4. Problemas por tipo

### 4.1 Datos erróneos [verificado]

1. **Pesos**: 5 con kilos como gramos, 3 con un valor que no casa y 9 vacíos (Indic, ECO25 y los 7 grifos). La ficha estándar los pinta como `peso / 1000` con dos decimales, así que hoy Basic S sale «0.01 kg».
2. **Atributos de Basic S (FRO1046)**: depósito frío 2 L (3,5), voltaje 230 V (220-240), frecuencia 55 Hz (50/60). Los otros 4 (caliente 1,3 L, 100 W, 420 W, R600a) casan. Los 3 de Infinity 1300 coinciden con su maestro; no hay ficha de Osmofilter con la que cruzarlos.
3. **`supplier_reference` con el proveedor**: 6 productos (lista en §1). El proveedor ya está en `default_supplier_name` en 5 de ellos.
4. **`kind`, categoría y `tipo_equipo`**:
   - Zafiro y Zafiro-S: categoría «Fuente» (`tipo_equipo` fuente) con `tipo_equipo = osmosis` en el producto. Sus 24 equipos de cliente también están como `osmosis`. Es un choque, pero puede ser a propósito (precio de mantenimiento de ósmosis) [inferido]: pregunta.
   - ECO25 ÉLITE como accesorio en «Gas» frente a equipo HORECA en Osmofilter: pregunta.
   - Categorías duplicadas en sentido: «Fuente» (12 productos, propia) y «Dispensadores» (12, clonada de la global) significan lo mismo y las dos tienen `tipo_equipo = fuente`. «Osmosis Inversa» (7) y «Ósmosis flujo directo» (1, solo Infinity Cool). 5 categorías sin productos: Descalcificador, Ozono, Horeca, Filtros y cabezales, Equipos con gas.
   - Ningún grifo está como equipo: bien.
5. **Grifo París** enganchado al maestro «Grifo Oviedo» de Corsa.
6. **Fotos huérfanas**: 6 productos (Zafiro, Zafiro-S, Golden Eye, Beast, Direct basic, Cool) tienen foto en `main_image_url` y ninguna fila en `product_images`. La ficha estándar la usa; una galería que lea `product_images` no la verá [sin verificar en pantalla].
7. **Errores en el propio maestro** (no son de Infinity, pero le llegan si pulsa «Aplicar actualización», que **pisa `kind`, medidas y peso**): FRO1046 10 g y fondo 410; RO1073P **40 × 40 × 445 mm y 10 g**; A-253405 10 g; A-253423 8 g (y alto/ancho que parecen cambiados); 000006 23 g; EN0901 11 g; FRO1046 con 55 Hz, 230 V y 2 L.

### 4.2 Duplicados

| Caso | Tipo | Riesgo de tocarlo |
|---|---|---|
| Infinity Beast ↔ maestro RO1073P | Producto sin enganchar que es un maestro existente | Bajo: 0 equipos de cliente |
| Infinity Zafiro / Zafiro-S ↔ FRO1090 / FRO1091-1104-1098 | Sin enganchar; el maestro aún no tiene esas refs | Alto: 25 equipos, contrato, propuesta, 8 planes |
| Golden Eye ↔ RO1131 | Igual | Alto: 15 equipos, 14 mantenimientos |
| Infinity Direct basic / SMART ↔ maestro A-253423 «INFINITY SMART» | Probable duplicado del maestro (sin confirmar por medidas) | Muy alto: 48 equipos, 63 mantenimientos |
| JAVA ↔ maestro 726239; STELLA ↔ maestro 12345S | Nombre de modelo igual a un maestro de Ionfilter | Bajo (0 uso), pero son nombres de identificación: no conviene fusionarlos |
| INDIC (variante) ↔ Infinity Indic | Mismo modelo dos veces dentro de la gama | Bajo (0 uso) |
| FIORD (variante) ↔ Infinity Basic («Fiord»); COMPACT ↔ Infinity Basic S (Compact) | Igual | FIORD tiene 2 equipos; COMPACT 1 |
| Categorías «Fuente» ↔ «Dispensadores» | Duplicado de categoría | Medio: cambia filtros de lista y packs |

No hay dos productos de Infinity con la misma `supplier_reference` [verificado]. Tampoco hay índice único que impida enganchar dos productos al mismo maestro.

### 4.3 Lo que le falta frente a Osmofilter (en los 9 que casan con Osmofilter)

| Producto | Fotos (tiene / hay) | Atributos | Ventajas | PDF | Recambios (consumibles + repuestos) |
|---|---|---|---|---|---|
| Basic S (FRO1046) | 1 / 8 | 7 / 35 | 0 / 3 | 1 / 22 | 0 / 5 + 18 |
| Indic (FRO1093) | 1 / 8 | 0 / 39 | 0 / 4 | 1 / 5 | 0 / 5 + 8 |
| Zafiro (FRO1090) | 0 (+1 huérfana) / 9 | 0 / 38 | 0 / 4 | 0 / 6 | 0 / 5 + 13 |
| Zafiro-S (FRO1091 si es s/Bomba) | 0 (+1) / 8 | 0 / 35 | 0 / 4 | 0 / 3 | 0 / 3 + 8 |
| Golden Eye (RO1131) | 0 (+1) / 8 | 0 / 24 | 0 / 4 | 0 / 5 | 1 de 2 filtros puesto / 2 + 9 |
| Beast (RO1073P) | 0 (+1) / 14 | 0 / 23 | 0 / 4 | 0 / 4 | 2 filtros puestos / 2 + 9 |
| ECO25 ÉLITE (HO1128) | 1 / 13 | 0 / 30 | 0 / 4 | 0 / 5 | 0 / 0 + 14 |
| Lisboa, Zagreb, París Ext. | 1 / 9 cada uno | 1-2 / 11 | 0 / 2-3 | 0-1 / 2 | — |
| Berlin, Durban, Bilbao | 1 / 1 (la descarga solo trae miniatura) | — | — | — | — |

Los filtros de Infinity viven en `product_filters` (mantenimiento), no en `product_compatibilities` (recambios del maestro): son dos sistemas distintos que habrá que casar antes de cargar recambios (pregunta 6).

---

## 5. Gamas de Infinity frente a `gamas.json`

| Gama de Infinity | Qué dice `gamas.json` | Choque |
|---|---|---|
| Basic S (FRO1046) + 6 nombres propios | BLUE MOUNTAIN: cabeza FRO1046, variantes FRO1047, FRO1055, FRO1056, FRO1059, FRO1060, FRO1075 | Misma cabeza, variantes distintas: las de Infinity son nombres de identificación, las de Osmofilter son refs reales. Si el maestro proyectara su gama, el trigger `trg_products_gama_un_nivel` lo impediría y además mezclaría las dos cosas |
| Indic (FRO1093) + 3 nombres + Infinity 1300 (Ionfilter) | INDIC: producto suelto | Infinity mete en la gama otro fabricante |
| Zafiro y Zafiro-S, sueltos | BLUE SEA 3.0: cabeza FRO1090, variantes FRO1104, FRO1091, FRO1094, FRO1095, FRO1098 | En Osmofilter son la misma gama; en Infinity no |
| Golden Eye, suelto | GOLDEN HOOP: suelto | Sin choque |
| Beast, suelto | QYRO: suelto | Sin choque |
| Infinity Basic + 9; Direct basic + Cool + 4 | No son de Osmofilter | No aplica |

Conclusión, igual que §0.1 del plan: **la gama de Infinity es «familia comercial con alias de identificación» y la de Osmofilter es «variantes técnicas de una ref»**. No se pueden fusionar; la gama del maestro solo puede enseñarse como información («este equipo, en Osmofilter, tiene estas variantes»), nunca escribirse en `products.gama_id` de Infinity.

---

## 6. Qué es arriesgado tocar (uso real)

Tablas con FK a `products` revisadas: `customer_equipment`, `maintenance_jobs` y `maintenance_contracts` (por el equipo), `contract_items`, `proposal_items`, `invoice_lines`, `installation_items`, `free_trial_items`, `stock_movements`, `warehouse_stock`, `stock_reservations`, `purchase_items`, `maintenance_items_replaced`, `loading_request_items`, `product_pricing_plans`, `product_price_history`, `correcciones_modelo_equipo`, `lost_sales`, `incidents`, `products.gama_id`. Varias son `ON DELETE RESTRICT` (`contract_items`, `proposal_items`, `installation_items`, `free_trial_items`, `stock_movements`, `warehouse_stock`, `products.gama_id`…): **un borrado tras fusionar fallaría**, y debe fallar.

- **No tocar sin enseñárselo producto a producto**: Infinity Basic (161 equipos), Infinity Direct basic (48), Zafiro (23), Basic S (19), Golden Eye (15). Entre los cinco suman 266 equipos y 292 mantenimientos.
- **Seguros de tocar** (0 equipos, 0 documentos de venta): Infinity Beast, Infinity Cool, Grifo Zagreb y 15 de las 22 variantes.
- Fusionar cualquier pareja obliga a mover filas de 10 tablas o más; **no se propone fusionar nada** (§8.3).

---

## 7. Ficha técnica

- `company_settings.datasheet_template = 'standard'` [verificado] → `datasheet-pick.ts` llama a `generateProductDatasheetV2` (`datasheet-pdf-v2.ts`).
- **Fallo confirmado**: `datasheet-pdf-v2.ts:429-436` pide `data_type` a `product_attribute_values`; esa columna **no existe** (comprobado en `information_schema`: la tabla tiene `value_text`, `value_number`, `value_boolean`, `value_json`, `is_visible`, `is_featured`…; `data_type` está en `product_attributes`). El mismo fallo está en `datasheet-iagua.ts:195` y `datasheet-iagua-html.tsx:266`. El código no mira `error`, así que `rows` es null y **la tabla de características sale vacía en el PDF de todas las empresas con cualquiera de las dos plantillas**. [verificado por lectura del código y del esquema; no he podido reproducir la respuesta de PostgREST: la llamada de prueba se denegó por permisos]
- Lo que ve hoy Infinity en su PDF [inferido de la lectura de v2]:
  - Cabecera, nombre, foto de `main_image_url` (12 + 6 productos la tienen) y descripción.
  - **Características: nada**, ni siquiera los 15 valores que tiene.
  - Dimensiones con dibujo isométrico solo si tiene las tres cotas: 12 productos. El peso sale mal en 5: «0.01 kg» (Basic S, Zafiro-S, Cool, Enfriador) y «0.02 kg» (1300). Los grifos no tienen fondo: no sale la sección.
  - Filtros: Golden Eye (solo membrana), Beast, Direct basic y, por herencia de gama, sus 5 variantes. Las fuentes no tienen filtros.
  - Certificaciones: ninguna. Ventajas: `datasheet_extra` no se usa en v2 [verificado por grep] y además está vacío.
- **Ojo al arreglarlo**: en cuanto se pida `data_type` al atributo, Basic S empezará a enseñar «Frecuencia 55 Hz», «Voltaje 230 V» y «Depósito frío 2 L». Arreglar el código **después** de proponer la corrección de esos tres valores, o a la vez.

---

## 8. Correcciones propuestas

Todas siguen §H.6: se le enseñan antes y después a Infinity, solo se aplican si acepta, y antes de aplicar se guarda una copia de cada fila tocada para poder deshacer. Mecanismo común propuesto para todas: una tabla `propuestas_catalogo` (empresa, producto, campo, valor_antes, valor_despues, motivo, estado, aplicada_por, aplicada_at) que se rellena por SQL o desde el superadmin, una pantalla en `/productos/propuestas` con «Aceptar / Rechazar» por fila, y el deshacer = volver a escribir `valor_antes`. Hoy no existe; es trabajo nuevo.

### 8.1 Sin riesgo: solo añade lo que falta

| # | Qué cambia | Qué no cambia | Cómo se enseña | Cómo se deshace |
|---|---|---|---|---|
| S1 | Fotos tipadas de Osmofilter (`is_main = false`) en los 9 productos de §4.3 | La foto principal actual, `main_image_url`, el orden de las existentes | Galería con las fotos nuevas marcadas «propuesta» al lado de la actual | Borrar las filas añadidas (se guardan sus ids) |
| S2 | Crear la fila de `product_images` para las 6 fotos huérfanas, apuntando al mismo fichero | `main_image_url` | «Esta foto ya es tuya; la añadimos a la galería» | Borrar la fila |
| S3 | Ventajas en `datasheet_extra.features` (vacío en los 41) | Nada más del producto | Lista de ventajas con icono | Volver `datasheet_extra` a null |
| S4 | Atributos que faltan (solo los que no tiene: p. ej. 32 en Indic) | Los 15 valores actuales | Tabla «tienes / propuesto» | Borrar los valores añadidos |
| S5 | PDF de Osmofilter que no tiene (manuales, certificados, trípticos) | Los 6 documentos actuales | Lista por apartado | Borrar los documentos añadidos |
| S6 | Pesos vacíos: Indic 32,5 kg, ECO25 22 kg, y alto/ancho que faltan en grifos | Lo que ya tiene valor | Antes «—» / después «32,5 kg» | Volver a null |
| S7 | Asignar el «Filtro Golden Eye», que ya existe | Las asignaciones actuales | «Tienes este filtro creado y no está puesto en el equipo» | Borrar la asignación |

### 8.2 Bajo: corrige un dato erróneo

| # | Qué cambia | Qué no cambia | Cómo se enseña | Cómo se deshace |
|---|---|---|---|---|
| B1 | Pesos con kilos como gramos: Basic S 10 → 15 800 g; Zafiro-S 10 → 16 000; Cool, Enfriador, 1300: ×1000 (pendiente del dato real) | Medidas, nombre, precio | «Hoy tu ficha dice 0,01 kg; Osmofilter dice 15,8 kg» | Volver al valor guardado |
| B2 | Pesos que no casan: Zafiro 10 → 28 kg, Golden Eye 1 → 8,8 kg, Beast 2 → 8,7 kg | Igual | Igual | Igual |
| B3 | Basic S: depósito frío 2 → 3,5 L; voltaje 230 → «220-240»; frecuencia 55 → «50/60» Hz; fondo 410 → 400 mm | Los otros 4 atributos | Tabla de tres filas | Volver a los valores guardados |
| B4 | `supplier_reference` de Zafiro, Golden Eye y Beast → FRO1090, RO1131, RO1073P; Zafiro-S cuando Mario elija la ref | `internal_reference` («Blue sea», «Golden»…), nombre, `default_supplier_name` | «Tu ref de proveedor pone "Osmofilter"; la ref real es FRO1090» | Volver al texto anterior |
| B5 | Basic y Direct basic: vaciar «COrsa» / «Corsa» de la ref (el proveedor ya está o se pone en `default_supplier_name`) | Todo lo demás | Igual | Igual |
| B6 | Quitar el espacio final de «Infinity Basic␣» | — | Puede que nadie lo note: preguntar si quiere | Igual |
| B7 | Arreglo de `data_type` en `datasheet-pdf-v2.ts`, `datasheet-iagua.ts` y `datasheet-iagua-html.tsx` (leerlo de `product_attributes`) | Ningún dato | PDF de antes y de después de 2-3 productos suyos | Revertir el commit |
| B8 | Corregir el maestro: FRO1046, RO1073P (40 × 40 × 445), A-253405, A-253423, 000006, EN0901. Y la corrección C.5 del plan (rellenar solo si está vacío) **antes** de publicar ninguna versión | Los productos de Infinity (la versión del maestro no sube por SQL) | No le afecta hasta que pulse «Aplicar actualización»; con C.5 ya no le pisará | Restaurar las filas del maestro guardadas |

### 8.3 Alto: fusionar, cambiar categoría o `kind`, enganchar al maestro

| # | Qué cambia | Qué no cambia | Cómo se enseña | Cómo se deshace |
|---|---|---|---|---|
| A1 | **Vincular al maestro** Infinity Beast → RO1073P (0 equipos: el más seguro para estrenar la acción) | Nombre, precio, kind, medidas, fotos, atributos, gama | Ver §9 | Poner `catalog_product_id` y `catalog_version_synced` a null |
| A2 | Vincular Golden Eye → RO1131 y Zafiro → FRO1090 **después** de cargar esas refs en el maestro (fase 2 del plan) | Igual | Igual | Igual |
| A3 | Zafiro y Zafiro-S: categoría «Fuente» frente a `tipo_equipo = osmosis` | — | Solo si Mario dice que es un error: puede cambiar el precio de mantenimiento de 24 equipos | Volver el valor |
| A4 | ECO25 ÉLITE de accesorio a equipo | — | Solo si Mario lo pide: cambia packs y configurador | Volver el valor |
| A5 | Unificar las categorías «Fuente» y «Dispensadores» | — | Lista de 24 productos con su categoría antes y después | Volver `category_id` de cada uno |
| A6 | Grifo París: desenganchar de «Grifo Oviedo» y, si Mario lo confirma, enganchar a RO5021 o RO5066 | Nombre, foto actual | Comparación de los dos maestros | Volver el `catalog_product_id` anterior |
| A7 | **Fusiones** (INDIC con Infinity Indic, SMART con Direct basic, Beast con RO1073P…) | — | **No se proponen.** Las variantes son nombres de identificación de equipos de cliente; fusionarlas rompe ese flujo y obliga a mover filas de más de 10 tablas con FK `RESTRICT` | — |

---

## 9. Cómo unificar con el maestro sin romper nada: acción «Vincular al maestro»

Hoy **no existe**: el único sitio que escribe `catalog_product_id` es la importación (`catalog-import-actions.ts:173`), que crea un producto nuevo. Propuesta:

1. **Dónde**: en la ficha del producto de la empresa, botón «Vincular al catálogo» si `catalog_product_id` es null. El buscador propone primero los maestros cuya ref coincide con `supplier_reference` o `internal_reference`, y después los de medidas idénticas.
2. **Qué escribe**: solo `catalog_product_id` y `catalog_version_synced = version actual del maestro`. Con eso no salta ningún aviso de actualización y **no se toca nada más**: ni nombre, ni precio, ni `kind`, ni categoría, ni medidas, ni peso, ni fotos, ni atributos, ni `gama_id`.
3. **Qué enseña antes de vincular**: una comparación campo a campo («tuyo / catálogo») con lo que *podría* traer después: medidas, peso, atributos que faltan, fotos, ventajas, PDF. Cada fila con su casilla, todas desmarcadas. Lo que marque se aplica como en §8.1 / §8.2, con copia previa.
4. **Comprobaciones**: que ningún otro producto de la empresa esté ya vinculado al mismo maestro (no hay índice único que lo impida; conviene añadirlo como parcial `(company_id, catalog_product_id) where catalog_product_id is not null`, previa comprobación de que hoy no hay repetidos); que el `kind` coincida o avisar si no.
5. **Deshacer**: «Desvincular» pone los dos campos a null. Las mejoras aceptadas se deshacen aparte con su copia.
6. **Requisito previo**: la corrección C.5 en «Aplicar actualización» (rellenar `kind`, medidas y peso solo si están vacíos) y corregir el maestro (B8). Si no, vincular Beast a RO1073P y pulsar «Aplicar» le pondría 40 × 40 × 445 mm y 10 g.
7. **Orden recomendado**: Beast (0 equipos) → Golden Eye y Zafiro (tras cargar RO1131 y FRO1090) → Zafiro-S (cuando Mario elija ref) → nada más. Basic y Direct basic no son de Osmofilter y Direct basic solo si Mario confirma que es A-253423.

---

## 10. Preguntas para Mario

1. **Zafiro-S**: ¿es FRO1091 (sobremesa s/Bomba), FRO1104 (c/Bomba) o FRO1098 (ultrafiltración)? Las medidas son idénticas en las tres.
2. **Infinity Beast**: ¿es el QYRO 1000 GPD (RO1073P), como dice el nombre del maestro, o otro equipo? Las medidas no son exactas.
3. **Grifo París**: está enganchado al maestro «Grifo Oviedo» de Corsa. ¿Error del enganche, del nombre del maestro, o Infinity vende un Oviedo como París?
4. **Zafiro y Zafiro-S con `tipo_equipo = osmosis`** dentro de la categoría «Fuente»: ¿a propósito (para el precio de mantenimiento) o error?
5. **ECO25 ÉLITE como accesorio en «Gas»**: ¿se vende como extra de una fuente? Si es así se queda.
6. **Recambios**: los filtros de Infinity están en `product_filters` (mantenimiento) y los del maestro irán a `product_compatibilities`. ¿Se unifican o conviven?
7. **Infinity Direct basic ↔ maestro A-253423 «INFINITY SMART»**: ¿es el mismo equipo? Las medidas no casan y tiene 48 equipos.
8. **Categorías «Fuente» y «Dispensadores»**: ¿se le propone unificarlas o se deja?
9. **Infinity 1300** (Ionfilter) como variante de Infinity Indic (Osmofilter): ¿lo dejó así Infinity a propósito?
10. ¿Montamos la tabla de propuestas y la pantalla de aceptar/rechazar (§8), o se le enseña en una reunión con capturas y se aplica a mano lo que acepte?

---

## Respuestas de Mario (2026-11-25)

1. **Zafiro-S** = BLUE SEA de sobremesa = **FRO1091**. **Infinity Beast** = **RO1073P** (Mario: «creo»; se le enseña
   la comparación antes de vincular).
2. **Grifo París ↔ «Grifo Oviedo» (Corsa):** el enlace es CORRECTO. Es el mismo grifo; antes se llamaba Oviedo y
   ahora París. No se desengancha.
3. **Zafiro y Zafiro-S son FUENTES** (la categoría «Fuente» está bien; hay que revisar su `tipo_equipo` para que sea
   fuente). **ECO25 ÉLITE** se queda como accesorio.
4. **Infinity Direct basic = INFINITY SMART (A-253423).** Hay que poner las medidas correctas (va como propuesta).
5. **Forma de proponer los cambios: opción a)**, una pantalla de propuestas donde la empresa acepta o rechaza cada
   cambio viendo el antes y el después. Sirve también para las demás empresas.
