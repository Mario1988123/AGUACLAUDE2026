# Diseño: plantillas de ficha técnica (PDF A4 y web pública)

Fecha: 2026-11-25 · Estado: **diseño, nada ejecutado** · Autor: agente de diseño (la ejecución la hace otro agente)

Leyenda: **[verificado]** = lo he leído en el código, en las migraciones o en los ficheros de `D:\OSMONOVA\catalogo`.
**[sin verificar]** = deducción o dato de memoria que el ejecutor debe comprobar. **[decide]** = decisión rutinaria que
tomo yo; se puede cambiar sin rehacer el diseño. **[pregunta]** = cambia el resultado y lo decide Mario (§11).

Este documento sustituye a la §D de `docs/PLAN_CATALOGO_MAESTRO.md` (una sola plantilla «neutra» con satori) por lo
que Mario pidió después en la §H.4: dos o tres plantillas, cada empresa elige la suya y cambia la paleta.

---

## 0. Lo que hay hoy

### 0.1 Código [verificado por lectura]

| Pieza | Qué hace |
|---|---|
| `src/modules/products/datasheet-pdf.ts` (540 líneas) | Ficha v1. `pdf-lib`, Helvetica estándar, coordenadas a mano. Solo sale con `?v=1` o `DATASHEET_USE_V1=true`. |
| `datasheet-pdf-v2.ts` (1.029 líneas) | Plantilla **`standard`**, la que usan hoy las cinco empresas. `pdf-lib`, Helvetica, texto vectorial. |
| `datasheet-iagua.ts` (630 líneas) | Plantilla `iagua`. `pdf-lib`, Helvetica. Es la que elige `datasheet-pick.ts` cuando `datasheet_template = 'iagua'`. |
| `datasheet-iagua-html.tsx` (764 líneas) | Motor satori → sharp → pdf-lib, Poppins. **Solo se alcanza con `?engine=html`**: no está en producción para nadie. Cada página es un **PNG de 1190×1684 px incrustado** (`pdf.embedPng`, líneas 753-761): el texto del PDF no se puede seleccionar ni buscar. |
| `datasheet-pick.ts` | `iagua` → generador IAGUA; cualquier otra cosa o cualquier error → `standard` (v2). |
| `src/app/api/pdf/product-datasheet/[id]/route.ts` | PDF con sesión del CRM. Admite `?t=iagua|standard`, `?v=1`, `?engine=html`. |
| `src/app/datasheet/[token]/page.tsx` y `pdf/route.ts` | Web pública por token y su PDF. La web es una página Tailwind genérica (cabecera de color, tarjeta con sombra, tabla), **igual para todas las plantillas**. |
| `src/modules/products/email-share-actions.ts:235` | Adjunta el PDF a un correo. **Nadie delante de un navegador**: el PDF tiene que poder generarse en servidor. |
| `src/modules/config/pdf/form.tsx` (`/configuracion/pdf`) | Dos tarjetas (Estándar, IAGUA), dos `input type="color"` sueltos y un `iframe` que **regenera el PDF entero** en cada cambio. |
| `src/modules/products/fonts/` | Solo **Poppins** Regular, Medium, SemiBold y Bold en TTF estático. |
| `package.json` | `pdf-lib`, `satori`, `satori-html`, `sharp`, `qrcode`. **No hay** Chromium, Puppeteer, Playwright ni `@pdf-lib/fontkit`. |
| `next.config.ts:26-32` | `serverExternalPackages: ["satori","sharp"]` y las fuentes empaquetadas **solo** para `/api/pdf/product-datasheet/[id]`. La ruta pública `/datasheet/[token]/pdf` no las lleva. |

### 0.2 Tres hallazgos que afectan al diseño

1. **`data_type` no existe en `product_attribute_values`** [verificado: la tabla se crea en
   `20260501121100_products.sql:277-292` sin esa columna y ninguna migración la añade; el plan del catálogo lo
   comprobó además en `information_schema`]. La piden **los cuatro generadores y la web pública**, no solo IAGUA:
   `datasheet-pdf.ts:231`, `datasheet-pdf-v2.ts:433`, `datasheet-iagua.ts:195`, `datasheet-iagua-html.tsx:266` y
   `datasheet/[token]/page.tsx`. Ninguno mira `error`. Lo esperable es que **la tabla de características salga vacía
   también en la `standard` que usa Infinity hoy** [sin verificar en ejecución]. Las plantillas nuevas piden
   `data_type` al atributo (`product_attributes`), que es donde está. Arreglar las antiguas es **[pregunta 3]**,
   porque Infinity vería un cambio.
2. **La web pública enseña el fabricante**: `page.tsx` pinta `manufacturer_name · manufacturer_model` bajo el
   título. Las plantillas nuevas no leen nunca esas dos columnas.
3. **Los colores actuales no se pueden reutilizar como paleta nueva.** `pdf_brand_color` y `pdf_accent_color` los
   leen también `catalog-pdf-v2.ts`, `mailing/company-context.ts`, `api/cron/maintenance-reminders` y la
   configuración fiscal y de empresa [verificado con grep]. Si la paleta de las fichas escribiera ahí, a Infinity le
   cambiarían el catálogo y los correos. La paleta va en una columna propia (§9).

### 0.3 El origen que hay que igualar [verificado en `D:\OSMONOVA\catalogo`]

- 174 fichas. Atributos por ficha: **mínimo 0, mediana 22, máximo 41** (BLUE PACIFIC). Ventajas: **0 a 5**, mediana 4;
  texto breve de hasta 44 caracteres, texto largo de hasta 93.
- Cuatro grupos con orden: físicas (20), eléctricas (30), técnicas (40) y extra (60). Valor y unidad separados.
  En ATLANTIS: 4 + 1 + 13 + 4.
- `principal.webp`: **fondo transparente** y casi siempre **vertical** (ATLANTIS 538×1200, BLUE MOUNTAIN 543×1200);
  QYRO es casi cuadrado (1081×1200). Hay equipos blancos y equipos negros.
- `medidas.webp`: 1200×935, **fondo blanco opaco**, dibujo de línea con cotas `a`, `b`, `c`. En BLUE MOUNTAIN hay
  además una cota **`d`** (altura del grifo): las cotas no son siempre tres.
- `ambiente-N.webp`: foto de entorno, unas veces con canal alfa y otras sin él. `ficha.json` trae por cada ambiente
  una `caja` `[x0, y0, x1, y1]` con la posición del equipo en la foto; no aparece en ningún script ni migración del
  repo [verificado con grep], así que hoy se pierde.
- `iconos/*.webp`: 500×500, **trazo azul sobre un cuadrado gris azulado de esquinas redondas**. El color y la forma
  son de Osmofilter. Mirados 2 de 82.
- La carcasa de ATLANTIS lleva el logo de Osmofilter serigrafiado; se ve en `principal`, `ficha-tecnica` y
  `ambiente`. Es la excepción admitida.
- Proyecciones solo en unos 15 equipos; recambios sin foto ni cantidad (ver plan del catálogo, §0.4).

---

## 1. Norte material

**Los tres papeles que viajan con la máquina.** Todo equipo de tratamiento de agua llega con tres papeles que nadie
diseñó para gustar y por eso funcionan: el **plano acotado** con su cajetín, la **placa de características** pegada
en la trasera y la **tarjeta del expositor** de la tienda. Cada plantilla es uno de esos tres papeles ampliado a un
A4. Cuando haya una duda, la pregunta no es «qué queda más bonito» sino **«qué pondría ese papel»**: un plano no
tiene degradados, una placa no tiene adjetivos y una tarjeta de expositor no tiene cuarenta filas.

