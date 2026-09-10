# Auditoría del trabajo de la noche del 9 al 10 de septiembre de 2026

**Hecha el 2026-09-10** contra el repo en `main` (`e6f8df7`) **y contra la base de
datos real de producción** (Management API, proyecto `pkgvzwunazzkstlfubnq`). La
rutina programada de las 04:01 no dejó informe en el repo, así que se rehízo entera.

A diferencia del encargo original, esta auditoría **sí tuvo acceso al esquema de
producción**, así que los hallazgos de esquema no son hipótesis: están comprobados
con `information_schema` y `pg_class`.

---

## 1. Veredicto en tres líneas

Lo de esa noche está bien: typecheck, tests y build en verde, las 13 herramientas
del agente de voz están implementadas, y el traspaso de equipos no tiene fugas
entre empresas. **Lo que apareció al mirar alrededor es mucho peor que lo
auditado:** ningún cron de Vercel se ha ejecutado nunca —el middleware los
redirige a `/login` con un 307— y el código habla de 10 tablas y 33 columnas que
no existen en producción. Hay que tocar ya: el arreglo del middleware y el de la
facturación mensual están hechos en esta sesión; el resto necesita decisiones.

---

## 2. Hallazgos por gravedad

### 🔴 CRÍTICO 1 — Ningún cron se ha ejecutado jamás en producción

**Fichero:** `src/middleware.ts` + `src/shared/lib/supabase/middleware.ts:64-75`

Los nueve `/api/cron/*` están en el matcher del middleware y **no** en
`PUBLIC_PATHS`. Vercel Cron llama sin cookie de sesión, así que el middleware
responde **307 → /login** y el handler jamás llega a ejecutarse.

**Cómo se comprobó:** 15 minutos de logs de runtime de la producción actual
(`vercel logs`): 17 llamadas a `/api/cron/verifactu-send`, 4 a `/api/cron/hourly`
y 1 a `/api/cron/voice-retention`, **todas con `responseStatusCode: 307`** y
`source: edge-middleware`. Confirmado por datos: `cron_runs` tiene **0 filas**
(la telemetría se escribe al empezar cada ejecución), `invoice_reminders_sent`
0 filas, `invoice_verifactu_records` 0 filas.

**Qué se ha caído con esto:** facturación mensual de alquiler, los cuatro niveles
de recordatorio de impago, el envío a VeriFactu cada 15 minutos, los recordatorios
de mantenimiento, las sugerencias de compra, el aviso de presupuesto de Google
Maps, el vaciado de backlog de geocodificación, la caducidad de pruebas gratuitas
y las llamadas del agente de voz.

**Arreglo (hecho):** `/api/cron/` añadido a `PUBLIC_PATHS`. No abre ningún
agujero: **las 9 rutas empiezan por `verifyCronAuth(req)`** (comprobado una a una),
que exige `CRON_SECRET` y es fail-closed si la variable no existe.

**Falta (no es código):** `CRON_SECRET` **no está definida en Vercel**
(`vercel env ls production` → 27 variables, ninguna es esa). Sin ella, ahora los
crons pasarán el middleware y devolverán **500**. Hay que crearla en Vercel;
Vercel Cron la manda sola como `Authorization: Bearer $CRON_SECRET`.

---

### 🔴 CRÍTICO 2 — La cuota mensual de alquiler no podía funcionar

**Fichero:** `src/app/api/cron/daily/route.ts:1408` (antes del arreglo)

El insert en `invoices` mandaba `pending_cents`, columna que **no existe** en
producción (la tabla tiene 57 columnas y ninguna es esa), y omitía cuatro
columnas **NOT NULL sin default**: `series_id`, `number`, `fiscal_year`,
`full_reference`. Es decir: aunque el cron hubiera llegado a ejecutarse, cada
insert habría fallado. En producción hay **3 facturas en total**.

El mismo `pending_cents` rompía el `select` del bloque de recordatorios de impago
(`:1878`) — al pedir una columna inexistente, PostgREST tumba la consulta entera y
`overdue` queda vacío: **ni un recordatorio ha salido nunca**.

**Arreglo (hecho):** se extrajo el núcleo de creación de facturas a
`src/modules/invoices/create-core.ts` (sin `"use server"`, porque acepta un
`company_id`). Ahora la cuota mensual pasa por el **mismo camino que la
facturación manual**: serie → `allocate_next_invoice_number` → `full_reference` →
snapshots fiscales → línea de factura. Y los recordatorios calculan lo pendiente
como `total_cents − Σ invoice_payments`, igual que `getInvoice()`.

