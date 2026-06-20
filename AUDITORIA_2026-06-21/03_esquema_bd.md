# Auditoría de coherencia del esquema de base de datos

**Proyecto:** AGUA_CLAUDE2026 (CRM SaaS multi-tenant, Postgres/Supabase)
**Fecha:** 2026-06-21
**Alcance:** `supabase/migrations/**` (194 migraciones, ~187 tablas en `public`) cruzado con `src/**`.
**Modo:** READ-ONLY. No se ha modificado ningún archivo.
**Ignorado:** `legacy_reference/`, `.next/`, `node_modules/`, `graphify-out/`.

> Nota de método: la auditoría tuvo en cuenta que la RLS y muchos FK se aplican
> también con bloques dinámicos `do $$ ... execute format('alter table ...') ... $$`
> y con `alter table if exists`. Un grep estático ingenuo da decenas de falsos
> positivos (decía "62 tablas sin RLS" cuando en realidad son 4). Las cifras de
> abajo ya están depuradas con eso.

---

## Recuento por severidad

| Severidad | Nº hallazgos |
|-----------|--------------|
| CRÍTICA   | 1 |
| ALTA      | 4 |
| MEDIA     | 6 |
| BAJA      | 5 |
| **TOTAL** | **16** |

(Más una lista informativa de tablas muertas/inertes para decisión humana, al final.)

---

## TOP 10 hallazgos (una línea cada uno)

1. **[CRÍTICA]** `invoice_lines`: el código inserta/lee `discount_pct` pero la columna real es `discount_percent` → rompe el alta de líneas Verifactu V2 y el PDF de factura Verifactu.
2. **[ALTA]** `invoice_taxes` sin RLS y sin `company_id` (solo `invoice_id`) → impuestos de factura sin aislamiento de empresa por política.
3. **[ALTA]** Embed roto en calculadora de ahorro: `product_attribute_values.value` y `product_attributes.label` no existen (`value_text` / `name`) → atributos del producto salen vacíos en silencio.
4. **[ALTA]** 9 pares de migraciones comparten el MISMO timestamp → orden de aplicación no determinista (riesgo de dependencia rota entre migraciones del mismo minuto).
5. **[ALTA]** `gocardless_webhook_events` sin RLS (tiene `company_id`) → log de webhooks de cobros sin política de aislamiento.
6. **[MEDIA]** Concepto teléfono incoherente: `leads.phone_company` vs `customers.phone_secondary` (mismo dato, nombre distinto) → ya causó un bug histórico de inserción.
7. **[MEDIA]** ~32 FK a `auth.users(id)` sin `ON DELETE` explícito (NO ACTION) → borrar un usuario puede quedar bloqueado de forma incoherente con la migración `user_delete_set_null`.
8. **[MEDIA]** FK a `warehouses`, `products`, `invoice_series`, `points_rules`, `product_pricing_plans` sin `ON DELETE` (NO ACTION) → borrados bloqueados o incoherentes con sus tablas hermanas.
9. **[MEDIA]** Varias features con tablas "fantasma" del lado de paneles inteligentes (`invoices.pending_cents`, `products.cash_price_cents`, `products.photo_url`, `customers.consent_rgpd_at`, `installation_items.product_name_snapshot`) → columnas inexistentes que el try/catch silencia (feature muerta sin avisar).
10. **[BAJA]** ~17 tablas creadas pero nunca tocadas por `src/` ni por funciones SQL (features andamiadas sin cablear): emails de automatización, social campaigns/channels/metrics, savings consumption/recommended/water_types, etc.

---

## Hallazgos detallados (ordenados por severidad)

### CRÍTICA

#### C1 — `invoice_lines.discount_pct` no existe (la columna es `discount_percent`)
- **Tabla/archivo:**
  - Esquema: `supabase/migrations/20260501121900_parked_modules.sql:239` → `discount_percent numeric(5,2) default 0`
  - Código: `src/modules/invoices/verifactu-actions.ts:391` y `:577` (INSERT `discount_pct: 0`)
  - Código: `src/app/api/pdf/invoice-verifactu/[id]/route.ts:64` (SELECT `"... discount_pct, tax_rate ..."`) y `:122` (tipo)
  - Tipo: `src/modules/invoices/verifactu-pdf.ts:45`
