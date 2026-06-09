# Plan de arreglo del módulo PRODUCTOS — 2026-06-09

> Hay UNA empresa con datos reales en producción.
> **Regla absoluta de este plan: todo es ADITIVO.** Solo migraciones que AÑADEN
> columnas/tablas. Nunca borrar, renombrar ni mover datos existentes. Los SELECT
> se mantienen defensivos. No se pierde ni cambia nada de lo que ya hay.

## Decisiones cerradas con Mario (2026-06-09)

1. **Multi-categoría → Categoría principal + etiquetas/roles.** El producto mantiene
   su `category_id` actual (cero migración de datos). Para los papeles dobles
   (es-recambio, es-extra-configurador, vendible-suelto…) usamos roles/etiquetas.
2. **Filtros → tabla aparte + venderlos sueltos.** Seguimos con `product_filters`
   (etapas + periodicidad). Le añadimos que pueda salir al catálogo / venderse suelto.
   NO migramos filtros a `products`.
3. **Orden de ejecución → primero categorías/atributos**, luego dominio.

---

## Diagnóstico (causas exactas, fichero a fichero)

| Queja de Mario | Causa en el código |
|---|---|
| "Lo creado no se puede modificar/ajustar" | `configuracion/productos/page.tsx`: la lista "Mis categorías" NO tiene editar/borrar/desactivar/anidar. `categories-panel.tsx` solo expone *crear*. La BD (`product_categories`) ya soporta `description`, `icon`, `sort_order`, `is_active`, `parent_id` — la UI no los usa. |
| "Al crear categoría (grifos) solo deja un atributo" | En la ficha, `attributes-panel.tsx` (`AddValueForm`) solo ofrece atributos cuya `category_id` = la del producto **o** `null` ("Todas"). Categoría nueva sin atributos → solo ofrece los de "Todas" (0-1) y al agotarlos muestra el mensaje de callejón. |
| "Te manda a /configuracion/productos pero ahí no hay" | Sí hay un bloque "Atributos (N)" pero **al final de la página**, desacoplado de la categoría. No se ve / no se asocia mentalmente. Además no se puede crear un atributo *desde dentro* de una categoría. |
| "Filtros: recambio o producto suelto / exclusivos de flujo directo / de varias categorías" | `product_filters` es tabla separada de `products`; no tiene precio de venta ni aparece en catálogo. Un atributo pertenece a UNA sola categoría → no se puede decir "este filtro vale para flujo directo Y compacta". |
| "Grifería: extra de ósmosis o producto suelto" | Los extras del configurador viven en el módulo `savings` (`accepts_extras`/`extra_role`), un sistema **distinto** a `product_categories`. Dos mundos sin puente. |

---

## FASE A — Gestión de categorías y atributos (PRIORIDAD, bajo riesgo)

Objetivo: que el admin pueda **editar todo** lo que crea y definir atributos
**desde la propia categoría**, sin callejones.

### A1. Editar categorías (sin migración — la BD ya tiene las columnas)
- Nuevo `updateCategoryAction(id, {name, default_kind, description, icon, sort_order, is_active, parent_id})` en `actions.ts` (guard admin, `parseOrFriendly`, defensivo).
- Nuevo `deleteCategoryAction(id)` → **soft delete** (poner `is_active=false`) por defecto; borrado duro solo si no hay productos ni atributos colgando (comprobar antes y avisar). Nunca borrado en cascada silencioso.
- UI en `categories-panel.tsx` / `page.tsx`: cada categoría con botón editar (lápiz) → formulario con nombre, tipo, activa/inactiva, **categoría padre** (desplegable de las demás categorías) y orden. Botón desactivar/reactivar.

### A2. Definir atributos DESDE la categoría (fin del callejón)
- En la fila de cada categoría, botón "Atributos de esta categoría (N)" que abre/expande
  el editor de atributos **ya filtrado a esa categoría** (reusar `AttrForm` de
  `attributes-config.tsx`, pre-seleccionando `category_id`).
- Así el flujo es: creo "Grifos" → pulso "Atributos" → añado los que quiera → ya
  aparecen en la ficha de cualquier producto de "Grifos". Se acabó el "solo uno".
- Mantener también el bloque global de atributos abajo (no se rompe nada).

### A3. Atributo en VARIAS categorías (migración aditiva)
- Hoy `product_attributes.category_id` es 1 sola. Para "este atributo vale para
  flujo directo Y compacta" añadimos tabla puente **nueva**:
  `product_attribute_categories (attribute_id, category_id)`.
- **Compatibilidad:** seguimos respetando `category_id` (el viejo) como "categoría
  principal"; la tabla puente son las categorías EXTRA. `listAttributes(categoryId)`
  pasa a devolver: atributos con `category_id = X` **OR** `category_id IS NULL` **OR**
  presentes en la puente para `X`. Defensivo: si la tabla puente no existe, cae al
  comportamiento actual.

### A4. Mensaje de callejón mejorado
- En `attributes-panel.tsx`, cuando no hay atributos para la categoría, el texto pasa
  a explicar claramente: "Esta categoría aún no tiene características definidas. Defínelas
  en Configuración → Productos → [nombre categoría]" con enlace directo.