De ahí sale lo que comparten las tres:

- El equipo es el protagonista y está **apoyado**, no flotando en una caja.
- Todo dato va en monoespaciada con cifras tabulares, la unidad separada y más tenue.
- La letra de la cota del dibujo (`a`, `b`, `c`, `d`) es la misma letra que encabeza su fila en la tabla.
- El papel es blanco. La tinta nunca es negro puro: es el tono del primario llevado a muy oscuro.
- El color es de la empresa y la legibilidad es nuestra: se calcula (§5), no se confía.

### Rechazo explícito

Estas fichas **no** van a ser:

- **La ficha genérica de CRM**, que es exactamente la `standard` de hoy y la web pública de hoy: banda de color
  arriba con el logo metido en un recuadro blanco, foto dentro de una tarjeta con borde, radio y sombra, tabla cebra
  gris, «Página 1 de 2» centrado y gris.
- **La ficha IAGUA**: azul marino + azul + verde de «check», degradados, tarjetas de esquina redonda con icono en
  círculo, Poppins, imagen fija de relleno en la página 2.
- **La ficha del fabricante**: iconos azules sobre cuadrados gris azulado, bloque «Highlights», render sobre gris.
  Igualamos su **contenido**, no su aspecto.
- **La hoja de producto de plantilla de IA**: tres cifras gigantes con etiqueta pequeña, cintillo en versalitas
  encima de cada bloque, cadenas «A · B · C», tarjetas idénticas en rejilla de tres.

---

## 2. Reglas con nombre (valen para las tres plantillas)

| Regla | Qué dice | Por qué |
|---|---|---|
| **Del Logo en Papel** | El logo de la empresa va siempre sobre blanco, nunca sobre el primario ni sobre una foto. Caja máxima 46 × 13 mm, alineado a la izquierda, sin recuadro ni radio. | No sabemos si el logo es oscuro, claro, con fondo o sin él. Sobre blanco funcionan todos. |
| **De la Peana** | El campo de color que hay detrás del equipo se elige midiendo la foto: se calcula la luminosidad media de los píxeles opacos de `principal` (sharp) y se usa el campo (velo claro o primario) que diste de ella **al menos 0,25 en L de OKLCH**. | Un dispensador blanco sobre velo claro desaparece; una ósmosis negra sobre un primario oscuro, también. |
| **Del Suelo** | El equipo se apoya en una línea o en el borde inferior de su campo. Sin sombra pintada debajo y sin recorte con halo. | Una sombra falsa es lo primero que delata un montaje. |
| **Del Plano Blanco** | `medidas` va siempre sobre papel blanco, nunca sobre un campo de color, y nunca se recorta. | El fichero tiene fondo blanco opaco: sobre color sale un rectángulo. |
| **De la Cota** | Las cotas salen de los atributos del grupo de físicas cuyo nombre acaba en `(letra)`; si no hay, de `dim_width_mm` (a), `dim_height_mm` (b), `dim_depth_mm` (c). Tantas filas como letras haya. El peso va después, sin letra. | BLUE MOUNTAIN tiene cota `d`. Fijar tres filas la perdería. |
| **Del Icono Reentintado** | Los iconos de ventaja no se pintan tal cual. Se convierten una vez en **máscara de un solo canal** (distancia al color de fondo → alfa) y se tiñen en servidor con la tinta de la paleta. Sin cuadrado de fondo. | El azul y el cuadrado redondo son la firma visual del fabricante. Además un icono azul no casa con una paleta burdeos. [sin verificar que los 82 sean de dos tintas] |
| **Del Rasgo en Ficha** | Lo que distingue a la variante (`rasgos_identificacion`: «Sobremesa», «Negro», «c/Bomba») va en fichas sueltas junto al nombre, y la referencia aparte en mono. No se encadena con puntos. | Mario quiere ver el rasgo y la ref en cada variante (§H.1). En fichas se lee de un golpe y se parte bien en dos líneas. |
| **Del Fabricante Mudo** | Las plantillas nuevas no leen `manufacturer_name`, `manufacturer_model` ni nada de la tabla `manufacturers`. Antes de pintar, los textos libres pasan por una lista negra (nombres de `manufacturers`); si hay coincidencia, la ficha **no** borra nada: se pinta, se registra en `error_reports` y el editor del producto enseña el aviso «Este texto nombra al fabricante». | Borrar una palabra a ciegas deja frases rotas. Avisar deja que lo arregle quien sabe. |
| **De la Hoja Declarada** | No se deja que el motor corte. Se maquetan **hojas de 210 × 297 mm** y el contenido se reparte por número de filas **medido** en Chromium (método de la skill `panel-informes`, §7). La primera hoja de tabla lleva menos filas. | Es lo que permite «Hoja 2 de 3» y que ninguna fila quede partida. |
| **Sin Dato, Sin Hueco** | Un bloque sin datos no se pinta, no deja su título ni su espacio, y los demás suben. Nunca «—», «N/D» ni «Sin información». | Una ficha con tres atributos tiene que parecer hecha así. |
| **Del Color que No Dice Nada Solo** | Nada depende del color para entenderse: cada fila lleva filete además de velo, y el dato destacado va en peso además de en acento. | La mitad de estas fichas se imprimirán en blanco y negro o sin «gráficos de fondo». |

Presupuesto de movimiento (solo web): **dos gestos**. La pulsación de los botones (`scale(.97)`, 110 ms) y el cambio
de foto en la galería (fundido de 180 ms). El héroe no se anima. En el PDF, ninguno.

---

## 3. Las tres plantillas

Contenido común, en este orden de prioridad cuando falta sitio: identidad (logo, nombre, rasgos, ref) → foto
principal → tabla técnica → medidas → ventajas → presentación → variantes → documentos → ambiente → consumibles y
recambios → certificaciones y garantía.

Medidas en milímetros para la geometría y en puntos para la letra. Las alturas de fila y las filas por hoja que doy
son **cálculo de mesa**: el ejecutor las mide en Chromium y las deja escritas como constantes con un comentario de
con qué estilos se midieron.

### 3.1 «Plano» — el plano acotado

- **Carácter:** técnico, seco, de oficina de proyectos. Línea fina, esquinas vivas, cajetín al pie. Registro C.
- **Encaja con:** instaladores, distribuidores, horeca y cualquier empresa que entregue la ficha a otro profesional.
  Propuesta como **plantilla por defecto de las empresas nuevas** [pregunta 1].
- **Gesto único:** el **cajetín**. El pie de cada hoja es el cajetín de un plano: celdas con empresa, contacto,
  modelo, referencia, revisión y hoja, y el QR en la última celda.
- **Radios:** 0 en todo. Solo las fichas de rasgo llevan 0,6 mm.
- **Margen:** 14 mm. Retícula de 12 columnas con canal de 4 mm (ancho útil 182 mm).

**Hoja 1 — alzado**

```
┌──────────────────────────────────────────────────────────────┐ 0
│ [logo empresa]                         Ficha técnica  FRO1047│ 14–27   cabecera sobre papel, sin banda
│ ──────────────────────────────────────────────────────────── │ 29      filete 0,35 pt (primario-trazo)
│ ┌───────────────────────┐  BLUE MOUNTAIN                      │ 34
│ │                       │  [Sobremesa] [Negro] [c/Bomba]      │         rasgos en fichas
│ │       campo peana     │                                     │
│ │                       │  Presentación: hasta 420 caracteres │
│ │      [ principal ]    │  en dos párrafos, 9,5/13,5 pt.      │
│ │                       │                                     │
│ │   col 1–5 · 72 × 196  │  Ventajas                           │ ~110
│ │                       │  ◇ Texto breve                      │         icono 8 mm reentintado
│ │                       │    Texto largo en una o dos líneas. │         una columna, hasta 5
│ │                       │  ◇ …                                │
│ │________suelo__________│                                     │ 230
│ └───────────────────────┘  col 6–12 · 106 mm                  │
│ ┌──────────┬───────────┬───────────┬────────┬───────┬───────┐ │ 261
│ │ Empresa  │ Teléfono  │ Modelo    │ Ref.   │ Hoja  │  QR   │ │         cajetín 22 mm
│ │ Dirección│ Correo·web│ Revisión  │        │ 1 / 3 │       │ │
│ └──────────┴───────────┴───────────┴────────┴───────┴───────┘ │ 283
└──────────────────────────────────────────────────────────────┘ 297
```

