# Diseño: fichas técnicas con la marca de cada empresa, ficha de producto y lista por categorías

Fecha: 2026-11-26 · Estado: **diseño y plan, nada ejecutado** · Autor: agente de diseño (la ejecución la hace otro agente)

Leyenda: **[verificado]** = leído en el código, en `package.json` o consultado en producción con SELECT (Management
API). **[sin verificar]** = deducción que el ejecutor debe comprobar. **[decide]** = decisión rutinaria que tomo yo.
**[pregunta]** = lo decide Mario (§H).

Este documento **corrige** a `docs/DISENO_FICHAS_TECNICAS.md` (25-11) en tres puntos y reutiliza el resto:

1. **El aspecto.** Aquel documento rechazaba parecerse a la ficha del fabricante («igualamos su contenido, no su
   aspecto») y proponía tres papeles distintos (Plano, Escaparate, Placa) de dos o tres hojas. Mario ha pedido lo
   contrario: **«algo parecido a la de Osmofilter pero con el logo de cada empresa»**. Las tres plantillas pasan a ser
   tres pieles de **un mismo esqueleto**, el de la ficha de Osmofilter: una hoja A4, dos columnas.
2. **El motor.** Con una hoja de rejilla fija ya no hace falta Chromium. Se recomienda `pdf-lib`, que es lo que hay (§B.4).
3. **Las paletas.** En vez de ocho paletas con nombre, **tres propuestas calculadas desde el color de la marca** (§C).

Se mantienen de aquel documento: la función `derivarPaleta` en OKLCH y su test (§5), las reglas del Logo en Papel, del
Plano Blanco, de la Cota, del Icono Reentintado, del Fabricante Mudo y «Sin Dato, Sin Hueco» (§2), y la migración
aditiva (§9, con los nombres de plantilla nuevos).

Registro visual **[decide]**: las pantallas (§D, §E, §C.3) son CRM y usan sus tokens (`src/app/globals.css`), sin estilo
propio. Las fichas PDF van en registro **A (documento serio)**: es un papel técnico que se entrega a un cliente.

---

## A. Diagnóstico

### A.1 Datos reales de producción [verificado, 2026-11-26]

| | INFINITY AQUA (`f02d586c…`) | aquaroo (`1d5d958b…`) |
|---|---|---|
| Productos / categorías | **41** / 10 (3 vacías: Descalcificador, Ozono, Filtros y cabezales) | 3 / 5 |
| Reparto | Fuente 12 · Dispensadores 12 · Osmosis Inversa 7 · Grifos 7 · Ósmosis flujo directo 1 · Horeca 1 · Enfriador 1 | — |
| Gamas | 4 cabezas con **24 variantes** («425», «FIORD», «SMART»…): 17 entradas reales, no 41 | — |
| Con foto principal | 18 de 41 (las 24 variantes, casi todas sin foto) | 1 de 3 |
| `product_images` | 12 filas, todas con `tipo_foto` NULL (ninguna «medidas», ninguna «ambiente») | 0 |
| Valores de atributo | **15, repartidos en 5 productos** (Basic S 7, 1300 3, tres grifos 2+2+1) | 7 |
| Atributos de empresa | 60, **los 60 con `grupo` NULL** | — |
| Ventajas (`datasheet_extra`) | 0 productos | — |
| Descripción larga / reclamo | 0 / 0 | — |
| Con las tres cotas | 12 | — |
| Filtros asignados / compatibilidades | 16 / 0 | — |
| Documentos | 6 | — |
| Plantilla | `standard` | `standard` |
| Logo (`fiscal_logo_url`) | sí (bucket público `company-logos`) | sí |
| `companies.primary_color` | `#28bce2` | `#2563eb` |
| `company_settings.pdf_brand_color` / `pdf_accent_color` | `#2563eb` / NULL | `#ebc924` / NULL |

Solo quedan **dos empresas**. Consecuencia para el diseño: la ficha tiene que quedar bien **con casi ningún dato**
(nombre, foto, tres cotas y poco más), que es lo que tiene hoy Infinity, y llenarse sola cuando llegue la importación
completa del maestro (738 productos, 3.455 valores, 503 ventajas, fotos por tipo).

Otros datos del esquema que cambian lo que decía el documento anterior [verificado]:
`product_attributes.grupo` **ya existe**; `product_compatibilities` **ya tiene** `cantidad` y `display_order`;
`product_images.tipo_foto` existe; `product_attribute_values` **no tiene** `data_type`; `company_settings` no tiene
columna de web; `companies` tiene `logo_url` y `primary_color`. Las 1.016 fotos del maestro son **todas `.webp`**.

### A.2 La ficha de producto de la empresa: «esa mierda de panel»

`src/app/(tenant)/productos/[id]/page.tsx` (498 líneas) **no es una ficha: es una pila de hasta 15 tarjetas plegables
de edición y configuración**, una debajo de otra, casi todas cerradas. [verificado]

| Orden | Lo que se ve | Fichero:línea |
|---|---|---|
| 1 | Cabecera: nombre, «Activo», stock, descripción corta, tipo en mayúsculas y, a la derecha, cinco controles en fila (Editar, activar, borrar, «📄 Ficha técnica», volver) | `page.tsx:181-271` |
| 2 | Aviso de actualización del catálogo y aviso de atributos críticos | `:273-280` |
| 3 | «📤 Compartir ficha técnica» (cerrada) | `:282-290` |
| 4 | «🪪 Datos extendidos (marca, claim, garantías, tags...)» (cerrada): 15 campos de formulario | `:292-307`, `extended-fields-panel.tsx:164-402` |
| 5 | Objetivos del extra del configurador | `:309-320` |
| 6 | «🎨 Ficha IAGUA — contenido del PDF» (solo plantilla IAGUA) | `:322-335` |
| 7 | «Modelo de equipo»: formulario de gama y variantes | `:337-346` |
| 8 | «🔁 Filtros y recambios (n)» (cerrada) | `:348-365` |
| 9 | «📁 Documentos y certificaciones (n/n)» (cerrada): dos formularios de subida | `:367-378`, `docs-and-certs-panel.tsx:163-269` |
| 10 | «Foto principal»: **un subidor de fichero**, sin `canEdit` en la página | `:380-382` |
| 11 | «Datos generales»: filas etiqueta/valor con «—» en lo vacío; el peso en gramos | `:385-408`, `:491-497` |
| 12 | «💰 Coste real (CMP)» | `:410-419` |
| 13 | «Código de barras del fabricante» con escáner | `:421-439` |
| 14 | «Stock y predicción»: formulario | `:441-459` |
| 15 | «Planes de precio (n)» (**cerrada**: el precio no se ve) | `:461-467` |
| 16 | «Atributos (n)» (**cerrada**): filas de edición con interruptores | `:469-479`, `attributes-panel.tsx:70-110` |
| 17 | Historial de precios | `:481-485` |

Lo que falla, en concreto:

- **La foto no se ve como foto.** Solo aparece dentro del subidor (10). No hay galería: `product_images` no se lee en
  toda la página.
- **Las características están escondidas y son un formulario** (16). No hay ficha técnica legible.
- **El precio está escondido** (15).
- **No hay ventajas, ni medidas dibujadas, ni variantes legibles, ni categoría.**
- **Lectura y edición mezcladas**: un comercial ve los mismos formularios que el administrador; los paneles de
  foto, stock, planes y atributos se pintan sin mirar `canEdit` en la página.
- **Emojis como iconos** en los títulos (📤 🪪 🎨 🔁 📁 💰 📄) y **«—»** en todo lo vacío.
- `collapsible-card.tsx` es correcto como pieza; el problema es usar 15 seguidas como estructura de página.

En cambio, la ficha del superadmin (`src/app/superadmin/catalogo/productos/[id]/page.tsx`, 276 líneas) ya es lo que
Mario quiere: cabecera, galería, características clave, ficha técnica por grupos, variantes, recambios y documentos;
dos columnas con pestañas en escritorio y bloques plegables con contador en móvil; «Editar» como acción aparte.

### A.3 Los generadores de ficha técnica

| Pieza | Estado [verificado] |
|---|---|
| `datasheet-pdf-v2.ts` (1.029 líneas) | Plantilla **`standard`**, la de las dos empresas. `pdf-lib`, Helvetica, coordenadas a mano. |
| `datasheet-iagua.ts` (630) | Plantilla `iagua`. Nadie la usa hoy. Portada con héroe azul marino, cuatro tarjetas, tabla y página 2 «por qué elegir». |
| `datasheet-iagua-html.tsx` (764) | satori → sharp → PNG incrustado. Solo con `?engine=html`. **El texto es una imagen.** |
| `datasheet-pdf.ts` (540) | v1, solo con `?v=1`. |
| `datasheet-pick.ts:28` | `iagua` → IAGUA; cualquier otra cosa o cualquier error → `standard`. |
| `api/pdf/product-datasheet/[id]/route.ts:43-60` | Admite `?t=`, `?v=1`, `?engine=html`. `Cache-Control: no-store` (`:66`). |
| `src/modules/config/pdf/` (`/configuracion/pdf`) | Dos tarjetas con icono (`form.tsx:14-31`), dos `input type="color"` (`:33-65`) y un `iframe` que regenera el PDF (`:171-176`). `actions.ts:44` convierte cualquier plantilla que no sea `iagua` en `standard`; `:57` solo admite esas dos. |