**Decisión tomada (dinero):** *no* se añade columna `pending_cents` ni generada ni
materializada. Lo pendiente se calcula, que es lo que ya hacía el resto de la app.

**Decisión tomada (IVA):** la semántica del precio la fija el destinatario, igual
que en `pickPrice()`: particular → la cuota lleva **IVA incluido** y se desglosa;
empresa o autónomo → la cuota es **base imponible** y se le suma el IVA. El cobro
(`contract_payments` y `wallet_entries`) pasa a ser el **total de la factura**, no
`monthly_cents` a secas: antes, a una empresa se le habría cobrado la base sin IVA.

---

### 🔴 CRÍTICO 3 — 10 tablas del código no existen en producción

Comprobado con `pg_class` (en ningún schema, ni `public` ni `app`):

| Tabla | Qué se lleva por delante |
|---|---|
| `invoice_payments` | los cobros de factura **no se registran**; `markInvoicePaidAction` inserta contra el vacío |
| `points_cycles`, `points_events`, `points_settings`, `points_cycle_users`, `points_cycle_adjustments` | el módulo de puntos entero (existe `points_ledger`, nada más) |
| `customer_duplicates` | el registro de duplicados detectados |
| `product_prices`, `product_price_history` | histórico y tarifa de precios |
| `proposal_payment_options` | formas de pago de una propuesta |
| `product_attribute_categories` | categorías de atributos de producto |

Casi todas tienen migración escrita en `supabase/migrations/` que **nunca se
aplicó al remoto** (`20260503310000_invoicing.sql`, `20260517100000_points_cycles.sql`,
`20260527100000_product_price_history.sql`, `20260501121200_proposals.sql`,
`20260609100000_product_attribute_categories.sql`).

Como los call-sites ignoran el `{ error }` de PostgREST, esto **no se ve**: la
función devuelve vacío y la pantalla se queda a cero.

**Pendiente de decisión tuya:** aplicar esas migraciones al remoto (son aditivas)
o quitar del código lo que no se va a usar. No se ha tocado nada.

---

### 🟠 IMPORTANTE 1 — 33 referencias a columnas que no existen

Se contrastó **cada `.select()`, `.insert()` y `.update()` del código** contra
`information_schema.columns` de producción. Las que rompen algo de verdad:

| Referencia | Fichero | Efecto |
|---|---|---|
| `free_trials.assigned_user_id` | `cron/daily:1173` | la columna es `assigned_installer_user_id`; el `UPDATE ... .select()` falla entero → **las pruebas gratuitas nunca se marcan como caducadas**. **ARREGLADO** |
| `customers.commercial_consent` | `cron/daily:1984` | no existe; el consentimiento vive en `customer_consents` → el filtro RGPD nunca filtraba. **ARREGLADO** |
| `user_profiles.email` | `cron/daily:228` | no existe (está en `auth.users`) → el nombre salía siempre "Usuario". **ARREGLADO** |
| `invoice_lines.discount_pct` + falta `company_id` (NOT NULL) y `tax_rate_percent` (NOT NULL) | `invoices/verifactu-actions.ts:571` | **la factura V2 mensual se creaba sin líneas**. **ARREGLADO** |
| `contracts.validated_at` | `contracts/actions.ts:1556` | no existe → validar un contrato devolvía error siempre. **ARREGLADO** (reintento sin la columna + migración `20260910120000`) |
| `company_settings.proposal_default_validity_days` | `config/proposals/actions.ts:61` | el admin cambiaba la validez y no se guardaba, sin avisar. **Migración `20260910120000`, sin aplicar** |
| `companies.legal_name`, `.trade_name`, `.tax_id`, `.phone`, `.email`, `.pdf_brand_color` | `contracts/pdf-generator.ts:1178`, `installations/pdf-generator.ts:845`, `free-trials/pdf-generator.ts:865`, `catalogo/[token]`, `datasheet/[token]`, confirmaciones públicas | `companies` **no tiene** esas columnas (tiene `name`, `billing_email` y `fiscal_data` jsonb) → los PDF y las páginas públicas se quedan sin los datos de la empresa. **NO arreglado: hay que decidir si se leen de `fiscal_data`/`company_settings` o se añaden columnas** |
| `customer_bank_accounts.sepa_mandate_id`, `.sepa_mandate_signed_at` | `sepa/sepa-xml.ts:177` | el XML SEPA se queda sin datos de mandato. **NO arreglado** |
| `customer_equipment.contract_id`, `.status` | `warehouses/sn-lookup-actions.ts:29` | buscar por número de serie no devuelve nada. **NO arreglado** |
| `invoices.pending_cents` | `invoices/smart-alerts.tsx:162` | mismo fallo que el cron, en las alertas. **NO arreglado** |
| resto (`products.sku`, `warehouses.is_main`, `installations.started_geo_*`, `maintenance_jobs.nps_score`, `events.created_at`, `contract_items.unit_price_cash_cents`, `installation_items.product_name_snapshot`, `user_profiles.department`/`home_address_label`, `company_settings.gps_tolerance_meters`/`schedule_default_start_hour`/`incident_sla_first_response_hours`/`fiscal_trade_name`, `products.cash_price_cents`/`description`) | varios | degradación silenciosa. **NO arreglado** |

