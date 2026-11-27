# Diseño: la propuesta de captación (página `/p/[codigo]` y PDF)

Documento de diseño, escrito **antes del código**. Cubre la fase 4 del módulo de captación por WhatsApp
(`docs/PLAN_MODULO_CAPTACION_WHATSAPP.md` §3.4, §4.5 y §9). Registro elegido por Mario: **A (serio)** de
`~/.claude/estilo-web.md`. Fecha: 27-11-2026.

Marcas usadas: **[V]** comprobado en el repositorio · **[NV]** sin verificar · **[decide]** decisión rutinaria
tomada aquí · **[Mario]** hay que preguntarlo, cambia el resultado.

Los textos de ejemplo usan un negocio inventado («Restaurante Ca'n Toni», Palma) y un teléfono de formato
(«971 00 00 00»). Ni el color ni el teléfono ni los datos fiscales reales de Infinity Aqua se han consultado: salen
de Hidromanager al generar.

---

## 0. Qué es y para quién

Un negocio de Mallorca (hotel, restaurante, oficina) recibe un WhatsApp en frío, pulsa «Sí, cuéntame» y a los pocos
segundos le llegan un PDF y un enlace. Lo abre **en el móvil, dentro del navegador de WhatsApp, con una mano y con
prisa**. No conoce a la empresa. Tiene tres preguntas, en este orden:

1. ¿Esto es para mí o es publicidad en serie?
2. ¿Qué me proponen exactamente?
3. ¿Qué hago si me interesa?

La página y el PDF contestan a las tres y nada más. No venden la empresa, no explican la tecnología y no piden datos:
el único paso siguiente es **«Que me llaméis»**.

---

## 1. Norte material: «El Impreso con Membrete»

La propuesta es **un impreso de la casa rellenado a máquina para un solo destinatario**: papel con el membrete de la
empresa, casillas preimpresas con su rótulo, y dentro de cada casilla lo que se ha mecanografiado para este negocio.
Lleva un sello con la fecha hasta la que vale y termina en un cupón de respuesta separado por una línea de corte.

Cuando surja una duda de diseño, la pregunta no es «qué queda mejor» sino **«¿qué haría el impreso?»**.

Lo que se deduce de ahí:

- **Dos voces y solo dos.** Lo que es igual para todos los negocios está *preimpreso* (grotesca). Lo que cambia de
  una propuesta a otra está *mecanografiado* (monoespaciada). El nombre del negocio es lo más grande de la primera
  pantalla y va a máquina: es la prueba de que la hoja es suya.
- **Un impreso no se mueve.** No hay entradas al hacer scroll, ni carruseles, ni contadores. Está impreso entero
  desde el primer momento.
- **Un impreso no tiene tarjetas.** Tiene casillas separadas por filetes y una relación de partidas.
- **La profundidad es otra hoja debajo**, no una sombra.
- **El sello dice una verdad con fecha**: «válida hasta», «caducada», «retirada». Es el único gesto con carácter y es
  el mismo objeto en los tres estados.
- **El precio es una fila que está o no está.** Un impreso sin precio no dice «consultar»: sencillamente no lleva
  esa fila.

---

## 2. Lo que esta propuesta NO es (rechazo explícito)

- **La landing de producto genérica**: héroe a pantalla completa con foto de ambiente y titular de promesa («Agua
  pura para tu negocio»), tres ventajas con icono en círculo, franja de logotipos de clientes, testimonios, preguntas
  frecuentes en acordeón, formulario de contacto y pie con cuatro columnas. Aquí no hay héroe: hay un destinatario.
- **El PDF de catálogo con rejilla de tarjetas**: portada a sangre con degradado, una página por producto o una
  rejilla de 2 × 3 tarjetas iguales con esquinas redondas y sombra, cinta «Novedad», y «Página 1 de 6» centrado.
- **El presupuesto sin precios disfrazado**: columnas de precio vacías, «Consultar», «Desde —», precios desenfocados
  o un candado.
- **La página de seguimiento que se nota**: avisos de cookies, ventanas emergentes de «¿te llamamos?» a los diez
  segundos, burbuja de chat flotante.
- **El «enlace mágico» de SaaS**: página blanca, logotipo centrado, tarjeta con sombra y un botón redondo.
- **La ficha técnica**: eso ya existe (plantillas Tarifa, Escaparate y Placa) y es otro documento. La propuesta no
  lleva tablas de características, dibujo de cotas ni recambios.
- **La copia de IKREAA**: se comparte el registro, no la web. Aquí no hay latón ni talonario; el color es el de cada
  empresa (§4.1).

---

## 3. Reglas con nombre

| Regla | Qué dice |
|---|---|
| **Del Impreso Rellenado** | Lo común a todas las propuestas, en la grotesca (preimpreso). Lo propio de esta, en la monoespaciada (mecanografiado). No se mezclan dentro de una misma línea salvo «rótulo: valor». |
| **De la Casilla** | Todo dato vive en una casilla con su rótulo encima. Las líneas las dibuja el hueco (`display: grid; gap: 1px` sobre el color del filete), nunca bordes dobles. |
| **Del Sello con Fecha** | Un sello por pantalla y por hoja. Siempre dice algo cierto y fechado. Es la única caja alta del documento y el único elemento girado (−4°). |
| **De la Partida, no la Tarjeta** | Los equipos son partidas de una relación, separadas por un filete. Sin caja, sin sombra, sin radio. La primera es grande; las demás, compactas. |
| **De la Fila que Falta** | El precio es una fila más de la casilla de datos. Si la empresa no lo activa, la fila no existe y nada lo delata. |
| **Del Cupón Único** | En cada momento hay en pantalla **un** «Que me llaméis», ni cero ni dos. Nunca un segundo botón a su lado. |
| **Del Mismo Nombre** | La acción se llama «Que me llaméis» en el botón de WhatsApp, en la página, en el PDF y en el mensaje prellenado. No hay «Contactar», «Solicitar información» ni «Te llamamos». |
| **De la Hoja Debajo** | La profundidad es otra hoja desplazada 7 px (`::before`). Ninguna sombra difusa en todo el documento. |
| **Del Papel Opaco** | Nada es translúcido: ni la barra fija, ni velos, ni desenfoques. Es papel. |
| **De la Vista Previa Muda** | Los metadatos que lee WhatsApp solo dicen quién envía. Ni el negocio, ni los equipos, ni el estado. |
| **Del Enlace sin Rastro** | La página no pide nada a terceros y no manda la URL como referente. El código de la propuesta no sale del dominio. |
| **De la Lista Blanca** | Solo llegan a la página y al PDF: nombre, descripción corta, `marketing_claim`, imagen principal, medidas, garantías y, si se activa, el precio de venta. Lo demás no se consulta (plan §3.4). |
| **La Carta Termina Donde Termina** | El PDF no rellena el papel que sobra ni estira bloques para llegar al pie. |
| **Sin Dato, Sin Hueco** *(heredada de las fichas)* | Casilla sin dato no se pinta: ni rótulo, ni «—». La rejilla se recompone. |
| **Del Contraste Calculado** *(heredada, ampliada)* | Ningún color se elige a ojo y **cada par se mide contra el fondo real que pisa**, no contra blanco (§4.1). |
| **Del Dedo** *(heredada, ampliada)* | Todo lo pulsable mide 48 px o más de alto en la página. |

### Presupuesto de movimiento: tres gestos

Con el vocabulario de `animation-vocabulary`:

| Gesto | Nombre | Valores |
|---|---|---|
| El sello al cargar | *Scale in* con *fade in*, sin rebote | de `scale(1.12)` y opacidad 0 a `scale(1)` y 1; 280 ms; `cubic-bezier(.2,.8,.2,1)` (*ease-out*); una vez; con `@starting-style`, sin JavaScript |
| Pulsar el botón | *Press feedback* | `scale(.98)` en `:active`, 120 ms, responde al bajar el dedo |
| La barra fija se retira al llegar al cupón | *Slide out* por `transition`, interrumpible | `translateY(100%)`, 200 ms, *ease-out*; vuelve por el mismo camino |

Lo que **no** hay, dicho por su nombre: *scroll reveal*, *stagger*, *parallax*, *number ticker*, *marquee*, *skeleton*
ni *page transition*. El nombre del negocio (que es el LCP) no se anima. Con `prefers-reduced-motion: reduce` los tres
gestos se quitan y todo aparece en su sitio. Si `@starting-style` no existe en el navegador, el sello sale ya puesto:
falla enseñando.

---

## 4. Tokens

### 4.1 Color: del color de marca de la empresa

Se parte de `companies.primary_color` y, si existe, de `company_settings.pdf_accent_color` [V: son los que lee
`cargar-ficha.ts`]. Se reutiliza `derivarPaleta()` de `src/modules/products/ficha/paleta.ts` y se envuelve en una
función nueva y pura, `derivarPaletaPropuesta()`, que añade los papeles de pantalla y **vuelve a medir**.

Desviación consciente del registro A: allí hay «papeles apagados + una tinta + un metal». Aquí el metal no existe,
porque el documento es de muchas empresas: **papeles teñidos del tono de la marca + una tinta + el color de la marca**.

| Token | Cálculo (H y C son los del primario) | Uso |
|---|---|---|
| `--mesa` | OKLCH(L 0,925 · C mín(C, 0,014) · H) | Fondo de la página: la mesa sobre la que están las hojas |
| `--hoja` | OKLCH(L 0,985 · C mín(C, 0,006) · H) | La hoja |
| `--hoja-debajo` | OKLCH(L 0,955 · C mín(C, 0,010) · H) | La hoja desplazada 7 px |
| `--velo` | el de `derivarPaleta` (L 0,965) | Panel de cada foto |
| `--filete` | OKLCH(L 0,80 · C mín(C, 0,02) · H) | Líneas de casilla (decorativas, sin exigencia de contraste) |
| `--tinta` | el de `derivarPaleta` | Texto. Nunca negro |
| `--tinta-suave` | el de `derivarPaleta`, comprobado contra `--mesa` | Rótulos de casilla y pie |
| `--trazo` | el primario oscurecido hasta **4,5:1 contra `--velo`** (el fondo más oscuro donde se usa como texto) | Sello, enlaces, lema del equipo, filete del membrete |
| `--campo` / `--sobre-campo` | los de `derivarPaleta` | Relleno y texto del botón |

Medido el 27-11-2026 con la función real sobre tres colores de prueba (ninguno es el de Infinity: el primero es el del
comentario de `paleta.ts`):

| Par | `#28bce2` (claro) | `#1f3a5f` (oscuro) | `#f2c200` (amarillo) | Mínimo |
|---|---|---|---|---|
| tinta sobre hoja | 15,71 | 15,72 | 15,85 | 7 |
| tinta sobre mesa | 13,22 | 13,19 | 13,26 | 7 |
| tinta suave sobre hoja | 6,18 | 6,24 | 6,27 | 4,5 |
| tinta suave sobre velo | 5,86 | 5,88 | 5,89 | 4,5 |
| tinta suave sobre mesa | 5,21 | 5,23 | 5,24 | 4,5 |
| texto del botón sobre su relleno | 7,32 | 11,48 | 9,83 | 4,5 |
| **`primarioTrazo` actual sobre hoja** | **4,35** | 10,99 | 15,85 | 4,5 |
| **`primarioTrazo` actual sobre velo** | **4,12** | 10,36 | 14,91 | 4,5 |
| relleno del botón contra la hoja | 2,15 | 10,99 | 1,61 | 3 (gráfico) |

Dos consecuencias que salen de la tabla y que el ejecutor no puede saltarse:

1. **`primarioTrazo` tal como está no vale para la página.** Se calculó contra blanco y sobre la hoja teñida se queda
   en 4,35 y sobre el velo en 4,12. Por eso `--trazo` se recalcula contra `--velo`. Hace falta exportar
   `oscurecerHasta()` (hoy es privada en `paleta.ts`) o repetirla en la función nueva.
2. **Un botón de marca clara no se distingue del papel** (2,15 y 1,61). El botón lleva **siempre** un borde de 1 px
   en `--tinta`: así su contorno da más de 13:1 con cualquier marca y no depende del relleno.

Test obligatorio, como en las fichas: recorrer la rejilla de 4.096 colores y fallar si algún par de la tabla baja de
su mínimo.

Otros ajustes de color:

- `<meta name="color-scheme" content="light">` y `color-scheme: only light`. No hay modo oscuro: es papel, y así el
  navegador de Android no lo invierte por su cuenta.
- Con `prefers-contrast: more`: `--filete` pasa a `--tinta-suave` y la hoja a blanco.
- El foco de teclado: contorno de 2 px en `--tinta` con 2 px de separación.

### 4.2 Papel y fotos

- **Fibra global**: una capa `position: fixed; inset: 0; pointer-events: none` con ruido (`feTurbulence` en data-URI o
  PNG de 128 px), `mix-blend-mode: multiply`, opacidad 0,08. Sin ella la mesa es un `div` gris.
- **Fotos en `multiply`** sobre `--velo`, con `object-fit: contain` y 20 px de aire. Nunca recortadas, nunca con
  sombra pintada debajo. Las fotos de catálogo con fondo blanco se funden con el velo sin halo. [NV: comprobarlo con
  las fotos reales del catálogo de Infinity; si alguna trae fondo gris, se ve el rectángulo y hay que tratarla.]
- **Sombras**: ninguna. Las hojas se separan de la mesa por un borde de 1 px en `--filete` y por la hoja de debajo.

### 4.3 Radios (tres, con su porqué)

| Radio | Dónde | Por qué |
|---|---|---|
| 0 | Hojas, casillas, paneles de foto, barra fija | El papel se corta a guillotina |
| 1 px | Botón | Es un control, no papel: lo justo para no pinchar |
| 2 px | Sello | El caucho se desgasta por las esquinas |

No hay círculos: en este impreso no hay ningún agujero real.

### 4.4 Tipografía

Dos familias, por `next/font/google`, autoalojadas y con subconjunto `latin`:

- **Archivo** (variable, ejes `wght` y `wdth`) para lo preimpreso. [NV: confirmar al instalar que `next/font` sirve
  el eje `wdth` con `axes: ["wdth"]`.] Se explota el eje de anchura al revés de lo habitual: **cuanto más pequeño el
  rótulo, más estrecho**, como en los impresos de verdad.
- **Courier Prime** (400 y 700) para lo mecanografiado. Es la misma letra que el `Courier` del PDF, así que página y
  papel coinciden sin incrustar nada.

Pesos no redondos en Archivo. Tamaños en `rem` (el usuario que agranda la letra del móvil agranda la página).

| Papel | Familia · `wdth` · peso | 390 px | ≥ 960 px | Interlineado | Otros |
|---|---|---|---|---|---|
| Nombre del negocio | Courier Prime 700 | 22 px | 32 px | 1,15 | `text-wrap: balance`, `overflow-wrap: anywhere` |
| Título de bloque (`h2`) | Archivo · 84 · 640 | 22 px | 26 px | 1,15 | interletrado −0,01 em |
| Nombre del equipo principal | Archivo · 84 · 640 | 26 px | 30 px | 1,1 | interletrado −0,015 em |
| Nombre de equipo secundario | Archivo · 86 · 620 | 19 px | 20 px | 1,2 | |
| Lema del equipo (`marketing_claim`) | Archivo · 100 · 540 | 16 px | 16 px | 1,35 | color `--trazo` |
| Carta y descripciones | Archivo · 100 · 430 | 17 px / 15 px | 17 px / 15 px | 1,5 | máximo 62 caracteres por línea |
| Rótulo de casilla | Archivo · 78 · 520 | 12 px | 12 px | 1,2 | interletrado +0,01 em, color `--tinta-suave`, **en minúscula** |
| Dato mecanografiado | Courier Prime 400 | 15 px | 15 px | 1,35 | `tabular-nums` |
| Botón | Archivo · 92 · 620 | 17 px | 17 px | 1 | |
| Sello | Courier Prime 700 | 11 px y 15 px | igual | 1,1 | caja alta, interletrado +0,06 em |
| Pie legal | Archivo · 100 · 430 | 13 px | 13 px | 1,5 | color `--tinta-suave` |

No hay cintillos en versalitas sobre los títulos, ni una palabra del titular en otro color, ni flechas pegadas al
texto de los enlaces.

### 4.5 Medidas

Escala de espacio: 4 · 8 · 12 · 16 · 20 · 28 · 40 · 56 px. Margen lateral de la página: 16 px. Relleno de la hoja:
20 px (390 px) y 40 px (≥ 960 px). Ancho de la hoja a 390 px: 358 px; columna de texto: 318 px.

---

## 5. La página `/p/[codigo]`

### 5.1 Estructura a 390 px

De arriba abajo. Entre paréntesis, la altura aproximada con tres equipos.

```
mesa (fondo con fibra)
┌────────────────────────────────────┐
│ [logo]                             │  A · Membrete (64)
│────────────────────────────────────│
│ propuesta para                     │  B · Casillas (≈ 190)
│ Restaurante Ca'n Toni              │
│────────────────┬───────────────────│
│ tipo de negocio│ localidad         │
│ Restauración   │ Palma             │
│────────────────┼───────────────────│
│ fecha · ref.   │   ┌─────────────┐ │
│ 27-11-2026     │   │ VÁLIDA HASTA│ │  ← sello, girado −4°
│ K7M2Q4         │   │ 27 DIC 2026 │ │
│────────────────┴───└─────────────┘─│
│ Hola:                              │  C · Carta (≈ 170)
│ Nos pedisteis que os contáramos…   │
│ El equipo de Infinity Aqua         │
└────────────────────────────────────┘▒  ← hoja de debajo, 7 px
┌────────────────────────────────────┐
│ Equipos que os proponemos   3      │  D · Relación de equipos
│ ┌────────────────────────────────┐ │
│ │        foto (velo, 300)        │ │  D1 · Partida principal (≈ 620)
│ └────────────────────────────────┘ │
│ 1  Nombre del equipo               │
│ Lema · descripción · casilla datos │
│────────────────────────────────────│
│ ┌──────┐ 2  Nombre                 │  D2 · Partidas compactas (≈ 250 c/u)
│ │ foto │ Lema · descripción        │
│ └──────┘ casilla de datos          │
│────────────────────────────────────│
│ Los precios dependen de…           │  D3 · Nota de precios
│                                    │
│ Qué incluye (si la campaña lo trae)│  E · Qué incluye (opcional)
│- - - - - - - - - - - - - - - - - - │  ← línea de corte
│ ¿Lo vemos por teléfono?            │  F · Cupón de respuesta (≈ 300)
│ [        Que me llaméis          ] │
│ o llamad vosotros: 971 00 00 00    │
│ Descargar la propuesta en PDF      │
└────────────────────────────────────┘
pie legal, sobre la mesa               G · Pie (≈ 260)
═══════════════════════════════════════
[          Que me llaméis            ]  H · Barra fija (se retira al llegar a F)
```

**A · Membrete.** 64 px de alto. Logo de la empresa a la izquierda, caja máxima 132 × 40 px, `object-fit: contain`,
directamente sobre la hoja: sin recuadro ni banda de color (regla «Del Logo en Papel» de las fichas). Si no hay logo,
el nombre comercial en Archivo · 88 · 640 a 17 px. Debajo, un filete de 1 px en `--trazo` a todo el ancho de la hoja.
No hay menú, ni enlaces, ni teléfono: el teléfono vive en el cupón.

**B · Casillas.** Rejilla de casillas con `gap: 1px` sobre `--filete`; cada casilla tiene fondo `--hoja`, relleno de
12 px, rótulo arriba y dato debajo.

- Fila 1, a todo el ancho: rótulo «propuesta para», dato **«Restaurante Ca'n Toni»** (el nombre tal como está en
  `captacion_propuestas.nombre_negocio`). Es el `h1` de la página. Hasta tres líneas.