**Fallos encontrados**

1. **`data_type`: la tabla de características sale vacía en todos los PDF.** `product_attribute_values` no tiene esa
   columna (está en `product_attributes`) y la piden seis consultas, ninguna de las cuales mira `error`:
   `datasheet-pdf-v2.ts:433`, `datasheet-pdf.ts:231`, `datasheet-iagua.ts:195`, `datasheet-iagua-html.tsx:266`,
   `catalog-pdf-v2.ts:346` (catálogo PDF) y `app/datasheet/[token]/page.tsx:171` (ficha pública web). PostgREST devuelve
   error, `rows` queda `null` y la lista de atributos sale vacía. [verificado en el código y en el esquema; la respuesta
   de PostgREST no se ha reproducido]. El resto del código sí lo sabe: `critical-attrs-actions.ts:61` lo comenta.
   Ojo al arreglarlo: Infinity vería aparecer de golpe 15 valores, tres de ellos mal (Basic S: 55 Hz, 230 V, 2 L;
   auditoría §4.1).
2. **El «Color base» de `/configuracion/pdf` no llega a la plantilla `standard`.** La pantalla guarda
   `company_settings.pdf_brand_color` (`actions.ts:77-78`), pero v2 lee **`companies.primary_color`**
   (`datasheet-pdf-v2.ts:380-393`, `:407-412`), que solo cambia el superadmin (`superadmin/companies/actions.ts:317`).
   Infinity ve en su PDF el `#28bce2` de `companies`, no el `#2563eb` que figura en configuración. Lo mismo en la ficha
   pública (`datasheet/[token]/page.tsx:141-165`). IAGUA sí lee `pdf_brand_color` (`datasheet-iagua.ts:166`). Hay
   **tres sitios de color** que no se hablan.
3. **Las fotos `.webp` no salen.** v2 decide «PNG si la URL contiene `.png`, si no JPG» (`:663-669`); un `.webp` cae en
   `embedJpg`, lanza, y el `catch` lo calla. La importación del maestro copia la foto con su extensión
   (`catalog-copy-helpers.ts:182`) y las 1.016 del maestro son `.webp`: **todo producto importado del maestro saldrá
   sin foto en el PDF**. [verificado en el código; no ejecutado]
4. **La `standard` imprime el fabricante** (`manufacturer_name · manufacturer_model`, `datasheet-pdf-v2.ts:625-626`).
5. **Los grupos de la `standard` se adivinan por la clave en inglés** (`classifyAttribute`, `:185-213`) y salen como
   «HIDRÁULICO / RENDIMIENTO / OTROS DATOS», no como físicas, eléctricas, técnicas y extra.
6. **Nada usa las ventajas ni las fotos por tipo** en `standard` (`datasheet_extra` solo lo lee IAGUA).

### A.4 La lista de productos de la empresa

`src/app/(tenant)/productos/page.tsx` + `products-list-client.tsx` (616 líneas). [verificado]

- Es **una lista plana ordenada por nombre** (`actions.ts:37`, `.order("name")`), sin agrupar. La categoría es un
  desplegable dentro de un formulario de cinco campos con botón «Aplicar» (`page.tsx:164-242`).
- En Infinity salen **41 filas** mezcladas: «425», «525», «630», «COMPACT», «FIORD», «FIORD BLACK»… (variantes sin
  foto ni referencia) entre los equipos de verdad. Eso es el «desorden».
- Antes de la primera fila hay: cinco botones (`:94-127`), las alertas (`:130`), cuatro cajas de cifras (`:133-162`) y
  el formulario de filtros. A 390 px la lista empieza varias pantallas más abajo.
- La rejilla usa `object-cover` (`products-list-client.tsx:340`): recorta los equipos.
- La tabla de escritorio tiene `min-w-[800px]` (`:494`) y ocho columnas (`:505-512`); en móvil hay lista aparte (`:393`).
- Sin paginar: con el tope de 1.000 de PostgREST no es problema con 41, lo será al importar el maestro.

---

## B. Ficha técnica en PDF

### B.1 Lo que tiene la ficha de Osmofilter (estudiadas ATLANTIS, BLUE MOUNTAIN y FRIZZIA) [verificado en los PDF]

Solo como referencia de estructura. No se copia ni su logo, ni su azul, ni sus textos, ni su código de documento.

- **Una sola hoja A4 vertical**, siempre. Margen lateral de unos 10 mm.
- **Cabecera**: logo arriba a la izquierda (unos 43 mm de ancho), referencia arriba a la derecha, pequeña y gris, y un
  filete fino a todo el ancho.
- **Columna izquierda (≈ 40 %)**: la foto del equipo sobre un **panel de color muy pálido** (≈ 83 × 124 mm); debajo,
  el **dibujo de línea con las cotas** `a`, `b`, `c` (y `d` en BLUE MOUNTAIN); al pie de la columna, las **ventajas**:
  de tres a cinco filas con un icono de trazo dentro de un cuadrado pálido y un texto corto en negrita.
- **Columna derecha (≈ 50 %)**: cintillo «FICHA TÉCNICA»; **nombre** en negrita y en el color de la marca; una línea
  de subtítulo en gris; y los **grupos** en orden fijo: físicas, eléctricas, técnicas, extra. Cada grupo: título en
  mayúsculas del color de la marca, filete grueso oscuro debajo, y filas de **tres columnas**: etiqueta a la
  izquierda, **valor centrado**, **unidad en su propia columna** a la derecha. Filete fino entre filas.
- Al pie de la columna derecha, **«Consumibles»**: referencia, nombre y cantidad.
- **Pie**: filete; código del documento a la izquierda, web en el centro, «Datos técnicos sujetos a cambios sin previo
  aviso» a la derecha.
- **La hoja se adapta a la cantidad de datos encogiendo la fila**: ATLANTIS (23 filas) va a unos 6,8 mm por fila;
  BLUE MOUNTAIN (31 filas) baja a unos 5,4 mm y a letra más pequeña. Con pocos datos (FRIZZIA, 11 filas) **deja el
  papel en blanco**: no rellena.
- El grupo sin datos no aparece (FRIZZIA no tiene eléctricas).

### B.2 Nuestra hoja: estructura común (210 × 297 mm, margen 12 mm, ancho útil 186 mm)

```
┌──────────────────────────────────────────────────────────────┐ 0
│ [logo de la empresa]                              Ref. RO-104 │ 12–28   cabecera sobre papel
│ ──────────────────────────────────────────────────────────── │ 30      filete 0,35 pt
│ ┌────────────────────┐   Ficha técnica                        │ 36
│ │                    │   NOMBRE QUE LE HA PUESTO LA EMPRESA   │         nombre 20 pt, primario-trazo
│ │   panel (velo)     │   [Sobremesa] [Negro]  rasgos          │         fichas de rasgo
│ │                    │   Descripción corta, una o dos líneas  │
│ │   [ principal ]    │                                        │
│ │                    │   Características físicas ──────────── │         grupo: título + filete 1,1 pt
│ │   80 × 118 mm      │   a  Ancho                 290    mm   │         etiqueta / valor centrado / unidad
│ └────────────────────┘   b  Alto                  990    mm   │
│                              Peso                   32    kg   │
│ ┌────────────────────┐   Características eléctricas ───────── │
│ │  [ medidas ]       │   …                                    │
│ │  a ─ b ─ c         │   Características técnicas ─────────── │
│ │  sobre blanco      │   …                                    │
│ └────────────────────┘   Características extra ────────────── │
│                          …                                    │
│ ◇ Ventaja breve          Consumibles y recambios ──────────── │         ref · nombre · cantidad
│ ◇ Ventaja breve          FCC-22  Filtro …               1 ud. │
│ ◇ Ventaja breve          …                                    │ 270
│ ──────────────────────────────────────────────────────────── │ 276     filete
│ Empresa · teléfono · correo · web        [QR]    Rev. 26-11   │ 278–288 pie con los datos de la empresa
└──────────────────────────────────────────────────────────────┘ 297
```

