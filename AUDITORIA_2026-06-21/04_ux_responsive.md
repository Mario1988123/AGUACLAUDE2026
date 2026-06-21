# Auditoría UX/UI responsive (tablet 768-1024px · móvil <640px)
Fecha: 2026-06-21 · Auditor: agente READ-ONLY · Proyecto: AGUA_CLAUDE2026 (Next.js 15 + Tailwind)

Alcance: `src/app/(tenant)/**` + `src/modules/**`. Ignorados `legacy_reference/`, `.next/`, `node_modules/`.
Prioridad: agenda, clientes, leads, instalaciones, mantenimientos, productos, contratos, facturas, pruebas-gratuitas, wallet, dashboard.

---

## 0. Estado de las primitivas compartidas (`src/shared/ui/layout/`)

Las primitivas están BIEN diseñadas (responsive correcto):
- `PageHeader` (page-header.tsx:57-121): `flex-col` móvil → `sm:flex-row`, acciones con `flex-wrap`. Correcto.
- `FilterBar` (filter-bar.tsx:42-47): `flex flex-wrap` + `stackOnMobile`. Correcto.
- `FormGrid` (form-grid.tsx:19-24): 1 col móvil → escala. Correcto.
- `ResponsiveTableWrapper` (responsive-table.tsx:46-52): `overflow-x-auto` + touch scroll. Correcto.
- `EmptyState/ErrorState/LoadingState` (states.tsx): correctos.

HALLAZGO RAÍZ: **las primitivas casi NO se usan.**
- `PageHeader`: importado por 0 páginas (solo se referencia a sí mismo en index.ts/page-header.tsx). Verificado con grep.
- `FilterBar/FormGrid/ResponsiveTableWrapper/EmptyState`: solo `productos/page.tsx`, `mi-dia/page.tsx` y `products/empty-state.tsx`. 3 ficheros en toda la app.
- Cada página reinventa a mano cabecera + barra de filtros + tabla. Por eso la calidad responsive es DESIGUAL: algunas páginas (wallet, leads, mantenimientos, facturas, contratos) lo hacen bien por copia-pega; otras (clientes, productos, ventas, comisiones) tienen fallos.

El `Button` base (button.tsx:21-26): `default` = `h-11` (44px, OK táctil), pero `sm` = `h-9` (36px) e `icon` está bien (44px). El problema táctil real NO es el Button sino los **botones-icono caseros `h-8 w-8` (32px)** repartidos por listados.

---

## RECUENTO POR SEVERIDAD

- ALTO: 6
- MEDIO: 9
- BAJO: 5
- TOTAL: 20 hallazgos (varios afectan a decenas de ficheros)

---

## HALLAZGOS

### [ALTO] H1 — Cabecera de /clientes sin flex-wrap, 5 acciones en una fila
`src/app/(tenant)/clientes/page.tsx:45` y `:50`
- Problema: contenedor `flex items-center justify-between` (sin `flex-wrap`) con un grupo de acciones `flex items-center gap-2` que contiene hasta 5 controles (Importar, Generar contratos legacy, ⚠ Duplicados, ⬇ Exportar CSV, + Nuevo cliente). En tablet (768-1024px) no caben y o se salen o aplastan el título.
- Patrón: 2 (barra de acciones que colapsa mal en tablet).
- Arreglo: en el wrapper exterior añadir `flex-wrap gap-3`; en el grupo de acciones añadir `flex-wrap`. Idealmente sustituir por `<PageHeader title="Clientes" subtitle={...} actions={...} />`.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ (añadir `flex-wrap` nunca empeora).

### [ALTO] H2 — Cabecera de /productos sin flex-wrap, 5 controles inline
`src/app/(tenant)/productos/page.tsx:93`
- Problema: `<div className="flex gap-2 items-center">` (sin `flex-wrap`) con toggle Lista/Grid + "📄 Catálogo PDF" + "🔁 Filtros y recambios" + "Configuración" + "+ Nuevo producto". En tablet desborda; los textos largos lo agravan.
- Patrón: 2.
- Arreglo: añadir `flex-wrap` al grupo; además en cada `Button` que repite en móvil considerar texto corto con `hidden sm:inline` (como hace /leads). El wrapper exterior (:84) ya tiene `flex-wrap gap-3`, solo falta el grupo interno.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ.