- Fila 2, dos casillas: «tipo de negocio» → «Restauración» · «localidad» → «Palma». Si falta una, la otra ocupa toda
  la fila; si faltan las dos, la fila no existe.
- Fila 3: a la izquierda (55 %) «fecha» → «27-11-2026» y, debajo en la misma casilla, «ref.» → «K7M2Q4» (los seis
  primeros caracteres del código, en mayúsculas). A la derecha (45 %), la **casilla del sello**, sin rótulo.

**El sello.** 132 × 52 px, girado −4°, borde de 2 px en `--trazo` con un segundo filete interior de 1 px a 2 px de
distancia, radio 2 px, sin relleno. Dos líneas centradas: «VÁLIDA HASTA» (11 px) y «27 DIC 2026» (15 px). Sobresale
6 px por abajo y por la derecha de su casilla: eso es lo que lo hace sello y no etiqueta. Tinta sobreentintada con un
filtro SVG (`feTurbulence` + `feDisplacementMap scale 1.5`), que se quita si el navegador no lo aplica. Es texto real
(`<p>`), no imagen: un lector de pantalla lee «Válida hasta el 27 de diciembre de 2026» por `aria-label`.

**C · Carta.** Margen superior 28 px. Tres piezas:

- Saludo: «Hola:»
- Cuerpo, a 17 px, de la campaña (campo de texto de presentación con variables) [NV: el plan no define aún ese campo
  en `captacion_campanas`; mientras no exista se usa el texto por defecto]. Texto por defecto:
  > Nos pedisteis que os contáramos más. Estos son los tres equipos que solemos instalar en restaurantes como el
  > vuestro. Miradlos con calma; si alguno os encaja, os llamamos y lo vemos con números.