| Bloque | Qué lleva | De dónde sale |
|---|---|---|
| **Cabecera** | Logo (caja máx. 46 × 14 mm, sobre papel, sin recuadro). A la derecha, «Ref.» + referencia de la empresa. | `company_settings.fiscal_logo_url` (si falta, `companies.logo_url`; si falta, el nombre comercial en texto). `products.internal_reference` [pregunta 4]. |
| **Identidad** | «Ficha técnica», nombre, rasgos de la variante en fichas, descripción corta. | `products.name`, `rasgos_identificacion`, `short_description`. **Nunca** `manufacturer_*`. |
| **Foto** | La principal sobre un panel `velo` de la paleta. `contain`, apoyada abajo. | `product_images` con `tipo_foto='principal'`; si no, `main_image_url`. **Se pasa por `sharp` a PNG** (arregla el fallo de `.webp`). |
| **Medidas** | Dibujo de cotas sobre blanco y, en la tabla de físicas, la letra delante de su fila. | `tipo_foto='medidas'`. **Si no hay dibujo pero sí las tres cotas** (12 productos de Infinity), se dibuja un **alzado y un perfil de caja** con vectores y las letras `a`, `b`, `c` [decide]; sustituye al isométrico de v2 (`drawIsoBox`, `:238`). Con menos de tres cotas, no hay dibujo. |
| **Ventajas** | De 0 a 5: icono reentintado con la tinta de la paleta + texto breve. | `products.datasheet_extra.features[]` (`title`, `desc`, `icon`). Sin icono propio, un rombo de la paleta. |
| **Características** | Cuatro grupos en orden fijo. Pares mín./máx. unidos («2–6 bar»). Sí/No como texto. | `product_attribute_values` visibles + `product_attributes (key, name, unit, data_type, grupo, sort_order, cloned_from_global_id)`. Grupo: el del atributo; si es NULL, el del global del que se clonó; si tampoco, la clasificación por clave de v2 llevada a los cuatro grupos; si nada, «técnicas». Cotas y peso (`dim_*`, `weight_grams`) encabezan «físicas». |
| **Consumibles y recambios** | Ref, nombre, cantidad. | `product_filter_assignments` (lo que hoy sale como «mantenimiento recomendado») + `product_compatibilities` (`cantidad`). Interruptor en configuración [pregunta 5]. |
| **Documentos** | No se listan en el papel. **Un QR** en el pie lleva a la ficha web, donde están. | Enlace `product_datasheet` **sin caducidad** y revocable, creado o reutilizado para el QR. `qrcode` ya está instalado. |
| **Pie** | Razón social, teléfono, correo, web y ciudad de la empresa; revisión (fecha de última modificación del producto); «Datos sujetos a cambios sin previo aviso». | `company_settings.fiscal_*` + `datasheet_opciones.web` (columna nueva, §C.4). |

**Regla de la Hoja Única** (cómo cabe siempre en una hoja):

1. La fila mide 6,8 mm con letra de 8,5 pt. Si el contenido no cabe en la columna derecha, baja de 0,2 en 0,2 mm hasta
   **4,6 mm y 7 pt** (el mínimo legible; BLUE MOUNTAIN con 31 filas cabe a 5,4).
2. Si a 4,6 mm sigue sin caber: los consumibles pasan a una **hoja 2** con la misma cabecera y el mismo pie.
3. Si aún no cabe: los grupos que sobren continúan en la hoja 2 con «(continuación)». Un grupo no se parte si cabe entero.
4. **Con pocos datos no se rellena ni se estira**: los bloques suben y lo que sobra es papel. Si hay descripción larga,
   ocupa el hueco bajo la descripción corta (hasta 420 caracteres). Si hay menos de seis filas, las ventajas suben a
   la columna derecha, bajo la tabla.
5. Sin foto: la columna izquierda la encabeza el dibujo de medidas; sin foto ni medidas, las dos columnas se funden y
   la tabla va a todo el ancho en dos columnas.

Todos los anchos se miden con `font.widthOfTextAtSize` antes de pintar; un valor que no cabe en su columna (p. ej.
«100-240V~50/60Hz») ocupa también la columna de la unidad, como hace la referencia.

### B.3 Las tres plantillas

Mismo esqueleto, mismos datos, mismo cargador. Cambia el tratamiento de cabecera, panel de foto, títulos y densidad.

| | **«Tarifa»** | **«Escaparate»** | **«Placa»** |
|---|---|---|---|
| Idea | La más parecida a la referencia. Papel blanco y línea fina. | La misma hoja con una **franja de color** arriba: comercial. | La misma hoja **compacta y en rejilla**, pensada para imprimir en blanco y negro. |
| Para quién | Predeterminada de las empresas nuevas. Instaladores, distribuidores, adjunto de presupuesto. | Venta a particular, comerciales a domicilio. | Técnicos, empresas que imprimen mucho, productos con muchos datos. |
| Cabecera | Logo sobre papel, ref a la derecha, filete. | Franja a sangre de 46 mm en `primario-campo` con el nombre encima (texto en el color calculado). El logo, en una **pestaña blanca** pegada al borde superior. | Rejilla de tres celdas: logo · nombre y rasgos · referencia (la única celda en `primario-campo`). |
| Foto | Panel `velo`, esquinas vivas. | Sin panel: el equipo **pisa el borde** de la franja 22 mm y se apoya en una línea. | Celda de 58 mm de ancho; el dibujo de medidas a su lado. |
| Títulos de grupo | Texto en `primario-trazo` + filete de 1,1 pt en tinta. | Texto en tinta + filete de 1,6 pt en `primario-trazo`. | Celda a todo el ancho en `velo`. |
| Filas | Etiqueta / valor centrado / unidad, filete fino. | Igual, fila mínima 5 mm. | **Campos de placa** en tres columnas: etiqueta pequeña arriba, valor en mono debajo. 41 atributos caben en 14 filas. |
| Ventajas | Columna izquierda, abajo. Icono 9 mm sin cuadrado de fondo. | En fila horizontal bajo la franja, icono 11 mm. | Franja de una línea: solo icono 6 mm y texto breve. |
| Pie | Una línea con filete. | Pieza de contacto: teléfono en 16 pt en `acento-texto`. | Rejilla: empresa · contacto · QR. |
| Radios | 0 en todo; 0,6 mm en las fichas de rasgo. | 0 a sangre; 3 mm en la pestaña del logo (solo abajo); 1,6 mm en fichas. | 2,5 mm en el marco exterior; 0 dentro. |
| Uso del color | Primario como trazo y como velo. Acento en un sitio: la letra de las cotas. | Primario como campo. Acento en el teléfono. | Tinta para casi todo. Primario en una celda y en el marco. |
| Gesto único | El panel pálido con el equipo apoyado. | El equipo pisa el borde. | Los campos de placa. |

Tipografía **[sin verificar: descargar, comprobar licencia OFL y autoalojar en `src/modules/products/fonts/`]**: una
grotesca para texto y títulos (candidata: Archivo, pesos 430 / 590 / 640) y una monoespaciada para valores y
referencias (candidata: Martian Mono 470). Poppins no se usa: es la letra de IAGUA. Si la incrustación de fuentes
propias falla (§B.4), las tres plantillas funcionan con Helvetica sin cambiar la maquetación, porque todo se mide.

### B.4 Motor: **`pdf-lib`** (lo que hay), con `sharp` y, si pasa la prueba, `@pdf-lib/fontkit`

Hechos comprobados en el repositorio:

- `package.json`: `pdf-lib ^1.17.1` (`:56`), `qrcode ^1.5.4` (`:57`), `satori ^0.26.0` (`:64`), `satori-html` (`:65`),
  `sharp ^0.34.5` (`:67`). **No hay** Chromium, Puppeteer, Playwright ni `@pdf-lib/fontkit`.
- `next.config.ts:26-32`: `serverExternalPackages: ["satori","sharp"]` y las fuentes empaquetadas **solo** para
  `/api/pdf/product-datasheet/[id]`; la ruta pública `/datasheet/[token]/pdf` no las lleva.
- La `standard` ya pinta con `pdf-lib` logo, foto, tablas, dibujo isométrico y pie: todo lo que pide la hoja de §B.2
  es lo mismo con otra rejilla.
- El PDF se genera en servidor sin navegador y se adjunta a correos (`email-share-actions.ts`).

| | `pdf-lib` (recomendado) | HTML + Chromium en Vercel | satori → PNG (ya escrito) |
|---|---|---|---|
| Texto del PDF | Vectorial, se selecciona y se busca | Vectorial | **Imagen** [verificado: `embedPng`] |
| Dependencias nuevas | `@pdf-lib/fontkit` (opcional, JS puro) | `@sparticuz/chromium` + `puppeteer-core` | ninguna |
| Riesgo de despliegue | Ninguno nuevo: es el motor de producción | Tamaño de la función, arranque en frío, memoria y coste **sin medir** | Bajo |
| Fotos `.webp` | Hay que convertir con `sharp` (instalado) | Nativo | Hay que convertir |
| Tipografía propia | Solo con `fontkit`; sin él, Helvetica y el saneador WinAnsi (`shared/lib/pdf/dashstack.ts:87`) que cambia por «?» lo que no conoce | Cualquiera | TTF |
| Maquetación | Coordenadas a mano. Asumible: **una rejilla fija** y un cargador común | CSS completo | Flex limitado |
| Vista previa en vivo | Hay que hacerla aparte, en HTML (§C.3) | La misma hoja HTML | Aparte |
| Plazo | Fases de uno o dos días cada una | Exige una fase 0 de prueba que puede no pasar | — |

