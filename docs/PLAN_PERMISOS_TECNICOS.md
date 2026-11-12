# Plan — Permisos de técnicos e instaladores

> 2026-11-12 · Investigación y plan, **SOLO LECTURA**: no se ha tocado código ni la base de datos.
> Las rutas son relativas a `src/` salvo que se diga otra cosa. Las cifras de producción salen de
> SELECT por la Management API el 2026-11-12.
> Leyenda: **[V]** verificado (código leído o consulta a producción) · **[NV]** sin verificar ·
> `[decide]` decisión rutinaria que tomo yo y Mario puede cambiar.

## 0. Petición de Mario

> «Los técnicos ahora mismo no pueden ver el cliente que les tiene que instalar o hacer
> mantenimiento. Habilita Clientes, que son los que tengan algo pendiente con ellos. Y en
> Mantenimientos pueden ver todos. FALLOS: los roles, por ejemplo de instaladores, solo pueden
> ver sus datos. Su furgoneta sin ver el stock, solo en verde para que sepan que hay stock.
> Además hay mucho ruido al principio con muchos botones que dificultan. Además ellos no tienen
> que ver ningún almacén, solo su furgoneta.»

---

## ★ Decisiones de Mario 12-11 (mandan sobre todo lo de abajo)

Donde el resto del documento diga otra cosa, vale lo de esta sección. Las secciones 3–8
quedan como histórico del análisis.

| # | Decisión | Efecto en el plan |
|---|---|---|
| D1 | Técnico e instalador son el **mismo rol** (`installer`) | No se crea rol nuevo. |
| D2 | **Un técnico NO ve los mantenimientos de otro** | Se anula «Mantenimientos: todos». El filtro de `listMaintenance` (`maintenance/actions.ts:381-383`) **se queda**. Además se cierra lo que hoy está abierto (ver abajo). |
| D3 | «Pendiente» = **mantenimientos e instalaciones asignados a él**. La agenda **no cuenta** | Fuera agenda, incidencias y pruebas gratuitas de la regla. |
| D4 | Tras cerrar el trabajo ve al cliente **24 h** | Margen sobre `completed_at`. |
| D5 | Furgoneta **verde / ámbar (queda poco) / gris** | Umbral en D5-bis. |
| D6 | Los técnicos **cargan ellos mismos** su furgoneta en el almacén | Nueva acción «Registrar carga» sin ver cantidades del almacén (ver abajo). |
| D7 | **Ocultar costes también a los comerciales** | M5 pasa a obligatoria: costes solo para nivel 1/2. |
| D8 | **No** crear cuenta de técnico de prueba | La prueba a 390 px se hace con un usuario real, con Mario o Orlando delante, o simulando el rol en local. |
| D9 | Furgonetas de Infinity a nombre de **Sandro** y de **Fernando Andrés Forini** | Cambio de datos propuesto abajo, **sin aplicar**. |
| D10 | aquaroo es de pruebas; **solo cuenta INIFINITY AQUA** | Cifras y pruebas, solo de Infinity. |
| — | Foto en el mantenimiento | La planifica otro agente; aquí no. |

### D2 — Cómo encaja con la petición inicial

La petición decía «en Mantenimientos pueden ver todos»; D2 dice que no ven los de otros. **Manda
D2.** La lectura que concilia las dos: «todos» = **todos los suyos** (no solo los de hoy, también
los atrasados y su historial), y no los de toda la empresa. Hoy la lista ya enseña todos los
estados de los suyos. Lo que falla es que salen **sin nombre de cliente** y que la ficha ajena **sí
se puede abrir**. Cambios:

- `listMaintenance`: mantener el filtro. Leer los nombres de cliente con admin + `company_id`
  (:404-407). Paginar con `fetchAllRows` en lugar del `limit(200)`.
- `/mantenimientos/[id]`: hoy **no tiene guard de asignación**. Añadir `notFound()` si es solo
  técnico y `technician_user_id ≠ él`. Nombre y dirección, con admin.
- `startMaintenanceAction` / `completeMaintenanceAction`: exigir que el trabajo sea suyo (nivel 3).
- **RLS `maintenance_jobs` SELECT**: hoy es de toda la empresa. Para el solo técnico, limitarla a
  `technician_user_id = auth.uid()`. `_modify`: UPDATE solo los suyos y **DELETE solo nivel 1/2**.
  sales_rep conserva su acceso actual (no se ha pedido cambiarlo).
- Las tarjetas de mantenimiento **dentro de la ficha de un cliente pendiente** muestran solo los
  trabajos del técnico, con admin y filtrados por `technician_user_id` **[decide]**.

### D3 + D4 — Regla de «cliente pendiente» (sustituye al §4)

Cliente `C` visible para el técnico `U` (empresa `E`) si:

- `installations`: `installer_user_id = U`, `company_id = E`, `deleted_at is null` y
  (`status not in (completed, cancelled)` **o** `completed_at > now() - 24 h`).
- `maintenance_jobs`: `technician_user_id = U`, `company_id = E` y
  (`status not in (completed, cancelled)` **o** `completed_at > now() - 24 h`).

**⚠ «Futuros» al pie de la letra deja la lista vacía [V, 12-11].** Los 33 mantenimientos abiertos
de los dos técnicos de Infinity tienen **todos `scheduled_at` en el pasado**: Sandro tiene 18
programados y 1 en curso; Fernando, 13 programados y 1 en curso. Si «futuro» = `scheduled_at >=
now()`, hoy no verían a **ningún** cliente. Propuesta `[decide]`: «pendiente» = **no cerrado**,
tenga la fecha que tenga, es decir, futuro **o atrasado sin cerrar**. Hoy serían 19 clientes
(Sandro) y 14 (Fernando). Pregunta abierta A1.

Instalaciones: ninguno de los dos tiene una abierta hoy (Fernando tiene 1 completada).

La función SQL de M1 queda así (sin agenda, incidencias ni pruebas):

```sql
create or replace function app.cliente_pendiente_para_mi(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from installations i
          where i.company_id = app.current_company_id() and i.customer_id = p_customer_id
            and i.installer_user_id = auth.uid() and i.deleted_at is null
            and (i.status not in ('completed','cancelled') or i.completed_at > now() - interval '24 hours'))
      or exists (select 1 from maintenance_jobs m
          where m.company_id = app.current_company_id() and m.customer_id = p_customer_id
            and m.technician_user_id = auth.uid()
            and (m.status not in ('completed','cancelled') or m.completed_at > now() - interval '24 hours'))
$$;
```

`hasActiveTaskForCustomer` (`role-scope.ts:69-122`) deja de mirar `agenda_events`, aplica la misma
regla y añade las 24 h. Es la regla única para la app y la RLS.

**Efecto secundario:** desde la agenda, un enlace a un cliente sin trabajo pendiente dará 404 al
técnico. Es coherente con D3, pero conviene que el diálogo no pinte el enlace en ese caso.

### D5-bis — Umbral del ámbar

Lo que ya existe en producción (Infinity, [V]):

- `warehouse_stock_thresholds.stock_min` por almacén y producto: 6 umbrales, **todos del almacén
  Andratx**; **ninguno de furgonetas**.
- `warehouse_stock.min_quantity`: 0 en todas las filas.
- `products.stock_min`: 13 de 19 productos, máximo 10. Es un mínimo **de empresa** pensado para el
  almacén. Aplicado a una furgoneta, pintaría ámbar casi todo.