**Hoja 2 — datos**

```
│ [logo]                                 BLUE MOUNTAIN  FRO1047│ cabecera corta (10 mm)
│ ──────────────────────────────────────────────────────────── │
│ Medidas                                                       │
│ ┌──────────────────────────────┐  a  Ancho       290 mm       │ dibujo col 1–7 sobre blanco, 66 mm de alto
│ │        [ medidas.webp ]      │  b  Alto        990 mm       │ cotas col 8–12 en mono 11 pt
│ │                              │  c  Fondo       525 mm       │ la letra, en acento-marca
│ └──────────────────────────────┘     Peso         32 kg       │
│                                                               │
│ Características físicas ───────   Características técnicas ── │ dos columnas de 89 mm
│ Etiqueta ............ valor ud    Etiqueta ......... valor ud │ fila 6,2 mm; filete 0,25 pt bajo cada fila
│ Características eléctricas ────   …                           │ un grupo no se parte entre columnas si cabe
│ …                                 Características extra ───── │
│ [cajetín · Hoja 2 / 3]                                        │
```

**Hoja 3 — gama y servicio** (solo si hay algo que poner)

```
│ ┌──────────────────────────────┐  Variantes de la gama        │ ambiente col 1–7, 78 mm de alto, recortado
│ │        [ ambiente ]          │  Nombre · rasgos      Ref.   │ alrededor de la `caja` del equipo
│ └──────────────────────────────┘  ▸ fila de esta ref en peso  │
│ Consumibles y recambios                                       │ rejilla de 2 columnas: miniatura 14 mm,
│ [mini] Ref.  Nombre            ×2 │ [mini] Ref.  Nombre       │ ref en mono, nombre, cantidad si la hay
│ Documentos                        Certificaciones y garantía  │ lista por tipo; el QR va en el cajetín
│ [cajetín · Hoja 3 / 3]                                        │
```

**Tipografía [sin verificar que exista versión variable y licencia OFL: comprobarlo al descargar]:**
Archivo (variable, ejes `wght` y `wdth`) para títulos y texto; Martian Mono (variable) para datos.

| Papel | Fuente | Cuerpo | Peso · ancho |
|---|---|---|---|
| Nombre | Archivo | 30 pt (24 pt si pasa de 18 caracteres) | 620 · `wdth` 88 → 75 al crecer el nombre |
| Título de bloque | Archivo | 10,5 pt, caja normal | 590 |
| Texto | Archivo | 9,5 / 13,5 pt | 430 |
| Etiqueta de fila | Archivo | 8,5 pt | 450 |
| Valor | Martian Mono | 8,5 pt, tabular | 470 · unidad en 7,5 pt y tinta suave |
| Cajetín | Archivo + Martian Mono | 7,5 pt | 450 / 470 |

**Color:** el primario solo como **trazo** (filetes, marco del cajetín, títulos de bloque) y como campo de la peana.
El acento solo en **tres sitios**: la letra de las cotas, la fila de la variante actual y el marco del QR.

**Datos que faltan:**

| Caso | Qué hace |
|---|---|
| Sin ventajas (31 fichas) | La presentación baja a 10,5 pt y ocupa la columna. Si tampoco hay presentación, la tabla técnica sube a la hoja 1, columna derecha, y la hoja 2 se queda con las medidas. |
| Sin medidas | Desaparece el bloque entero; si hay `dim_*` pero no dibujo, las cotas se listan como primer grupo de la tabla, sin letra. |
| 3 atributos | Tabla en una sola columna en la hoja 1, debajo de las ventajas. **Una sola hoja.** |
| 41 atributos | Dos columnas en la hoja 2. Si no caben con las medidas (cálculo de mesa: 48 huecos de fila contra 41 filas y 4 títulos), las medidas pasan a la hoja 1 bajo el texto o los dos últimos grupos saltan a la hoja 3 con «(continuación)». |
| Nombre largo | 18 caracteres → 24 pt y `wdth` 75. Más de 32 → dos líneas a 20 pt, cortando por espacio. Nunca puntos suspensivos en el nombre. |
| Sin foto | La columna de la peana no se pinta. Nombre, texto y ventajas ocupan las 12 columnas y la tabla sube. No hay silueta gris ni «Sin imagen». |
| Sin logo | Nombre comercial de la empresa en Archivo 13 pt, peso 620, en el sitio del logo. |
| Sin hoja 3 | Si no hay variantes, recambios, ambiente ni documentos, la ficha acaba en la hoja 2. |

### 3.2 «Escaparate» — la tarjeta del expositor

- **Carácter:** comercial y limpio. Un campo de color a sangre, el equipo grande y pocas palabras. Registro D.
- **Encaja con:** venta directa a particulares, comerciales a domicilio, la ficha que se adjunta a una propuesta.
- **Gesto único:** el equipo **pisa el borde** del campo de color y entra en el papel. Es lo único que se sale de la
  retícula en toda la ficha.
- **Radios:** pieza 4 mm · ficha de rasgo 1,6 mm · miniatura 2 mm · todo lo que toca el borde de la hoja, 0.
- **Margen:** 16 mm de texto; el campo y la foto de ambiente van a sangre.

**Hoja 1 — portada**

```
┌──────────────────────────────────────────────────────────────┐
│░░░┌─────────────┐░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ pestaña blanca pegada al borde superior
│░░░│ [logo]      │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ FRO1047 ░░│ (Regla del Logo en Papel), 0 arriba, 4 abajo
│░░░└─────────────┘░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░ BLUE MOUNTAIN ░░░░░░░░░░░░░░░░░░░░░░░░░   [ principal ]  ░░│ campo a sangre, 0–168 mm
│░░ [Sobremesa] [Negro] [c/Bomba] ░░░░░░░░░                  ░░│ nombre 44 pt sobre el campo
│░░ Reclamo en una frase, 13 pt ░░░░░░░░░░░                  ░░│ texto = `sobre(campo)` de §5
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  ░░│
│──────────────────────────────────────────                  ──│ 168   borde del campo
│  Presentación, 10,5/15 pt,                └─── pisa 26 mm ──┘ │ 194   el equipo acaba aquí, apoyado
│  hasta 380 caracteres.                                        │
│  ◇ Breve      ◇ Breve      ◇ Breve      ◇ Breve              │ ventajas en fila de 3 a 5: icono 11 mm,
│    largo        largo        largo        largo               │ breve en peso, largo en 2 líneas
│  Empresa · teléfono · correo                         Hoja 1/2 │ pie de una línea
└──────────────────────────────────────────────────────────────┘
```

**Hoja 2 — detalle**