### [ALTO] H3 — Botones-icono de acción a 32px (h-8 w-8) en todos los listados
Repartido (66 ocurrencias `h-8 w-8 ... rounded` verificadas). Ejemplos:
`src/app/(tenant)/instalaciones/page.tsx:599-635` (Ver/Llamar/WhatsApp/Maps), `mantenimientos/page.tsx:337,401`, `contratos/page.tsx:281,367`, `facturas/page.tsx:388,506`, `productos-list-client.tsx:460,570`.
- Problema: tamaño táctil 32×32 px, por debajo del mínimo recomendado (≈44px, mínimo 40). En tablet/móvil se fallan los toques, sobre todo cuando hay 3-4 iconos pegados con `gap-0.5/gap-1`.
- Patrón: 5 (tamaños táctiles <40px).
- Arreglo: en móvil agrandar a `h-10 w-10` y desktop dejar compacto: `h-10 w-10 sm:h-8 sm:w-8` (y subir el `gap` a `gap-1.5` en móvil). Como es un patrón repetido conviene un componente `IconActionLink/IconActionButton` compartido en `src/shared/components/`.
- Riesgo: medio (cambia densidad de filas en desktop si no se condiciona con `sm:`). seguro-sin-ver-pantalla: SÍ si se usa `h-10 w-10 sm:h-8 sm:w-8` (no toca desktop).

### [ALTO] H4 — /ventas: tabla sin versión móvil (cards)
`src/app/(tenant)/ventas/page.tsx:115` (`<table className="w-full text-sm">`)
- Problema: tabla mostrada en todos los tamaños SIN `md:hidden` + cards alternativas y, por lo visto en el grep, sin `overflow-x-auto`. En móvil/tablet la tabla se desborda o se comprime ilegible.
- Patrón: 3 (tabla sin ResponsiveTableWrapper / sin alternativa móvil).
- Arreglo: envolver en `ResponsiveTableWrapper` (mínimo) y/o añadir el patrón cards `md:hidden` como en facturas/contratos.
- Riesgo: bajo (solo añade scroll/cards). seguro-sin-ver-pantalla: SÍ para el wrapper de scroll; las cards requieren más cuidado.

### [ALTO] H5 — /comisiones: tabla sin scroll wrapper robusto ni cards
`src/app/(tenant)/comisiones/page.tsx:120-121` (`<div className="overflow-x-auto"><table ...>`)
- Problema: solo `overflow-x-auto` desnudo (sin borde/touch-scrolling hint) y sin alternativa de cards; varias columnas → en móvil scroll horizontal incómodo.
- Patrón: 3.
- Arreglo: cambiar el `div` por `ResponsiveTableWrapper showScrollHint`. Para móvil, considerar cards.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ (el wrapper solo añade borde + hint).

### [ALTO] H6 — Adopción nula de PageHeader/FilterBar → inconsistencia responsive sistémica
Toda la app (ver sección 0).
- Problema: el toolkit responsive existe pero no se usa; cada página replica el layout y algunas lo hacen mal (H1, H2). El riesgo es que cada nueva página vuelva a fallar.
- Patrón: 4 (páginas que no usan las primitivas y deberían).
- Arreglo: migración progresiva. Empezar por cabeceras (PageHeader) en las 11 páginas prioritarias; luego FilterBar para las barras de filtros (todas usan el mismo `<form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">`, fácilmente sustituible).
- Riesgo: medio (refactor amplio; hacerlo por páginas, verificando build). seguro-sin-ver-pantalla: PARCIAL (PageHeader es equivalente visual; conviene revisar 1-2 pantallas tras migrar).

### [MEDIO] H7 — Barras de filtros con selects a ancho natural sin min-width controlado
Repetido: `instalaciones/page.tsx:243`, `mantenimientos/page.tsx:206`, `contratos/page.tsx:185`, `wallet/page.tsx:353`, `agenda/page.tsx:298`, `productos/page.tsx:163`.
- Problema: `<form className="flex flex-wrap items-end gap-3 ...">` con `<select className="h-10 rounded-xl ...">` sin `w-full sm:w-auto`. En móvil estos selects quedan a ancho natural (estrecho) en vez de full-width, y el "Aplicar" salta de línea de forma irregular. /leads y /clientes SÍ lo hacen bien (`w-full ... sm:w-auto`).
- Patrón: 1 (grupos flex que no se estiran bien en móvil).
- Arreglo: usar `FilterBar stackOnMobile` + `FilterField`, o como parche añadir `w-full sm:w-auto` a cada `<select>`/`<input>` y a los `<div className="space-y-1">` contenedores.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ (`w-full sm:w-auto` no afecta a desktop).