Propuesta:

1. Si la furgoneta tiene umbral propio en `warehouse_stock_thresholds` para ese producto →
   **ámbar si `cantidad <= stock_min`**. Lo configura la oficina; la tabla y su RLS ya existen y
   solo dejan escribir a nivel 1/2.
2. Si no tiene → **ámbar si `cantidad = 1`** (queda la última unidad) **[decide, pregunta A2]**.
3. **Verde** si cantidad > umbral; **gris** si 0 o el producto no está en la furgoneta.

Se calcula en servidor y al técnico solo le llega `estado: 'verde'|'ambar'|'gris'`.

### D6 — El técnico registra la carga sin ver el almacén

Hoy existen la solicitud manual de carga (`loading-request-actions.ts`, escribe con RLS) y el
«Entregar» (`deliverLoadingRequestAction`, mueve con admin). Se sustituye, para el técnico, por una
sola acción de servidor:

**`registrarCargaFurgoneta({ origen_id, lineas: [{ product_id, cantidad }] })`**:

- **Destino forzado en servidor:** la furgoneta `kind='vehicle' AND assigned_user_id = session.user_id
  AND company_id = session.company_id`. Si no tiene, error «No tienes furgoneta asignada».
- **Origen:** un almacén `main`/`secondary` de su empresa. En Infinity solo hay uno (Andratx), así
  que se fija sin preguntar **[decide]**. Si hay varios, el selector muestra **solo nombres**,
  servidos por una acción con admin, porque la RLS ya no le dejará leer `warehouses` ajenos.
- **Selector de productos:** catálogo por nombre o SKU, **sin cantidades del almacén**. Opcional:
  marcar «hay / no hay» en el almacén. Eso ya revela algo, así que queda **[NV, pregunta A3]**.
- **Movimiento atómico** con la RPC existente `adjust_stock_batch` (salida del origen y entrada en la
  furgoneta con el mismo motivo, `performed_by` = técnico), con admin. Queda un registro en
  `loading_requests` en estado entregado para la trazabilidad.
- **Si el almacén no tiene bastante:** error genérico («No hay suficiente de X en el almacén; avisa a
  la oficina»), **sin decir cuánto queda**. Riesgo menor y asumido: probando cantidades se podría
  deducir el stock.
- **Devolución furgoneta → almacén:** la misma acción en sentido inverso **[pregunta A4]**.
- El cron de autocarga (`auto-loading.ts`) y el aviso al fichar siguen igual (admin).
- Para el técnico se quitan «Crear solicitud» y «Entregar» de solicitudes ajenas. La RLS de
  `loading_requests` queda limitada a las de su furgoneta.

### D7 — Costes ocultos a técnicos y comerciales

`products.cost_cents`, `products.supplier_price_cents`, `stock_lots.unit_cost_cents`, la valoración
del inventario y las compras: **solo nivel 1/2**.

- En BD: la RLS de `stock_lots` y de compras pasa a nivel 1/2. Para `products`, que necesitan leer
  todos los roles, vista `products_catalogo` sin columnas de coste (security invoker) y `revoke
  select (cost_cents, supplier_price_cents)` a `authenticated` con un GRANT por columnas.
- **Precaución:** el GRANT por columnas rompe cualquier `select("*")` sobre `products` que haga un
  rol no admin con el cliente RLS. Antes hay que inventariar las lecturas de `products` con
  `createClient()` **[NV, tarea del paso 7]**.
- Además, `getInventoryValuation` (`import-actions.ts:188`) y la pestaña Compras de
  `/almacenes/[id]` solo para nivel 1/2.
- Comerciales y cantidades de stock (P9 original): **sin decisión**, se dejan como hoy (A5).

### D9 — Furgonetas de Infinity (propuesta de cambio de datos, NO aplicada)

Situación [V, 12-11]:

| Almacén | id | Matrícula | Asignada hoy | Stock / movimientos |
|---|---|---|---|---|
| Furgoneta Sandro | `24fe5c7e-3bf1-452f-b15a-7ad61dc546ec` | 1722MXC | Sandro Rozalen Sotos (`93726251-5712-459f-b583-efd6e784cc48`, installer) ✔ | 0 / 0 |
| Furgoneta Orlando | `9a0f0e10-3d4a-4a46-ba78-4f1b8fef665c` | 8502NMK | Orlando Camin (company_admin) | 0 / 0 |
| Furgoneta Toni | `dcf2ac7c-8381-4b25-b99d-bab6ff2b88c3` | 6492MFZ | nadie | 1 producto con stock / 2 movimientos |

Fernando Andrés Forini = `90c2fae7-ea0b-44fd-b275-7c4b67785ef8` (installer, activo), hoy **sin
furgoneta**. Sandro ya está bien.

Propuesta (opción A, a falta de confirmar cuál es la furgoneta de Fernando, A6):

```sql
-- NO APLICADO. Con Mario delante, por la Management API.
update public.warehouses
   set assigned_user_id = '90c2fae7-ea0b-44fd-b275-7c4b67785ef8',
       name = 'Furgoneta Fernando', updated_at = now()
 where id = 'dcf2ac7c-8381-4b25-b99d-bab6ff2b88c3'
   and company_id = (select company_id from public.warehouses where id = 'dcf2ac7c-8381-4b25-b99d-bab6ff2b88c3');
-- ¿Y la «Furgoneta Orlando»? Opciones: dejarla con Orlando (no le afecta: es admin),
-- desasignarla o darla de baja (is_active=false). Pendiente A6.
```

Alternativa B: si la furgoneta física de Fernando es la de Orlando (8502NMK), reasignar esa (no
tiene stock ni movimientos, cambio limpio) y dejar la de Toni sin nadie. El stock que tenga la de
Toni pasará a «ser» de Fernando: comprobarlo físicamente.

### Preguntas A1–A7 (RESPONDIDAS el 12-11, ver más abajo)

- **A1.** ¿«Futuros» incluye los **atrasados sin cerrar**? Si no, hoy no verían a nadie.
- **A2.** Ámbar sin umbral configurado: ¿«queda 1» vale, o prefieres otro número (p. ej. ≤ 2)? ¿Lo
  configura la oficina por furgoneta?
- **A3.** Al registrar la carga, ¿puede el técnico ver «hay / no hay» en el almacén (sin cifras), o
  ni eso?
- **A4.** ¿Puede el técnico **devolver** material de la furgoneta al almacén él mismo?
- **A5.** ¿Los comerciales siguen viendo las **cantidades** de stock (no los costes)?
- **A6.** ¿Qué furgoneta (matrícula) lleva Fernando: la de Toni (6492MFZ) o la de Orlando (8502NMK)?
  ¿Qué se hace con la otra?
- **A7.** Menú del técnico: ¿quitamos Puntos, Mail, Comisiones y Rutas? (Era P7.)

### Respuestas de Mario a A1–A7 (12-11) — RESPONDIDAS

Mandan sobre lo escrito arriba en D3, D5-bis, D6, D7 y D9.

- **A1 ✔ Sí, cuentan los atrasados sin cerrar.** Regla definitiva: mantenimiento o instalación
  asignado a él y no cerrado (sea cual sea la fecha), o cerrado hace menos de 24 h. Es la función
  `app.cliente_pendiente_para_mi` tal y como está escrita arriba.