La lista completa con fichero y línea sale de reejecutar el scan (ver §5).

---

### 🟠 IMPORTANTE 2 — Traspaso de equipos: el pack partido dejaba huérfanos

**Fichero:** `src/modules/customers/transfer-equipment-actions.ts`

Respondiendo a las cinco preguntas del encargo:

1. **¿Estado a medias si falla un paso?** Sí, y encima en silencio: los `update`
   de mantenimientos, contratos, incidencias y el "soltar del pack" **no miraban
   el error**. El peor estado alcanzable era el equipo ya a nombre del nuevo
   titular con las visitas y las incidencias todavía a nombre del viejo.
   **ARREGLADO:** cada paso recoge su error y el resultado devuelve `warnings[]`,
   que la UI muestra como "Traspaso incompleto" en vez de un "OK" mentiroso. No
   se movió a una función de Postgres: sin transacción no hay atomicidad real,
   pero al menos ahora se sabe qué quedó a medias.
2. **¿Y los nietos?** El modelo lo permite (`parent_equipment_id` no impide un
   tercer nivel) aunque hoy en producción hay **0** nietos. Se recogía solo un
   nivel. **ARREGLADO:** ahora baja por toda la descendencia, con tope de 5
   niveles por si alguien crea un ciclo a mano.
3. **¿`.not("status","in","(completed,cancelled)")` es válido?** **Sí.**
   Comprobado contra los enums reales: `maintenance_status` =
   `preprogrammed,needs_callback,scheduled,in_progress,completed,cancelled,rescheduled`
   e `incident_status` incluye `resolved,closed,cancelled`. Los valores existen y
   `status` es NOT NULL en las dos tablas, así que no hay filas perdidas por NULL.
   **No hay fallo silencioso aquí.**
4. **¿Se corta `listTransferTargets` a 500?** Sí, y con **1.826 clientes** en
   producción la ficha hermana se quedaba fuera de la ventana. **ARREGLADO:** las
   500 recientes siguen (lista "por si acaso") pero ahora se busca *además* por
   DNI/CIF, email y teléfono con un `or()`, que es justo el caso de uso.
5. **¿Puede la empresa A traspasar a una ficha de la empresa B?** **No.** Cada
   consulta filtra `company_id` y las dos fichas se resuelven en la misma query
   acotada por empresa. Sin fuga.

**Un fallo más, no preguntado:** al partir un pack (`include_children: false`) los
extras que se quedaban seguían apuntando con `parent_equipment_id` al equipo que
se acababa de ir. Como `removeCustomerEquipmentAction` da de baja en cascada a los
hijos, dar de baja el principal en la ficha nueva **habría dado de baja equipos de
otro cliente**. **ARREGLADO:** al partir el pack se sueltan los extras que se quedan.

---

### 🟠 IMPORTANTE 3 — Fechas fiscales en UTC

**Fichero:** `src/modules/invoices/create-core.ts` (heredado de `actions.ts`)

`issue_date`, `operation_at` y el año fiscal salían de `new Date().toISOString()`.
Las funciones de Vercel corren en UTC y el cron diario está a las **22:00 UTC**,
que en España ya es el día siguiente: una factura emitida el 1 de septiembre a las
00:30 de Madrid se fechaba **31 de agosto** — trimestre de IVA equivocado. Y la
primera factura del año se numeraría en el ejercicio anterior.
**ARREGLADO:** las tres usan `madridDateKey()`, que ya existía en el repo.

---

### 🟡 MENOR