### [MEDIO] H8 — Botón "Aplicar" / "Filtrar" no es full-width en móvil en varias barras
`instalaciones/page.tsx:274`, `mantenimientos/page.tsx:265`, `contratos/page.tsx:214`, `wallet/page.tsx:415`, `agenda/page.tsx:392`, `productos/page.tsx:230`.
- Problema: el `<button type="submit" className="inline-flex h-10 ...">` queda a ancho natural y, tras filtros que se apilan, aparece descolgado. /leads lo resuelve con `className="w-full sm:w-auto"` (leads/page.tsx:263).
- Patrón: 1.
- Arreglo: añadir `w-full sm:w-auto` al submit (y al enlace "Limpiar").
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ.

### [MEDIO] H9 — KPIs de instalaciones/productos/contratos/facturas a 2 columnas en móvil con 4 tarjetas
`instalaciones/page.tsx:316`, `productos/page.tsx:140`, `contratos/page.tsx:159`, `facturas/page.tsx:139` (`grid gap-3 grid-cols-2 sm:grid-cols-4`).
- Problema: en móvil 2 columnas con números grandes (`text-3xl`) + label en mayúsculas → en pantallas estrechas (~360px) el texto del label puede truncar/saltar feo. No es roto, pero es apretado.
- Patrón: 3 (densidad excesiva en móvil) / borde con 6.
- Arreglo: mantener `grid-cols-2` (es aceptable) pero usar `KpiCard` compartido (wallet ya lo usa, wallet/page.tsx:208) que gestiona tamaños. Opcional `grid-cols-1 xs:grid-cols-2`.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ (usar componente existente).

### [MEDIO] H10 — Toggle Lista/Calendario y Lista/Grid sin scroll/wrap en móvil
`instalaciones/page.tsx:193` (toggle dentro de grupo) y `productos/page.tsx:94`.
- Problema: los toggles `inline-flex rounded-xl border` van junto a otros botones en un grupo sin `flex-wrap` (productos H2) o quedan en una fila que puede estrecharse. En productos comparte el grupo con 4 botones más.
- Patrón: 2.
- Arreglo: el `flex-wrap` de H2 lo resuelve; mantener el toggle como bloque indivisible (`shrink-0`).
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ.

### [MEDIO] H11 — Tabla histórico mensual de wallet sin alternativa móvil
`src/app/(tenant)/wallet/page.tsx:291-347` (`<div className="overflow-x-auto"><table>`)
- Problema: dentro del `<details>` "Histórico mensual", tabla de 4 columnas solo con `overflow-x-auto`. En móvil scroll lateral; aceptable pero por debajo del estándar del resto del módulo (que sí tiene cards). El propio listado de movimientos sí tiene cards (wallet:438).
- Patrón: 3.
- Arreglo: `ResponsiveTableWrapper showScrollHint` para dar pista visual; cards opcionales.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ.

### [MEDIO] H12 — Tabla "Pendientes de facturar" de facturas: solo overflow-x-auto en desktop, OK móvil
`src/app/(tenant)/facturas/page.tsx:237-294`
- Problema: el bloque tiene cards `md:hidden` (bien) y tabla `hidden ... md:block overflow-x-auto`. Correcto, pero la tabla principal de facturas (`:406`) NO declara `min-w` y con 9 columnas en tablet (768-1024 en la franja `md`) se aprieta. Como `md` empieza en 768, la tabla aparece justo en tablet vertical.
- Patrón: 3 (demasiadas columnas para tablet en el breakpoint `md`).
- Arreglo: subir el breakpoint de tabla a `lg:block` / `lg:hidden` (como hace wallet) para que tablet siga viendo cards; o añadir `min-w-[760px]` a la tabla para forzar scroll limpio.
- Riesgo: medio (cambia qué ve el tablet). seguro-sin-ver-pantalla: parcial — `min-w-[...]` sí es seguro; cambiar `md`→`lg` conviene verlo.

### [MEDIO] H13 — Mismo problema de breakpoint md vs lg en contratos, productos, mantenimientos, pruebas-gratuitas
`contratos/page.tsx:302` (`hidden ... md:block`, table `min-w-[720px]` — OK), `productos-list-client.tsx:484` (`md:block`, sin min-w), `mantenimientos/page.tsx:347` (`md:table`, sin min-w), `pruebas-gratuitas/page.tsx:250` (`md:block`, sin min-w).
- Problema: en tablet vertical (768px) aparece la tabla (no las cards) y sin `min-w` algunas columnas se aprietan. Contratos lo hace bien (min-w-[720px]); el resto no.
- Patrón: 3.
- Arreglo: añadir `min-w-[680px]`/`min-w-[720px]` a esas tablas (ya van dentro de un `overflow-x-auto`), garantizando scroll en vez de aplastamiento. Wallet usa `lg:` como alternativa más cómoda.
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ (min-w + overflow ya presente).