- Firma, a máquina: «El equipo de Infinity Aqua» [Mario: ¿firma la empresa o el comercial con su nombre?].

Límite del cuerpo: 280 caracteres, para que entre también en el PDF (§6). Tratamiento de **vosotros**, coherente con
el botón «Que me llaméis» [decide; si una empresa quiere usted, es un ajuste por empresa que hoy no existe].

La hoja A–C lleva **la hoja de debajo**: un `::before` con `--hoja-debajo` y el mismo borde, desplazado 7 px abajo y
a la derecha. Cabe en el margen de 16 px y no provoca scroll horizontal. Solo esta hoja la lleva: dice «hay más
debajo».

**D · Relación de equipos.** Segunda hoja, a 12 px de la primera. Cabecera: `h2` «Equipos que os proponemos» y, a la
derecha, a máquina, el número de equipos («3»).

Cada partida lleva su número a máquina («1», «2», «3») delante del nombre. No es adorno: sirve para decir por teléfono
«me interesa el 2», y el comercial ve la misma numeración.

- **D1 · Partida principal** (la primera línea de `lineas`) [decide: el orden lo fija la campaña y la primera es la
  recomendada]. Panel de foto a todo el ancho de la columna, 318 × 300 px, fondo `--velo`. Debajo, con 20 px:
  número y nombre (26 px), lema en `--trazo` (16 px), descripción corta (15 px) y la casilla de datos.