- **`getCompanyInvoicingMode(companyId)`** (`src/modules/invoices/mode.ts:37`) es
  `"use server"` y acepta un `company_id` arbitrario: cualquier usuario logueado
  puede preguntar el modo de facturación de otra empresa. Fuga mínima (un enum),
  pero es la misma clase de fallo que se arregló en `getFiscalSettings` esta
  sesión — ahí sí se filtraban CIF, dirección e IBAN.
- **Idempotencia de la cuota mensual:** el check miraba `issued_at`, que en un
  borrador es NULL, así que nunca casaba; salvaba la situación el segundo check
  por concepto en `contract_payments`. **ARREGLADO** (ahora mira `issue_date`).
- **`gen_reference_code`**: la fuga cross-tenant que quedó abierta en julio
  **ya está cerrada en producción** (`proacl` = solo `postgres` y `service_role`,
  y el trigger `fill_reference_code_on_insert` es `security definer`). Se puede
  tachar de la lista de pendientes.
- **`generateMonthlyRecurringInvoicesAction`** filtra contratos con
  `status = "signed"` y el cron con `status = "active"`. Uno de los dos está mal;
  no se ha tocado porque depende de cómo uses tú los estados.

---

## 3. Lo que se comprobó y salió BIEN

- `npx tsc --noEmit`: **verde**. `npm test`: **verde**. `npm run build`: **verde**
  (solo warnings de lint preexistentes: `<img>` y un `fullName` sin usar).
- **Agente de voz:** las **13** herramientas declaradas en `prompts.ts`
  (`SERVICE_TOOLS`, `COMMERCIAL_TOOLS`, `INBOUND_TOOLS`) están **todas**
  implementadas en `src/app/api/voice-agent/tools/[tool]/route.ts`. Ninguna falta.
- **Crons de voz:** `voice-calls` comprueba `verifyCronAuth` y salta las empresas
  con el módulo apagado (`companiesWithModuleDisabled("voice_agent")`).
- **Sin `TODO`, `FIXME` ni `console.log`** en los 14 ficheros tocados esa noche.
- **Traspaso de equipos: sin fuga entre empresas** (ver §2, pregunta 5).
- **Migración de packs `20260703200000`: SÍ está aplicada en producción**
  (`product_extra_targets`, `parent_item_id` en las tres tablas de items y
  `customer_equipment.parent_equipment_id` existen). La nota de memoria que decía
  lo contrario estaba desfasada.
- **Migración `20260828100000` (wrappers `seed_*`)**: aplicada y correcta.

---

## 4. Lo que NO se pudo comprobar

- **Por qué falla Google Maps.** El logging que dice el motivo real está
  desplegado desde `a6b3334`, pero **no ha entrado ni una llamada desde entonces**
  (la última fila de `google_api_usage` es del 9-sep 14:42 UTC, todas con el
  `no_result` viejo). Para saberlo hay que provocar una geocodificación en
  producción (hace falta sesión iniciada) o probar la key a mano — y la key es
  `Secret` en Vercel: `vercel env pull` de secretos está bloqueado en esta sesión.
  Lo que sí se sabe: `GOOGLE_MAPS_PLATFORM_SERVER_KEY` **no está definida** y el
  servidor cae a la key pública, que si tiene restricción de referrer devuelve
  `REQUEST_DENIED` en toda llamada de servidor.
- **Ejecutar un cron de verdad** contra producción (bloqueado en esta sesión, y
  con razón: son endpoints que mueven dinero).
- **Correctness de dinero a mano** (redondeos en propuestas/wallet/puntos/ahorro,
  idempotencia de comisiones): sigue pendiente, salvo lo tocado aquí.
- **Las 8 preguntas de negocio** de `AUDITORIA_2026-09-09.md`: se ha resuelto una
  desde el código (IVA incluido vs base, ver CRÍTICO 2). Las otras siete siguen
  esperando respuesta tuya.

---

## 5. Cómo reproducir los escaneos

Los dos scripts que encontraron los hallazgos 3 y 4 quedaron en el scratchpad de
la sesión; la idea, por si hay que rehacerlos:

1. Volcar el esquema real: `information_schema.columns` de `public` vía
   Management API (`POST /v1/projects/<ref>/database/query`, ver la nota de
   memoria *Consultar Supabase producción*).
2. Extraer del código los pares tabla→columna de cada `.from("x").select("…")` y
   las claves de cada `.insert({…})`/`.update({…})`.
3. Restar. Lo que sobra en el código es deriva.

Merece la pena convertirlo en un test de CI: es la clase de fallo que este
proyecto produce una y otra vez, y no lo detecta ni el typecheck ni el build
porque el cliente de Supabase está tipado como `any` a propósito.