- **A2 ✔ El umbral del ámbar depende del producto.** Dónde se fija:
  1. **Por producto (obligatorio):** columna nueva `products.umbral_furgoneta integer null`
     (migración `…_umbral_furgoneta.sql`). Se edita en la ficha de producto, solo nivel 1/2, con la
     etiqueta «En furgoneta, avisar cuando queden ≤ N».
     - No reutilizo `products.low_stock_warning_threshold`: existe en BD pero **ningún código la
       usa** y en Infinity está a null en todos los productos. Su sentido es «alerta antes del mínimo
       del almacén», no de la furgoneta `[decide]`.
     - Tampoco `products.stock_min`: es el mínimo del almacén (hasta 10).
  2. **Por furgoneta (opcional, pisa al de producto):** `warehouse_stock_thresholds.stock_min`, que
     ya existe para (almacén, producto) y solo deja escribir a nivel 1/2. Se edita en la ficha de la
     furgoneta en `/almacenes/[id]`, vista de oficina.
  3. **Sin ninguno de los dos:** ámbar cuando queda 1 `[decide]`.

  Cálculo en servidor: `umbral = coalesce(umbral de la furgoneta, products.umbral_furgoneta, 1)`.
  Gris si la cantidad es 0, ámbar si es ≤ umbral, verde en otro caso. Al técnico solo le llega el
  color.

- **A3 ✔ Al cargar puede ver «hay / no hay» del almacén**, sin cantidades. La acción de servidor
  que sirve el catálogo de carga devuelve `hay_en_almacen: boolean` por producto (admin +
  `company_id`).

- **A4 ✔ Puede devolver material** de la furgoneta al almacén. Es la misma acción con
  `sentido: 'carga' | 'devolucion'`.
  - En devolución, el origen es siempre su furgoneta (forzado en servidor) y el destino el almacén.
  - El selector solo ofrece productos que la furgoneta tiene (verde o ámbar), sin cifras.
  - Si pide devolver más de lo que hay: error genérico sin decir cuánto queda.

- **A5 ✔ Los comerciales tampoco ven cantidades de stock.** M3 se amplía: el SELECT de
  `warehouse_stock`, `stock_lots`, `stock_movements`, `stock_reservations` y `stock_alerts` queda
  **solo para nivel 1/2** (y el técnico, solo vía las acciones de servidor). Hay que revisar si
  algún flujo comercial lee stock con el cliente RLS **[NV]**:
  - propuesta o contrato con disponibilidad;
  - `listProducts` (`products/actions.ts:85-88`, calcula `stock_total` con RLS): para un comercial
    saldría 0 sin error.

  Si hiciera falta disponibilidad en una propuesta, se sirve como «hay / no hay» por una acción con
  admin.

- **A6 ✔ Furgonetas:** Fernando → «Furgoneta Toni» (6492MFZ). La «Furgoneta Orlando» (8502NMK) la
  lleva Sandro. Orlando se queda sin furgoneta.
  **Comprobado con SELECT el 12-11:** Sandro tiene hoy asignada **otra**, la «Furgoneta Sandro»
  (1722MXC, activa, sin stock ni movimientos). **Pregunta B1: ¿qué se hace con la 1722MXC?** Dejarla
  sin asignar, darla de baja (`is_active = false`) o es un error de matrícula.
  SQL ajustado (**NO aplicado**; con Mario delante, por la Management API):

  ```sql
  begin;
  -- Fernando Andrés Forini → Furgoneta Toni (6492MFZ)
  update public.warehouses
     set assigned_user_id = '90c2fae7-ea0b-44fd-b275-7c4b67785ef8',
         name = 'Furgoneta Fernando', updated_at = now()
   where id = 'dcf2ac7c-8381-4b25-b99d-bab6ff2b88c3' and kind = 'vehicle';
  -- Sandro → Furgoneta Orlando (8502NMK); Orlando deja de tenerla
  update public.warehouses
     set assigned_user_id = '93726251-5712-459f-b583-efd6e784cc48',
         name = 'Furgoneta Sandro', updated_at = now()
   where id = '9a0f0e10-3d4a-4a46-ba78-4f1b8fef665c' and kind = 'vehicle';
  -- La antigua «Furgoneta Sandro» (1722MXC): según B1. Mínimo, desasignarla y renombrarla
  -- para que Sandro no tenga dos (auto-loading y Mi furgoneta cogen la primera que encuentran).
  update public.warehouses
     set assigned_user_id = null, name = 'Furgoneta 1722MXC', updated_at = now()
   where id = '24fe5c7e-3bf1-452f-b15a-7ad61dc546ec' and kind = 'vehicle';
  commit;
  ```

  Comprobación posterior: `select name, vehicle_plate, assigned_user_id from warehouses where
  kind = 'vehicle'` → cada técnico, exactamente una.
  Riesgo: el stock que quede en 6492MFZ (1 producto) pasa a figurar en la furgoneta de Fernando;
  conviene que lo confirme físicamente.

- **A7 ✔ Menú del técnico:** se quitan **Puntos y Mail**; **Comisiones y Rutas se quedan**. Menú
  final: Hoy · Agenda · Mis clientes · Instalaciones · Mantenimientos · Incidencias · Mi furgoneta ·
  Rutas (si el módulo está activo) · Comisiones · Fichajes · Gastos · Chat.
  - Comisiones: `commissions` no tiene fila en `modules_catalog`, así que hoy no aparece en el
    menú del técnico. Hay que revisarlo al implementar **[NV]**.

**B1 ✔ RESPONDIDA (12-11):** la 1722MXC se queda SIN ASIGNAR (se podrá reasignar después). Se mantiene el SQL propuesto. **El plan queda sin preguntas abiertas.**

### Orden de implementación (sustituye al §6)

1. **Arreglos previos sin cambio de permisos**: búsqueda del almacén con admin en
   `completeMaintenanceAction`; solicitudes de carga con admin; `x-pathname` en el middleware; rol en
   traspaso y valoración.
2. **Asignación obligatoria** en las acciones de campo (firma, inicio y cierre de instalación;
   inicio y cierre de mantenimiento) y guard de la ficha `/mantenimientos/[id]`.
3. **Clientes pendientes** (regla D3 + D4) en el listado, la ficha, Mi día y la ficha de
   instalación y mantenimiento, con contacto leído con admin. Nombres de cliente en
   `/mantenimientos`.
4. **Mi furgoneta** (semáforo D5) + **Registrar carga** (D6) + menú, barra inferior e inicio en
   `/mi-dia`, sin Almacenes, «+ Lead» ni Configuración.
5. **Datos D9** (furgonetas), con Mario delante.
6. **RLS** M1–M3: `customers` abre los pendientes; `maintenance_jobs` solo los suyos; almacenes y
   stock cerrados y sin escritura directa del técnico. Smoke test con el JWT de Sandro o Fernando
   y Mario delante, porque no hay cuenta de prueba (D8).
7. **Costes D7** (inventario de lecturas de `products`, vista y GRANT por columnas).

---

**Importante [V]:** en el sistema **no existe un rol «técnico» distinto de «instalador»**.
`roles_catalog` tiene `installer` («Instalador», nivel 3, departamento `tech`) y
`technical_director` (nivel 2). En este documento, «técnico» = `installer`.

---