- **D2 · Partidas compactas** (las demás). Separadas por un filete de 1 px y 28 px de aire. Rejilla `104px 1fr` con
  16 px de hueco: panel de foto de 104 × 138 px a la izquierda; a la derecha, número y nombre (19 px), lema y
  descripción. La descripción no se corta con puntos suspensivos: la fila crece. La casilla de datos va debajo, a
  todo el ancho.
- **Casilla de datos** (misma pieza en D1 y D2): filas de `rótulo | dato` con `gap: 1px`. Rótulo en Archivo
  estrecho, dato a máquina alineado a la izquierda en una segunda columna que empieza a 112 px.
  - «medidas» → «26 × 45 × 41 cm» y, debajo, en `--tinta-suave` a 12 px, «ancho × fondo × alto».
  - «garantía» → «2 años».
  - *(solo si la empresa activa precios)* «alquiler» → «29,00 €/mes + IVA» o «compra» → «1.190,00 € + IVA». Es una
    fila más; el resto no cambia. Qué precio de empresa se lee sigue pendiente en el plan (§3.4, [NV]).
  - Peso en kilos con coma. Ninguna fila sin dato.
- **Sin foto**: no hay panel ni icono de sustitución. La partida es texto a todo el ancho.
- **D3 · Nota de precios** (solo si no hay precios), a 15 px bajo la última partida:
  > Los precios dependen de cuántos equipos necesitéis y de si preferís alquiler o compra. Os los damos por teléfono,
  > sin compromiso.

Tope: **seis equipos** por propuesta [decide: la campaña no deja asignar más]. Uno solo también funciona: queda la
partida principal y el título pasa a «El equipo que os proponemos».

**E · Qué incluye** (opcional). Solo si la campaña trae ese texto [NV: no está en la lista blanca de §3.4 porque no es
dato de producto; tendría que ser un campo de la campaña]. `h2` «Qué incluye» y hasta cuatro líneas con raya. Formato
de ejemplo, **no** son condiciones reales de Infinity:
> — Instalación por nuestros técnicos.
> — Mantenimiento y cambio de filtros.

Sin texto, el bloque no existe.

**F · Cupón de respuesta.** Empieza con la línea de corte: 1 px de trazos (`6px` tinta, `4px` hueco) en `--tinta`, a
todo el ancho de la hoja, con 28 px de aire arriba y abajo. Dentro:

- `h2` «¿Lo vemos por teléfono?»
- Texto: «Pulsad el botón y se abre vuestro WhatsApp con el mensaje ya escrito. Os llamamos nosotros.»
- **Botón «Que me llaméis»**: ancho completo, 56 px de alto, relleno `--campo`, texto `--sobre-campo`, borde de 1 px
  en `--tinta`, radio 1 px. Es un `<a>` a `wa.me` (§5.5).
- «o llamad vosotros:» y el teléfono a máquina, 17 px, como enlace `tel:` con 48 px de alto pulsable.
  El horario solo se escribe si la empresa lo tiene guardado.
- Enlace «Descargar la propuesta en PDF», con el dato a máquina debajo: «2 páginas · 240 kB». Va a
  `/p/[codigo]/pdf`.

**G · Pie**, sobre la mesa, fuera de las hojas (§5.6).

**H · Barra fija.** `position: fixed; bottom: 0`, fondo `--hoja` opaco, filete superior de 1 px en `--tinta`, relleno
12 px más `env(safe-area-inset-bottom)`. Dentro, solo el botón «Que me llaméis» a 52 px de alto. Está desde el primer
momento, así que **la primera pantalla tiene su acción sin ocupar sitio en la carta**. Cuando el cupón F entra en la
ventana (un único `IntersectionObserver`), la barra se retira; si el usuario sube, vuelve. Así se cumple «Del Cupón
Único». El `body` reserva el alto de la barra para que no tape el pie. Sin JavaScript la barra se queda fija: se
duplica el botón al final, que es el mal menor.

Qué se ve en la primera pantalla (390 × ~660 px en el navegador de WhatsApp): membrete, las tres filas de casillas con
el nombre del negocio y el sello, el arranque de la carta y la barra con el botón. Contesta a «¿es para mí?» sin
tocar nada.

### 5.2 Cómo crece

| Ancho | Cambios |
|---|---|
| 390–599 px | Lo descrito. |
| 600–959 px | Hojas centradas con ancho máximo de 600 px y relleno de 28 px. D1 pasa a dos columnas (foto 240 px a la izquierda, texto a la derecha). Sigue la barra fija. |
| ≥ 960 px | Ancho máximo 1.120 px en dos columnas: a la izquierda las hojas (máximo 720 px); a la derecha, una columna de 320 px con **el cupón como hoja propia, pegada** (`position: sticky; top: 32px`). Desaparecen la barra fija y el cupón del final: sigue habiendo un solo botón. Relleno de hoja 40 px. D1: foto de 300 px a la izquierda. D2: rejilla `160px 1fr 240px` (foto, texto, casilla de datos a la derecha). El nombre del negocio sube a 32 px. La hoja de debajo se desplaza 9 px. |

En escritorio el cupón pegado añade bajo el teléfono un QR de 96 px hacia el mismo enlace `wa.me`, con el rótulo «o
escanead con el móvil»: quien lo abre en el ordenador tiene WhatsApp en el teléfono.

`hover` solo dentro de `@media (hover: hover) and (pointer: fine)`: el botón oscurece su relleno un 6 % de L; los
enlaces pasan de subrayado fino a subrayado de 2 px.

### 5.3 Detalles de móvil

- `100dvh`, nunca `100vh`. `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`,
  `text-size-adjust: 100%`.
- Ningún texto por debajo de 12 px; ningún `input` (no hay formularios, así que no hay zoom al enfocar).
- Peso: HTML y CSS por debajo de 60 kB, JavaScript propio por debajo de 15 kB (el latido de visita y el observador
  de la barra), dos tipografías. La primera foto con prioridad; las demás, `loading="lazy"`, a 640 px de ancho como
  mucho. El LCP es el nombre del negocio, que es texto.