### [MEDIO] H14 — Acciones inline de pruebas-gratuitas con textos que no caben (Aceptar / Desinstalar)
`pruebas-gratuitas/page.tsx:222-241` (móvil) y `:343-362` (desktop)
- Problema: en la fila de acciones móvil hay Ver(icono) + "Aceptar" + "Desinst." en `flex items-center gap-1.5` sin `flex-wrap`. Con referencia/estado largos puede desbordar la card.
- Patrón: 1/2.
- Arreglo: añadir `flex-wrap` al contenedor de acciones (`:214` y `:335`).
- Riesgo: bajo. seguro-sin-ver-pantalla: SÍ.

### [MEDIO] H15 — 29 modales caseros (no usan el Dialog compartido) → riesgo de overflow desigual
29 ficheros con `fixed inset-0 z-50` (verificado). Buenos ejemplos: `customers/add-equipment-button.tsx:122-144` (full-screen móvil + `max-h-[90vh] overflow-y-auto`). Riesgo en los que NO replican ese patrón.
- Problema: el `Dialog` de `shared/ui/dialog.tsx` ya es responsive (`max-h-[90vh] overflow-y-auto max-w-[calc(100%-2rem)] sm:max-w-lg`), pero la mayoría de modales se montan a mano. Los que olviden `max-h`/`overflow-y-auto` o usen `max-w-2xl/3xl` fijo desbordan en tablet/móvil (formularios largos: installation-wizard, complete-wizard, edit-data, etc.).
- Patrón: 6 (modales/formularios que desbordan o no scrollean).
- Arreglo: estandarizar en `Dialog` compartido donde sea viable; donde no, exigir el patrón `flex h-full max-h-screen flex-col ... sm:max-h-[90vh]` con cuerpo `flex-1 overflow-y-auto` (como add-equipment). Auditar uno a uno los wizards.
- Riesgo: medio (cada modal es distinto). seguro-sin-ver-pantalla: NO (revisar caso a caso; algunos ya están bien).

### [BAJO] H16 — Enlaces-pill de scope (Todos / Mi cartera) sin flex-wrap
`clientes/page.tsx:78`, `leads/page.tsx:147` (`<div className="flex gap-2">`)
- Problema: 2 pills cortas, raramente desbordan, pero el contenedor no tiene `flex-wrap`. Bajo riesgo.
- Patrón: 1.
- Arreglo: `flex flex-wrap gap-2`.
- Riesgo: nulo. seguro-sin-ver-pantalla: SÍ.

### [BAJO] H17 — Toggle de vistas de agenda sin flex-wrap
`agenda/page.tsx:413` (`<div ... className="flex gap-2 scroll-mt-20">` con Mes/Semana/Listado)
- Problema: 3 pills con icono+texto. En móvil estrecho (320-360px) pueden no caber en una línea.
- Patrón: 1.
- Arreglo: añadir `flex-wrap`.
- Riesgo: nulo. seguro-sin-ver-pantalla: SÍ.

### [BAJO] H18 — Checkbox de filtro "Solo activos" en productos a 16px
`productos/page.tsx:220-228` (`<input type="checkbox" className="h-4 w-4">`)
- Problema: 16px es pequeño para tocar en móvil; el `<label>` envolvente ayuda (área clicable mayor), así que riesgo bajo.
- Patrón: 5.
- Arreglo: `h-5 w-5` y asegurar padding del label.
- Riesgo: nulo. seguro-sin-ver-pantalla: SÍ.

### [BAJO] H19 — Iconos de "factura ✓" a 24px (h-6 w-6) en wallet desktop
`wallet/page.tsx:587` (solo visible en desktop `lg:block`), por lo que el impacto táctil móvil es nulo. Se reporta por completitud.
- Patrón: 5.
- Arreglo: irrelevante en móvil (la tabla es `lg:`). Sin acción.
- Riesgo: nulo. seguro-sin-ver-pantalla: SÍ.

### [BAJO] H20 — Título h1 a text-2xl/3xl sin truncado en algunas fichas
Varias páginas usan `<h1 className="text-2xl ...">` sin `truncate min-w-0` (clientes:47, productos:86). PageHeader sí lo trae (page-header.tsx:105 `truncate`). Con nombres largos de cliente en ficha puede empujar acciones.
- Patrón: 2.
- Arreglo: migrar a PageHeader (que ya trunca) o añadir `min-w-0 truncate`.
- Riesgo: nulo. seguro-sin-ver-pantalla: SÍ.