```
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ [ ambiente a sangre, 0–92 mm ] ▓▓▓▓▓▓▓▓▓▓│ recortado alrededor de la `caja`
│  Medidas                          Características             │
│  [ medidas.webp, 78 mm ]          grupos uno tras otro,       │ columna izquierda 78 mm, derecha 96 mm
│  a 290 mm  b 990 mm  c 525 mm     etiqueta / valor, 6 mm      │
│  Peso 32 kg                       …                           │
│  Variantes: fichas con rasgo+ref                              │
│  ┌──────────────────────────────────────────────────────────┐ │ pieza de contacto, 30 mm, velo:
│  │ ¿Hablamos?  955 000 000   correo   web          [  QR  ] │ │ teléfono en 20 pt, es una ficha de venta
│  └──────────────────────────────────────────────────────────┘ │
```

Hoja 3 (continuación de la tabla, consumibles y documentos) solo si hace falta.

**Tipografía [sin verificar: disponibilidad y licencia]:** Bricolage Grotesque para nombre y títulos (44 pt, peso
660; títulos 12 pt, peso 620), Hanken Grotesk para texto (10,5/15 pt, peso 430) y Spline Sans Mono para datos
(9 pt, peso 470). El nombre **no** va en mono ni lleva una palabra en otro color.

**Color:** el primario es el **campo** de la portada (ajustado por la regla de §5; el texto encima es blanco o
tinta, lo que más contraste dé). El acento solo en el **teléfono** de la pieza de contacto (en
acento-texto) y en la ficha de la variante actual.

**Datos que faltan:**

| Caso | Qué hace |
|---|---|
| Sin ventajas | La presentación pasa a dos columnas y ocupa su sitio. |
| Sin medidas | La tabla ocupa las dos columnas de la hoja 2. |
| 3 atributos | La tabla baja a la hoja 1 en lugar de las ventajas largas (las ventajas quedan solo con icono y breve). **Una sola hoja**, con la pieza de contacto al pie. |
| 41 atributos | La tabla pasa a dos columnas a todo el ancho; las medidas suben junto al ambiente (ambiente a 110 mm de ancho, medidas a su derecha). Lo que no quepa, a la hoja 3. |
| Nombre largo | 44 → 34 → 28 pt según longitud (más de 14, más de 22 caracteres); a 28 pt se permite una segunda línea. El equipo no se encoge: se encoge el nombre. |
| Sin foto | El campo baja de 168 a 84 mm y lleva solo nombre, rasgos y reclamo. Sin gesto de pisar el borde. |
| Sin ambiente | La hoja 2 empieza en el margen, sin franja. No se usa `ficha-tecnica.webp` de relleno: es un render sobre gris del fabricante. |
| Equipo casi cuadrado (QYRO) | Caja de foto de 86 × 150 mm con `object-fit: contain` abajo: se apoya igual, pisa menos. |

### 3.3 «Placa» — la placa de características

- **Carácter:** documental y denso. Todo en una cara, pensado para imprimirse en blanco y negro y quedarse con el
  equipo. Registro A.
- **Encaja con:** empresas que imprimen mucho, técnicos, adjunto de presupuesto. Es también la plantilla que mejor
  aguanta un producto con pocos datos.
- **Gesto único:** cada dato es un **campo de placa**: etiqueta pequeña «preimpresa» arriba y valor «estampado» en
  mono debajo. Las líneas de la rejilla no son bordes: son el hueco de 0,3 mm entre celdas sobre un fondo de tinta.
- **Radios:** marco exterior 2,5 mm (como una placa real); celdas interiores 0.
- **Margen:** 12 mm. Sin remaches, sin textura de metal: es una placa por estructura, no por disfraz.

**Hoja única**

```
┌──────────────────────────────────────────────────────────────┐
│ ╭──────────────┬───────────────────────────────┬───────────╮ │
│ │ [logo]       │ BLUE MOUNTAIN                 │ Ref.      │ │ 24 mm · la celda de la ref es el único
│ │              │ [Sobremesa] [Negro] [c/Bomba] │ FRO1047   │ │ campo de primario de toda la hoja
│ ├──────────────┼───────────────────────────────┴───────────┤ │
│ │              │ [ medidas.webp ]     a 290  b 990  c 525   │ │ 78 mm · foto 58 mm de ancho sobre velo
│ │ [principal]  │                      Peso 32 kg            │ │ medidas sobre blanco
│ ├──────┬───────┼──────┬──────┬──────┬──────┬──────┬────────┤ │
│ │etiq. │ etiq. │ etiq.│ …                                  │ │ campos de placa: 3 columnas, 9 mm de alto
│ │VALOR │ VALOR │ VALOR│      un título de grupo ocupa      │ │ 41 atributos = 14 filas = 126 mm
│ │      │       │      │      una celda a todo el ancho     │ │
│ ├──────┴───────┴──────┴──────────────────────────────────── ┤ │
│ │ ◇ Breve   ◇ Breve   ◇ Breve   ◇ Breve   ◇ Breve          │ │ ventajas: solo icono 6 mm y texto breve
│ ├───────────────────────────────┬──────────────────┬────────┤ │
│ │ Empresa · dirección           │ Teléfono · correo│  QR    │ │ 22 mm
│ ╰───────────────────────────────┴──────────────────┴────────╯ │
└──────────────────────────────────────────────────────────────┘
```

Reverso opcional (hoja 2): variantes, consumibles y recambios, documentos y una foto de ambiente pequeña, con la
misma rejilla.

**Tipografía [sin verificar: disponibilidad y licencia]:** Sofia Sans Condensed para lo preimpreso (etiquetas
7 pt, peso 520; nombre 22 pt, peso 640) y Sometype Mono para lo estampado (valores 9,5 pt, peso 500; ref 16 pt).

**Color:** tinta para casi todo. El primario, en dos sitios: la celda de la referencia (campo) y el marco exterior
(trazo de 0,7 pt). El acento, en uno: la letra de las cotas. Impresa en gris sigue diciendo lo mismo.

**Datos que faltan:**

| Caso | Qué hace |
|---|---|
| Sin ventajas | Se quita su franja; los campos crecen de 9 a 10 mm. |
| Sin medidas | La foto pasa a la celda ancha y las cotas `dim_*` van como primeros campos. |
| 3 atributos | Campos en una fila de 3 a 12 mm de alto, valor a 12 pt; la foto sube a 110 mm de alto. La hoja no se estira: el marco se cierra donde acaba el contenido y lo que sobra es papel. |
| 41 atributos | 14 filas de 3 columnas. Si el valor más largo no cabe en 56 mm (p. ej. «100-240V~50/60Hz»), ese campo ocupa dos columnas. |
| Nombre largo | 22 → 18 → 15 pt; a 15 pt, dos líneas. La celda de la ref no cede ancho. |
| Sin foto | La celda de la foto desaparece y medidas ocupa la fila; si tampoco hay medidas, se quita la fila. |
| Sin logo | Nombre comercial en Sofia Sans Condensed 14 pt, peso 640. |

### 3.4 Lo que es igual en las tres

- **Variantes:** tabla o fichas con nombre, rasgos y referencia de las hermanas (`products.gama_id`). La de esta
  ficha va marcada con peso y acento. Más de 12 variantes: se listan 12 y la línea «y 3 más en la ficha web».
- **Consumibles y recambios:** apagado por defecto en la ficha del cliente, encendido para el técnico (`?recambios=1`,
  como proponía la §D del plan). Fuentes: `product_filter_assignments` (lo que hoy pinta la `standard` como
  «mantenimiento recomendado») y `product_compatibilities`. Miniatura de 14 mm; **si el recambio no tiene foto
  —hoy no la tiene ninguno— la fila no lleva miniatura y el texto ocupa su sitio**, sin recuadro vacío.
- **Documentos:** lista por tipo (manual, certificado, comercial), solo los que tengan `is_public = true`. En papel
  no hay enlaces: **un solo QR** que lleva a la ficha web, donde están todos. Debajo del QR, la dirección corta
  escrita. El QR se genera en SVG con el paquete `qrcode`, ya instalado, en tinta sobre blanco y con su margen.