## 1. Cifras de producción [V]

| Empresa | Roles activos (user_roles) |
|---|---|
| INIFINITY AQUA | 3 company_admin · 3 sales_rep · **2 installer** |
| TMK | 1 company_admin · **2 installer** |
| aquaroo | 2 company_admin · 1 sales_rep |
| Naturquea / Demo Revisión | 1 company_admin cada una |

Nadie tiene dos roles a la vez. No hay `permission_overrides` (0 filas).

**Furgonetas (`warehouses.kind = 'vehicle'`) — solo en INIFINITY AQUA:**

| Furgoneta | Asignada a | Filas de stock |
|---|---|---|
| Furgoneta Sandro | installer `93726251…` | 0 |
| Furgoneta Orlando | company_admin `83c9b880…` | 0 |
| Furgoneta Toni | nadie | 1 (con stock) |

El otro instalador de Infinity (`90c2fae7…`) **no tiene furgoneta**. TMK tiene 2 instaladores y
**ningún almacén**, sin trabajos asignados. Almacenes principales: «Andratx» (17 productos, Infinity)
y «PRINCIPAL» (1 producto, aquaroo).

**Trabajo de los instaladores de Infinity:**

| Instalador | Mant. abiertos | Instal. abiertas | Agenda abierta | **Clientes distintos «pendientes»** |
|---|---|---|---|---|
| 93726251 | 19 | 0 | 84 (19 de cliente, 2 de mantenimiento, resto de lead) | **37** |
| 90c2fae7 | 14 | 0 (1 total) | 37 (7 de cliente, 8 de mantenimiento, resto de lead) | **23** |

Ojo: **los 121 eventos de agenda de los instaladores están en estado `scheduled` y con fecha
pasada**. Nadie los cierra, así que si «pendiente» incluye la agenda, la lista no se vacía nunca
(ver P3). Además, 76 eventos de instaladores son de **leads**, no de clientes.

`maintenance_jobs` de Infinity: 159 programados sin técnico, 31 programados con técnico,
102 preprogramados, 2 en curso y 43 completados.

---

## 2. Estado actual

### 2.1 Cómo funcionan roles y permisos

- **Sesión** — `shared/lib/auth/session.ts:59-160`. Lee los roles del JWT y los **reconcilia con
  `user_roles`** (:103-122), así que en la app los roles siempre están frescos.
- **Niveles** — `shared/lib/auth/role-scope.ts`:
  - `resolveVisibleUserIds` (:21-54): nivel 1 → todo; nivel 2 → su equipo; nivel 3 → solo él.
  - `hasActiveTaskForCustomer` (:69-122): agenda (solo `subject_type='customer'`), instalación o
    mantenimiento asignado y no `completed/cancelled`. Lee siempre con admin.
- **Menú** — `shared/lib/modules.ts:61-148`, con `rolesAllowed` por módulo:
  - `FIELD_ROLES = nivel 1/2 + installer` (:69).
  - Clientes: `SALES_ROLES`, **sin installer** (:80).
  - Almacenes: `FIELD_ROLES` (:116).
- **Guard por ruta del layout** — `app/(tenant)/layout.tsx:61-85`. **Es débil:** depende de las
  cabeceras `x-invoke-path`/`next-url`/`x-pathname`, y el middleware (`middleware.ts`,
  `shared/lib/supabase/middleware.ts`) no fija ninguna. En carga directa por URL probablemente no
  actúa **[NV en ejecución]**.
- **Guard por página** — `requireModuleAccess` (`shared/lib/auth/module-guard.ts:135-142`). Solo
  algunas páginas lo usan.
- **RLS en BD:**
  - `app.can()` lee `user_roles` + `role_permissions` + overrides (fresco).
  - `app.has_role()` lee el **claim `roles` del JWT** (`app.current_user_roles()`), que solo se
    renueva al volver a iniciar sesión. Mezcla dos fuentes con frescura distinta. **[V]**
- **Permisos del installer** (`role_permissions`) [V]: dashboard/agenda view own,
  **products view all_company**, warehouses view own, installations view/update own,
  maintenance view/update own, incidents view/create own, wallet create own, notifications view.
  **No tiene `customers`.**

### 2.2 Políticas RLS reales en producción [V] (pg_policies)

| Tabla | SELECT | Escritura del installer |
|---|---|---|
| `customers` | Por `app.can('customers',…)`. La rama `has_role('installer') AND EXISTS(… WHERE false)` **no abre nunca nada** → el installer no ve ningún cliente | — |
| `addresses` | Hereda de `customers` con EXISTS → 0 para el installer | — |
| `customer_equipment` | Toda la empresa (migración `20260501121700…sql:209`) | — |
| `maintenance_jobs` | **Toda la empresa** | **ALL** (incluye DELETE) para installer **y sales_rep** |
| `installations` | Solo las suyas y **no** completed/cancelled | UPDATE solo las suyas |
| `incidents` | Toda la empresa | ALL |
| `warehouses` | **Toda la empresa** | **ALL** |
| `warehouse_stock` | **Toda la empresa, con cantidades** | **ALL** |
| `stock_movements` / `warehouse_locations` / `stock_reservations` / `loading_requests(_items)` | Toda la empresa | ALL |
| `stock_lots` (con `unit_cost_cents`) / `stock_counts` | Toda la empresa | ALL |
| `stock_alerts` / `warehouse_stock_thresholds` / `filter_stock` | Toda la empresa | No |
| `products` (con `cost_cents`, `supplier_price_cents`) | Toda la empresa | No |

**Consecuencia:** aunque la UI se lo escondiera, con su JWT un instalador puede leer por PostgREST
(`/rest/v1/warehouse_stock`) el stock de todos los almacenes y los costes de compra. Y **puede
escribir** stock, almacenes, movimientos y lotes de cualquier almacén de su empresa, y borrar
cualquier mantenimiento. No hay fuga entre empresas: todo va acotado por `company_id`.

### 2.3 Qué ve hoy un instalador, pantalla a pantalla [V salvo marca]

**Entrada.** El login lleva a `/` y `app/page.tsx:17` redirige a **`/dashboard`** a todo el que no es superadmin.

**Cabecera** (`shared/components/header.tsx`):
- Hamburguesa, buscador global, reloj de fichaje y campana.
- **Botón «+ Lead» para todos** (:113-120). Solo aparece desde `sm`, así que en 390 px no se ve.
  Leads no está permitido al installer.
- El menú de usuario lleva a «Configuración», que es solo de company_admin.

**Menú lateral** (con los módulos por defecto):
- Dashboard, Mi día, Agenda.
- **Almacenes**.
- Instalaciones, Mantenimientos, Incidencias (y Rutas si está activo).
- Fichajes, Mis gastos, Chat, Puntos.
- Mail.

**Barra inferior móvil** (`modules.ts:164-172`): agenda, instalaciones, mantenimientos, mi día,
dashboard, avisos, y un botón fijo «Editar» (`bottom-nav.tsx:207-215`).

**/dashboard** (`app/(tenant)/dashboard/page.tsx:343-515`, «vista personal»). **Es de comercial:**
- Mi venta del mes, Total empresa del mes, Mis leads, Mis clientes, Mis contratos, Mis
  instalaciones, Mi venta del año.
- Objetivos, ranking de puntos y gráfico de ventas.
- Al final, próximas instalaciones y mantenimientos (:491-492).