- Página de servidor: todo el contenido llega en el HTML. Sin JavaScript se lee entera; solo deja de contarse la
  visita.
- Para el panel del comercial conviene marcar los bloques (`data-bloque="equipos"`, `"cupon"`) y traducir el
  `scroll_max` a «llegó a los equipos / llegó al cupón». Es una mejora del panel, no de esta página.

### 5.4 Estados

| Estado | Qué se ve |
|---|---|
| **No existe el código** | `notFound()` genérico de Next, sin marca ni pistas (plan §4.5). |
| **Caducada** (`caduca_at` pasado) | La misma mesa y una sola hoja: membrete; casilla «propuesta para» con el nombre; casilla de fecha y ref.; y el sello, ahora **«CADUCADA / 27 DIC 2026»**, en `--tinta` en vez de `--trazo`. Debajo: «Esta propuesta caducó el 27 de diciembre de 2026. Los equipos y las condiciones pueden haber cambiado.» y el botón **«Pedir una actualizada»** (mismo estilo y medidas que «Que me llaméis»), más el teléfono. No se ven equipos, ni carta, ni descarga del PDF. Sin barra fija: el botón ya está en la primera pantalla. |
| **Revocada** (`revocada_at`) | Igual, pero **sin nombre del negocio, sin fecha y sin referencia**: una revocación puede deberse a que se envió a quien no era. Sello «RETIRADA». Texto: «Esta propuesta ya no está disponible. Si os sigue interesando, pedidnos otra y os la mandamos por WhatsApp.» Botón «Pedir una actualizada» y teléfono. |
| **La foto no carga** | La partida se queda en texto. Nunca un icono roto ni un panel vacío. |
| **La empresa no tiene teléfono guardado** | La línea «o llamad vosotros» no existe. |
| **Nombre de negocio muy largo** | Hasta tres líneas a 22 px; nunca se recorta. |

`/p/[codigo]/pdf` hace las mismas comprobaciones: caducada o revocada no entrega el fichero y redirige a la página.

Código de estado [decide]: caducada y revocada responden 200 con `noindex`. Devolver 410 desde una página del App
Router exige una ruta aparte y no aporta nada a quien la abre.

Se recomienda que la visita a una propuesta caducada **también se cuente** (solo segundos): que un negocio vuelva a
abrirla es una señal para el comercial.

### 5.5 Llamada a la acción

Enlace del botón «Que me llaméis»:

```
https://wa.me/<número de captación en E.164 sin +>?text=<texto codificado>
```

- El número es el de la conexión de WhatsApp del módulo (la misma conversación en la que recibieron la propuesta),
  **no** el número principal de la empresa (plan §11).
- Texto prellenado:
  > Hola, soy de Restaurante Ca'n Toni. He visto la propuesta (ref. K7M2Q4) y quiero que me llaméis.
- Texto de «Pedir una actualizada»:
  > Hola, soy de Restaurante Ca'n Toni. La propuesta (ref. K7M2Q4) ha caducado. ¿Me mandáis una actualizada?

  En la revocada, sin nombre ni referencia: «Hola, quería una propuesta actualizada de vuestros equipos.»

Por qué lleva la referencia: quien pulsa puede no ser quien recibió el WhatsApp (el encargado reenvía el enlace al
dueño, que escribe desde otro teléfono). Con la referencia, la bandeja sabe de qué propuesta habla.

Pendiente para el ejecutor [NV, cambia el webhook]: el plan marca el lead como prioritario por la **carga del botón**
de WhatsApp. Un mensaje que llega por `wa.me` es texto libre y hoy iría a la bandeja sin más. Hay que reconocer la
frase fija o la referencia y darle el mismo trato que al botón. Además conviene anotar la pulsación en la visita
(propuesta: `captacion_visitas.pulso_llamada bool`, junto a `descargo_pdf`) [Mario: es una columna nueva].

El botón responde al bajar el dedo (`:active`), no al soltarlo, y no espera a nada: es un enlace.

### 5.6 Pie legal y aviso de privacidad

Sobre la mesa, bajo las hojas, a 13 px. Tres párrafos cortos y una línea de enlaces. Nada de banner: la página no
escribe cookies ni guarda nada en el navegador, así que no hay consentimiento que pedir.

> **Infinity Aqua, S.L.**, NIF B00000000, Carrer d'exemple 1, 07000 Palma. hola@ejemplo.es
>
> Propuesta informativa, sin valor contractual. Las condiciones definitivas os las confirma un comercial.
>
> Esta página no usa cookies. Anotamos cuándo se abre la propuesta y cuánto se lee para saber si os ha interesado
> antes de llamaros. No guardamos vuestra dirección IP ni compartimos el dato con nadie.
>
> ¿No queréis más mensajes? Contestad «baja» en el WhatsApp y no volvemos a escribir.
>
> Privacidad

- Los datos de la primera línea salen de los campos fiscales de la empresa (`fiscal_legal_name`, `fiscal_tax_id`,
  `fiscal_street`, `fiscal_postal_code`, `fiscal_city`, `fiscal_email`) [V: existen en `config/fiscal/load.ts`]. Los
  del ejemplo son de relleno.
- **Dónde va el aviso de privacidad**: aquí, en el pie, a la vista y en lenguaje llano (el tercer párrafo es la
  primera capa), con el enlace «Privacidad» a la política completa. No va en una ventana ni en un banner.
- **Problema detectado** [V]: `/privacidad` es hoy la política de **Hidromanager** (la de las tiendas de
  aplicaciones). El responsable de estos datos es **la empresa que envía** (Infinity Aqua); Hidromanager es su
  encargado. El enlace tiene que ir a la política de la empresa, y eso pide un dato por empresa (URL o texto de
  privacidad) que no he encontrado [NV]. [Mario: de dónde sale la política de cada empresa.]
- El texto del tercer párrafo describe una medición ligada a un negocio identificado, no una estadística anónima. Lo
  tiene que revisar quien lleve la protección de datos de la empresa antes del piloto. Esto es diseño, no
  asesoramiento legal.
- No hay «Hecho con Hidromanager» ni enlaces a redes.

### 5.7 Vista previa de WhatsApp, buscadores y fugas

**Metadatos** (los mismos para una propuesta válida, caducada o revocada, para que la vista previa no delate el
estado):

| Etiqueta | Valor |
|---|---|
| `<title>` | `Propuesta de Infinity Aqua` |
| `og:title` | `Propuesta de Infinity Aqua` |
| `og:description` | `Enlace privado. Ábrelo para ver la propuesta.` |
| `og:image` | Una imagen **por empresa**, no por propuesta: el logo sobre `--hoja` con el filete del membrete, 1.200 × 630 px, JPG por debajo de 300 kB, en una URL que no contiene el código |
| `og:type` | `website` |
| `og:url` | **no se pone** (llevaría el código) |
| `twitter:card` | `summary_large_image` |

Nunca aparecen en los metadatos: el nombre del negocio, su tipo, su localidad, los equipos, los precios, la fecha de
caducidad ni la referencia. El código inexistente devuelve el 404 sin metadatos de marca.

**Fuera de los buscadores:**

- `robots: { index: false, follow: false, nocache: true }` en los metadatos de la ruta, más `noarchive`.
- Cabecera `X-Robots-Tag: noindex, nofollow, noarchive` para `/p/:path*` en `next.config.ts`. Hace falta porque el PDF
  de `/p/[codigo]/pdf` no puede llevar etiquetas `meta`.
