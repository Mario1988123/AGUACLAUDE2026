# Auditoría UX de flujos (READ-ONLY) — 2026-06-21

Auditor: agente de flujos. NO se ha modificado ningún archivo fuente. Solo se
escribe este informe.

Contexto: ya existe `ScrollToOnMount`
(`src/shared/components/scroll-to-on-mount.tsx`). Patrón aplicado en `/agenda`
(al calendario) y `/clientes` (a la tabla). El usuario se queja de "apretar en
mil sitios" y de que en tablet debería costar menos clics.

El componente es robusto: si el ancla ya está visible cerca de arriba NO roba
el scroll (sirve igual de bien en desktop). Por eso aplicarlo es **seguro** en
casi todos los listados: en pantallas grandes no molesta, en tablet/móvil baja
directo a la tabla.

Patrón EXACTO a replicar (idéntico al de `/clientes`):

```tsx
import { ScrollToOnMount } from "@/shared/components/scroll-to-on-mount";
// ...justo antes del bloque útil (tabla/listado/cards):
<ScrollToOnMount targetId="ID" />
<div id="ID" className="scroll-mt-20">
  {/* ...la tabla/listado existente... */}
</div>
```

Nota técnica: el `<div id>` envuelve el contenido. En las páginas donde el
listado ya está dentro de un `<Card>`, basta envolver ese `<Card>` (o poner el
`id` + `scroll-mt-20` en el propio Card vía wrapper). En las que el listado es
un componente cliente (`<SelectableLeadsTable>`, `<ProductsListClient>`...) se
envuelve la etiqueta del componente. Todos los cambios son **ADITIVOS** (un
import + un componente + un div wrapper). Riesgo casi nulo.

---

## 1) PÁGINAS DONDE APLICAR AUTOSCROLL (archivo:línea + id)

Ordenadas por prioridad (cuánto "estorbo" hay antes del contenido útil).

### ALTA prioridad (mucha cabecera + KPIs + alertas + filtros antes de la tabla)

| Página | Archivo:línea (insertar ANTES de) | id sugerido | Qué hay encima del contenido |
|---|---|---|---|
| Mantenimientos | `src/app/(tenant)/mantenimientos/page.tsx:278` (antes del `<Card>` "Listado") | `mant-content` | h1 + alertas + panel preprogramadas + 3 KPIs + tarjeta contratos + form filtros |
| Instalaciones | `src/app/(tenant)/instalaciones/page.tsx:394` (antes del `<Card>` "Calendario por día", dentro de `view === "list"`) | `inst-content` | h1 + toggle + form filtros + alertas + ranking satisfacción + 4 KPIs + tarjeta incidencias |
| Facturas | `src/app/(tenant)/facturas/page.tsx:299` (antes del `<Card>` "Listado") | `fact-content` | h1 + alertas + 4 KPIs + cola Verifactu + tarjeta "pendientes de facturar" |
| Wallet | `src/app/(tenant)/wallet/page.tsx:428` (antes del `<Card>` "Movimientos") | `wallet-content` | h1 + alertas + form resumen + 5 KPIs + histórico mensual + form filtros |
| Productos | `src/app/(tenant)/productos/page.tsx:243` (antes de `<ProductsListClient`) | `prod-content` | h1 + toggle vista + alertas + 4 KPIs + form filtros |
| Leads | `src/app/(tenant)/leads/page.tsx:268` (antes de `<SelectableLeadsTable`) | `leads-content` | h1 + toggle cartera + panel temperatura + form filtros (6 selects) |
| Contratos | `src/app/(tenant)/contratos/page.tsx:227` (antes del comentario "Mobile: cards" / la `<ul>`) | `contratos-content` | h1 + alertas + botón bulk + 4 KPIs + form filtros |

### MEDIA prioridad (cabecera + alertas + filtros, sin tantos KPIs)