Ese es el «ruido al principio».

**/mi-dia** (`app/(tenant)/mi-dia/page.tsx`):
- Lista del día con Llamar, WhatsApp, Iniciar parte y Ruta, más el mapa.
- **Nombre, teléfono y dirección del cliente se leen con RLS** (`modules/my-day/actions.ts:41,
  111-113, 143-146`), así que salen «Cliente», sin teléfono y sin dirección.
- Es una de las causas directas de «no ven al cliente».

**/agenda.** Resuelve nombre, teléfono y dirección **con admin** (`modules/agenda/actions.ts:380-622`),
así que aquí **sí** los ve. El evento enlaza a `/clientes/{id}`
(`modules/agenda/move-event-dialog.tsx:212-215`).

**/clientes** (`app/(tenant)/clientes/page.tsx:22-33`):
- No está en su menú. Por URL, lista vacía: RLS más filtro `assigned_user_id = él`
  (`modules/customers/actions.ts:24-63`).
- Ve igualmente «Exportar CSV» y «+ Nuevo cliente».

**/clientes/[id]:**
- Entra **solo mientras tenga una tarea activa** (`clientes/[id]/page.tsx:75-126`, relee con admin
  :86-98).
- Direcciones por fallback admin (:138-150).
- Se le pintan botones que no le tocan: Nueva propuesta, Contrato directo, Calcular, Prueba, Editar
  datos, Añadir equipo, Etiquetas (:361-711).
- Con la tarea completada, 404.

**/instalaciones/[id]:**
- Solo las suyas (`:82-90`).
- Nombre y DNI desde el snapshot del contrato.
- **Teléfono, email y dirección con RLS → vacíos** (:263-302, la tarjeta los oculta :525-558).
- Enlace «Ver ficha del cliente» (:515-521).

**/mantenimientos** (`app/(tenant)/mantenimientos/page.tsx:73-77`):
- **Solo los suyos**, filtrados en código en `modules/maintenance/actions.ts:381-383`
  (`.eq("technician_user_id", session.user_id)`), con un límite de 200 (:369).
- **El nombre del cliente sale «—»** porque se resuelve con RLS (:404-407).
- Ve los KPIs y la tabla de contratos de mantenimiento
  (`modules/maintenance-plans/actions.ts:53-72`).
- Aparte: el guard deja fuera a commercial_director aunque el menú lo incluye.

**/mantenimientos/[id]:**
- **Sin guard de asignación:** puede abrir cualquier mantenimiento de su empresa.
- Nombre y dirección con RLS → «—» (`[id]/page.tsx:37-53, 125-144`).
- Ve Iniciar/Completar en trabajos ajenos (:337-349).

**/almacenes** (`app/(tenant)/almacenes/page.tsx`, solo `assertModuleActive` :20). Ve:
- **Todos** los almacenes y furgonetas.
- **Cantidades por almacén** (:206).
- **Valoración del inventario en €** (:161-199, `getInventoryValuation` con admin sin comprobar rol,
  `modules/warehouses/import-actions.ts:188-210`).
- Alertas de stock de toda la empresa.
- Todas las solicitudes de carga, con «Entregar» y «Crear solicitud».

**/almacenes/[id]** (solo `requireSession` :55):
- Cualquier almacén, con todas las pestañas: stock, ubicaciones, compras con `cost_cents`, lotes,
  reservas y traspaso (`modules/warehouses/warehouse-detail-tabs.tsx:140-145`).
- `canManageLots = true` (:58-62).

**Acciones de almacén:**
- **Traspaso entre dos almacenes cualesquiera sin control de rol**
  (`modules/warehouses/transfer-actions.ts:21-43`).
- Ajuste y fijación de stock (`inventory-actions.ts:12-19`), conteos y lotes.

**/productos y /productos/[id].** No están en su menú, pero las páginas no comprueban rol. En la
ficha, el no-admin ve «✓/—» por almacén (`modules/products/stock-panel.tsx:193-197`). **Ese patrón
es justo lo que pide Mario para la furgoneta.**

### 2.4 Por qué no ven a su cliente (resumen)

1. Clientes no está en su menú (`modules.ts:80`) y el listado solo mira `assigned_user_id`.
2. La RLS de `customers` no abre nada al installer, y `addresses` hereda ese cero.
3. Mi día, la ficha de instalación, la lista y la ficha de mantenimiento leen nombre, teléfono y
   dirección **con el cliente RLS** → salen vacíos. Solo Agenda los lee con admin.
4. `hasActiveTaskForCustomer` no cuenta los eventos de agenda con `subject_type='maintenance'`, y
   la ficha da 404 en cuanto la tarea se cierra.

### 2.5 Cerrar y firmar partes (lo que no se puede romper) [V]

- **Instalación:**
  - Firma: `saveInstallationSignatureAction` (`modules/installations/client-actions.ts:199-214`).
  - Cierre: `finishInstallationAction` (`wizard-actions.ts:767-790`) → `completeInstallation`
    (`actions.ts:1500+`).
  - Todo **con admin** tras `assertInstallationCompany` (`ownership.ts:18-46`), que solo comprueba
    la empresa, **no la asignación**.
- **Mantenimiento:** `startMaintenanceAction` (`maintenance/actions.ts:327-355`, admin) y
  `completeMaintenanceAction` (:585-629: select RLS + update admin). No comprueban ni rol ni
  asignación. No hay firma del cliente en mantenimiento.
- **Descuento de stock:**
  - Instalación: admin (`warehouses/stock-decrement.ts:180-219`).
  - Prueba gratuita, retirada y desinstalación: admin.
  - **Mantenimiento: busca el almacén con el cliente RLS** (`maintenance/actions.ts:666-686`).
    Primero la furgoneta del técnico (`assigned_user_id`, sin filtrar `kind`) y, si no la
    encuentra, el `main` de la empresa. **Si se endurece la RLS sin cambiar esto, el recurso al
    almacén principal devolverá null y no se descontará nada, sin error.**
- **Carga de furgoneta:**
  - Automática por el cron: admin (`warehouses/auto-loading.ts:29,118,133`).
  - Manual: `createLoadingRequestAction` escribe con **RLS** (`loading-request-actions.ts:28-62`)
    y `cancelLoadingRequestAction` también, **sin filtrar `company_id`** (:224-234). La RLS lo
    acota igualmente.
  - Entregar: `deliverLoadingRequestAction` admite al installer (:72-78) y mueve con admin.
  - Aviso al fichar: admin (`time-tracking/actions.ts:100-110`).
- **Navegador.** Ningún componente cliente lee tablas de stock con supabase-js. Solo chat y storage
  (`installations/tech-prep-card.tsx:99`). Endurecer la RLS solo afecta a lecturas de servidor con
  `createClient()`.

---

## 3. Matriz propuesta rol × pantalla/dato

`installer` cambia; los demás roles **no cambian** salvo lo marcado.