- **No** se añade `Disallow: /p/` a `robots.txt`: un rastreador que no puede entrar no llega a leer el `noindex`.
- La ruta no entra en el `sitemap`.
- Nada de esto es seguridad. La seguridad son los 60 bits del código, la caducidad y la revocación.

**Fugas:**

- `<meta name="referrer" content="no-referrer">` y `Referrer-Policy: no-referrer` en la ruta: al salir hacia `wa.me`
  o hacia la política de privacidad, el destino no recibe la URL con el código.
- Ninguna petición a terceros: tipografías autoalojadas, sin analítica externa, sin mapas, sin vídeos incrustados.
  [NV: comprobar desde dónde se sirven las fotos de producto; si es un bucket público de Supabase, la petición sale
  del dominio pero con `no-referrer` no arrastra el código.]
- `Cache-Control: private, no-store`.
- La apertura **no** se cuenta en el servidor (plan §4.5): la vista previa de WhatsApp y los antivirus piden la URL
  sin que nadie la abra. Solo cuenta el latido que lanza el navegador.

---

## 6. El PDF

A4 vertical (210 × 297 mm), **una hoja con hasta tres equipos, dos con cuatro a seis, nunca más**. Dibujado con
`pdf-lib` a coordenadas, en `src/modules/captacion/pdf-propuesta.ts` (sin sesión, recibe `company_id`), con las
piezas de `src/shared/lib/pdf/dashstack.ts` y de `src/modules/products/ficha/` (`descargar`, `sharp`, `derivarPaleta`,
`withSanitizer`). Sin HTML a PDF.

Es el mismo impreso que la página, en papel: mismas casillas, mismo sello, mismas partidas, mismo cupón.

### 6.1 Lo que cambia respecto a la página

- **Papel blanco.** Sin mesa, sin fibra, sin hoja de debajo: se imprime en una oficina y tiene que pesar poco.
  `--velo` solo en los paneles de foto.
- **Tipos estándar de PDF**: `Helvetica` y `Helvetica-Bold` para lo preimpreso, `Courier` y `Courier-Bold` para lo
  mecanografiado, como hace hoy `ficha/pintar.ts` [V]. No se incrusta nada: cero peso y cero riesgo de despliegue.
  Se pierde el eje de anchura de Archivo; se acepta. [Mario: si algún día se adopta `@pdf-lib/fontkit` para las
  fichas, se incrusta Archivo aquí también.]
- **Sin movimiento**, claro. El sello es vectorial y limpio, sin sobreentintado.
- Colores: `tinta`, `tintaSuave`, `velo`, `primarioCampo`, `sobreCampo` y `primarioTrazo` de `derivarPaleta` tal cual
  (aquí el fondo sí es blanco, así que sus contrastes valen).

### 6.2 Rejilla de la hoja 1

Margen de 12 mm por los cuatro lados (como las fichas): ancho útil 186 mm, alto útil 273 mm. Medidas en milímetros
desde el borde superior del papel; cuerpos en puntos.

| Bloque | De–a (mm) | Alto | Contenido |
|---|---|---|---|
| Membrete | 12–32 | 20 | Logo arriba a la izquierda, caja máxima 46 × 14 mm, sobre blanco. A la derecha, alineado a la derecha, a máquina (Courier 7,5 pt): teléfono, web y localidad, una línea cada uno. Filete de 0,6 pt en `primarioTrazo` a 32 mm. |
| Casillas | 37–59 | 22 | Líneas de 0,4 pt. **Fila A** (12 mm): casilla «propuesta para» de 134 mm (rótulo Helvetica 7 pt; nombre en Courier-Bold 15 pt) y casilla del sello de 52 mm. **Fila B** (10 mm): «tipo de negocio» 62 mm · «localidad» 62 mm · «fecha» 31 mm · «ref.» 31 mm (rótulo 7 pt, dato Courier 9 pt). |
| Sello | sobre la fila A | — | 44 × 15 mm, girado −4°, borde de 1,2 pt más filete interior de 0,4 pt, en `primarioTrazo`. «VÁLIDA HASTA» Courier-Bold 7 pt y «27 DIC 2026» Courier-Bold 10 pt. Sobresale 2 mm de su casilla. |
| Carta | 64–84 | 20 | «Hola:», cuerpo y firma. Helvetica 10 pt con 14,5 pt de interlínea, ancho máximo 130 mm (unos 73 caracteres). La firma, en Courier 9 pt. |
| Título de la relación | 89–96 | 7 | «Equipos que os proponemos» Helvetica-Bold 12 pt; a la derecha, «3» en Courier 9 pt. Filete de 0,4 pt debajo. |
| Partida principal | 99–165 | 66 | Panel de foto de 62 × 66 mm en `velo`, foto contenida con 5 mm de aire. A su derecha (118 mm): «1» Courier-Bold 9 pt; nombre Helvetica-Bold 16 pt; lema Helvetica-Bold 10 pt en `primarioTrazo`; descripción Helvetica 9,5 pt / 13,5 pt, hasta cinco líneas; casilla de datos **anclada abajo**, filas de 6 mm (rótulo Helvetica 8 pt, dato Courier 9 pt). |
| Partidas compactas | 168–202 y 205–239 | 34 c/u | Filete de 0,4 pt entre partidas. Panel de foto de 26 × 34 mm. Texto (96 mm): número y nombre Helvetica-Bold 11,5 pt; lema 9 pt; descripción 8,5 pt / 12 pt, hasta tres líneas. A la derecha (58 mm), la casilla de datos. |
| Cupón | 244–270 | 26 | Línea de corte arriba: 0,6 pt, trazos de 3 pt y huecos de 2 pt, en `tinta`. Tres columnas (§6.4). |
| Pie | 275–285 | 10 | Dos líneas en Helvetica 6,5 pt, `tintaSuave` (§6.5). |

Los bloques ocupan de 12 a 285 mm: los 273 mm útiles, con huecos de 3 y 5 mm entre ellos. Con tres equipos la hoja
va justa, y por eso los topes de líneas de cada descripción son firmes. Con uno o dos equipos sobra papel: el cupón
sube hasta quedar 5 mm bajo la última partida y lo demás queda en blanco. Ningún bloque se estira.

Recortes para que quepa siempre, en este orden: (1) el nombre del negocio baja de 15 a 11 pt y, si aún no cabe, pasa
a dos líneas; (2) la descripción se corta **por frase completa** al llegar a su tope de líneas, nunca con puntos
suspensivos a media palabra; (3) la carta, limitada a 280 caracteres en origen, no necesita recorte.

### 6.3 Una hoja o dos