- **El QR no puede caducar:** los enlaces públicos caducan por defecto a los 60 días (`page.tsx`), y un papel impreso
  no. La ficha crea (o reutiliza) un enlace `product_datasheet` **sin caducidad** y revocable para el QR [decide].
- **Pie y cajetín:** razón social (`fiscal_legal_name`), teléfono (`fiscal_phone`), correo (`fiscal_email`) y ciudad.
  **No existe columna de web en `company_settings`** [verificado con grep]: va en las opciones nuevas (§9).
- **Metadatos del PDF:** título = nombre del producto; autor = empresa; sin «Producer» ni «Creator» que nombren a
  terceros más allá del motor.

---

## 4. Tipografía: qué se puede incrustar

- En el repo solo está Poppins (4 TTF estáticos) [verificado]. Las tres parejas propuestas hay que **descargarlas,
  comprobar su licencia (OFL) y autoalojarlas** en `src/modules/products/fonts/`. No las he descargado ni he
  comprobado la licencia en esta sesión: **[sin verificar]**.
- Con el motor recomendado (§7) vale cualquier `woff2`, también variable: Chromium incrusta en el PDF el subconjunto
  usado. Que una fuente **variable** quede como texto seleccionable y no como contornos es **[sin verificar]** y se
  comprueba en la fase 0. Plan B: instancias estáticas de los pesos de las tablas de arriba.
- Pila de sustitución con métricas parecidas en cada plantilla, y `document.fonts.ready` antes de imprimir: si la
  fuente no carga, cambian todos los altos y el reparto por filas deja de cuadrar.
- Ningún texto en mayúsculas sostenidas. Cuerpo mínimo absoluto: **7 pt**.
- Poppins no se usa en las plantillas nuevas: es la letra de IAGUA.

---

## 5. Color: la regla calculada

La empresa da **dos colores** (primario y acento). De ahí salen todas las fichas de color con una función pura,
`derivarPaleta(primario, acento)`, la misma para el PDF, la web y la vista previa. Trabaja en **OKLCH** y mide con
la fórmula de contraste de WCAG 2.

| Ficha de color | Cómo se calcula | Garantía |
|---|---|---|
| `papel` | `#FFFFFF` | — |
| `tinta` | OKLCH(L 0,24 · C mín(C del primario, 0,04) · H del primario) | ≥ 16:1 sobre papel |
| `tinta-suave` | la tinta con L 0,48 | ≥ 4,5:1 sobre papel (comprobar en el test) |
| `velo` | OKLCH(L 0,965 · C mín(C, 0,02) · H) | tinta sobre velo ≥ 14,6:1 |
| `primario-campo` | El primario. Si ni el blanco ni la tinta llegan a 4,5:1 encima, se mueve L de 0,01 en 0,01 (hacia oscuro si gana el blanco, hacia claro si gana la tinta) hasta llegar. | texto encima ≥ 4,5:1 |
| `sobre(campo)` | Blanco o tinta: el que más contraste dé sobre ese campo. | — |
| `primario-trazo` | El primario oscurecido en L hasta 4,5:1 sobre papel. **Si hacen falta más de 25 pasos** (amarillos, pasteles), no se usa como trazo: los trazos y títulos van en tinta y el primario queda solo como campo. | ≥ 4,5:1 |
| `acento-marca` | El acento oscurecido hasta 3:1 sobre papel (gráficos, letras de cota grandes). | ≥ 3:1 |
| `acento-texto` | El acento oscurecido hasta 4,5:1. | ≥ 4,5:1 |
| `acento-campo` | Igual que `primario-campo`. | ≥ 4,5:1 |

Al reducir L, si el color sale de gama se baja el croma hasta que entra. Se guarda en hexadecimal de 8 bits.

**Comprobado con un prototipo** de esta sesión (script suelto, no está en el repo) sobre una rejilla de **4.096
colores** (16³): peor contraste de texto sobre campo **4,50**, peor trazo **4,50**, peor marca **3,00**, peor tinta
sobre velo **14,68**. De los 4.096, 413 necesitan ajustar el campo y 810 quedan como «solo campo». Casos límite:

| Entrada | `primario-campo` → texto encima | `primario-trazo` |
|---|---|---|
| `#FFE600` amarillo | se queda · tinta `#232007` · 12,9:1 | solo campo (36 pasos) |
| `#3DA5DD` azul claro de IAGUA | se queda · tinta · 5,9:1 | `#007CB0` · 4,7:1 |
| `#808080` gris medio | `#868686` · tinta · 4,5:1 | `#747474` · 4,7:1 |
| `#FF0000` rojo puro | `#FF3427` · tinta · 4,6:1 | `#EA0000` · 4,7:1 |
| `#FFFFFF` blanco | se queda · tinta · 16,5:1 | solo campo |

El ejecutor convierte el prototipo en un test que recorre la rejilla y falla si cualquier par baja del umbral. La
regla del rojo (aclara y pone tinta en vez de oscurecer y poner blanco) se puede afinar a «la dirección con menos
pasos» [decide del ejecutor]; el test no cambia.

**Dos avisos en la pantalla de configuración**, calculados, no opinados:

- Si el primario es «solo campo»: «Tu color principal es claro. En fondos sale tal cual; en líneas y títulos usamos
  la tinta oscura para que se lea.»
- Si primario y acento distan menos de 0,10 en OKLab: «Tus dos colores se parecen mucho: el acento no destacará.»

`products.datasheet_color_accent` (acento por producto) se respeta en las plantillas nuevas, pasando por la misma
función [decide; pregunta 8 si se prefiere retirarlo].

---

## 6. Paletas

Ocho predefinidas y una personalizada. Los nombres salen del oficio (tubería, depósito, señal), no de una carta de
moda. Valores derivados con el prototipo de §5:

| Clave | Nombre | Primario | Acento | Texto sobre el campo primario | Acento como texto |
|---|---|---|---|---|---|
| `pizarra` | Pizarra y cobre *(por defecto)* | `#2E3A45` | `#B5632E` | blanco · 11,6:1 | `#B2602B` · 4,6:1 |
| `marino` | Marino y latón | `#16344E` | `#B8902F` | blanco · 12,8:1 | `#936F0A` · 4,6:1 |
| `agua` | Agua clara | `#1E6FB8` | `#19A7A0` | blanco · 5,2:1 | `#06827D` · 4,7:1 |
| `glaciar` | Glaciar | `#7CC4E8` | `#0E3A5A` | tinta `#07222F` · 8,5:1 | `#0E3A5A` · 11,9:1 |
| `aljibe` | Aljibe | `#1F4D3F` | `#D0A640` | blanco · 9,6:1 | `#947001` · 4,6:1 |
| `grafito` | Grafito y señal | `#2A2C2F` | `#E0A100` | blanco · 14,0:1 | `#9A6E0A` · 4,6:1 |
| `burdeos` | Burdeos | `#6E1F33` | `#C9A46A` | blanco · 11,0:1 | `#937037` · 4,6:1 |
| `cal` | Cal y óxido | `#4A4640` | `#B33A2B` | blanco · 9,4:1 | `#B33A2B` · 5,9:1 |
| `personalizada` | Tus colores | el que elija | el que elija | calculado | calculado |

«Glaciar» está a propósito: es la paleta de primario claro, la que demuestra que la regla pone tinta oscura encima.

### 6.1 Pantalla de configuración (`/configuracion/pdf`, la que ya existe)

Tres pasos en una sola página, sin asistente:

1. **Plantilla.** Tres tarjetas —Plano, Escaparate, Placa— con una **miniatura real** de la hoja 1 (no un icono) y
   una línea de para quién es. Debajo, plegado, «Plantillas anteriores»: Estándar e IAGUA, tal como están hoy. La
   empresa que tenga una antigua la ve marcada y nada cambia hasta que pulse otra y guarde.
2. **Paleta.** Ocho muestras. Cada muestra no son dos círculos: es una **ficha en miniatura** con un campo del
   primario, una línea de texto encima en su color calculado y una marca de acento, así se ve el resultado y no el
   ingrediente. La novena, «Tus colores», despliega dos selectores con su campo de texto hexadecimal y los avisos
   de §5.
3. **Datos de contacto de la ficha.** Teléfono, correo y web que salen en el pie (por defecto, los fiscales), y tres
   interruptores: variantes, documentos, consumibles y recambios.

**Vista previa en vivo.** Hoy el `iframe` regenera el PDF en cada cambio. Con el motor nuevo la vista previa es el
**HTML de la hoja**, no el PDF: cambiar de paleta es cambiar seis variables CSS, sin petición al servidor; cambiar
de plantilla recarga el `iframe`. Se enseña con el producto de muestra de la empresa (el que ya usa el formulario) o
con uno ficticio si no tiene ninguno. Botón «Descargar PDF de prueba» aparte.

**Escritorio (≥ 1024 px):** controles a la izquierda (380 px) y la hoja a la derecha, pegada al desplazarse, escalada
al alto disponible, con las hojas apiladas sobre gris.

**A 390 px:**

```
┌────────────────────────────────┐
│ Fichas técnicas                │
│ Plantilla                      │
│ ┌────────┐┌────────┐┌────────┐ │  carrusel horizontal con ajuste; cada tarjeta 132 px
│ │ Plano  ││Escapar.││ Placa  │ │  con su miniatura; la elegida, con marco de 2 px
│ └────────┘└────────┘└────────┘ │
│ Paleta                         │
│ ▣ ▣ ▣ ▣                        │  rejilla 4 × 2; cada muestra 78 × 56 px (> 44 px de dedo)
│ ▣ ▣ ▣ ▣   [ Tus colores ]      │
│ Contacto de la ficha …         │
├────────────────────────────────┤
│ [▯ hoja]  Ver ficha   Guardar  │  barra fija abajo: miniatura viva de 40 px, «Ver ficha»
└────────────────────────────────┘  abre la hoja a pantalla completa (358 px de ancho, pellizco)
```

La barra respeta `safe-area-inset-bottom`. «Guardar» solo se activa si hay cambios. La hoja a pantalla completa se
cierra con un botón visible, no solo con gesto.

---

## 7. Versión web pública (`/datasheet/[token]`)

Hoy es una sola página igual para todas. Pasa a tener el mismo carácter que el PDF de cada plantilla, pero **no es
la hoja A4 encogida**: es una página de una columna hecha para el pulgar. Comparten los bloques y la paleta.

Común a las tres, a 390 px:

- Cabecera de 56 px sobre papel con el logo (Regla del Logo en Papel) y la referencia en mono.
- **Botón «Descargar PDF» fijo abajo**, uno solo, ancho completo, 48 px, con `safe-area`. Es el único botón de
  acción de la página; teléfono y correo son enlaces `tel:` y `mailto:` en el bloque de contacto.
- Las tablas **no hacen scroll horizontal**: cada fila es etiqueta a la izquierda y valor a la derecha, y si el valor
  no cabe baja a su propia línea alineado a la derecha.
- Grupos de características plegables con `<details>`; el primero abierto. Con 41 atributos la página no se hace
  eterna.
- Fotos: `principal`, `ambiente` y `detalle` en una galería con ajuste horizontal; `medidas` aparte, siempre entera
  y sobre blanco.
- Documentos como lista de enlaces (aquí sí hay enlaces); el QR no se pinta en móvil.
- Sin grano ni textura en el PDF; en la web, grano muy suave (`feTurbulence`, opacidad 0,06) solo sobre el fondo.
- `noindex`, y **ninguna ruta de imagen con el nombre del fabricante**: el plan del catálogo guarda los iconos en
  `catalog-global/iconos/osmofilter/…`; en la web pública las imágenes se sirven por una ruta propia o incrustadas,
  nunca con esa URL a la vista.
- Enlace caducado o revocado: se mantiene la pantalla actual («Enlace no disponible»), con el nombre de la empresa.

Lo que cambia por plantilla:

| | Móvil (390 px) | Escritorio |
|---|---|---|
| **Plano** | Foto sobre su peana a todo el ancho con la línea de suelo; nombre y rasgos debajo; cotas en una fila de fichas `a 290` `b 990` `c 525`; tabla con filetes; el cajetín se convierte en el bloque de contacto final, con sus celdas apiladas de dos en dos. | Dos columnas 5/7 como la hoja 1; el cajetín, a todo el ancho al pie. |
| **Escaparate** | Campo de color a sangre arriba (0 de radio contra los bordes) con nombre y reclamo; el equipo debajo, pisando el borde del campo 40 px; ventajas en lista vertical con icono de 40 px; pieza de contacto con el teléfono grande antes del pie. | Campo a todo el ancho, equipo a la derecha pisando el borde; ventajas en fila. |
| **Placa** | Rejilla de campos a **dos columnas** (etiqueta arriba, valor abajo), dibujada con `gap: 1px`; foto y medidas arriba una bajo otra; referencia en su celda de primario. | Tres columnas de campos, ancho máximo 880 px. |

Imprimir desde la web (Ctrl+P) saca la versión web limpia, sin barra ni botones. La hoja A4 buena es el PDF.

---

## 8. Decisión técnica

### Qué hay hoy

Dos motores, los dos en servidor: **pdf-lib a mano** (lo que está en producción) y **satori → PNG → pdf-lib**
(escrito, pero solo en pruebas). Ninguno comparte nada con la web pública.

### Opciones

| | pdf-lib a mano (actual) | satori → PNG (escrito, en pruebas) | HTML imprimible + Chromium |
|---|---|---|---|
| Texto del PDF | Vectorial | **Imagen**: no se selecciona ni se busca [verificado] | Vectorial |
| Tipografía | Solo Helvetica (no hay `fontkit`) [verificado] | TTF propios | Cualquiera, también variable [sin verificar en PDF] |
| Maquetación | Coordenadas a mano: 1.029 líneas para una plantilla | Subconjunto de CSS (flex) [sin verificar el detalle] | CSS completo: rejilla, tablas, `break-inside`, `multiply` |
| Web y vista previa | Aparte: otra implementación | Aparte: otra implementación | **La misma** hoja HTML |
| Implementaciones para 3 plantillas | 3 PDF + 3 web | 3 satori + 3 web | 3 hojas + 3 páginas que comparten bloques y CSS |
| Coste en Vercel | Mínimo | Bajo (sharp ya está) | **El más alto**: binario de Chromium en la función, arranque en frío de segundos, más memoria |
| Dependencias nuevas | `@pdf-lib/fontkit` | ninguna | `@sparticuz/chromium` + `puppeteer-core` (o equivalente) |

### Recomendación: **HTML imprimible con Chromium en servidor, con caché en Storage**

Por qué:

1. **Tres plantillas con web y vista previa son nueve superficies.** Con una hoja HTML por plantilla, el PDF, la
   vista previa de configuración y buena parte de la web salen del mismo código. Con los motores actuales cada
   plantilla se escribe dos veces y la vista previa en vivo sigue siendo «regenerar el PDF».