**Recomendación: `pdf-lib`.** El documento anterior recomendaba Chromium porque eran tres maquetaciones distintas de
varias hojas, con cajetín en rejilla y texto fluyendo. Lo que Mario pide ahora es **una hoja de rejilla fija**: eso es
exactamente lo que `pdf-lib` hace bien y ya hace en producción. Chromium añadiría una dependencia pesada y un riesgo
sin medir para resolver un problema que ya no tenemos.

Lo que se paga: la vista previa de configuración no puede ser «la misma hoja» y se hace como **maqueta HTML** (§C.3).
Se acepta porque la maqueta solo tiene que enseñar plantilla y color; el PDF real está a un toque.

Organización para no repetir las 1.029 líneas de v2 **[decide]**: un **cargador único** (`cargarFicha`) que devuelve un
modelo normalizado; un módulo de **primitivas** (texto medido, fila de tabla, imagen en caja, QR, dibujo de cotas);
y **un fichero por plantilla** que solo coloca piezas. La maqueta HTML y la ficha de producto en pantalla (§D) leen
el mismo modelo.

Prueba de `fontkit` (media hora, dentro de la fase del motor): incrustar una TTF con `subset: true`, generar en
Vercel, comprobar que el texto se selecciona y que salen «º», «≤», «™» y «³». **[sin verificar]** Si falla, Helvetica.

Chromium queda como opción futura solo si algún día se piden fichas de varias páginas con maquetación libre.

### B.5 Qué pasa con las fichas que ya existen

Regla de Mario: **a Infinity no se le rompe nada; lo que cambie se le propone y lo acepta ella.**

- `standard` e `iagua` **no se tocan ni se borran**. `datasheet-pick.ts` gana tres ramas (`tarifa`, `escaparate`,
  `placa`) y **conserva su caída a `standard` ante cualquier error**.
- La migración (§C.4) **no actualiza ninguna fila**: Infinity y aquaroo siguen en `standard` con el mismo PDF, byte a
  byte comparable.
- En `/configuracion/pdf`, quien esté en `standard` o `iagua` la ve marcada como «la que usas ahora», dentro de
  «Plantillas anteriores». Nada cambia hasta que elija otra y pulse Guardar. Puede volver.
- **Proponer, no imponer.** Encima de las plantillas, un aviso para quien siga en una antigua: «Hay plantillas nuevas.
  Mira cómo quedaría tu ficha» → abre la **comparación** de un producto suyo: su ficha actual a un lado y la «Tarifa»
  con su logo y su color al otro (dos PDF reales, `?t=standard` y `?t=tarifa`). Botón «Usar esta».
- **Arreglo de `data_type` en las antiguas**: es cambiar la consulta en seis sitios. **No va en este trabajo** salvo
  que Mario lo diga [pregunta 3], porque a Infinity le aparecerían valores que hoy no ve (tres de ellos erróneos).
  Las plantillas nuevas nacen bien: piden `data_type` al atributo y miran `error`.
- Empresas nuevas: nacen con `tarifa` **[pregunta 1]**. Se hace en el alta de empresa (código), no cambiando el
  `default` de la columna, para que una fila sin tocar siga significando `standard`.

---

## C. Paletas a partir del color de la marca

### C.1 Cómo se calcula

Se mantiene la función pura `derivarPaleta(primario, acento)` del documento anterior (§5), en OKLCH y midiendo con la
fórmula de contraste de WCAG 2. De dos colores salen todas las tintas:

| Ficha de color | Cálculo | Garantía |
|---|---|---|
| `papel` | `#FFFFFF` | — |
| `tinta` | OKLCH(L 0,24 · C mín(C del primario, 0,04) · H del primario). Nunca negro puro. | ≥ 14:1 sobre `velo` |
| `tinta-suave` | la tinta con L 0,48 | ≥ 4,5:1 sobre papel |
| `velo` (fondo del panel de foto) | OKLCH(L 0,965 · C mín(C, 0,02) · H) | — |
| `primario-campo` | El primario. Si ni el blanco ni la tinta dan 4,5:1 encima, se mueve L de 0,01 en 0,01 hasta que lo den. | texto encima ≥ 4,5:1 (**AA**) |
| `sobre(campo)` | Blanco o tinta: el que más contraste dé. | — |
| `primario-trazo` (títulos, filetes) | El primario oscurecido hasta 4,5:1 sobre papel. Si hacen falta más de 25 pasos (amarillos, pasteles), títulos y filetes van en tinta y el primario queda solo como campo. | ≥ 4,5:1 (**AA**) |
| `acento-texto` / `acento-marca` | El acento oscurecido hasta 4,5:1 / 3:1. | AA texto / AA gráficos |

Al bajar L, si el color sale de gama se reduce el croma. El prototipo anterior lo comprobó sobre 4.096 colores (peor
contraste de texto 4,50); el ejecutor lo deja como test que falla si un par baja de su umbral.

### C.2 Las tres propuestas

Desde **un color base** B (L, C, H en OKLCH) se proponen tres paletas. No son carta de moda: son tres maneras de usar
el color de la empresa.

| Propuesta | Primario | Acento | Carácter |
|---|---|---|---|
| **«Marca sola»** | B | B con L − 0,22 (mínimo 0,30), mismo tono | Monocroma. La más segura. |
| **«Marca y contrapunto»** | B | Si el logo tiene un segundo color (tono a más de 40° de B y croma > 0,06), ese. Si no, el complementario: OKLCH(0,62 · 0,13 · H + 180°). | Dos colores. La más viva. |
| **«Sobria»** | OKLCH(0,30 · mín(C, 0,05) · H): pizarra teñida de la marca | B | Oscura y documental; la marca solo como acento. |

Calculado en esta sesión con un prototipo suelto (no está en el repo) sobre los colores **reales** de producción:

| Base | Propuesta | Primario → texto encima | Trazo | Acento como texto |
|---|---|---|---|---|
| Infinity `#28bce2` (`companies.primary_color`) | Marca sola | `#28BCE2` → tinta `#04232C` · 7,3:1 | `#0E819C` | `#0F748D` · 5,4:1 |
| | Marca y contrapunto | igual | `#0E819C` | `#C66845` → `#B95C39` · 4,5:1 |
| | Sobria | `#07333F` → blanco · 13,5:1 | `#07333F` | `#28BCE2` → `#0E819C` · 4,5:1 |
| Infinity `#2563eb` (`pdf_brand_color`) | Marca sola | `#2563EB` → blanco · 5,2:1 | `#2563EB` | `#002686` · 13,0:1 |
| | Marca y contrapunto | igual | `#2563EB` | `#AB7E07` → `#98700C` · 4,5:1 |
| | Sobria | `#202D47` → blanco · 13,7:1 | `#202D47` | `#2563EB` · 5,2:1 |
| aquaroo `#ebc924` (amarillo) | Marca sola | `#EBC924` → tinta `#251F07` · 10,1:1 | **solo campo**: títulos en tinta | `#9D8508` → `#897305` · 4,6:1 |
| | Sobria | `#352E0D` → blanco · 13,6:1 | `#352E0D` | `#897305` · 4,6:1 |

En los nueve casos, tinta sobre velo: 14,9:1.

**De dónde sale el color base**, por este orden:

1. **Del logo.** Acción de servidor `extraerColoresLogo`: descarga `fiscal_logo_url`, lo reduce con `sharp` a 64 px,
   descarta píxeles transparentes, casi blancos (L > 0,93), casi negros (L < 0,18) y grises (C < 0,04), agrupa por
   tono en 12 sectores y devuelve hasta **tres** colores por peso. Si el logo es SVG, negro o no se puede leer,
   devuelve lista vacía y se pasa al punto 2. **[sin verificar con los dos logos reales]**
2. **De lo que ya tiene la empresa**: `companies.primary_color` y `company_settings.pdf_brand_color`, como fichas
   para tocar («Los colores que ya tenías»).
3. **A mano**: selector de color y campo hexadecimal.

### C.3 La pantalla `/configuracion/pdf` (la que existe, rehecha)

Tres pasos en una página, sin asistente. Se guarda todo junto con un solo botón.