| Pantalla / dato | installer (propuesto) | installer (hoy) | technical_director | company_admin | sales_rep |
|---|---|---|---|---|---|
| Pantalla de inicio | **/hoy** (Mi día limpio) | /dashboard de ventas | /dashboard | /dashboard | /dashboard |
| Clientes (menú) | **Sí: solo «pendientes conmigo»**, solo lectura + Llamar/WhatsApp/Cómo llegar | No | Todos | Todos | Suyos |
| Ficha de cliente | **Solo los pendientes**: datos de contacto, direcciones, equipos e historial técnico. Sin propuesta, contrato, calculadora, prueba ni edición de datos | Solo con tarea activa, con todos los botones | Igual que hoy | Igual que hoy | Igual que hoy |
| Mantenimientos (lista) | **Todos los de su empresa**, con nombre y población del cliente; filtro «Míos» por defecto (P2) | Solo los suyos y sin nombre | Todos | Todos | No |
| Mantenimiento ajeno: Iniciar/Completar | **No** (solo el asignado; nivel 1/2 sí) | Sí (agujero) | Sí | Sí | — |
| Instalaciones | Las suyas (igual) + contacto del cliente visible | Las suyas sin contacto | Todas | Todas | — |
| Firma/cierre de instalación | Solo la asignada | Cualquiera de la empresa | Sí | Sí | — |
| Almacenes (menú, /almacenes, /almacenes/[id]) | **No** | Todos con cantidades y € | Igual | Igual | No |
| Mi furgoneta | **Sí: lista de productos con punto verde (hay) / gris (no hay), sin cifras** | No existe | Ve cantidades | Ve cantidades | No |
| Cantidades de stock por API | **No** (RLS) | Sí, de todos los almacenes | Sí | Sí | Sí (hoy, ver P9) |
| Costes (`cost_cents`, `unit_cost_cents`, valoración) | **No** (P8) | Sí | Sí | Sí | Sí (hoy) |
| Escribir stock/almacenes/lotes por API | **No** (solo vía acciones de servidor) | Sí | Sí | Sí | No |
| Solicitudes de carga | Solo las de **su** furgoneta: ver y confirmar recepción (P6) | Todas | Todas | Todas | No |
| Productos / Leads / Ventas / Objetivos / Comisiones / Mail / Puntos | No (P7 para Puntos, Mail y Comisiones) | Parte | Sí | Sí | Sí |
| Botón «+ Lead» de la cabecera | **No** | Sí (desde `sm`) | Sí | Sí | Sí |
| Fichajes, Gastos, Chat, Incidencias, Agenda | Sí (sin cambio) | Sí | Sí | Sí | Sí |

---

## 4. Definición de «cliente con algo pendiente conmigo»

Un cliente `C` es pendiente para el usuario `U` de la empresa `E` si existe al menos una de estas
condiciones, todas con `company_id = E`:

| Origen | Condición | ¿Incluir? |
|---|---|---|
| `installations` | `installer_user_id = U`, `deleted_at is null`, `status not in (completed, cancelled)` | Sí |
| `maintenance_jobs` | `technician_user_id = U`, `status not in (completed, cancelled)` | Sí |
| `incidents` | `assigned_user_id = U`, `status not in (resolved, closed, cancelled)` | Sí `[decide]` |
| `free_trials` | `assigned_installer_user_id = U`, `status in (draft, scheduled, installed)`, con `customer_id` | Sí `[decide]` |
| `agenda_events` | `assigned_user_id = U`, `subject_type in ('customer','maintenance')`, `status in (scheduled, in_progress, rescheduled)`, `deleted_at is null`, **`starts_at >= now() - interval '7 days'`** | Ver P3 |

**Margen de gracia:** propongo seguir viendo al cliente **48 h** después de cerrar la tarea
(`completed_at`/`updated_at`), para poder volver a llamar o consultar tras el parte (P4).

Fuente única: una función SQL `app.clientes_pendientes_de(U)` (security definer, solo lectura)
usada **por la RLS y por la app**, para que no vuelva a pasar lo de la memoria
`postgrest-limites-y-scope` (app y policy mirando columnas distintas). `hasActiveTaskForCustomer`
pasaría a llamar a esa misma regla.

Con la regla sin agenda, hoy serían 19 clientes y 14 clientes en Infinity. Con la agenda completa
(sin ventana), 37 y 23.

---

## 5. Cambios propuestos

### 5.1 Base de datos (migraciones propuestas, **NO aplicadas**)

**M1 — `20261112100000_permisos_tecnico_funciones.sql`**

```sql
-- ¿El usuario actual es solo técnico (installer sin nivel 1/2)? Lee user_roles (fresco), no el JWT.
create or replace function app.es_solo_tecnico() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid() and ur.company_id = app.current_company_id()
                    and ur.revoked_at is null and ur.role_key = 'installer')
     and not exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid() and ur.company_id = app.current_company_id()
                    and ur.revoked_at is null
                    and ur.role_key in ('company_admin','technical_director',
                                        'commercial_director','telemarketing_director','sales_rep'))
$$;

-- Clientes con algo pendiente para el usuario actual (regla del §4).
create or replace function app.cliente_pendiente_para_mi(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from installations i where i.company_id = app.current_company_id()
          and i.customer_id = p_customer_id and i.installer_user_id = auth.uid()
          and i.deleted_at is null and i.status not in ('completed','cancelled'))
      or exists (select 1 from maintenance_jobs m where m.company_id = app.current_company_id()
          and m.customer_id = p_customer_id and m.technician_user_id = auth.uid()
          and m.status not in ('completed','cancelled'))
      or exists (select 1 from incidents n where n.company_id = app.current_company_id()
          and n.customer_id = p_customer_id and n.assigned_user_id = auth.uid()
          and n.status not in ('resolved','closed','cancelled'))
      or exists (select 1 from free_trials f where f.company_id = app.current_company_id()
          and f.customer_id = p_customer_id and f.assigned_installer_user_id = auth.uid()
          and f.status in ('draft','scheduled','installed'))
      -- agenda: según la respuesta a P3
$$;
revoke all on function app.es_solo_tecnico(), app.cliente_pendiente_para_mi(uuid) from public, anon;
grant execute on function app.es_solo_tecnico(), app.cliente_pendiente_para_mi(uuid) to authenticated;
```

Riesgo: `cliente_pendiente_para_mi` se evalúa por fila en la RLS de `customers` (1798 filas en
Infinity, según la memoria). Hacen falta índices en `maintenance_jobs(technician_user_id, customer_id)`,
`installations(installer_user_id, customer_id)` e `incidents(assigned_user_id, customer_id)`.
Comprobar antes con `pg_indexes` **[NV]**.

**M2 — `customers` (abrir lectura de pendientes):** sustituir la rama muerta
`has_role('installer') AND EXISTS(… WHERE false)` de `customers_select_by_scope` por
`(app.es_solo_tecnico() AND app.cliente_pendiente_para_mi(customers.id))`. `addresses` lo hereda
solo, sin tocarla. UPDATE no cambia: el técnico no edita clientes.

**M3 — almacenes y stock (cerrar), para el «solo técnico»:**

- `warehouses` SELECT: `company_id = current AND (not app.es_solo_tecnico() OR (kind = 'vehicle'
  AND assigned_user_id = auth.uid()))`.
- `warehouse_stock`, `stock_lots`, `stock_movements`, `stock_reservations`,
  `warehouse_locations`, `warehouse_stock_thresholds`, `stock_alerts`, `stock_counts`,
  `stock_count_items`: añadir `AND NOT app.es_solo_tecnico()` al SELECT. **Cero filas: ni siquiera
  las cantidades de su furgoneta.** El verde/gris se sirve por la RPC de M4.