**Migraciones Fase A:** 1 nueva (`..._product_attribute_categories.sql`). Resto sin BD.

---

## FASE B — Roles múltiples de un producto (categoría principal + etiquetas)

Objetivo: que la grifería/filtro pueda ser a la vez "producto suelto", "recambio"
y "extra del configurador" sin duplicarlo.

### B1. Migración aditiva: `products.roles text[]`
- Columna `roles` (array de texto) con valores tipo:
  `sellable_standalone` (vendible suelto), `spare_part` (recambio),
  `configurator_extra` (extra del configurador), `accessory`.
- Por defecto se rellena desde el `kind` actual (trigger o backfill suave, sin borrar).
- `kind` se queda como "papel principal"; `roles` son los papeles adicionales.

### B2. UI ficha/edición producto
- En `edit-form.tsx`: bloque "¿Cómo se usa este producto?" con casillas (vendible suelto /
  recambio / extra del configurador / accesorio). Texto llano, sin jerga.

### B3. Puente con el configurador (grifería como extra)
- Cuando un producto tiene rol `configurator_extra`, que aparezca como opción de extra
  en el configurador. Conectar con el sistema `savings` existente (leer cómo consume hoy
  los extras antes de tocar) — pendiente de mini-investigación en su momento.

**Migraciones Fase B:** 1 nueva (`..._products_roles.sql`).

---

## FASE C — Filtros vendibles sueltos + multi-equipo

Objetivo: que un filtro sea recambio (ya lo es) y además producto vendible/en catálogo.

### C1. Migración aditiva sobre `product_filters`
- Ya tiene `sale_price_cents`. Añadir: `show_in_catalog boolean default false`,
  `category_id uuid` (opcional, para agruparlo en catálogo).
- Filtros "exclusivos de flujo directo" vs "válidos para varias": ya se resuelve con
  `product_filter_assignments` (N:N filtro↔equipo). Documentar/mejorar la UI de asignación
  para que se vea claro a qué equipos/categorías sirve cada filtro.

### C2. UI
- En la ficha del filtro: casilla "Vender suelto / mostrar en catálogo" + precio.
- En el listado de productos/catálogo, incluir filtros con `show_in_catalog=true`
  (consulta defensiva: si la columna no existe, no rompe).

**Migraciones Fase C:** 1 nueva (`..._product_filters_catalog.sql`).

---

## Orden de trabajo propuesto
1. **Fase A** completa (lo que te bloquea hoy). Build + verificación.
2. **Fase B** (roles).
3. **Fase C** (filtros vendibles).

Cada fase: migración aditiva → actions defensivas → UI → `npm run build` →
commit pequeño. Las migraciones las aplicas tú al desplegar (regla conocida).

## Riesgos y mitigaciones
- **Datos vivos:** ninguna migración borra/renombra; todo `add column` / `create table if not exists`.
- **Cache de esquema (PostgREST):** todo SELECT nuevo va con fallback defensivo por si la
  migración aún no está aplicada (patrón ya usado en `listProducts`).
- **Permisos:** todas las nuevas actions con guard admin (nivel 1 escribe; 2 y 3 leen),
  igual que el resto del módulo.

## Pendiente de confirmar al ejecutar
- Nombres exactos de los roles (B1) en español para la UI.
- Si "desactivar categoría" debe ocultarla también en filtros/listados (gating).

---

## ESTADO DE EJECUCIÓN (2026-06-09)

### ✅ Fase A — HECHA (y repasada con effort alto)
- Editar/desactivar/borrar categorías + categoría padre + orden (`updateCategoryAction`,
  `deleteCategoryAction` con borrado seguro: desactiva si está en uso). Anti-ciclo en parent_id.
- Atributos desde la propia categoría (desplegable "Atributos (N)" + "Nueva característica").
- Atributo en VARIAS categorías: tabla puente `product_attribute_categories` +
  multi-select en el formulario de atributo + badge "Compartido" + `listAttributes` y
  `deleteCategory` la tienen en cuenta. Todo defensivo.
- Mensaje del callejón mejorado en la ficha.
- **Migración:** `20260609100000_product_attribute_categories.sql` (aplicar al desplegar).

### ✅ Fase B (datos + UI) — HECHA
- `products.roles text[]` con default `{sellable_standalone}` (no cambia comportamiento).
- Constantes `PRODUCT_ROLES`/`ROLE_LABEL`/`ROLE_HELP` en schemas.
- Bloque "¿Cómo se usa este producto?" en alta y edición. Badges read-only en la ficha.
- `updateProductAction`/`createProductAction` manejan roles (defensivo).
- **Migración:** `20260609110000_products_roles.sql` (aplicar al desplegar).

### ⏳ Fase B3 — PENDIENTE (toca módulo `savings`, requiere OK de Mario)
Que un producto con rol `configurator_extra` aparezca de verdad como extra en el
configurador. Hay que ver cómo consume hoy los extras (`accepts_extras`/`extra_role`).
NO tocado todavía por la regla de no cambiar de módulo sin preguntar.

### ⏳ Fase C — PENDIENTE
Filtros vendibles sueltos (`product_filters` + show_in_catalog/category_id).

`npm run build` → ✅ Compiled successfully. Migraciones las aplica Mario al desplegar.