1. **Plantilla.** Tres tarjetas —Tarifa, Escaparate, Placa— con una **miniatura real** de la hoja (la maqueta de
   abajo a escala, con el logo y el producto de muestra de la empresa), el nombre y una línea de para quién es.
   Debajo, plegado, «Plantillas anteriores»: Estándar e IAGUA.
2. **Colores de tu marca.** Una fila «Sacados de tu logo» con las fichas detectadas (o el botón «Sube tu logo» que
   lleva a `/configuracion/fiscal` si no hay), «Los que ya tenías» y «Otro color». Al tocar un color aparecen las
   **tres propuestas** como tres **fichas en miniatura** (panel de foto, título y filete pintados con la paleta
   calculada), no como círculos sueltos: se ve el resultado, no el ingrediente. Debajo, plegado, «Ajustar a mano»:
   primario y acento con sus dos selectores. Avisos calculados:
   - primario «solo campo»: «Tu color es claro: en fondos sale tal cual; en títulos y líneas usamos una tinta oscura
     para que se lea.»
   - primario y acento a menos de 0,10 en OKLab: «Tus dos colores se parecen mucho: el acento no destacará.»
3. **Datos del pie y qué se enseña.** Teléfono, correo y web (por defecto, los fiscales) e interruptores: consumibles
   y recambios, variantes de la gama, QR.

**Vista previa en vivo.** Componente `VistaPreviaFicha`: una **maqueta HTML** de la hoja 1 (caja con
`aspect-ratio: 210/297`, medidas en `cqw`), con el logo real, el producto de muestra y la paleta en variables CSS.
Cambiar de color o de plantilla la repinta **sin ir al servidor**. Es una maqueta: enseña estructura y color, no cada
milímetro; por eso lleva al lado el botón **«Ver PDF real»**, que abre `/api/pdf/product-datasheet/[id]?t=…&p=…&a=…`
con los valores sin guardar (solo administrador, hex validado). No se usa `iframe` de PDF: en móvil no se pinta.
**[sin verificar en el WebView de la app]**

Producto de muestra: el que tenga más datos (foto, más valores de atributo), no «el más reciente» como hoy
(`configuracion/pdf/page.tsx:19-31`), con un desplegable para cambiarlo.

**Escritorio (≥ 1024 px):** controles a la izquierda (400 px) y la hoja a la derecha, pegada al desplazarse.

**A 390 px:**

```
┌────────────────────────────────┐
│ ← Configuración                │
│ Fichas técnicas                │
│ Plantilla                      │
│ ┌────────┐┌────────┐┌────────┐ │  carrusel con ajuste; tarjeta de 132 px con su miniatura;
│ │ Tarifa ││Escapar.││ Placa  │ │  la elegida, con marco de 2 px
│ └────────┘└────────┘└────────┘ │
│ Colores de tu marca            │
│ De tu logo   ■  ■              │  fichas de 48 × 48 px
│ Otro color   [ # ______ ]      │
│ ┌────────┐┌────────┐┌────────┐ │  las tres propuestas: 108 × 76 px cada una
│ │ Marca  ││Contrap.││ Sobria │ │
│ └────────┘└────────┘└────────┘ │
│ Datos del pie …                │
├────────────────────────────────┤
│ [▯ hoja]  Ver ficha    Guardar │  barra fija: miniatura viva de 40 px; «Ver ficha» abre la
└────────────────────────────────┘  maqueta a pantalla completa (358 px de ancho) con «Ver PDF real»
```

La barra respeta `--safe-bottom`. «Guardar» solo se activa si hay cambios. Salir sin guardar no cambia nada.

### C.4 Dónde se guarda: migración aditiva

`supabase/migrations/20261129100000_fichas_plantillas_paleta.sql` (descrita; **no aplicar sin Mario**):

```sql
-- 1) Plantillas nuevas: el CHECK pasa a ser un superconjunto. El default sigue siendo 'standard'.
alter table public.company_settings drop constraint if exists company_settings_datasheet_template_check;
alter table public.company_settings add constraint company_settings_datasheet_template_check
  check (datasheet_template in ('standard','iagua','tarifa','escaparate','placa'));

-- 2) Paleta propia de las fichas. NULL = se deriva de companies.primary_color al pintar.
alter table public.company_settings add column if not exists datasheet_palette jsonb;
--   { "propuesta": "marca_sola" | "contrapunto" | "sobria" | "manual",
--     "base": "#RRGGBB", "primario": "#RRGGBB", "acento": "#RRGGBB" }
alter table public.company_settings add constraint company_settings_datasheet_palette_check check (
  datasheet_palette is null or (
    jsonb_typeof(datasheet_palette) = 'object'
    and datasheet_palette->>'primario' ~* '^#[0-9a-f]{6}$'
    and datasheet_palette->>'acento'   ~* '^#[0-9a-f]{6}$'));

-- 3) Opciones de la ficha. NULL = valores por defecto.
alter table public.company_settings add column if not exists datasheet_opciones jsonb;
--   { "telefono": "...", "correo": "...", "web": "...",
--     "mostrar_recambios": true, "mostrar_variantes": true, "mostrar_qr": true }
```

- **No toca ninguna fila.** Los generadores antiguos no leen las columnas nuevas.
- Se guardan `primario` y `acento` **ya resueltos**, no solo la propuesta: si mañana se retoca la fórmula, la ficha
  de una empresa no cambia de color sola.
- **No se escribe en `pdf_brand_color`, `pdf_accent_color` ni `companies.primary_color`** desde la pantalla nueva: los
  leen también el catálogo PDF, los correos (`mailing/company-context.ts:70`) y el cron de recordatorios
  (`api/cron/maintenance-reminders/route.ts:322`). Los dos selectores viejos se quedan dentro de «Plantillas
  anteriores», con el texto corregido (hoy prometen algo que la `standard` no hace, §A.3-2).
- En código: ampliar `DatasheetTemplate` y el `z.enum` (`config/pdf/actions.ts:10`, `:44`, `:57`).
- `products.datasheet_color_accent` (acento por producto) **no se usa** en las plantillas nuevas [decide]: manda la
  paleta de la empresa. El campo sigue donde está para `standard` e IAGUA.

---

## D. Ficha de producto dentro de la empresa (pantalla)

### D.1 El cambio

De «pila de 15 paneles» a **una ficha que se lee de arriba abajo como la del superadmin**, con la edición en una
ruta aparte. Dos pantallas:

- `/productos/[id]` — **ficha de lectura**. La ve todo el mundo (oficina; el técnico sigue fuera por
  `productos/layout.tsx`). Ningún `input`, ningún interruptor, ningún subidor.
- `/productos/[id]/editar` — **edición por secciones**. Solo `isProductEditor`. Aquí viven, sin reescribirlos, los
  paneles de hoy.

### D.2 Qué se ve arriba (lectura)

1. **Migas y vuelta**: `← Dispensadores` (vuelve a la categoría de la que viene, no a la lista general).
2. **Galería**: foto principal grande, `object-contain` sobre `bg-muted`; el resto de `product_images` debajo,
   agrupadas por tipo. Sin foto: no hay recuadro gris para los lectores; el editor ve «Añadir foto».
3. **Identidad**: categoría en pequeño, **nombre**, rasgos de la variante, `Ref.` en mono. Estado en dos insignias
   como mucho: «Inactivo» (si lo está; «Activo» no se anuncia) y stock («Hay stock» / «Sin stock»; con unidades
   para quien ve el coste, como hoy en `page.tsx:165-177`).
4. **Precio**, a la vista: «Contado 1.290 €» y «desde 39 €/mes» si hay planes de cuota (de `listPricingPlans`).
   Sin planes: nada para el lector; para el editor, «Sin precio · Añadir».
5. **Descripción corta** y, plegada si pasa de cuatro líneas, la larga.
6. **Acciones**: «Ficha técnica» (abre el PDF), «Compartir» (abre `ShareDatasheetPanel` en una hoja `ui/sheet`) y,
   solo para el editor, «Editar».

### D.3 El cuerpo (lectura)

| Sección | Contenido | Componente |
|---|---|---|
| Características clave | Ventajas con icono | `FichaVentajas` (del superadmin) |
| Ficha técnica | Los cuatro grupos, con el dibujo de medidas junto a las físicas y las cotas a/b/c | `agruparCaracteristicas` + `FichaTecnica` / `TablaCaracteristicas` |
| Variantes de la gama | Miniatura, rasgo, ref; la actual, marcada | `FichaVariantes` (con `hrefDe`) |
| Filtros y recambios | Lista de lectura: miniatura, ref, nombre, cada cuántos meses o cantidad | `FichaRecambios` (con `hrefDe`) |
| Documentos y certificaciones | Por apartado, con descarga | `FichaDocumentos` |
| Garantía | Una línea: «General 24 meses · Electrónica 12» | nuevo, mínimo |
| Gestión *(solo quien ve el coste)* | Tres resúmenes de una línea, cada uno con su enlace a editar: **Stock** («12 ud · mínimo 4 · 3 almacenes»), **Coste** («CMP 412,00 €»), **Historial de precios** (último cambio) | nuevo, mínimo |