- `loading_requests(_items)` SELECT: el técnico solo las de destino su furgoneta.
- **Quitar `installer` de las políticas `*_modify` (ALL)** de warehouses, warehouse_stock,
  stock_movements, stock_lots, warehouse_locations, stock_reservations y stock_counts. Todas las
  mutaciones del flujo del técnico pasan ya por acciones de servidor con admin (§2.5), **salvo**
  `createLoadingRequestAction` y `cancelLoadingRequestAction`, que se pasan a admin en el paso 2.
  En `loading_requests_modify` el técnico queda limitado a sus filas.
- `maintenance_jobs_modify` (ALL): separar en UPDATE (installer y sales_rep solo si
  `technician_user_id = auth.uid()`) y **DELETE solo nivel 1/2**. SELECT de toda la empresa se
  queda como está (es lo que pide Mario).

**M4 — RPC `public.mi_furgoneta_semaforo()`** (security definer, `authenticated`). Devuelve
`(product_id, nombre, sku, hay_stock boolean)` de los productos con fila en la furgoneta
`kind = 'vehicle' AND assigned_user_id = auth.uid() AND company_id = app.current_company_id()`.
**Nunca devuelve `quantity`.** Alternativa sin RPC: acción de servidor con admin que filtra
`company_id` y `assigned_user_id` y mapea a booleano (patrón ya usado en la app). `[decide]`:
acción de servidor con admin. Es más simple y no añade otra RPC en `public` que blindar (lección C1).

**M5 — `products` (costes):** decidir según P8. Opciones:
(a) vista `products_publico` sin `cost_cents`/`supplier_price_cents` y SELECT de la tabla solo para
nivel 1/2;
(b) dejarlo como está y ocultarlo solo en la UI.
`(a)` toca muchas lecturas: hay que hacer inventario antes **[NV]**.

### 5.2 Servidor (código)

1. **Helper `esSoloTecnico(session)`** en `shared/lib/auth/role-scope.ts` (installer sin nivel 1/2
   ni sales_rep). **Helper `listarClientesPendientes(session)`** con admin y `company_id`, misma
   regla que M1. `hasActiveTaskForCustomer` (:69-122) pasa a usarla y añade la agenda de
   `subject_type='maintenance'`.
2. **Clientes:**
   - `listCustomers` (`modules/customers/actions.ts:24-63`): si `esSoloTecnico`, `.in("id",
     pendientes)` sobre admin + `company_id`, o sobre RLS una vez aplicada M2.
   - Ficha `clientes/[id]/page.tsx:109-126`: misma regla más el margen de 48 h.
3. **Mantenimientos:**
   - Quitar el filtro `technician_user_id` de `listMaintenance` (`maintenance/actions.ts:381-383`)
     y sustituirlo por el filtro «Míos/Todos» de la UI.
   - Nombres de cliente con admin + `company_id` (:404-407; `[id]/page.tsx:37-53, 125-144`).
   - **Paginar**: con «todos», el `limit(200)` (:369) se queda corto (Infinity tiene 340 trabajos);
     usar `fetchAllRows` o paginación real.
4. **Comprobar la asignación en las acciones de campo** (nivel 3 → `technician_user_id` /
   `installer_user_id = user`; nivel 1/2 libre):
   - `startMaintenanceAction` (:327) y `completeMaintenanceAction` (:585).
   - `assertInstallationCompany` → nuevo `assertInstallationAssignee` en `installations/ownership.ts`,
     usado por la firma, el inicio y el cierre (`client-actions.ts:199`,
     `wizard-actions.ts:40, 293-790`).
5. **Antes de M3 (obligatorio):**
   - `completeMaintenanceAction` debe buscar el almacén **con admin** + `company_id`
     (`maintenance/actions.ts:666-686`) y filtrar `kind = 'vehicle'` en la primera búsqueda.
   - `createLoadingRequestAction` / `cancelLoadingRequestAction` → admin + `company_id` + rol
     (`loading-request-actions.ts:36, 227`).
   - Barrido completo de `createClient()` que lean tablas de stock en rutas que usa el técnico. Lista
     de partida: `installations/actions.ts` (:125, 179, 494-660, 1247), `free-trials/actions.ts`,
     `warehouses/*` **[NV caso a caso]**.
6. **Almacenes:**
   - `requireModuleAccess(session, ["company_admin","technical_director"])` en `/almacenes`,
     `/almacenes/[id]`, `/almacenes/conteo/[id]` y `/productos(/[id])` para el técnico.
   - Rol en `transferStockAction` (`transfer-actions.ts:21`) y `getInventoryValuation`
     (`import-actions.ts:188`).
7. **Mi furgoneta:** acción `listarMiFurgonetaSemaforo()` (admin, `company_id` + `assigned_user_id`
   + `kind='vehicle'`) que devuelve solo `hay_stock`.
8. **Guard del layout:** fijar `x-pathname` en `shared/lib/supabase/middleware.ts` para que
   `layout.tsx:61-85` funcione de verdad. Aun así, cada página sensible lleva su
   `requireModuleAccess` (el layout no se re-renderiza en navegación cliente).
9. **Inicio:** `app/page.tsx:17` → si `esSoloTecnico`, `redirect("/mi-dia")`. Si un técnico entra a
   `/dashboard`, también a `/mi-dia`. Mi día lee el contacto del cliente con admin + `company_id`
   (`my-day/actions.ts:111-146`) solo para los ítems que ya son suyos.

### 5.3 Interfaz (móvil primero, 390 px)

- **Menú del técnico** (`modules.ts`): Hoy (mi día) · Agenda · **Clientes** (rolesAllowed + installer,
  etiqueta «Mis clientes») · Instalaciones · Mantenimientos · Incidencias · **Mi furgoneta** (nueva
  entrada `/mi-furgoneta`, solo installer) · Fichajes · Gastos · Chat.
  - Fuera: Dashboard, **Almacenes**, Mail, Puntos y Comisiones (P7).
- **Barra inferior por defecto** (`defaultBottomNavKeysForRoles` :164): **Hoy · Agenda · Clientes ·
  Mantenim. · Furgoneta**, con 5 huecos. Avisos ya está en la campana de la cabecera.
  - Ojo: las preferencias guardadas en `localStorage` (`bottom-nav.tsx:32, 67-90`) pisan el nuevo
    valor por defecto en móviles que ya lo personalizaron. Propongo una versión de la clave para
    reiniciarlas una vez `[decide]`.
- **Cabecera:**
  - Ocultar «+ Lead» al técnico (header.tsx:113).
  - En el menú de usuario, ocultar «Configuración» a quien no es company_admin.
- **/clientes para el técnico:**
  - Lista de tarjetas: nombre, población y el «por qué» (p. ej. «Mantenimiento 14/11», «Instalación
    pendiente»), más tres acciones grandes: Llamar, WhatsApp y Cómo llegar.
  - Sin Exportar, sin Nuevo y sin filtros de comercial.
- **Ficha de cliente para el técnico:**
  - Se quedan contacto, direcciones, equipos e historial de mantenimientos/instalaciones.
  - Se ocultan Nueva propuesta, Contrato directo, Calcular, Prueba, Editar datos, Etiquetas, Añadir
    equipo y Consentimientos (`clientes/[id]/page.tsx:361-757`).