- **Problema:** el código escribe y lee una columna `discount_pct` que NO existe; la real es `discount_percent`.
- **Por qué importa:** el INSERT de líneas falla (la factura Verifactu V2 no se puede emitir con líneas) y la ruta del PDF Verifactu hace `SELECT` de una columna inexistente → 400/excepción. Es un fallo DURO en una ruta de usuario (no es fail-soft). El `discount_pct` de `src/modules/mailing/*` es una variable de plantilla distinta y NO está afectado.
- **Arreglo propuesto:** corregir el CÓDIGO para usar `discount_percent` en los 4 sitios (INSERT, SELECT, tipos). No requiere migración. Si se prefiere no tocar tantos sitios, migración ADITIVA: `alter table public.invoice_lines add column if not exists discount_pct numeric(5,2);` + trigger/columna generada que lo espeje a `discount_percent` (más sucio; preferible arreglar código).
- **Riesgo del arreglo:** bajo (renombrado de literal). Verificar que no haya datos ya escritos en un `discount_pct` accidental (no debería, porque el INSERT fallaba).

---

### ALTA

#### A1 — `invoice_taxes` sin RLS y sin `company_id`
- **Tabla/archivo:** `supabase/migrations/20260507200000_invoicing_verifactu.sql` (CREATE TABLE `invoice_taxes`). No aparece en ningún `enable row level security` (ni estático ni dinámico).
- **Problema:** la tabla de desglose de impuestos por factura no tiene RLS y solo se ata al tenant por `invoice_id` (no tiene `company_id` propio).
- **Por qué importa:** en un SaaS multi-tenant, una tabla sin RLS es legible/escribible por cualquier usuario autenticado vía PostgREST si conoce/adivina ids. Aunque el acceso normal pase por la factura, la superficie queda abierta. Incoherente con `invoice_lines` / `invoice_payments` que sí tienen política.
- **Arreglo propuesto (migración ADITIVA nueva):** añadir `company_id` (rellenable por backfill desde `invoices`), habilitar RLS + `force` + política tenant análoga a `invoice_lines`. Patrón: `select` y `all` con `exists (select 1 from invoices i where i.id = invoice_taxes.invoice_id and i.company_id = app.current_company_id())` si no se quiere desnormalizar el `company_id`.
- **Riesgo:** medio-bajo. Si se añade política `exists(...)`, validar que los inserts de Verifactu siguen pasando (usan service role o usuario autenticado de la empresa).

#### A2 — Embed roto en calculadora de ahorro (`value` / `label` inexistentes)
- **Tabla/archivo:** `src/modules/savings/actions.ts:647` → `.select("product_id, value, product_attributes(key, label)")`
  - Esquema: `product_attribute_values` tiene `value_text/value_number/value_boolean/value_json` (no `value`) — `20260501121100_products.sql:282-285`.
  - Esquema: `product_attributes` tiene `key` + `name` (no `label`) — `20260501121100_products.sql:116`.
- **Problema:** dos columnas inexistentes dentro del mismo embed PostgREST.
- **Por qué importa:** PostgREST anula el embed completo en silencio → las descripciones/atributos de los productos recomendados en la calculadora salen vacías. Encaja con la regla de memoria "embeds PostgREST frágiles → listado vacío".
- **Arreglo propuesto:** corregir CÓDIGO: usar `value_text` (o el campo según `data_type`) y `name` en lugar de `label`. Sin migración.
- **Riesgo:** bajo.

#### A3 — 9 pares de migraciones con timestamp duplicado
- **Archivos (mismo prefijo `YYYYMMDDHHMMSS`):**
  - `20260523120000_financiers.sql` / `20260523120000_maintenance_jobs_indices.sql`
  - `20260523140000_contracts_assigned_at_fix.sql` / `20260523140000_contracts_payment_state.sql`
  - `20260525100000_maintenance_preprogrammed_tracking.sql` / `20260525100000_time_punch_requests.sql`
  - `20260525110000_autoclose_at_shift_end.sql` / `20260525110000_maintenance_customer_confirmation.sql`
  - `20260525120000_dedupe_holidays.sql` / `20260525120000_maintenance_fix_indexes.sql`
  - `20260525130000_company_city_code.sql` / `20260525130000_wallet_entries_customer_backfill.sql`
  - `20260525140000_maintenance_contract_per_equipment.sql` / `20260525140000_vacation_windows.sql`
  - `20260525150000_invoices_maintenance_contract_link.sql` / `20260525150000_leave_kinds_and_budgets.sql`
  - `20260527100000_product_price_history.sql` / `20260527100000_smtp_dual_setup.sql`