Regla «Sin Dato, Sin Hueco»: sección sin datos **no se pinta** para el lector. Para el editor, todas las secciones
vacías se resumen en **una sola tarjeta** arriba del cuerpo: «A esta ficha le falta: foto · características ·
ventajas · medidas», cada palabra enlazada a su sección de edición. Sustituye a tener quince paneles vacíos; convive
con `CatalogUpdateBanner` y `CriticalAttributesBanner`, que se quedan arriba.

Con los datos de hoy, una ficha de Infinity enseñará: foto, nombre, precio, descripción corta, físicas (cotas y
peso), filtros (si tiene) y la tarjeta «le falta…». Es corta, pero es una ficha.

### D.4 Qué va dentro de Editar (`/productos/[id]/editar`)

Secciones con ancla, cada una guarda lo suyo (los paneles de hoy, **movidos tal cual**):

| Sección | Panel que se reutiliza |
|---|---|
| Datos | `ProductEditButton` pasa de modal a sección (`edit-form.tsx`), + `ExtendedFieldsPanel` |
| Fotos | `ProductPhotoUploader` |
| Características | `AttributesPanel` |
| Ventajas y textos de la ficha | `DatasheetIaguaPanel`, generalizado en una fase posterior (ventajas con icono para todas las plantillas) |
| Gama y variantes | `PanelModeloProductoCard` |
| Filtros y recambios | `ProductFiltersPanel` |
| Documentos y certificaciones | `DocsAndCertsPanel` |
| Precio | `PricingPlansPanel` |
| Stock | `ProductStockPanel` + código de barras (`BarcodeScanner`) |
| Configurador | `ExtraTargetsPanel` (si procede) |
| Zona delicada | Activar / desactivar y borrar (`ProductActiveToggle`, `DeleteProductButton`) |

- Móvil: un `CollapsibleCard` por sección, **todas cerradas salvo la que llega por el ancla** (`?seccion=precio`).
- Escritorio: menú lateral de secciones a la izquierda, la sección a la derecha.
- `?abrir=filtros` (enlace de «Necesitamos tu ayuda», `page.tsx:67-68`) se redirige a `/editar?seccion=filtros`.
- Se quitan los emojis de los títulos: iconos de `lucide-react` o nada.

### D.5 A 390 px y en escritorio

**390 px** (una columna):

```
┌────────────────────────────────┐
│ ← Dispensadores                │
│ ┌────────────────────────────┐ │  galería a todo el ancho, deslizable con ajuste,
│ │        [ foto ]            │ │  puntos de posición
│ └────────────────────────────┘ │
│ Dispensadores                  │
│ Infinity Basic S               │  nombre 24 px
│ Ref. IA-104      [Hay stock]   │
│ Contado 1.290 € · desde 39 €/mes│
│ Dispensador de sobremesa…      │
│ ┌ Le falta: características ·…┐│  solo editor
│ ▾ Características clave      4 │  bloques plegables con contador;
│ ▾ Características físicas    4 │  abiertos: clave y físicas
│ ▸ Características técnicas  14 │
│ ▸ Variantes de la gama       3 │
│ ▸ Filtros y recambios        5 │
│ ▸ Documentos                 2 │
├────────────────────────────────┤
│ [ Ficha técnica ] [Compartir][✎]│  barra fija: acción principal ancha, 44 px de alto,
└────────────────────────────────┘  `pb` con `--safe-bottom`
```

Tablas en dos columnas etiqueta / valor, sin desplazamiento lateral: si el valor no cabe, baja a su línea.

**Escritorio (≥ 1024 px)**: dos columnas 5 / 7 como el superadmin. Izquierda fija (`sticky`): vuelta, galería,
identidad, precio, descripción y las tres acciones. Derecha: `ui/tabs` — **Ficha** (clave + ficha técnica) ·
**Variantes** · **Recambios** · **Documentos** · **Gestión** (solo quien ve el coste).

---

## E. Lista de productos de la empresa por categorías

### E.1 Entrada: kiosco de categorías

`/productos` sin filtros enseña **categorías, no productos**.

- Una tarjeta por categoría **con productos**: foto del primer producto con imagen de esa categoría
  (`object-contain` sobre `bg-muted`), nombre y «12 productos». Las categorías vacías no salen; el editor ve al final
  «3 categorías vacías · Gestionar» → `/configuracion/productos`.
- Orden **[decide]**: por número de productos, como el kiosco del superadmin (el `sort_order` de Infinity vale 0 en
  la mitad de sus categorías y no sirve). En Infinity: Fuente 12 · Dispensadores 12 · Osmosis Inversa 7 · Grifos 7 ·
  Ósmosis flujo directo 1 · Horeca 1 · Enfriador 1.
- Tarjetas aparte: «Sin categoría» (si hay) y «Filtros y recambios» (→ `/productos/filtros`, que ya existe).
- **Sin arcoíris**: todas las tarjetas del mismo color (`bg-card` con borde); lo que distingue a una categoría es su
  **foto** y, si no hay ninguna, un icono de `categorias-estilo.ts` en `text-muted-foreground`. No se usan sus
  fondos pastel (`bg-sky-100`, `bg-emerald-100`, `bg-amber-100`…, `categorias-estilo.ts:43-81`).
- 390 px: rejilla de 2 columnas, tarjeta de 148 px de alto. Escritorio: 4 columnas.
- Arriba: **buscador** a todo el ancho y, a la derecha, «Nuevo producto» (editor). El resto de botones de hoy
  (Catálogo PDF, Configuración, Filtros) pasan a un menú «Más».
- Las cuatro cajas de cifras (`page.tsx:133-162`) se convierten en **una fila de fichas que filtran**: «41 productos»,
  «N sin precio», «23 sin foto» (cifras de Infinity; la de precio no la he consultado). Solo para quien las ve hoy. Las alertas (`ProductSmartAlerts`) se quedan, plegadas en
  una línea.

### E.2 Dentro de una categoría: `/productos?cat=<id>`

- Cabecera: `← Categorías`, nombre de la categoría y el recuento («12 productos», y cuántos modelos son una vez plegadas las gamas).
- **Las gamas, como carpeta**: la cabeza de gama se pinta como `TarjetaCarpeta` («FIORD · 4 variantes») y al tocarla
  se entra en `?cat=…&gama=<id>`, donde salen sus variantes con el rasgo que las distingue. Así los 41 de Infinity se
  ven como 17 entradas.
- Vista por defecto **[decide]**: **filas** en móvil y **rejilla** en escritorio, con conmutador.
- **Fila** (reutiliza `FilaProducto`): a la izquierda, el **recuadro de stock** (en el superadmin ese hueco enseña
  empresas; aquí es su sitio natural, como en la tarifa): verde con las unidades para quien las ve, verde con un
  visto para el comercial, gris si no hay o no se gestiona. Centro: nombre, ref en mono, insignias («Inactivo»,
  «Sin precio», «Actualización disponible», «4 variantes»). Derecha: miniatura de 56 px y, debajo en escritorio, el
  precio de contado.
- **Tarjeta de rejilla** (reutiliza `TarjetaRejilla`): foto cuadrada `object-contain`, nombre, ref, precio.
- Sin foto: icono `ImageOff` discreto, como en el superadmin. Nunca `object-cover`.

### E.3 Buscar y filtrar

- **Buscador** (`BuscadorCatalogo`): al escribir se sale del kiosco y se listan resultados de **todas** las
  categorías, cada fila con la insignia de su categoría. Busca en nombre, referencia interna y rasgos.
- **Filtros**: Tipo (equipo, accesorio, consumible, servicio), Estado (activos / inactivos), Tag, y para el editor
  «Sin precio», «Sin foto», «Con actualización». En móvil, botón «Filtros (2)» que abre `ui/sheet`; los activos,
  como fichas que se quitan con un toque (patrón de `ListaFiltros`). Se aplican al tocar, sin botón «Aplicar».
- **Selección múltiple** (`ProductBulkToolbar`): se conserva solo en escritorio y solo para el editor, detrás de un
  botón «Seleccionar» que cambia a la vista de tabla actual. No está encendida por defecto.
- Todo en la URL (`cat`, `gama`, `q`, `tipo`, `estado`, `tag`, `vista`), para que «volver» funcione.

### E.4 Reutilización de los componentes del superadmin

Hoy están acoplados al superadmin por las rutas escritas dentro y por los tipos de `catalogo-lectura.ts`. [verificado]