- **/mantenimientos para el técnico:**
  - Pestañas «Míos» (por defecto) / «Todos».
  - Sin KPIs de empresa ni tabla de contratos de mantenimiento (:178-195).
  - En un trabajo ajeno: solo lectura, sin Iniciar/Completar.
- **/mi-furgoneta:**
  - Encabezado con el nombre y la matrícula de la furgoneta.
  - Lista de productos con un punto **verde = hay** y gris = «no queda», más un buscador.
  - Sin números.
  - Sin furgoneta asignada: estado vacío «No tienes furgoneta asignada; habla con la oficina».
    Hoy es el caso de 1 de 2 instaladores de Infinity y de los 2 de TMK.
  - Y si hay solicitud de carga para su furgoneta: tarjeta «Carga para mañana» (P6).
- Verlo todo a **390 px** con una cuenta de técnico real o de prueba antes de darlo por bueno. El
  autologin local es de superadmin (memoria `marco-movil-rediseno`), así que hará falta un usuario
  installer de prueba (P10).

---

## 6. Orden de implementación

Cada paso es un commit (= despliegue): `tsc` + `next lint` antes, y comprobar que Vercel sale
Ready (memorias `commit-es-deploy` y `lint-antes-de-commit`).

1. **Arreglos previos que no cambian permisos** (sin riesgo):
   - Búsqueda del almacén con admin en `completeMaintenanceAction`.
   - Solicitudes de carga con admin y rol.
   - Rol en traspaso y valoración.
   - `x-pathname` en el middleware.
2. **Comprobación de asignación en las acciones de campo** (§5.2.4). Probar firma y cierre de una
   instalación y un mantenimiento con el técnico asignado, y con uno no asignado, que debe dar error.
3. **Clientes pendientes en código** (helper + listado + ficha + Mi día/instalación/mantenimiento
   leyendo contacto con admin). Esto ya resuelve «no ven al cliente» **sin tocar la RLS**.
4. **Mantenimientos «todos»** (quitar el filtro, nombres con admin, paginación, pestañas, sin
   Iniciar/Completar en ajenos).
5. **Mi furgoneta + menú + barra inferior + inicio en /mi-dia + quitar Almacenes, «+ Lead» y
   Configuración.**
6. **Migraciones M1–M3** (RLS), aplicadas por la Management API con Mario delante. Antes, escaneo de
   índices y de `pg_policies`. Después, smoke test con el JWT de un técnico:
   - `/rest/v1/warehouse_stock` → `[]`.
   - `/rest/v1/warehouses` → solo su furgoneta.
   - `/rest/v1/customers` → solo sus pendientes.
   - Intento de PATCH a `warehouse_stock` → 0 filas o 42501.
   - Y una carga de furgoneta más el cierre de un mantenimiento con recambio de punta a punta.
7. **M5** (costes de productos), según P8.

Sin los pasos 1 y 2, la RLS del paso 6 rompe silenciosamente el descuento de recambios del
mantenimiento.

---

## 7. Riesgos

- **Descuento de stock silencioso** al cerrar un mantenimiento si M3 llega antes del paso 1
  (`maintenance/actions.ts:679-686`).
- **`has_role` lee el JWT y `app.can`/`user_roles` no.** Un técnico al que se cambie de rol
  conserva el anterior en la RLS hasta que vuelva a iniciar sesión. Por eso M1 usa `user_roles`.
- **Rendimiento** de `cliente_pendiente_para_mi` evaluada por fila de `customers` (índices, §5.1).
- **Fugas entre empresas.** Toda lectura nueva con admin lleva `.eq("company_id", session.company_id)`.
  Las funciones SQL filtran por `app.current_company_id()`. Las RPC nuevas de `public` llevan
  `revoke` de public/anon (lección C1).
- **Agenda nunca cerrada** (121 eventos `scheduled` en el pasado): o se acota por fecha o el técnico
  verá clientes viejos para siempre.
- **Dos usuarios con furgoneta y rol admin** (Furgoneta Orlando → company_admin): no les afecta,
  `es_solo_tecnico` es false.
- **Un técnico que también sea comercial** (hoy ninguno): `es_solo_tecnico` = false → conserva la
  vista amplia. Es lo esperado, pero conviene confirmarlo (P11).
- **El límite de 1000 de PostgREST** al listar todos los mantenimientos: usar `fetchAllRows` con
  `.order(...,"id")`.
- **El botón «Editar» de la barra inferior y las preferencias guardadas** pueden hacer que el
  técnico no vea el menú nuevo.
- **Los otros agentes en paralelo** (mantenimientos de Infinity, modelo de equipo por cliente,
  mantenimientos incluidos, leads) tocan `maintenance/actions.ts` y la ficha de cliente: hay que
  coordinar los conflictos de merge antes del paso 3–4.

---

## 8. Preguntas para Mario

1. **¿«Técnico» e «instalador» son la misma persona/rol?** Hoy solo existe `installer`. ¿Quieres un
   rol nuevo «Técnico de mantenimiento» distinto, o vale con uno?
2. **Mantenimientos «ver todos»:** ¿también con **teléfono y dirección** de los clientes que no son
   suyos (para cubrir a un compañero), o solo nombre y población, y el contacto completo solo en los
   suyos? ¿Pueden **coger** un mantenimiento sin técnico asignado o solo mirarlo? Hay 159 programados
   sin técnico.
3. **Agenda como «pendiente»:** los eventos de agenda de los técnicos no se cierran nunca (121 en el
   pasado, aún «programados»). ¿Cuentan las citas de agenda, y en ese caso solo las de los próximos
   días o la última semana, o solo instalaciones, mantenimientos, incidencias y pruebas?
4. Tras cerrar el trabajo, ¿el técnico **sigue viendo al cliente un tiempo** (propongo 48 h) o deja
   de verlo al instante?
5. **Furgoneta:** ¿solo verde/gris, o también **ámbar «queda poco»** usando el mínimo
   (`min_quantity`)? ¿Se listan solo los productos que tiene la furgoneta o todo el catálogo con su
   punto?
6. **Carga de furgoneta:** hoy cualquier técnico puede pulsar «Entregar» en cualquier solicitud (saca
   stock del almacén principal). ¿Quién debe hacerlo: la oficina o almacén, y el técnico solo
   «confirmo que lo he recibido»? ¿Puede el técnico **pedir** carga?
7. ¿Qué más quitamos del menú del técnico: **Puntos, Mail, Comisiones, Rutas**? ¿Y el Dashboard del
   todo, o un dashboard mínimo?
8. **Costes:** hoy cualquier usuario (también comerciales) puede leer por la API el precio de coste
   y de proveedor de los productos. ¿Lo cerramos solo para técnicos o también para comerciales?
9. ¿El **comercial** debe seguir viendo cantidades de stock de los almacenes (hoy puede por API)?
10. Para probar a 390 px hace falta una **cuenta de técnico de prueba**. ¿Creo un usuario installer
    en «Demo Revisión» o usamos uno de TMK?
11. Si algún día un usuario es **técnico y comercial** a la vez, ¿manda la vista amplia (comercial)
    o la de técnico?
12. Los técnicos de **TMK** no tienen ningún almacén ni trabajo. ¿Es una empresa de prueba o hay que
    crearles furgonetas?
13. El instalador de Infinity sin furgoneta (`90c2fae7…`), ¿debería tener asignada «Furgoneta Toni»
    (que no tiene a nadie)?