| Página | Archivo:línea | id sugerido | Qué hay encima |
|---|---|---|---|
| Incidencias | `src/app/(tenant)/incidencias/page.tsx:76` (antes del `<Card>` "Listado") | `incid-content` | h1 + alertas |
| Propuestas | `src/app/(tenant)/propuestas/page.tsx:113` (antes del `{proposals.length === 0 ? ...}`) | `prop-content` | h1 + alertas + form filtro |
| Pruebas gratuitas | `src/app/(tenant)/pruebas-gratuitas/page.tsx:147` (antes del `<Card>` "Listado") | `pruebas-content` | h1 + alertas |
| Gastos | `src/app/(tenant)/gastos/page.tsx` (antes del listado; cabecera con KPIs + filtros) | `gastos-content` | h1 + KPIs + filtros |
| Comisiones | `src/app/(tenant)/comisiones/page.tsx` (antes del listado de ciclos) | `comis-content` | h1 + tarjeta "mis comisiones" |
| Cartera alquileres | `src/app/(tenant)/contratos/alquileres/page.tsx` (antes de la primera Card de listado) | `alq-content` | h1 + KPIs + tarjetas estado |

### BAJA / NO aplicar
- **Dashboard** (`src/app/(tenant)/dashboard/page.tsx`): es una home de tarjetas;
  NO hay una "tabla útil" única a la que saltar. NO aplicar (sería arbitrario).
- **Detalle de ficha** (`/clientes/[id]`, `/leads/[id]`, etc.): el usuario quiere
  ver la cabecera de la ficha al entrar. NO aplicar autoscroll genérico.
  Excepción posible: la `CustomerAlertsModal` ya auto-abre, así que no hace falta.

**Todas las de la tabla son SEGURAS de aplicar sin ver pantalla** (cambio
aditivo, mismo patrón ya probado en `/clientes` y `/agenda`, y el componente
se auto-inhibe si el ancla ya está visible). Las líneas son el punto de
inserción del `<ScrollToOnMount/>` + apertura del `<div id>`; hay que cerrar
el `</div>` al final del bloque de contenido correspondiente.

---

## 2) FLUJOS CON DEMASIADOS CLICS (top 15) + atajo propuesto

Marcado: **[SEGURO]** = aplicable sin ver pantalla (aditivo o de bajo riesgo).
**[REVISAR]** = conviene ver la pantalla antes (cambia comportamiento o layout).

### F1 — Aceptar prueba gratuita desde el listado **[REVISAR]**
- Archivo: `src/app/(tenant)/pruebas-gratuitas/page.tsx:222-241` (móvil) y
  `:343-362` (desktop).
- Problema: los botones "Aceptar" y "Desinst." del listado NO ejecutan la
  acción; son `<Link href="/pruebas-gratuitas/{id}">` que solo llevan a la
  ficha. El usuario cree que actúa y solo navega → luego tiene que buscar el
  botón real en la ficha (2-3 clics extra).
- Atajo: convertir esos dos en botones reales (componente cliente con server
  action), o quitarlos del listado para no engañar. Riesgo: medio (toca
  semántica de acción). Por eso REVISAR.

### F2 — Agendar tarea: cliente en un modal aparte (picker) **[REVISAR]**
- Archivo: `src/modules/agenda/create-form.tsx:64` (`pickerOpen`) +
  `subject-picker-modal.tsx`.
- Problema: para crear evento abres modal → pulsas "Buscar cliente" → se abre
  OTRO modal (SubjectPickerModal) → buscas → seleccionas → vuelves al primero.
  Doble modal encadenado en tablet.
- Atajo: incrustar el buscador de cliente como campo con autocompletar dentro
  del propio formulario (sin segundo modal). Riesgo: medio (reescritura del
  picker). REVISAR.

### F3 — Borrar cliente: cabecera de ficha **[SEGURO]**
- Archivo: `src/modules/customers/delete-customer-button.tsx` + ubicación en
  `src/app/(tenant)/clientes/[id]/page.tsx:373-381`.
- Problema: el flujo es correcto (modal con decisiones por equipo), pero el
  botón "Borrar" vive en la barra superior de acciones junto a 5 botones más
  (Nueva propuesta, Contrato directo, Calcular, Prueba, Borrar). En tablet esa
  barra se apila y hay que desplazarse. No es exceso de clics sino de ruido.
- Atajo: mover "Borrar cliente" a un menú de overflow (···) para descongestionar
  la barra principal. Es aditivo (agrupar). SEGURO de hacer, bajo riesgo.