| Componente | Se reutiliza | Qué hay que tocar |
|---|---|---|
| `ficha-galeria.tsx`, `ficha-caracteristicas.tsx`, `ficha-ventajas.tsx`, `ficha-tecnica.tsx`, `ficha-documentos.tsx` | Tal cual | Nada: son de presentación. Solo cambiar de carpeta. |
| `ficha-variantes.tsx` | Sí | Ruta fija en `:19` → prop `hrefDe(id)`. |
| `ficha-recambios.tsx` | Sí | Ruta fija en `:35` → prop `hrefDe(id)`. |
| `fila-producto.tsx` | Sí | Ruta fija en `:39` → prop `href`; el recuadro izquierdo (`:42-55`) → prop `recuadro` (empresas en superadmin, stock en empresa); insignias por prop. |
| `tarjeta-producto.tsx` | Sí | Ruta fija en `:49` → prop `href`. `TarjetaCarpeta` ya recibe `href` (`:71`). |
| `kiosco-categorias.tsx` | Sí | `BASE` fijo (`:12`) → prop; la tarjeta admite foto y modo neutro. |
| `lista-filtros.tsx` (444 líneas) | Parcial | El buscador y el patrón hoja + fichas sí; las claves de filtro (`fab`, `fam`) son del maestro. Se extrae el armazón y cada pantalla le pasa su lista de filtros. |
| `categorias-estilo.ts` | Solo los iconos | Va por clave global; la categoría de empresa se traduce por `cloned_from_global_id` (5 de las 10 de Infinity la tienen) y, si no, por `tipo_equipo`. |

**[decide]** Los compartidos se mueven a `src/modules/catalogo-vista/` y `src/modules/superadmin/catalogo/` deja un
reexport de cada uno, para que el superadmin no cambie ni una importación en la misma fase.

Lectura de datos: un módulo nuevo `src/modules/products/productos-lectura.ts` (`leerKioscoEmpresa`,
`leerListaEmpresa`, `leerFichaEmpresa`) con cliente de sesión (RLS), que devuelve las mismas formas que usan los
componentes (`ItemLista`, `ProductoMini`, `AtributoVista`, `VentajaVista`). `leerFichaEmpresa` y el `cargarFicha` del
PDF comparten el mismo núcleo: **una sola verdad** para pantalla y papel.

---

## F. Reglas con nombre y lista de «Don't»

### Norte

**«Primero la ficha, luego el formulario.»** Un producto se enseña como en una tarifa: foto, nombre, lo que hace y
sus datos. Cambiarlo es otra cosa y está en otro sitio. Cuando haya duda, la pregunta es **«¿esto lo leería un
comercial delante de un cliente?»**. Si no, va en Editar.

### Rechazo explícito

- **El panel de configuración como ficha**: la pila de tarjetas plegables con formularios dentro (lo de hoy).
- **La lista de base de datos**: todo junto y por orden alfabético, con las variantes mezcladas.
- **El arcoíris**: un color pastel distinto por categoría, insignias de cinco colores, emojis de iconos.
- **La ficha genérica de CRM en PDF**: banda de color con el logo dentro de un recuadro, foto en tarjeta con sombra,
  tabla cebra gris, «Página 1 de 2» centrado.
- **La ficha IAGUA**: degradados, tarjetas con icono en círculo, vistos verdes.
- **La copia literal del fabricante**: su azul, su logo, su cinta «Personalizable», sus iconos tal cual.

### Reglas

| Regla | Qué dice |
|---|---|
| **De Leer Antes que Editar** | La ficha no tiene ni un control de formulario. Editar es una ruta, con secciones que guardan por separado. |
| **De la Foto Primero** | Ninguna lista sin miniatura y ninguna ficha que no empiece por la foto. `object-contain`, nunca `cover`. |
| **De la Categoría como Puerta** | A los productos se entra por su categoría. La lista plana solo existe como resultado de buscar. |
| **De la Carpeta** | Una gama es una entrada con sus variantes dentro. Una variante nunca aparece suelta junto a los modelos. |
| **Sin Dato, Sin Hueco** | Bloque sin datos no se pinta: ni título, ni «—», ni «N/D», ni tabla vacía. Al editor se le dice **una vez** qué falta. |
| **De un Solo Color** | En pantalla, el color es el del CRM. En papel, el de la empresa. Nunca un color por categoría. |
| **Del Logo en Papel** | El logo de la empresa va siempre sobre blanco, sin recuadro, caja máxima 46 × 14 mm. |
| **De la Hoja Única** | La ficha cabe en una hoja encogiendo la fila hasta 4,6 mm; solo entonces salta a la segunda (§B.2). |
| **Del Contraste Calculado** | Ningún color de texto se elige a ojo: sale de `derivarPaleta` y pasa AA. |
| **Del Plano Blanco** | El dibujo de medidas, siempre sobre blanco y entero. |
| **De la Cota** | La letra del dibujo (`a`, `b`, `c`, `d`) es la que encabeza su fila en la tabla. |
| **Del Icono Reentintado** | Los iconos de ventaja se pintan con la tinta de la paleta, sin cuadrado de fondo. |
| **Del Fabricante Mudo** | Las fichas nuevas no leen `manufacturer_name` ni `manufacturer_model`. |
| **De Proponer** | A una empresa con ficha en uso no se le cambia nada: se le enseña el antes y el después y decide. |
| **Del Dedo** | Todo lo pulsable mide 44 px o más. |

Presupuesto de movimiento: **dos gestos** en pantalla (pulsación `scale(.97)` de 110 ms; fundido de 180 ms al cambiar
de foto), ninguno en lo que se repite (filas, filtros). En el PDF, ninguno.

### Don't

- No formularios, interruptores ni subidores en `/productos/[id]`.
- No emojis en títulos ni botones (📤 🪪 🎨 🔁 📁 💰 📄).
- No «—», «N/D», «Sin información» ni tablas con cabecera y cero filas.
- No quince tarjetas plegables como estructura de página. En móvil, plegables **de lectura** con contador, sí.
- No un color por categoría ni fondos pastel fuera de los tokens.
- No variantes sueltas en la lista. No lista plana como entrada.
- No `object-cover` en fotos de producto. No la foto de 1.200 px en una miniatura sin `loading="lazy"`.
- No tablas con `min-w` en móvil.
- No botón «Aplicar» en los filtros.
- No el tipo en inglés ni en mayúsculas (`equipment`, «EQUIPO»).
- No el peso en gramos: kilos con coma.
- No nombre ni modelo del fabricante en la ficha, en el PDF, en sus metadatos ni en el nombre del fichero.
- No logo dentro de una banda de color ni dentro de un recuadro.
- No sombra pintada bajo el equipo. No degradados. No vistos verdes.
- No tabla cebra gris: filete fino.
- No rellenar el papel que sobra.
- No escribir en `pdf_brand_color`, `pdf_accent_color` ni `companies.primary_color` desde la pantalla nueva.
- No tocar `datasheet-pdf.ts`, `datasheet-pdf-v2.ts` ni `datasheet-iagua*.ts*` (salvo la fase 9, con permiso).
- No cambiar la plantilla de ninguna empresa en la migración.
- No `iframe` de PDF como vista previa.
- Errores ya cometidos que no se repiten: pedir `data_type` a `product_attribute_values`; no mirar `error` tras una
  consulta; decidir PNG o JPG por la extensión; empaquetar las fuentes para una sola de las dos rutas de PDF; un QR
  cuyo enlace caduca; un selector de color que no llega a la plantilla que la empresa usa.

### Checklist antes de dar cada fase por buena

- [ ] ¿Se ha visto a **390 px**? (lista, categoría, ficha, editar, configuración)
- [ ] ¿La ficha de un producto **sin datos** parece hecha así, sin huecos?
- [ ] ¿Hay un solo color de acento en pantalla y ninguna categoría con color propio?
- [ ] ¿Cada plantilla tiene un único gesto y radios con su porqué?
- [ ] ¿El PDF es de una hoja con 3 filas y con 31?
- [ ] ¿El texto del PDF se selecciona y `pdftotext` no devuelve el nombre de ningún fabricante?
- [ ] ¿Impresa en blanco y negro se entiende igual?
- [ ] ¿El PDF de Infinity en `standard` es el mismo que antes?

---

## G. Plan de implementación

Cada fase se despliega sola. **Recordatorio: en este repo, commit = despliegue a producción**; `npx tsc --noEmit` y
`next lint` antes de cada commit. Las fases 1 y 2 no tocan base de datos ni PDF.

Comprobación de Infinity, antes y después de cada fase que toque datos o PDF: (a) `SELECT` de su fila de
`company_settings` (`datasheet_template`, colores, columnas nuevas a NULL); (b) descargar
`/api/pdf/product-datasheet/<id>` de **Infinity Basic S**, **Golden Eye** y **Grifo Durban** y comparar tamaño y
aspecto con los guardados antes de empezar; (c) recuento de `products`, `product_attribute_values` y
`product_images` de la empresa.