---

## PLAN DE ARREGLO POR PATRÓN (cambios reutilizables, mayor impacto primero)

1. **Añadir `w-full sm:w-auto` a submits y selects de TODAS las barras de filtros** (H7, H8).
   Afecta: agenda, instalaciones, mantenimientos, contratos, wallet, productos (~6 páginas, ~7 barras).
   Mejor aún: crear/usar `FilterBar` + `FilterField` (ya existen, filter-bar.tsx:35/84) y migrar las barras `<form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">`.
   SEGURO sin ver pantalla: SÍ (no toca desktop).

2. **Botón-icono táctil compartido `h-10 w-10 sm:h-8 sm:w-8`** (H3).
   Crear `src/shared/components/icon-action.tsx` (link y button) y reemplazar las 66 ocurrencias `h-8 w-8 items-center justify-center rounded`. Afecta a TODOS los listados prioritarios.
   SEGURO sin ver pantalla: SÍ (en desktop queda idéntico por el `sm:`).

3. **Añadir `flex-wrap` a los grupos de acciones de cabecera que aún no lo tienen** (H1, H2, H10, H14, H16, H17).
   Sitios concretos: clientes/page.tsx:45 y :50, productos/page.tsx:93, agenda/page.tsx:413, pruebas-gratuitas/page.tsx:214 y :335, clientes:78, leads:147.
   SEGURO sin ver pantalla: SÍ (añadir `flex-wrap` solo mejora el wrap).

4. **Añadir `min-w-[680-720px]` a las tablas desktop que ya van en `overflow-x-auto` pero sin min-w** (H12, H13).
   Sitios: productos-list-client.tsx:485, mantenimientos:347, pruebas-gratuitas:251, facturas:407. (contratos ya lo tiene).
   SEGURO sin ver pantalla: SÍ (el contenedor ya hace scroll).

5. **Envolver tablas "desnudas" en `ResponsiveTableWrapper` (showScrollHint)** (H4, H5, H11).
   Sitios: ventas/page.tsx:115, comisiones/page.tsx:120, wallet histórico:291.
   SEGURO sin ver pantalla: SÍ (solo añade borde + scroll + pista).

6. **Migrar cabeceras a `<PageHeader>`** (H6, H20).
   Empezar por las 11 prioritarias. Aporta truncado de título, wrap de acciones y consistencia. Equivalente visual.
   SEGURO sin ver pantalla: PARCIAL (revisar 1-2 pantallas tras migrar).

7. **Tabla en `lg:` en vez de `md:` para que el tablet vertical vea cards** (H12, H13).
   Patrón ya usado por wallet (lg:hidden / lg:block). Aplicable a facturas/contratos/mantenimientos/productos si se prefiere a las cards en tablet.
   SEGURO sin ver pantalla: NO (cambia experiencia tablet; conviene verlo).

8. **Auditar y estandarizar los 29 modales caseros** (H15).
   Plantilla obligatoria: contenedor `fixed inset-0 ... p-0 sm:p-4 items-stretch sm:items-center`, panel `flex h-full max-h-screen flex-col ... sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl`, cuerpo `flex-1 overflow-y-auto`. Tomar `customers/add-equipment-button.tsx:122-144` como referencia.
   SEGURO sin ver pantalla: NO (caso a caso).

---

## Cambios marcados SEGUROS para aplicar sin ver pantalla (resumen ejecutable)

- Plan 1: `w-full sm:w-auto` en submits y selects de las 7 barras de filtros (H7, H8).
- Plan 2: componente icon-action `h-10 w-10 sm:h-8 sm:w-8` y reemplazo de los `h-8 w-8` (H3).
- Plan 3: `flex-wrap` en grupos de acciones de cabecera (H1, H2, H10, H14, H16, H17).
- Plan 4: `min-w-[680-720px]` en tablas desktop ya con overflow-x-auto (H12, H13).
- Plan 5: `ResponsiveTableWrapper showScrollHint` en ventas/comisiones/histórico-wallet (H4, H5, H11).
- H18 (`h-5 w-5` checkbox), H20 (`min-w-0 truncate` en h1).

NO aplicar a ciegas: Plan 6 (migración PageHeader — equivalente pero conviene mirada), Plan 7 (md→lg cambia tablet), Plan 8 (modales caso a caso).