2. **El diseño lo pide.** La Regla de la Hoja Declarada, el cajetín en rejilla, los campos de la Placa y el equipo
   pisando el borde son CSS corriente y un calvario en coordenadas.
3. **El PDF es de verdad:** texto vectorial, seleccionable y buscable. Una ficha técnica de la que no se puede
   copiar la referencia es un defecto, y es lo que da hoy el motor de satori.
4. **Hace falta servidor igualmente:** el PDF se adjunta a correos (`email-share-actions.ts`) y se descarga desde el
   móvil. «Imprimir desde el navegador» no cubre ninguno de los dos casos (skill `panel-informes`, §13).

Cómo se contiene el coste:

- **Caché.** El PDF se guarda en un bucket privado con una huella = plantilla + versión de la plantilla + paleta +
  fecha de última modificación del producto y de sus fotos, atributos y documentos. Descargar, ver y adjuntar leen
  el fichero; Chromium solo arranca la primera vez tras un cambio. El techo de generaciones es «productos × cambios»,
  no «productos × visitas».
- La función de Chromium es **una sola ruta**, con `maxDuration` propio y fuera del resto de la app.
- Chromium solo abre **una ruta interna de la propia app** con un token firmado de vida corta, y se le bloquea
  cualquier petición que no sea al propio dominio o al de Storage.

Lo que **no** sé y hay que medir antes de comprometerse (**fase 0**): tamaño real del binario en la función y si
entra en el límite de Vercel; tiempo de arranque en frío y de render de 3 hojas en `cdg1`; memoria que pide; coste
en la factura de Vercel Pro; si las fuentes variables quedan como texto; si `mix-blend-mode` y
`print-color-adjust` sobreviven al PDF. Todo eso es **[sin verificar]**: no doy cifras porque no las he medido.

**Si la fase 0 no pasa** (no entra, tarda demasiado o cuesta lo que no debe): las hojas HTML siguen valiendo tal cual
para la web y la vista previa; el PDF lo saca el navegador («Imprimir → Guardar como PDF») y el correo lleva el
enlace a la ficha en vez del adjunto. Es peor en móvil, pero no se tira nada de lo hecho. Lo que **no** recomiendo
es escribir las tres plantillas en satori: es el camino que deja el texto como imagen.

Las plantillas `standard` e `iagua` **no se tocan ni se migran de motor**.

---

## 9. Modelo de datos (migración aditiva)

`supabase/migrations/2026112Xhhmmss_fichas_plantillas.sql` — [sin verificar: confirmar contra el esquema remoto por
la Management API antes de escribirla].

```sql
-- 1) Valores nuevos de plantilla: el CHECK pasa a ser un superconjunto. El default sigue siendo 'standard'.
alter table public.company_settings drop constraint if exists company_settings_datasheet_template_check;
alter table public.company_settings add constraint company_settings_datasheet_template_check
  check (datasheet_template in ('standard','iagua','plano','escaparate','placa'));

-- 2) Paleta propia de las fichas. NULL = paleta por defecto ('pizarra') en las plantillas nuevas.
alter table public.company_settings add column if not exists datasheet_palette jsonb;
-- { "clave": "marino" }                                       predefinida
-- { "clave": "personalizada", "primario": "#RRGGBB", "acento": "#RRGGBB" }
alter table public.company_settings add constraint company_settings_datasheet_palette_check check (
  datasheet_palette is null or (
    jsonb_typeof(datasheet_palette) = 'object' and datasheet_palette ? 'clave'
    and (datasheet_palette->>'clave' <> 'personalizada' or (
      datasheet_palette->>'primario' ~* '^#[0-9a-f]{6}$' and datasheet_palette->>'acento' ~* '^#[0-9a-f]{6}$'))));

-- 3) Opciones de la ficha. NULL = valores por defecto.
alter table public.company_settings add column if not exists datasheet_opciones jsonb;
-- { "telefono": "...", "correo": "...", "web": "...",
--   "mostrar_variantes": true, "mostrar_documentos": true, "mostrar_recambios": false }
```

Por qué así:

- **Infinity no ve nada.** Su fila sigue en `standard`; no se actualiza ninguna fila; las dos columnas nuevas nacen
  a `NULL`; los generadores antiguos no las leen. `datasheet-pick.ts` gana tres ramas y conserva su caída a
  `standard` ante cualquier error.
- **No se tocan `pdf_brand_color` ni `pdf_accent_color`** (§0.2, punto 3). Las plantillas nuevas leen solo
  `datasheet_palette`; las antiguas, solo las dos columnas de siempre.
- Los hexadecimales de las ocho paletas viven **en código**, no en la base: así se pueden retocar sin migración y
  la huella de caché cambia con la versión de la plantilla.
- En código: ampliar `DatasheetTemplate` y el `z.enum` de `src/modules/config/pdf/actions.ts` (hoy
  `"standard" | "iagua"`, y cualquier otro valor lo convierte en `standard` al leer: línea 44).

Otras piezas, sin cambio de esquema o ya previstas en el plan del catálogo:

- `products.datasheet_extra.features[]` gana `icon` (ruta del icono ya reentintable). Es JSON: aditivo. Hoy el tipo
  es `{ title, desc }` [verificado].
- `product_attributes.grupo` y su orden: los propone la §A del plan del catálogo [sin verificar si ya existen]. Sin
  ellos, las plantillas pintan un solo grupo «Características».
- `product_compatibilities` de empresa **no tiene `cantidad` ni orden** [verificado en la migración de creación];
  mientras no los tenga, la ficha no pinta cantidad.
- `product_images.tipo_foto` ya existe (migración `20261125100000`) [verificado].
- **Opcional, fase posterior:** guardar la `caja` del ambiente (`catalog_product_photos` y `product_images`, cuatro
  números) para recortar alrededor del equipo. Sin ella, el recorte es centrado.
- Bucket privado nuevo `datasheets-cache`. No necesita tabla.

---

## 10. «Don't»

- No aparece **ningún nombre de fabricante**: ni en texto, ni en metadatos del PDF, ni en nombres de fichero, ni en
  URL de imagen, ni en el `alt`. Las plantillas no leen `manufacturer_*`.
- No se retoca ni se tapa el logo de la carcasa en las fotos. Tampoco se añade ninguno.
- No se usa `ficha-tecnica.webp` ni `banner.webp` del fabricante en las fichas: son su maquetación.
- No se pintan los iconos con su azul y su cuadrado: siempre reentintados y sin fondo.
- No hay banda de color con el logo dentro. El logo va sobre papel.
- No hay foto dentro de una tarjeta con borde, radio y sombra. Ni sombra pintada bajo el equipo.
- No hay tabla cebra gris. Filete fino; velo solo donde la Placa lo pide.
- No hay cintillos en versalitas encima de los bloques, ni mayúsculas sostenidas, ni cadenas «A · B · C».
- No hay «tres cifras gigantes con etiqueta». Los datos van en su tabla.
- No hay un radio único para todo: cada plantilla tiene los suyos y lo que toca el borde de la hoja va a 0.
- No hay degradados, ni iconos en círculos de color, ni «check» verdes.
- No se rellena un hueco: sin dato no hay bloque. Nunca «—» ni «N/D».
- No se recorta ni se pone sobre color el dibujo de medidas.
- No se confía un contraste al ojo: todo color de texto sale de `derivarPaleta`.
- No se deja al motor cortar una tabla: hojas declaradas y filas medidas.
- No se usa `overflow`, `max-height`, `position: fixed/sticky`, `vh/vw` ni `rem` en la geometría de la hoja.
- No se anida `@page` dentro de `@media print`; `@page { size: A4; margin: 0 }` al nivel superior.
- No se cambia nada de `datasheet-pdf.ts`, `datasheet-pdf-v2.ts` ni `datasheet-iagua*.ts*` en este trabajo.
- No se escribe en `pdf_brand_color` ni `pdf_accent_color` desde la pantalla nueva.
- Errores ya cometidos que no se repiten: pedir `data_type` a `product_attribute_values`; no mirar `error` tras una
  consulta; empaquetar las fuentes solo para una de las dos rutas de PDF; enlace del QR que caduca.