### F4 — Rechazar/Eliminar propuesta: confirmación con modal de motivo **[REVISAR]**
- Archivo: `src/modules/proposals/row-actions.tsx:90-111` + modal `:114-171`.
- Problema: "Eliminar" abre modal solo para leer un párrafo y volver a pulsar
  "Eliminar" (confirmación redundante sin input). 2 clics para borrar algo
  reversible-bajo-impacto. "Rechazar" sí pide motivo (justificado).
- Atajo: para "Eliminar" usar un `confirm()` inline o doble-clic-arma en vez de
  modal completo; mantener modal solo para "Rechazar" (que pide texto). Riesgo:
  bajo, pero cambia UX visible → REVISAR.

### F5 — "Cumplimiento SLA" y "Por confirmar" como página aparte **[SEGURO]**
- Archivos: `incidencias/page.tsx:62-69` (link a `/incidencias/cumplimiento`),
  `mantenimientos/page.tsx:148-155` (link a `/mantenimientos/por-confirmar`).
- Problema: secciones útiles escondidas tras un clic de navegación a otra
  página. No es grave, pero suma navegación.
- Atajo: no tocar (son secciones grandes que merecen su página). Marcado SEGURO
  porque la mejora real aquí es el autoscroll de F-listados, no fusionar.

### F6 — Ficha cliente: "Calcular" / "Prueba" / "Contrato directo" abren página nueva **[SEGURO]**
- Archivo: `src/app/(tenant)/clientes/[id]/page.tsx:346-372`.
- Observación: están bien resueltos como Links directos con `customer_id`
  precargado (1 clic). El "Contrato directo" (`&direct=1`) ya es el atajo de
  "propuesta+contrato en un paso". No requiere cambio. Se documenta como
  ejemplo de buen patrón a replicar.

### F7 — Ver factura/contrato/propuesta: icono Ver + icono PDF separados **[SEGURO]**
- Archivos: `facturas/page.tsx:385-400`, `contratos/page.tsx:277-294`,
  `propuestas/row-actions.tsx:65-80`.
- Problema: en cada fila hay icono "Ver" (ojo) + "PDF" + a veces acciones. En
  tablet son dianas pequeñas (h-8 w-8) pegadas → fallos de pulsación.
- Atajo: hacer toda la fila/celda del nombre clicable hacia la ficha (ya lo es
  el nombre como Link) y agrandar el área táctil de los iconos a 44px en móvil.
  Aditivo (clases). SEGURO. Reduce clics fallidos, no clics.

### F8 — Wallet: validar/facturar movimiento **[REVISAR]**
- Archivo: `src/modules/wallet/validate-buttons.tsx` (usado en
  `wallet/page.tsx:494` y `:597`).
- Problema: por fila puede haber "Validar" + "Facturar" + estado. Acciones
  correctas pero densas; en móvil cada una es un clic y a veces confirmación.
- Atajo: revisar si "Validar" necesita confirmación (si es reversible, quitarla).
  REVISAR porque toca lógica de cobros.

### F9 — Productos: editar precio obliga a entrar a la ficha **[REVISAR]**
- Archivo: `src/modules/products/products-list-client.tsx` (listado).
- Problema: cambiar un precio/stock = abrir ficha → editar → guardar → volver.
  Hay plan de "bulk precios" en memoria pero no inline.
- Atajo: edición inline del precio en la tabla (admin). Riesgo: medio (toca
  permisos + euros↔céntimos). REVISAR.

### F10 — Instalaciones: acciones de fila (llamar/WhatsApp/Maps/Ver) **[SEGURO]**
- Archivo: `src/app/(tenant)/instalaciones/page.tsx:597-637`
  (`InstallationRowActions`).
- Observación: 4 iconos de 32px muy juntos. Buen contenido (tel/wa/maps directos
  = atajo correcto, sin entrar a ficha). Mejora táctil: separar/agrandar en
  móvil. Aditivo. SEGURO.

### F11 — Contratos: "Cartera alquileres" + "Exportar" en cabecera **[SEGURO]**
- Archivo: `src/app/(tenant)/contratos/page.tsx:107-121`.
- Observación: correcto (1 clic cada uno). Sin cambio. Documentado para no
  "arreglar lo que funciona".

