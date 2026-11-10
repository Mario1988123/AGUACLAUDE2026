# Diseño de la navegación en móvil y tablet

Fecha: 2026-11-10 · Alcance: el **marco** del CRM (cabecera, menú lateral, barra inferior,
superadmin, portal y páginas públicas). Las páginas de los módulos no se tocan aquí.
Registro: **A, serio**. No hay cambio de marca: misma paleta, misma tipografía, mismo
dibujo de la barra lateral en escritorio.

## North Star: el salpicadero

El marco es el salpicadero de la furgoneta del técnico: lo que se usa a diario está al
alcance del pulgar, siempre en el mismo sitio, y **nada cuelga por delante del
parabrisas**. Ante una duda no se pregunta «qué queda mejor», sino «¿esto tapa la
carretera?». La carretera es el contenido del módulo.

## Lo que se rechaza

- El botón hamburguesa redondo y flotante encima del contenido (lo que había): tapa la
  página, obliga a reservar un hueco fantasma en la cabecera y no sabe dónde está la muesca.
- La cabecera de escritorio de 80 px encogida tal cual al móvil.
- El carril de iconos sin texto como única navegación en tablet: con más de treinta
  módulos, un icono sin nombre no se encuentra y en táctil no hay `title` que lo explique.
- Abrir el menú deslizando desde el borde izquierdo: en iOS ese gesto es «volver».

## Reglas

**La Regla del Parabrisas.** Ningún control del marco flota sobre el contenido. La
hamburguesa vive dentro de la cabecera, a la izquierda, y ocupa su sitio en el flujo.

**La Regla de la Tinta hasta el Borde.** El fondo de cada pieza del marco (cabecera,
carril, cajón, barra inferior) llega hasta el borde físico de la pantalla, por detrás de
la barra de estado, de la muesca y del indicador de inicio. El contenido empieza
después. El margen se pone con `padding`, nunca con `top` ni `margin`, y se lee siempre
de `--safe-top / --safe-right / --safe-bottom / --safe-left` (definidas en `globals.css`
con respaldo a `0px`), nunca de `env()` suelto: así se puede simular la muesca.

**La Regla de la Escalera.** Tres peldaños, y cada uno hereda del anterior:

| Ancho | Navegación fija | Menú completo | Cabecera |
| --- | --- | --- | --- |
| < 768 (móvil) | barra inferior con los módulos fijados | cajón lateral | 56 px + muesca |
| 768–1023 (tablet vertical, móvil apaisado) | carril de iconos de 80 px | cajón lateral | 64 px + muesca |
| ≥ 1024 (tablet apaisada, escritorio) | barra lateral plegable, como hasta ahora | la propia barra | 80 px |

En tablet se queda el **carril y además el cajón**, no uno de los dos. Solo cajón
costaría dos toques por cada cambio de módulo a quien trabaja en oficina con el iPad;
solo carril deja treinta iconos sin nombre. El carril da el acceso de un toque a quien
ya conoce los iconos y la hamburguesa de la cabecera abre el mismo cajón del móvil, con
los grupos y los nombres. A 1024 px (iPad apaisado) ya cabe la barra completa y el
usuario decide si la pliega.

**La Regla de la Puerta Única.** Hay un solo cajón (`cajon-lateral.tsx`) para el CRM y
para el superadmin. Entra por la izquierda y sale por la izquierda, por el mismo camino.
Se cierra con la X, con Escape, tocando el velo, arrastrándolo hacia la izquierda o al
navegar. Mientras está abierto: el foco no sale de él, el fondo no se desplaza y queda
`inert`; al cerrar, el foco vuelve a la hamburguesa. La hamburguesa lleva
`aria-expanded` y `aria-controls`.

**La Regla del Pulgar.** Todo objetivo táctil del marco mide 44 × 44 px como mínimo.
La respuesta a la pulsación es inmediata (`:active`), no espera a soltar. Los `:hover`
solo existen con puntero fino.

**La Regla del Teclado.** Con un campo de texto enfocado en pantalla táctil, la barra
inferior se retira: en Android el teclado encoge la ventana y la barra se quedaría
montada encima del teclado comiéndose media pantalla.

## Presupuesto de movimiento

Dos gestos y ninguno más:

1. El cajón: 240 ms, curva `cubic-bezier(0.32, 0.72, 0, 1)`, con `transition` (se puede
   interrumpir y arrastrar a media animación). El velo funde a la vez.
2. La pulsación: 120 ms de cambio de fondo.

Con «reducir movimiento» el cajón aparece sin deslizarse.

## Lo que no se hace

- No se usa `100vh` ni `h-screen` en el marco: `100dvh`.
- No se pone `env(safe-area-inset-*)` directo en un componente: se usan las variables.
- No se separa la cabecera de la barra de estado con `margin-top`: se queda una franja
  del color del fondo, que es justo el fallo que vio el tester.
- No se añade un segundo botón de menú ni un botón flotante «para móvil».
- No se deja un campo de texto por debajo de 16 px en táctil: iOS amplía la página y no
  la devuelve.
- No se pone `user-select: none` en el `body`: solo en controles. Las direcciones y los
  teléfonos se tienen que poder copiar.
- No se bloquea el desplazamiento con `touchmove` + `preventDefault`: `overscroll-behavior`.
- No se anima el ancho del cajón ni su `left`: solo `translate` y `opacity`.
- No se da por bueno desde el emulador de Chrome: la muesca, el teclado y el rebote solo
  se ven en un iPhone de verdad.

## Fuera de este trabajo

- `maximumScale: 1` y `userScalable: false` del `viewport` siguen como estaban: en la app
  nativa el pellizco no pinta nada, pero en el navegador es un fallo de accesibilidad.
  Queda como decisión de Mario.
- Los diálogos y las barras fijas propias de cada módulo.