- **Problema:** dos migraciones con idéntico timestamp. El orden entre ambas no está garantizado (depende del orden alfabético del sufijo, que Supabase CLI puede o no respetar según versión/herramienta).
- **Por qué importa:** si una de las dos dependiera de la otra (p. ej. una crea una columna que la otra usa) podría aplicarse en orden inverso en un entorno nuevo y fallar. Hoy parecen independientes (tocan módulos distintos), por eso es ALTA y no CRÍTICA, pero es deuda peligrosa para futuros `db reset`.
- **Arreglo propuesto:** NO renombrar migraciones ya aplicadas (la memoria lo prohíbe y rompería el historial). Acción: documentar el orden correcto y, para CUALQUIER migración nueva, garantizar timestamp único (script de pre-commit que valide unicidad). Si un `db reset` desde cero falla por orden, resolver con una migración aditiva que arregle el estado, no editando las antiguas.
- **Riesgo:** ninguno si no se tocan; el riesgo es no actuar y que un entorno limpio falle.

#### A4 — `gocardless_webhook_events` sin RLS
- **Tabla/archivo:** `supabase/migrations/20260509100000_gocardless.sql` (CREATE TABLE). No aparece en ningún enable RLS.
- **Problema:** tabla con `company_id` y `payload jsonb` (datos de cobros) sin política RLS.
- **Por qué importa:** payloads de webhooks de cobros (datos financieros) accesibles vía PostgREST a cualquier autenticado. Si el procesamiento lo hace el service role, la tabla NO necesita ser legible por usuarios → falta política.
- **Arreglo propuesto (migración ADITIVA):** `enable row level security` + `force` + política tenant (`company_id = app.current_company_id()` para lectura admin) o, si solo la usa el service role, RLS habilitada SIN políticas para clientes (deny-by-default), confiando en service role.
- **Riesgo:** bajo. Verificar que el handler de webhook use service role (no la sesión de usuario) antes de cerrar el acceso.

---

### MEDIA

#### M1 — Concepto "teléfono" con nombres incoherentes entre tablas
- **Tabla/archivo:**
  - `leads`: `phone_primary` + `phone_company` (`20260501120800_leads_customers.sql:62-63`, comentario "solo empresas")
  - `customers`: `phone_primary` + `phone_secondary` (`...:143-144`)
- **Problema:** el "segundo teléfono" se llama `phone_company` en leads y `phone_secondary` en customers. El código tiene que mapear manualmente (`leads.phone_company` → `customers.phone_secondary`) al convertir lead→cliente y al alta desde prueba gratuita (`src/modules/leads/actions.ts:536`, `src/modules/free-trials/actions.ts:801`).
- **Por qué importa:** ya provocó un bug histórico (insertar `phone_company` en `customers` que no tiene esa columna — ver memoria sesión 2026-06-15). El mapeo manual es frágil: cualquier nuevo flujo que copie lead→customer puede olvidarlo.
- **Arreglo propuesto:** NO renombrar columnas existentes (datos vivos). Migración ADITIVA opcional: en `customers` añadir columna generada/espejo o documentar el contrato. Lo realista: dejar un único helper centralizado de mapeo lead→customer y prohibir copias ad-hoc. Sin cambio de esquema obligatorio.
- **Riesgo:** ninguno si solo se centraliza el mapeo.

#### M2 — ~32 FK a `auth.users(id)` sin `ON DELETE` explícito
- **Tabla/archivo:** múltiples (32 ocurrencias `references auth.users(id)` sin `on delete`). Existe la migración `20260506200000_user_delete_set_null.sql` que arregla ALGUNAS a `set null`, pero no todas.
- **Problema:** las FK a `auth.users` sin `ON DELETE` quedan en NO ACTION → impiden borrar un usuario si tiene filas referenciándolo, de forma incoherente: unas columnas son `set null` (por la migración) y otras NO ACTION.
- **Por qué importa:** borrar/desactivar un comercial puede fallar o comportarse distinto según la tabla. Incoherencia de política sobre la misma referencia (`auth.users`).
- **Arreglo propuesto (migración ADITIVA):** auditar las 32, decidir política uniforme (la mayoría debería ser `on delete set null` para campos "created_by/assigned_to" y `restrict` solo donde la autoría sea obligatoria). Aplicar con `alter table ... drop constraint ... ; add constraint ... on delete set null;` en migración nueva. NO editar las migraciones originales.
- **Riesgo:** medio. `drop/add constraint` toma lock breve; hacerlo en ventana tranquila. Verificar que ninguna columna NOT NULL apunte a `auth.users` antes de poner `set null`.