### F12 — Añadir equipo / Crear mantenimiento / Desinstalar en ficha cliente **[REVISAR]**
- Archivos: `customers/add-equipment-button.tsx`,
  `customers/create-maintenance-button.tsx`,
  `customers/uninstall-button.tsx` (todos en `clientes/[id]/page.tsx`).
- Problema: tres botones que abren tres modales distintos en la sección de
  equipos. En tablet hay que localizar cuál. Flujo correcto pero disperso.
- Atajo: agrupar bajo un solo botón "Acciones de equipo" con menú. Riesgo:
  medio (layout). REVISAR.

### F13 — Filtros que exigen pulsar "Aplicar" siempre **[REVISAR]**
- Archivos (forms con `<button>Aplicar</button>`):
  `mantenimientos/page.tsx:265`, `instalaciones/page.tsx:274`,
  `productos/page.tsx:230`, `wallet/page.tsx:415`, `contratos/page.tsx:214`,
  `propuestas/page.tsx:100`.
- Problema: cada filtro es: tocar select → tocar "Aplicar" (2 clics por filtro).
- Atajo: auto-submit on change en los `<select>` (un `onChange` que envíe el
  form). Riesgo: medio (cambia comportamiento; en móvil el auto-submit puede
  recargar antes de tiempo). REVISAR. Alternativa segura: dejar "Aplicar" pero
  hacerlo sticky para no perderlo al hacer scroll.

### F14 — Leads: 6 selects de filtro siempre desplegados **[SEGURO]**
- Archivo: `src/app/(tenant)/leads/page.tsx:185-266`.
- Problema: el form de filtros (búsqueda + estado + origen + potencial +
  comercial + orden + botón) ocupa mucho antes de la tabla en tablet.
- Atajo: ver sección 3 (plegar filtros). Combinado con autoscroll (F-leads)
  el problema desaparece sin tocar el form. SEGURO vía autoscroll.

### F15 — Mantenimientos/Facturas: tarjetas intermedias empujan el listado **[SEGURO]**
- Archivos: `mantenimientos/page.tsx:194-204` (tarjeta Contratos),
  `facturas/page.tsx:169-297` (tarjeta "Pendientes de facturar").
- Problema: son tarjetas grandes ENTRE los KPIs y el listado principal. En
  tablet hay que pasarlas para llegar a la tabla.
- Atajo: el autoscroll (sección 1) ya las salta dejándolas accesibles arriba.
  SEGURO. No hace falta plegarlas.

---

## 3) FILTROS/PANELES que ocupan demasiado antes del contenido

Candidatos a plegar por defecto (`<details>`) o sticky. El usuario ya validó
el patrón `<details>` en Wallet histórico (`wallet/page.tsx:247`), así que es
el patrón de referencia.

| Panel | Archivo:línea | Propuesta | Riesgo |
|---|---|---|---|
| Filtros de Leads (6 controles) | `leads/page.tsx:185-266` | Envolver el `<form>` en `<details>` plegado por defecto en móvil (resumen "Filtros"). ADITIVO. | Bajo [SEGURO] |
| Filtros de Productos | `productos/page.tsx:163-241` | Igual, `<details>` plegable. | Bajo [SEGURO] |
| Filtros de Wallet (método/estado/fechas) | `wallet/page.tsx:353-426` | `<details>` plegable (ya hay precedente en la misma página). | Bajo [SEGURO] |
| Form "Mes del resumen" Wallet | `wallet/page.tsx:159-205` | Ya es compacto; dejar. Solo autoscroll. | — |
| Ranking satisfacción Instalaciones | `instalaciones/page.tsx:289` | Plegar `<details>` o moverlo bajo el listado (es informativo, no operativo). | Medio [REVISAR] |
| 4 KPIs (instalaciones/contratos/facturas/productos) | varios | NO plegar (son glanceables). El autoscroll ya los deja arriba accesibles. | — |
| Cola Verifactu (facturas) | `facturas/page.tsx:164-167` | Si suele estar vacía, ocultar cuando `pending+failed === 0`. Comprobar si ya lo hace el componente. | Bajo [REVISAR] |
| Tarjeta "Pendientes de facturar" | `facturas/page.tsx:169` | Ya condicionada a `length > 0`. Correcto. Solo autoscroll. | — |
| Histórico mensual Wallet | `wallet/page.tsx:247` | Ya plegado por `<details>`. Buen ejemplo. | — |