### Checklist anti-IA (de `~/.claude/estilo-web.md` §4, adaptado a papel)

- [ ] ¿Cada plantilla tiene más de un radio y cada uno tiene su porqué? (Plano 0 / 0,6 · Escaparate 0 / 1,6 / 2 / 4 ·
      Placa 0 / 2,5.)
- [ ] ¿Los pesos son no redondos (430, 450, 470, 590, 620, 660) y en Plano se usa el eje `wdth`?
- [ ] ¿La peana se elige midiendo la foto real del equipo?
- [ ] ¿Las fotos van apoyadas, sin sombra falsa ni recorte con halo?
- [ ] ¿Hay **un** gesto por plantilla (cajetín, pisar el borde, campos de placa) y solo uno?
- [ ] ¿Se han quitado los cintillos en versalitas y las cadenas con puntos?
- [ ] ¿La web tiene un solo botón de acción?
- [ ] ¿Está escrito qué se ha rechazado? (§1.)
- [ ] ¿Alternan zonas densas y calmas dentro de la hoja, y no son todas losas iguales?
- [ ] ¿Ninguna animación de la web pasa de 300 ms y el héroe no se anima?
- [ ] ¿Se ha visto a **390 px**: la web de las tres plantillas y la pantalla de configuración?
- [ ] ¿Se ha impreso una hoja en blanco y negro y se sigue entendiendo?
- [ ] ¿`pdftotext` sobre los PDF de prueba no devuelve ningún nombre de `manufacturers`?
- [ ] ¿Salen las hojas esperadas, sin una en blanco al final?

Dos puntos del checklist original **no aplican al PDF** y lo digo en vez de callarlo: el grano sobre toda la página
(solo en la web: en papel es tinta y peso de fichero) y `mix-blend-mode: multiply` en las fotos (la principal es
transparente y no lo necesita; el dibujo de medidas va sobre blanco).

---

## 11. Fases de ejecución

Cada fase acaba en algo que se puede comprobar sin fiarse de nadie. Antes y después de cada una que toque base de
datos, la comprobación de Infinity del plan del catálogo (§F.2).

| Fase | Qué se hace | Cómo se verifica |
|---|---|---|
| **0 · Prueba de Chromium** | Una ruta suelta que imprime a PDF una hoja de prueba con una fuente variable, una imagen transparente, un campo de color y un `multiply`. Sin plantillas. | Desplegado en Vercel: entra en el límite, se anota el tiempo en frío y en caliente y la memoria; el texto del PDF se selecciona; los fondos salen. **Si no pasa, se para y se aplica el plan B de §8.** |
| **1 · Migración** | La de §9 y los tipos de `config/pdf/actions.ts`. Sin pantalla. | `SELECT` de `company_settings` antes y después: las cinco filas iguales salvo las dos columnas nuevas a `NULL`. El PDF de un producto de Infinity pesa lo mismo que antes. |
| **2 · Paleta** | `derivarPaleta` como función pura y las ocho paletas en código. | Test sobre la rejilla de 4.096 colores: ningún par bajo su umbral. Los valores de la tabla de §6 coinciden. |
| **3 · Datos de la ficha** | Un cargador único que devuelve el modelo normalizado (identidad, fotos por `tipo_foto`, ventajas, grupos, cotas, variantes, recambios, documentos, contacto). `data_type` desde `product_attributes`; todas las consultas miran `error`; nunca `manufacturer_*`. | Tests con cuatro productos: completo, sin nada, 41 atributos, variante de gama. El de «sin nada» devuelve bloques vacíos, no errores. |
| **4 · Plantilla Plano (hojas HTML)** | Ruta interna de vista con las hojas. Seis casos fijos: completo, sin ventajas, sin medidas, 3 atributos, 41 atributos y nombre largo sin foto. | Captura de cada caso; se cuentan las hojas; ninguna fila partida; constantes de filas medidas y comentadas. |
| **5 · PDF y caché** | Chromium imprime las hojas; bucket de caché; ramas nuevas en `datasheet-pick.ts`; fuentes empaquetadas para **las dos** rutas de PDF. | Una empresa de pruebas con `plano`: PDF correcto por sesión, por token y como adjunto. Segunda descarga sin arrancar Chromium. Infinity, intacta. |
| **6 · Web pública** | `/datasheet/[token]` con la variante Plano; las plantillas antiguas conservan la página actual. | Vista a 390 px y a 1280 px. Sin scroll horizontal. Ninguna URL ni texto con el fabricante. |
| **7 · Configuración** | Pantalla de §6.1 con vista previa en vivo. | A 390 px: elegir plantilla y paleta, ver la hoja, guardar. Una empresa en `standard` que entra y sale sin guardar sigue en `standard`. |
| **8 · Escaparate** | Hojas, web y miniatura. | Los seis casos y las ocho paletas (48 capturas, revisadas en una pasada). |
| **9 · Placa** | Hojas, web y miniatura. | Igual, más una impresión real en blanco y negro. |
| **10 · Cierre** | Iconos reentintados para los 82, enlace permanente del QR, lista negra de fabricantes, checklist de §10. | `pdftotext` de 20 fichas sin coincidencias; el QR de un PDF de hace 61 días sigue abriendo. |

---

## 12. Preguntas para Mario

1. **Las tres plantillas y sus registros.** ¿Valen Plano (técnico), Escaparate (comercial) y Placa (una hoja
   compacta)? ¿Cuál es la predeterminada de las empresas nuevas? *Propongo Plano.*
2. **Chromium en Vercel.** Es una dependencia nueva y pesada, con caché para que solo arranque cuando cambia un
   producto. ¿Hago la prueba de la fase 0 antes de nada? *Lo recomiendo; si no pasa, hay plan B sin tirar trabajo.*
3. **El fallo de `data_type`.** Todo apunta a que la ficha `standard` que usa Infinity hoy sale **sin tabla de
   características**. Arreglarlo es una línea, pero Infinity vería aparecer la tabla. ¿Se arregla ya o se deja como
   está hasta que elija plantilla?
4. **Documentos con la marca del fabricante.** Manuales, certificados, dípticos y flyers llevan el logo de
   Osmofilter. ¿Cuáles se enlazan desde la ficha pública? *Propongo manuales y certificados visibles; dípticos,
   flyers y fichas del fabricante solo dentro del CRM.*
5. **Marcas de componentes.** Hay ventajas como «Resina Amberlite™ (Made in USA)» y atributos como «Modelo de
   válvula: TM69». ¿Cuentan como «otro fabricante» y se quitan, o se quedan por ser del componente?
6. **Contacto del pie.** No hay campo de web en la configuración de la empresa. ¿Añado teléfono, correo y web
   propios de la ficha (por defecto, los fiscales)? ¿Sale la dirección?
7. **Recambios en la ficha del cliente.** ¿Apagados por defecto y solo para el técnico, como proponía el plan?
8. **Color de acento por producto** (`datasheet_color_accent`). ¿Se mantiene en las plantillas nuevas o manda
   siempre la paleta de la empresa?
9. **Uso de los iconos y fotos de Osmofilter bajo la marca de cada empresa**, reentintando los iconos. Doy por hecho
   que hay permiso como distribuidor; no lo he verificado.