| Fase | Qué se hace | Ficheros | Riesgo para Infinity | Cómo se verifica |
|---|---|---|---|---|
| **1 · Componentes compartidos** | Mover los de presentación a `src/modules/catalogo-vista/`, añadir las props `href` / `hrefDe` / `recuadro` y dejar reexports. Sin cambio visible. | `superadmin/catalogo/ficha-*.tsx`, `fila-producto.tsx`, `tarjeta-producto.tsx`, `kiosco-categorias.tsx`, `categorias-estilo.ts` → `catalogo-vista/` | Ninguno (no es su pantalla). | `tsc` y lint. `/superadmin/catalogo/productos` y una ficha del maestro, idénticas a 390 y a 1280 px. |
| **2 · Lista por categorías** | Kiosco, categoría, gama como carpeta, buscador y filtros en hoja. | Nuevo `products/productos-lectura.ts`; `app/(tenant)/productos/page.tsx`; `products-list-client.tsx` queda como vista «Seleccionar». | Bajo: cambia cómo ve su lista. No se pierde ninguna acción (se comprueba una a una: nuevo, catálogo PDF, filtros, configuración, selección múltiple, borrar inactivo, calculadora). | Con Infinity a 390 px: 7 categorías, 3 vacías ocultas; «Fuente» enseña carpetas y no 12 filas sueltas; buscar «fiord» devuelve resultados con su categoría. A 1280 px, rejilla. |
| **3 · Ficha de lectura + Editar** | `/productos/[id]` nueva; `/productos/[id]/editar` con los paneles actuales movidos; redirección de `?abrir=filtros`. | `app/(tenant)/productos/[id]/page.tsx` (rehecha); nuevo `[id]/editar/page.tsx`; `productos-lectura.ts` (`leerFichaEmpresa`); `edit-form.tsx` (de modal a sección). Los paneles no se reescriben. | Medio: es su pantalla de trabajo. Todo lo que hoy se puede hacer tiene que seguir pudiéndose desde Editar. | Lista de las 17 piezas de §A.2: cada una localizada en la ficha o en Editar. Con rol comercial: ningún formulario y ningún coste. A 390 px con Basic S (7 atributos), Golden Eye (0) y una variante sin foto. |
| **4 · Paleta y cargador** | `derivarPaleta`, las tres propuestas, `extraerColoresLogo` y `cargarFicha` (modelo normalizado; `data_type` desde el atributo; todas las consultas miran `error`; nunca `manufacturer_*`). Sin pantalla. | Nuevos `products/ficha/paleta.ts`, `paleta.test.ts`, `colores-logo.ts`, `cargar-ficha.ts`, `cargar-ficha.test.ts` | Ninguno: código que nadie llama. | Test de la rejilla de 4.096 colores; los valores de la tabla de §C.2 coinciden; `cargarFicha` con Basic S devuelve 7 características agrupadas y con Golden Eye, bloques vacíos sin error. |
| **5 · Migración** | La de §C.4. Tipos y `z.enum` ampliados. | `supabase/migrations/20261129100000_fichas_plantillas_paleta.sql`; `config/pdf/actions.ts` | Ninguno si se aplica como está: no actualiza filas. **La aplica Mario** (`scripts/aplicar-migracion.sh`). | (a) y (b) de arriba: fila igual salvo dos columnas nuevas a NULL; PDF idéntico. Intentar guardar `tarifa` en una empresa de prueba: el CHECK lo acepta. |
| **6 · Plantilla «Tarifa»** | Primitivas + plantilla con `pdf-lib`; fotos por `sharp`; prueba de `fontkit`; rama en `datasheet-pick.ts`; `?t=tarifa` en la ruta; fuentes empaquetadas para **las dos** rutas de PDF. | Nuevos `products/ficha/primitivas.ts`, `plantilla-tarifa.ts`; `datasheet-pick.ts`; `api/pdf/product-datasheet/[id]/route.ts`; `next.config.ts`; `package.json` (si entra `fontkit`) | Ninguno: solo se alcanza con `?t=tarifa`; nadie la tiene asignada. | PDF de Basic S, Golden Eye y Grifo Durban con `?t=tarifa`: una hoja, logo de Infinity, texto seleccionable, sin fabricante. Producto de prueba con 31 filas y otro con 3: una hoja los dos. Un producto con foto `.webp`: sale. |
| **7 · Configuración** | Pantalla de §C.3: plantillas, colores del logo, tres propuestas, maqueta en vivo, «Ver PDF real», comparación antes/después. | `config/pdf/form.tsx` (rehecho), `actions.ts`, nuevo `config/pdf/vista-previa-ficha.tsx`; `configuracion/pdf/page.tsx` | Bajo: entrar y salir sin guardar no cambia nada; si guarda, es su decisión. | A 390 px: elegir plantilla y color, ver la maqueta, guardar, volver a `standard`. Con aquaroo (amarillo): sale el aviso de color claro y los títulos en tinta. |
| **8 · «Escaparate» y «Placa»** | Dos plantillas más sobre las mismas primitivas, con su miniatura. | Nuevos `plantilla-escaparate.ts`, `plantilla-placa.ts`; `datasheet-pick.ts`; `vista-previa-ficha.tsx` | Ninguno. | Los tres productos × tres propuestas de color (9 PDF por plantilla). «Placa» impresa en blanco y negro. |
| **9 · Ficha pública y QR** | `/datasheet/[token]` con los componentes de §D para las plantillas nuevas (las antiguas conservan la página actual); enlace permanente para el QR; ventajas con icono editables en Editar. | `app/datasheet/[token]/page.tsx`, `pdf/route.ts`; `share-actions.ts`; `datasheet-iagua-panel.tsx` generalizado | Bajo: su página pública no cambia mientras siga en `standard`. | A 390 px sin desplazamiento lateral. El QR de un PDF abre la ficha. Ningún texto ni URL con el fabricante. |
| **10 · Arreglos en las plantillas antiguas** *(solo con el sí de Mario)* | `data_type` desde el atributo en los seis sitios de §A.3-1; fotos `.webp`; texto correcto del «Color base». | `datasheet-pdf-v2.ts:433`, `datasheet-pdf.ts:231`, `datasheet-iagua.ts:195`, `datasheet-iagua-html.tsx:266`, `catalog-pdf-v2.ts:346`, `app/datasheet/[token]/page.tsx:171` | **Alto**: a Infinity le aparecen 15 valores que hoy no ve, tres erróneos. Antes, corregir Basic S o enseñárselo. | PDF de antes y de después de Basic S, uno al lado del otro, enseñados a Mario antes de desplegar. |

Dependencia externa: la riqueza de la ficha (ventajas, grupos, dibujo de medidas, fotos por tipo) llega a las
empresas con la **importación completa del maestro** (paso 3 del plan del catálogo), que hoy no copia ni ventajas ni
`grupo` ni `tipo_foto` (`catalog-copy-helpers.ts`, sin esas columnas [verificado con grep]). Este diseño no la
bloquea ni depende de ella: lee solo tablas de la empresa y se llena cuando lleguen los datos.

---

## H. Preguntas para Mario

1. **Las tres plantillas.** Son la misma hoja estilo Osmofilter con tres acabados: «Tarifa» (la más parecida),
   «Escaparate» (franja de color, comercial) y «Placa» (compacta, para imprimir). ¿Valen? ¿«Tarifa» como
   predeterminada de las empresas nuevas?
2. **Infinity.** Hoy sigue en su ficha `standard`. ¿Se le deja ahí y se le enseña la comparación para que elija, o
   quieres pasarla tú a «Tarifa» cuando la veas?
3. **El fallo de la tabla vacía.** La ficha que usa Infinity hoy sale **sin características**. Arreglarlo en su
   plantilla actual le haría aparecer 15 valores, tres mal (Basic S). ¿Se arregla ya, se arregla después de corregir
   esos tres, o se deja y que el arreglo le llegue al cambiar de plantilla?
4. **La referencia de la cabecera.** En seis productos de Infinity la «referencia interna» es el nombre comercial del
   proveedor («Blue sea», «Fiord», «Smart», «Golden», «Black Beast»…) y saldría impresa arriba a la derecha. ¿Se
   imprime la referencia interna tal cual, o la ficha no lleva referencia hasta que la empresa ponga las suyas?
5. **Consumibles y recambios en la ficha del cliente.** La de Osmofilter los lleva. ¿Encendidos por defecto, o
   apagados y que cada empresa los active?
6. **Iconos y marcas de terceros.** ¿Se usan los iconos de ventajas de Osmofilter repintados con el color de cada
   empresa (doy por hecho el permiso, como con las fotos)? ¿Y las marcas de componente dentro de los datos
   («Amberlite», «TM69») se quedan o se quitan?