Recomendación combinada: **autoscroll (sección 1) resuelve el 80% del dolor**
("hay que apretar/desplazar en mil sitios") sin tocar los paneles. Plegar
filtros (sección 3) es la segunda capa para los listados con más controles
(Leads, Productos, Wallet).

---

## RESUMEN PARA EL USUARIO (lo esencial)

### A) Páginas donde aplicar autoscroll (archivo:línea + id) — TODAS SEGURAS

1. `src/app/(tenant)/mantenimientos/page.tsx:278` → id `mant-content`
2. `src/app/(tenant)/instalaciones/page.tsx:394` → id `inst-content`
3. `src/app/(tenant)/facturas/page.tsx:299` → id `fact-content`
4. `src/app/(tenant)/wallet/page.tsx:428` → id `wallet-content`
5. `src/app/(tenant)/productos/page.tsx:243` → id `prod-content`
6. `src/app/(tenant)/leads/page.tsx:268` → id `leads-content`
7. `src/app/(tenant)/contratos/page.tsx:227` → id `contratos-content`
8. `src/app/(tenant)/incidencias/page.tsx:76` → id `incid-content`
9. `src/app/(tenant)/propuestas/page.tsx:113` → id `prop-content`
10. `src/app/(tenant)/pruebas-gratuitas/page.tsx:147` → id `pruebas-content`
11. `src/app/(tenant)/gastos/page.tsx` (antes del listado) → id `gastos-content`
12. `src/app/(tenant)/comisiones/page.tsx` (antes del listado) → id `comis-content`
13. `src/app/(tenant)/contratos/alquileres/page.tsx` (antes 1ª card listado) → id `alq-content`

NO aplicar en: `dashboard` (no hay tabla única) ni en fichas de detalle
(`/[id]`).

### B) Top 10 flujos con más clics + atajo (★ = SEGURO sin ver pantalla)

1. **Aceptar/Desinstalar prueba desde listado** — los botones solo navegan a la
   ficha, no actúan. Hacerlos reales o quitarlos. [REVISAR]
2. **Agendar tarea** — doble modal encadenado (form → picker de cliente).
   Incrustar buscador en el form. [REVISAR]
3. ★ **Borrar cliente** — mover de la barra de 5 botones a un menú overflow (···).
4. **Eliminar propuesta** — modal de confirmación redundante (sin input);
   sustituir por confirm inline. [REVISAR]
5. ★ **Iconos Ver/PDF de fila** (facturas/contratos/propuestas) — agrandar área
   táctil a 44px en móvil; nombre ya es clicable.
6. **Filtros con "Aplicar"** (6 listados) — auto-submit on change o, opción
   segura, hacer "Aplicar" sticky. [REVISAR]
7. **Editar precio de producto** — exige entrar a la ficha; añadir edición
   inline en la tabla (admin). [REVISAR]
8. **Validar/Facturar en Wallet** — revisar confirmaciones innecesarias. [REVISAR]
9. **Equipo en ficha cliente** (Añadir/Mantenimiento/Desinstalar) — 3 modales
   dispersos; agrupar en un botón "Acciones de equipo". [REVISAR]
10. ★ **Acciones de fila Instalaciones** (tel/WhatsApp/Maps/Ver) — ya son atajos
    directos correctos; solo separar/agrandar dianas en móvil.

Atajos que YA están bien (no tocar): "Contrato directo" en ficha cliente
(propuesta+contrato en un paso), "Calcular/Prueba" con `customer_id` precargado,
acciones directas tel/WhatsApp/Maps en instalaciones.

### C) Paneles a plegar (segunda capa, todos SEGUROS)
Filtros de **Leads**, **Productos** y **Wallet** → envolver el `<form>` en
`<details>` plegado (patrón ya usado en el histórico de Wallet,
`wallet/page.tsx:247`).