#### M3 — FK sin `ON DELETE` a tablas de negocio (warehouses, products, invoice_series, points_rules, product_pricing_plans)
- **Tabla/archivo:**
  - `20260501121500_warehouses.sql:135-136` → `source_warehouse_id` / `destination_warehouse_id` `references public.warehouses(id)` (NOT NULL, sin ON DELETE)
  - `20260501121600_installations.sql:53` → `source_warehouse_id references public.warehouses(id)` (sin ON DELETE)
  - `20260501121800_wallet_sales_objectives.sql:103-104` → `product_id` / `pricing_plan_id` (sin ON DELETE)
  - `20260501121900_parked_modules.sql:188` → `series_id references public.invoice_series(id)` NOT NULL (sin ON DELETE)
  - `20260501121900_parked_modules.sql:50` → `rule_id references public.points_rules(id)` (sin ON DELETE)
- **Problema:** NO ACTION por defecto → no se puede borrar un almacén/producto/serie/regla si algún registro lo referencia.
- **Por qué importa:** incoherente con el resto del esquema (que mayoritariamente usa `set null`/`cascade`). Para `warehouses`/`products` lo correcto suele ser `restrict` explícito (no quieres borrar un producto con histórico) — pero debe ser EXPLÍCITO para que la intención quede clara, no un NO ACTION accidental.
- **Arreglo propuesto (migración ADITIVA):** redefinir cada constraint con la política deseada explícita (`restrict` para histórico inmutable; `set null` para referencias opcionales como objetivos). Migración nueva con `drop/add constraint`.
- **Riesgo:** bajo-medio (lock breve por constraint).

#### M4 — Columnas "fantasma" en paneles inteligentes y aids (fail-soft, feature muerta)
- **Tabla/archivo:**
  - `invoices.pending_cents` → `src/modules/invoices/smart-alerts.tsx:126,163,165` (no es columna; se calcula en TS)
  - `products.cash_price_cents` → `src/modules/products/smart-alerts.tsx:129,139,142` (el precio vive en `product_pricing_plans`)
  - `products.photo_url` → `src/modules/products/smart-alerts.tsx:183` (la columna real es `main_image_url`)
  - `customers.consent_rgpd_at` → `src/modules/customers/smart-alerts.tsx:258` (el consentimiento vive en `customer_consents`)
  - `installation_items.product_name_snapshot` → `src/modules/installations/product-aids-actions.ts:29` (existe en proposal_items/contract_items/free_trial_items, no en installation_items)
- **Problema:** el código consulta columnas inexistentes; envueltas en try/catch que devuelven 0/vacío.
- **Por qué importa:** la alerta/feature parece funcionar pero NUNCA dispara (silenciosa). El usuario cree tener un panel de alertas que en realidad está muerto.
- **Arreglo propuesto:** corregir CÓDIGO para leer de la fuente real (joins a `product_pricing_plans`, `customer_consents`, `main_image_url`, cálculo de `pending_cents` ya existente en TS). Sin migración. Para `installation_items.product_name_snapshot`, decidir si añadir la columna (migración aditiva) o leer el nombre del producto por join.
- **Riesgo:** bajo.

#### M5 — `companies.legal_name` / `companies.trade_name` usados pero la tabla solo tiene `name`
- **Tabla/archivo:** `companies` solo tiene `name`; los datos fiscales viven en `company_settings`. Usos sospechosos (no verificados línea a línea, mismo patrón que bug histórico):
  - `src/modules/products/catalog-pdf-v2.ts:219`
  - `src/modules/products/datasheet-pdf-v2.ts:382`
  - `src/modules/products/datasheet-pdf.ts:210`
  - `src/modules/products/email-share-actions.ts:205`
- **Problema:** se leen `legal_name`/`trade_name` sobre `companies`, que no existen ahí.
- **Por qué importa:** PDFs/emails de catálogo pueden salir con nombre de empresa vacío. Coincide con la regla de memoria sobre `companies.legal_name`.
- **Arreglo propuesto:** corregir CÓDIGO para leer de `company_settings` (o `companies.name`). Sin migración. Verificar cada uso (puede ser un embed a `company_settings` y el alias confunde).
- **Riesgo:** bajo (confirmar primero si es embed a company_settings).