| Equipos | Hoja 1 | Hoja 2 |
|---|---|---|
| 1 | Membrete, casillas, carta, partida principal, cupón | — |
| 2–3 | Lo anterior más una o dos partidas compactas | — |
| 4–6 | Membrete, casillas, carta, partida principal y **dos** compactas. Sin cupón; al pie, a la derecha, «sigue en la hoja 2» en Courier 8 pt | Membrete reducido (logo de 30 × 9 mm y «propuesta para Restaurante Ca'n Toni» a máquina, 14 mm en total), las partidas 4.ª a 6.ª, «Qué incluye» si existe, cupón y pie |

Con cuatro equipos la hoja 2 queda a menos de la mitad. Está bien: la carta termina donde termina. No se reparte de
otra forma ni se agrandan bloques para llenar.

Dos bloques opcionales, sin sitio propio en la rejilla:

- **Nota de precios** (cuando no hay precios): no ocupa un bloque. Sustituye a la frase de la columna izquierda del
  cupón (§6.4).
- **«Qué incluye»**: 8 mm justo encima del cupón, hasta cuatro líneas en dos columnas, Helvetica 9 pt. Con tres
  equipos en una hoja no cabe tal cual: las dos partidas compactas bajan a 30 mm (descripción de dos líneas como
  mucho) y se ganan esos 8 mm.

Paginación: solo si hay dos hojas, «hoja 1 de 2» a máquina, alineado a la derecha en el pie. Nunca centrado.

### 6.4 El cupón en papel

Tres columnas dentro de los 186 mm:

1. **Izquierda (92 mm)**: «¿Lo vemos por teléfono?» Helvetica-Bold 12 pt. Debajo, 9 pt y tres líneas como mucho:
   si la propuesta no lleva precios, la nota de precios («Los precios dependen de cuántos equipos necesitéis y de si
   preferís alquiler o compra. Os los damos por teléfono, sin compromiso.»); si los lleva, «Pulsad “Que me llaméis”
   en el WhatsApp, o escribidnos, y os llamamos nosotros.» Debajo, el teléfono en Courier-Bold 14 pt.
2. **Centro (62 mm)**: un rectángulo de 58 × 11 mm relleno de `primarioCampo`, con borde de 0,6 pt en `tinta` y el
   texto «Que me llaméis» en Helvetica-Bold 11 pt en `sobreCampo`. Lleva una **anotación de enlace** al mismo
   `wa.me` de la página: el PDF se abre casi siempre en el móvil y el rectángulo se puede pulsar. Es una primitiva
   nueva (anotación `Link` con acción `URI`); no he encontrado ninguna en el repositorio [V: sin resultados al
   buscar].
3. **Derecha (26 mm)**: QR de 22 × 22 mm hacia el mismo `wa.me`, dibujado con rectángulos vectoriales a partir de la
   matriz de `qrcode` [V: instalado], en `tinta`. Debajo, 6,5 pt: «o escanead».

El QR apunta a `wa.me` y **no** a `/p/[codigo]`: la página caduca y un QR impreso que lleva a «caducada» es un error
que el proyecto ya cometió una vez.

### 6.5 Pie del PDF

Dos líneas, sin puntos medios como separadores:

> Infinity Aqua, S.L., NIF B00000000, Carrer d'exemple 1, 07000 Palma.
> Propuesta informativa, sin valor contractual. Generada el 27-11-2026, válida hasta el 27-12-2026. Ref. K7M2Q4.

El aviso sobre la medición de visitas **no** va en el PDF: el PDF no mide nada. Va en la página, que es donde ocurre.

### 6.6 Imágenes y peso

- Fotos descargadas con `descargar()` de `ficha/imagenes.ts` (con `node:https`, no con `fetch`) y pasadas por `sharp`.
  El formato se decide por el contenido, no por la extensión [V: es lo que ya hace ese módulo].
- **El `multiply` se hace en `sharp`, no en el PDF**: la foto se compone en modo `multiply` sobre un rectángulo del
  color `velo` y se guarda como **JPG de calidad 80**, sin canal alfa. El resultado es la foto ya impresa en su
  panel, pesa poco y se ve igual en todos los lectores.
- Tamaños: partida principal 520 × 560 px; compactas 220 × 290 px. Logo en PNG, 600 px de ancho como mucho.
- Objetivo de peso: **menos de 350 kB con tres equipos y menos de 600 kB con seis**, para cumplir los 15 s del plan.
- Todo el texto es texto: se selecciona y se busca. Pasa por `withSanitizer` (WinAnsi). Probar con «Ca’n Pastil·la»,
  «Es Molí d’en Sopa» y un nombre con emoji: el apóstrofo curvo y el punto volado existen en WinAnsi; el emoji se
  elimina, no se convierte en «?».
- Metadatos del PDF: título «Propuesta para Restaurante Ca'n Toni», autor el nombre de la empresa. Sin
  identificadores internos. Nombre del fichero: `Propuesta Restaurante Ca'n Toni.pdf` (plan §4.5).
- La primera hoja es la miniatura que WhatsApp enseña en el chat: membrete, nombre del negocio y sello quedan en el
  tercio superior a propósito.

### 6.7 Modo «PDF subido»

Cuando la campaña usa un PDF propio (plan §4.5, modo `subido`), no se rediseña nada: se estampa en la primera página,
dentro del margen superior, la casilla «propuesta para» con el nombre a máquina (Courier-Bold 11 pt) sobre un
rectángulo blanco de 90 × 10 mm [decide]. Si el PDF subido no deja margen libre, eso se ve en la vista previa de la
campaña y lo decide quien la configura.

---

## 7. Don't

Diseño:

- No héroe con foto de ambiente, titular de promesa ni vídeo.
- No tarjetas: ni caja, ni sombra, ni radio alrededor de un equipo. No rejilla de tarjetas iguales en el PDF.
- No sombras difusas en ninguna parte. No degradados. No vidrio ni desenfoque.
- No `rounded` genérico: los radios son 0, 1 y 2 px.
- No iconos decorativos ni emojis. No vistos verdes. No flechas en botones y enlaces.
- No cintillos en mayúsculas sobre los títulos. La única caja alta es el sello.
- No una palabra del titular en otro color ni en cursiva.
- No animar nada al hacer scroll. No animar el nombre del negocio. Ninguna animación por encima de 300 ms.
- No segundo botón junto a «Que me llaméis». No botón fantasma. No dos «Que me llaméis» a la vez en pantalla.
- No «Consultar precio», «Desde —», columnas vacías ni precios desenfocados cuando los precios están apagados.
- No «—», «N/D» ni casillas con rótulo y sin dato.
- No `object-cover` en fotos de producto. No foto recortada con sombra debajo. No icono de foto rota.
- No puntos suspensivos para cortar descripciones.
- No modo oscuro.
- No logo dentro de una banda de color o de un recuadro.
- No «Página 1 de 2» centrado. No rellenar el papel que sobra.

Contenido y datos:

- No inventar ventajas, servicios, plazos ni horarios: lo que no está en la campaña o en Productos no se escribe.
- No sacar hacia la página ni el PDF nada fuera de la lista blanca: nunca costes, márgenes, precios mínimos,
  fabricante ni referencia del proveedor.
- No copiar precios a mano: se leen de Productos al generar y se guardan en `lineas`.
- No tabla de características ni dibujo de cotas: eso es la ficha técnica.
- No el nombre del negocio, los equipos ni la fecha en `title`, Open Graph ni en la imagen de vista previa.
- No el nombre del negocio en la pantalla de «retirada».
- No formularios, ni correo, ni «déjanos tus datos»: el único paso es WhatsApp o el teléfono.

Técnica y privacidad:

- No banner de cookies (no hay cookies) y no cookies, `localStorage` ni huella del dispositivo en el navegador.
- No peticiones a terceros: ni tipografías de CDN, ni analítica, ni mapas, ni píxeles.
- No `og:url` ni enlaces salientes que arrastren el código como referente.
- No `Disallow: /p/` en `robots.txt`.
- No enlazar a `/privacidad` de Hidromanager como si fuera la política de la empresa.
- No HTML a PDF, ni Chromium, ni `satori` (saldría el texto como imagen).
- No usar el número principal de la empresa en `wa.me`: el de captación.

Errores ya cometidos en este proyecto que no se repiten:

- Contar la apertura de la página en el servidor (la vista previa de WhatsApp la dispara).
- Un QR cuyo enlace caduca.
- Decidir PNG o JPG por la extensión de la URL (las `.webp` se perdían en silencio).
- Descargar imágenes con el `fetch` de Next en vez de `node:https` (revienta la pila en desarrollo).
- Empaquetar las fuentes para una sola de las dos rutas de PDF. Aquí no se empaqueta ninguna.
- Dejar que el saneador WinAnsi cambie por «?» lo que no conoce sin haberlo probado con nombres reales.
- Dar por bueno un color de texto calculado contra blanco cuando el fondo no es blanco (§4.1).
- No mirar `error` después de una consulta a Supabase: si la propuesta no carga, es 404, no una hoja vacía.
- Dar una pantalla por buena sin verla a 390 px.

---

## 8. Checklist anti-IA de `estilo-web.md`, aplicado

| Pregunta | Respuesta en este diseño |
|---|---|
| ¿Más de un radio, cada uno con su porqué? | Sí: 0 (papel), 1 px (control), 2 px (caucho del sello). §4.3 |
| ¿Pesos no redondos y algún eje variable explotado? | Sí en la página: Archivo a 430, 520, 540, 620 y 640, con `wdth` de 78 a 100 (más estrecho cuanto más pequeño). En el PDF no: tipos estándar, asumido en §6.1. |
| ¿El color sale de una foto real del producto? | **A medias, y se dice.** El color es el de la marca de cada empresa, no se puede muestrear a mano por empresa. Lo que sí sale de las fotos es el panel: `--velo` está pensado para fotos de catálogo con fondo blanco en `multiply`. Queda por comprobar con las fotos reales de Infinity [NV]. |
| ¿Grano sobre toda la página? | Sí: fibra fija en `multiply` al 8 %. En el PDF, no, a propósito. |
| ¿Fotos en `multiply`, no recortadas con sombra? | Sí. En el PDF el `multiply` se hace en `sharp`. |
| ¿Sombras teñidas, no negras? | No hay ninguna sombra. La profundidad es la hoja de debajo. |
| ¿El movimiento es un gesto y no un `fade-up` uniforme? | Sí: el sello. Los otros dos (pulsación y barra) responden al usuario. Nada entra al hacer scroll. |
| ¿Sin cintillos en versalitas repetidos? | Sí. Los rótulos de casilla van en minúscula y son parte del impreso, no adorno sobre un título. |
| ¿El héroe tiene un CTA? | Sí: uno en la barra fija. Y uno en toda la pantalla en cada momento. |
| ¿Está escrito qué default se rechaza? | §2. |
| ¿Alternan secciones densas y calmas? | Sí: casillas (densa), carta (calma), partida principal (calma, foto grande), partidas compactas (densas), cupón (calma). |
| ¿Como mucho dos secciones seguidas de imagen + texto, sin repetir maquetación? | Las partidas son filas de una misma relación, no secciones. Hay dos maquetaciones de partida (principal y compacta) y la compacta se repite por diseño, como las líneas de un presupuesto. Con seis equipos son cinco filas compactas seguidas: es el límite y por eso el tope es seis. |
| ¿Ninguna animación pasa de 300 ms? | Sí: 280, 120 y 200 ms. (El registro A de referencia estampa en 750 ms; aquí se baja para cumplir.) |
| ¿Se ve bien a 390 px? | Está diseñado desde 390 px (§5.1). **Sin verificar hasta que exista**: hay que verlo en un móvil de verdad, dentro del navegador de WhatsApp, antes de darlo por bueno. |

Comprobaciones propias antes de dar la fase por buena:

- [ ] Abierto desde WhatsApp en un iPhone y en un Android reales, no solo en el emulador.
- [ ] La vista previa del enlace en WhatsApp no enseña el nombre del negocio y **no suma una visita**.
- [ ] Con marca clara (`#28bce2`), oscura y amarilla: todos los pares de §4.1 por encima de su mínimo.
- [ ] Con un equipo, con tres y con seis; con y sin precios; con un equipo sin foto y otro sin medidas.
- [ ] Con un nombre de negocio de 60 caracteres y otro con apóstrofo curvo y punto volado.
- [ ] El PDF de tres equipos pesa menos de 350 kB, su texto se selecciona y el botón abre WhatsApp.
- [ ] El PDF impreso en blanco y negro se entiende igual.
- [ ] Caducada y revocada enseñan su pantalla, y `/p/[codigo]/pdf` no entrega el fichero.
- [ ] Con «reducir movimiento» activado no se mueve nada y no falta nada.
- [ ] Las herramientas de red del navegador no muestran ninguna petición fuera del dominio (salvo las fotos, si
      están en Supabase).

---

## 9. Preguntas para Mario

Solo las que cambian el resultado:

1. **Privacidad por empresa.** `/privacidad` es la política de Hidromanager. ¿De dónde sale la de Infinity Aqua (una
   URL suya, un texto en Configuración)? Sin eso el pie no puede enlazar bien.
2. **Firma de la carta.** ¿«El equipo de Infinity Aqua» o el nombre de un comercial?
3. **«Qué incluye» y texto de la carta.** ¿Se añaden a la campaña como dos campos de texto, o la propuesta va solo
   con el texto por defecto y los equipos?
4. **Vosotros.** La propuesta trata de vosotros, como los botones. ¿Vale para hoteles, o hace falta un ajuste por
   empresa para usted?
5. **Pulsación de «Que me llaméis».** Requiere que el webhook reconozca el mensaje de `wa.me` y, si se quiere medir,
   una columna nueva en `captacion_visitas`. ¿Entra en la fase 4?
6. **Tipografía del PDF.** ¿Vale Helvetica y Courier (sin dependencias), o se quiere Archivo también en papel, lo que
   pide `@pdf-lib/fontkit` y su prueba?

## 10. Notas de proceso

- Skills cargadas y aplicadas: `impeccable`, `frontend-design`, `apple-design` y `animation-vocabulary`.
- De `impeccable` no se ha ejecutado el flujo interactivo (`init`, sorteo de direcciones): el encargo ya fija el
  registro A y el norte se deduce de él. El proyecto no tiene `PRODUCT.md`.
- De `apple-design` se aplican respuesta al bajar el dedo, transiciones interrumpibles que vuelven por el mismo
  camino, tamaños en `rem`, y `prefers-reduced-motion` y `prefers-contrast`. Se descarta a conciencia su capa de
  materiales translúcidos: contradice el registro A («Del Papel Opaco»).
- De `frontend-design` se aplican dos familias con papeles distintos, líneas por debajo de 80 caracteres, numeración
  solo donde hay secuencia útil y la acción con el mismo nombre en todo el recorrido. Su aviso contra la
  monoespaciada para datos se desoye: `estilo-web.md` la exige y aquí además es el argumento del diseño.
- Diseño y plan en Fable; la ejecución, en Opus, según el reparto de Mario.