#### M6 — `invoice_taxes` también sin `company_id` (desnormalización ausente, refuerza A1)
- **Tabla/archivo:** `invoice_taxes` (ver A1).
- **Problema:** todas las tablas hijas de factura del esquema llevan `company_id` desnormalizado para RLS rápida; `invoice_taxes` no.
- **Por qué importa:** incoherencia estructural; obliga a `exists(...)` en la política (más lenta) o deja la tabla sin aislar.
- **Arreglo propuesto:** ver A1 (añadir `company_id` + backfill desde `invoices`).
- **Riesgo:** bajo.

---

### BAJA

#### B1 — Tablas andamiadas sin cablear (inertes) — ver lista al final
- **Problema:** ~17 tablas creadas pero nunca usadas ni por `src/` ni por funciones SQL.
- **Por qué importa:** ruido de esquema, confunde futuras auditorías y a quien lea el modelo. No rompe nada.
- **Arreglo propuesto:** decisión humana (mantener para roadmap o `drop table` en migración aditiva). NO borrar sin OK explícito (regla de memoria). Lista detallada abajo.
- **Riesgo:** bajo si se mantienen; medio si se borran sin confirmar (podrían estar planificadas).

#### B2 — Columna `discount_pct` como variable de plantilla vs columna BD (homonimia)
- **Tabla/archivo:** `src/modules/mailing/system-templates.ts`, `sample-vars.ts` usan `{{discount_pct}}` como variable de email.
- **Problema:** mismo nombre que la columna mal escrita de C1, pero aquí es legítimo (variable de plantilla). Riesgo de confusión al refactorizar C1.
- **Por qué importa:** al arreglar C1 hay que NO tocar estos (son strings de plantilla, no columnas).
- **Arreglo propuesto:** documentar; no cambiar.
- **Riesgo:** ninguno (solo aviso para no romper al arreglar C1).

#### B3 — `savings_price_scrape_log` sin RLS
- **Tabla/archivo:** `20260513100000_savings_calculator.sql`. Solo se escribe (INSERT) desde `src/modules/savings/scrapers.ts:165`.
- **Problema:** log de scraping sin RLS. Probablemente sin `company_id` relevante (datos públicos de precios).
- **Por qué importa:** bajo riesgo (datos de precios de mercado, no sensibles), pero incoherente con la norma "toda tabla con RLS".
- **Arreglo propuesto (migración ADITIVA):** habilitar RLS con política de lectura admin o deny-by-default + service role. O documentar explícitamente que es global/no sensible.
- **Riesgo:** bajo.

#### B4 — `contract_photos` huérfana (tabla dropeada que aún aparece como "sin RLS")
- **Tabla/archivo:** `20260503280000_contract_photos.sql` crea la tabla, pero comentarios en código indican que se eliminó.
- **Problema:** estado ambiguo: la migración la crea, no veo el DROP claro, y `src/` solo la menciona en comentarios ("tabla que se eliminó").
- **Por qué importa:** confusión de esquema; si la tabla SIGUE existiendo en BD está sin RLS.
- **Arreglo propuesto:** verificar en BD si la tabla existe. Si existe y no se usa → migración aditiva `drop table if exists` (con OK del humano). Si ya no existe, limpiar comentarios.
- **Riesgo:** bajo (verificar antes de dropear).

#### B5 — Tablas write-only (se escriben pero nunca se leen desde `src/`)
- **Tabla/archivo:**
  - `expense_per_diems` — `src/modules/expenses/actions.ts:647` (solo INSERT)
  - `expense_mileage` — `src/modules/expenses/actions.ts:676` (solo INSERT)
  - `email_consents` — `src/modules/mailing/actions.ts:1065` (solo INSERT)
  - `product_images` — `src/modules/products/catalog-copy-helpers.ts:190` (solo INSERT)
  - `filter_stock_movements` — `src/modules/products/filter-stock-actions.ts:202` (solo INSERT)
- **Problema:** datos que se escriben pero ninguna pantalla los lee.
- **Por qué importa:** o falta UI (feature a medias) o son tablas de auditoría legítimas. `expense_per_diems`/`expense_mileage` probablemente sí se leen vía embed del gasto padre (verificar). `product_images` puede leerse vía `main_image_url`.
- **Arreglo propuesto:** decisión humana — completar la UI de lectura o aceptar como log. Sin migración.
- **Riesgo:** ninguno.

---

## Cosas verificadas que están BIEN (no son hallazgos)

- **Enums usados en código:** todos los literales de status (lead potential A/B/C, contract payment_state, invoice status, installation/maintenance status, etc.) están dentro del set permitido. El bug histórico "B vs medium" está arreglado (`savings/actions.ts:281` escribe "B").
- **Enum añadido y usado en la misma migración:** los 10 casos detectados son FALSOS POSITIVOS: el valor solo aparece en el guard `where enumlabel = 'x'` (comprobación previa al `add value`), nunca en un índice/CHECK de la misma transacción. Patrón correcto.
- **`uniq_free_trials_ref` (y los 3 hermanos):** el choque por duplicado YA está arreglado en `20260702100000_gen_reference_code_security_definer.sql` (función pasada a SECURITY DEFINER para saltar RLS y leer también borrados).
- **Marcas duplicadas (savings_water_brands):** ya tiene unique `uq_swb_company_name_kind` (`20260630100000`).
- **`role_permissions`, `permissions_catalog`, `superadmins`:** parecen "no usadas en src/" pero SÍ las usan las funciones SQL de RLS/auth (`is_superadmin()`, auth hook, seeds). NO son muertas.
- **RLS:** tras descontar los bloques dinámicos `execute format(...)`, solo 4 tablas quedan sin RLS (A1, A4, B3, B4). El resto está cubierto.

---

## Tablas que parecen MUERTAS / INERTES (decisión humana)

> Definición: CREATE TABLE existe, pero NO se referencia desde `src/` ni desde
> funciones/triggers/seeds SQL (solo aparecen en su propia migración de creación).
> NO borrar sin confirmación (regla de memoria "no sobreescribir sin preguntar").
> Verificar antes contra el roadmap: varias son features andamiadas a propósito.

**Sin uso en src/ ni en SQL (candidatas firmes a inertes):**
- `customer_contacts`
- `lead_contacts`
- `email_automations`
- `email_automation_steps`
- `email_automation_runs`
- `email_lists`
- `email_domains`
- `social_campaigns`
- `social_channels`
- `social_post_metrics`
- `product_compatibilities`
- `product_external_compatibilities`
- `savings_consumption_profiles`
- `savings_recommended_products`
- `savings_water_types`
- `contract_clauses_used`
- `price_approvals`

**Dropeadas/ambiguas (verificar si siguen en BD):**
- `contract_photos` (ver B4 — comentarios dicen "se eliminó")
- `installation_steps_log` (comentarios dicen "se DROPEÓ en 20260507100000")

**Write-only (se escriben pero no se leen desde src/ — pueden tener UI pendiente o ser logs):**
- `expense_per_diems`, `expense_mileage`, `email_consents`, `product_images`, `filter_stock_movements`

**NO son muertas (parecen, pero las usa la capa SQL — NO borrar):**
- `role_permissions`, `permissions_catalog`, `superadmins`, `points_rules` (revisar este último: solo 1 migración; comprobar si lo lee alguna función de puntos antes de decidir)

---

## Resumen ejecutivo para Mario

Lo más urgente es **C1**: el descuento de las líneas de factura Verifactu está escrito con un nombre de columna equivocado (`discount_pct` en vez de `discount_percent`), lo que rompe emitir esas facturas y su PDF. Es un arreglo de código de 4 líneas, sin tocar la base de datos.

Después, hay **2 tablas sensibles sin "candado" (RLS)**: los impuestos de factura y el registro de avisos de cobros (GoCardless). Conviene cerrarlas con una migración nueva (aditiva, sin tocar lo ya aplicado).

Y hay **9 parejas de migraciones con la misma "hora"**: hoy no rompen nada, pero hay que vigilar que cualquier migración nueva tenga hora única, porque montar la base desde cero podría aplicarlas en orden equivocado.

El resto son incoherencias de nombres (el segundo teléfono se llama distinto en leads y en clientes), borrados de usuario que pueden quedar bloqueados, y unas cuantas tablas creadas "por si acaso" que nunca se llegaron a usar (lista al final para que decidas si quitarlas o dejarlas para el futuro).
