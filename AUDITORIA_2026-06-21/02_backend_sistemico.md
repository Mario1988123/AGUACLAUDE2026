# Auditoría backend sistémico — 2026-06-21

Proyecto: `C:\AGUA_CLAUDE2026` (Next.js 15 + Supabase/Postgres, CRM SaaS multi-tenant, RLS por empresa).
Modo: READ-ONLY. No se modificó ningún archivo fuente.
Ignorado: `legacy_reference/`, `.next/`, `node_modules/`.

Patrón disparador (bug ya arreglado): `gen_reference_code` era `SECURITY INVOKER` → su SELECT
quedaba filtrado por RLS del usuario → un comercial nivel 3 (scope 'own') recalculaba un número
ya usado por otro → choque con índice único. Arreglado en `20260702100000` (SECURITY DEFINER).

---

## RECUENTO POR SEVERIDAD

| Severidad | Nº |
|-----------|----|
| CRITICAL  | 0  |
| HIGH      | 18 |
| MEDIUM    | 14 |
| LOW       | 14 |
| Sistémico (cuenta aparte) | 1 (RULE C: ~200 sitios `throw new Error`) |

Desglose por dimensión:
- DIM 1 (generadores de código secuencial): 2 HIGH (contracts, proposals) + 1 LOW latente (orden lexicográfico) — ver tabla dedicada abajo.
- DIM 2 (funciones SECURITY INVOKER que leen tablas con RLS): 0 nuevos críticos (el único era `gen_reference_code`, ya arreglado).
- DIM 3 (IDOR `createAdminClient` sin filtro company): 7 HIGH + 1 MEDIUM + 9 LOW (defensa en profundidad).
- DIM 4 (SELECT de columnas inexistentes): 18 confirmados (8 HIGH, 8 MEDIUM, 2 conocidos recurrentes).
- DIM 5 (embeds PostgREST frágiles): 14 (2 HIGH sin fallback, ~8 MEDIUM, ~4 LOW).
- DIM 6 (`schema.parse()` directo): 0 — el código usa `parseOrFriendly`/`safeParse` (LIMPIO).
- DIM 7 (`z.coerce.boolean()`): 0 — migrado a `zBoolean()` (LIMPIO).
- DIM 8 (`throw` de validación visible al usuario): ~200 sitios (sistémico, MEDIUM/LOW).

---

## LOS 10 HALLAZGOS MÁS GRAVES

1. [HIGH] `src/app/api/cron/daily/route.ts:1863,1867` — cron de impagos filtra por `invoices.pending_cents` (columna inexistente) → la query falla en silencio → TODA la rutina de recordatorios de impago no envía nada.
2. [HIGH] `src/modules/contracts/actions.ts:359-366` — reference_code C-YYYY-NNNN se calcula con cliente RLS (`supaAny`) → comercial scope 'own' duplica número (contracts NO tiene índice único en reference_code → duplicados silenciosos).
3. [HIGH] `src/modules/proposals/actions.ts:428-435` — reference_code P-YYYY-NNNN con cliente RLS (`supaAny`) → mismo defecto que el bug original; proposals tampoco tiene índice único.
4. [HIGH] `src/modules/addresses/actions.ts:129-133` — `upsertAddressAction`: admin `update().eq("id", parsed.id)` SIN filtro company y SIN role gate → cualquier usuario reescribe/re-tenanta la dirección de otra empresa.
5. [HIGH] `src/modules/maintenance-plans/actions.ts:354-361` — `cancelMaintenanceContractAction`: admin `update(status:cancelled).eq("id", id)` sin filtro company ni role gate → cualquiera cancela el contrato de mantenimiento de otra empresa.
6. [HIGH] `src/modules/time-tracking/attendance-gaps-actions.ts:92-137` — gap leído/actualizado por id sin filtro company → admin/director de empresa A manipula registros de fichaje de empresa B.
7. [HIGH] `src/modules/invoices/verifactu-actions.ts:138-142` — `upsertInvoiceSeriesAction`: admin `update().eq("id", input.id)` sin filtro company → company-admin secuestra/re-tenanta la serie fiscal de otra empresa.
8. [HIGH] `src/modules/contracts/actions.ts:682-686,717-720` — `cleanupDuplicateContractPaymentsAction`: borra `contract_payments` por `contract_id` de cliente sin verificar que el contrato sea de su empresa.
9. [HIGH] `src/app/catalogo/[token]/page.tsx:138` + `src/app/datasheet/[token]/page.tsx:133` — embed `companies(legal_name, trade_name, pdf_brand_color)`: ninguna existe en `companies` → página pública peta / sale en blanco.
10. [HIGH] `src/modules/installations/pdf-generator.ts:844` — `companies(legal_name, trade_name, tax_id)` con `.single()` → THROW → generación del parte de trabajo PDF falla por completo.

(11.ª de honor: `src/modules/messaging/actions.ts:117-118,129` — upsert/delete de plantillas por id sin filtro company.)

---

## ★ GENERADORES DE CÓDIGO SECUENCIAL — INVENTARIO COMPLETO (PRIORITARIO)

Tipos de generador encontrados y su veredicto frente al bug de tipo "RLS filtra el MAX → duplicado".

| # | Código / prefijo | Ubicación | Mecanismo | Cliente / SECURITY | Índice único | Veredicto |
|---|------------------|-----------|-----------|--------------------|--------------|-----------|
| 1 | PG / INC / MJ / W (free_trials, incidents, maintenance_jobs, wallet_entries) | `supabase/migrations/20260507300000_reference_codes_auto.sql` (fn `gen_reference_code`) | MAX+1 (`order by ... desc limit 1`) en trigger BEFORE INSERT | **SECURITY DEFINER** (arreglado en `20260702100000`) | Sí (uniq por company_id) | **OK** (ya arreglado). ⚠ Bug LOW latente: el `order by reference_code desc` es lexicográfico → se rompe al pasar de 9999 a 10000 (padStart 4). |
| 2 | Nº factura (series A/R/P) | `supabase/migrations/20260507200000_invoicing_verifactu.sql:277` (`allocate_next_invoice_number`) usado en `src/modules/invoices/actions.ts:383` y `verifactu-actions.ts:660` | **Contador en tabla `invoice_series.next_number` con `FOR UPDATE`** (no MAX+1) | SECURITY DEFINER + admin client | n/a (contador atómico) | **OK** — patrón correcto, atómico, sin dependencia de RLS. |
| 2b | Nº factura (legacy) | `supabase/migrations/20260503310000_invoicing.sql:38` (`app.next_invoice_number`) | Contador `FOR UPDATE` | NO security definer, schema `app` | n/a | **OK pero MUERTA** — no se usa en TS (reemplazada por la de schema public). Sin riesgo. |
| 3 | C-YYYY-NNNN (contracts) | `src/modules/contracts/actions.ts:359-366` (crear) | MAX+1 leyendo `contracts` | **Cliente RLS (`supaAny` = `createClient()`)** | **NO existe índice único en `contracts.reference_code`** | **VULNERABLE** — comercial scope 'own' ve solo SUS contratos → recalcula nº ya usado. Sin índice único → genera DUPLICADOS en silencio (no peta, pero dos contratos comparten "C-2026-0001"). |
| 4 | P-YYYY-NNNN (proposals) | `src/modules/proposals/actions.ts:428-435` (crear) | MAX+1 leyendo `proposals` | **Cliente RLS (`supaAny`)** | **NO existe índice único en `proposals.reference_code`** | **VULNERABLE** — idéntico a contracts: duplicados silenciosos por scope. |
| 5 | I-YYYY-NNNN (installations) | `src/modules/contracts/actions.ts:976-990` (crear al firmar) | MAX+1 leyendo `installations` | **admin client** (salta RLS) | No verificado índice único | **OK** frente al bug de RLS (lee todas las filas de la empresa). Queda condición de carrera teórica (dos firmas a la vez), mitigada. |
| 6 | I-YYYY-NNNN backfill | `src/modules/installations/actions.ts:533-558` | MAX+1 | admin client | — | **OK** (admin). Carrera teórica, fail-soft try/catch. |
| 7 | C-/P- backfill (one-shot en getContract/getProposal) | `contracts/actions.ts:112-134`, `proposals/actions.ts:165-187` | MAX+1 | admin client | — | **OK** frente a RLS (admin). Carrera + falta de índice único → puede backfillear códigos duplicados, pero fail-soft. |
| 8 | AH-YYYY-NNNN (savings_proposals) | `src/modules/savings/actions.ts:813-828` | MAX+1 leyendo `savings_proposals` | **admin client** | No verificado | **OK** frente a RLS. Carrera teórica mitigada. |
| 9 | M-YYYY-NNNN (maintenance_contracts) | `src/modules/maintenance-plans/actions.ts:143-158` | MAX+1 leyendo `maintenance_contracts` | **admin client** | No verificado | **OK** frente a RLS. Carrera teórica mitigada. |
| 10 | invoice_number (purchases) | `src/modules/warehouses/purchase-actions.ts` / `20260515120000_purchases.sql:31` | N/A — **texto libre del proveedor** (nº de albarán) | — | — | **OK** — no es un generado correlativo. |

**Resumen del inventario:**
- **OK (ya arreglado / patrón correcto):** #1 (con caveat lexicográfico LOW), #2, #2b, #10.
- **OK frente al bug de RLS (admin client), con carrera teórica:** #5, #6, #7, #8, #9.
- **VULNERABLES (mismo defecto que el bug original):** **#3 (contracts) y #4 (proposals)** — ambos usan cliente RLS y NO tienen índice único en `reference_code`, así que el síntoma no es un choque de clave (como en free_trials) sino **duplicados silenciosos**.

**Arreglo recomendado para #3 y #4 (y endurecer #5-#9):** o bien (a) cambiar la lectura del MAX a `createAdminClient()` (como ya hacen installations/savings/maintenance) — MODIFICA, riesgo bajo; o mejor (b) reutilizar la función SQL `gen_reference_code` extendiéndola a contracts/proposals/installations/savings/maintenance_contracts vía trigger (igual que las 4 tablas ya cubiertas) — ADITIVO, elimina de raíz RLS+carrera. En ambos casos **añadir índice único `(company_id, reference_code)`** a contracts y proposals (ADITIVO; requiere limpiar duplicados existentes antes).

---

## DIM 1 — Generadores: detalle de los vulnerables

### [HIGH] contracts C-YYYY-NNNN
- `src/modules/contracts/actions.ts:359-366`
- Problema: `supaAny` (línea 294) = `supabase` = `createClient()` (cliente RLS). El SELECT del MAX queda filtrado por scope del comercial.
- Causa: cliente RLS + ausencia de índice único en `contracts.reference_code`.
- Arreglo: usar `createAdminClient()` para la lectura del MAX, o delegar en `gen_reference_code` SQL. Añadir `unique index ... on contracts(company_id, reference_code) where reference_code is not null`.
- Riesgo del arreglo: el índice único fallará si ya hay duplicados → limpiar antes (backfill). El cambio de cliente no afecta a otras empresas (sigue filtrando por `company_id`).
- ADITIVO (índice) + MODIFICA (cliente).

### [HIGH] proposals P-YYYY-NNNN
- `src/modules/proposals/actions.ts:428-435` — idéntico a contracts.
- Mismo arreglo y mismo riesgo.

### [LOW] Orden lexicográfico en todos los MAX+1 (incl. `gen_reference_code`)
- `gen_reference_code` (SQL) y todos los generadores TS usan `order by reference_code desc` + `padStart(4)`/`padStart(5)`. Al superar 9999 (o 99999 en facturas), el orden alfabético deja de coincidir con el numérico ("9999" > "10000"). Riesgo real solo con >10k filas por empresa/año. Arreglo: ordenar por el sufijo numérico extraído, o ampliar padding. ADITIVO/MODIFICA según implementación.

---

## DIM 3 — IDOR (createAdminClient sin filtro company)

Total de llamadas a `createAdminClient`: ~945 en 239 archivos. La gran mayoría (~520 en la superficie de mutación) están correctamente acotadas por `company_id` o por lectura-y-verificación previa (el código ya pasó por endurecimientos previos: helpers `loadOwnedInstallation`, `assertWarehouseCompany`, etc.). El módulo `customers` está totalmente limpio.

### HIGH (explotables hoy)
- [HIGH] `src/modules/addresses/actions.ts:129-133` — `upsertAddressAction`: update por id sin filtro company y SIN role gate. El más amplio (cualquier usuario autenticado). MODIFICA: añadir `.eq("company_id", session.company_id)`.
- [HIGH] `src/modules/maintenance-plans/actions.ts:354-361` — `cancelMaintenanceContractAction`: update por id sin filtro company ni role gate. MODIFICA.
- [HIGH] `src/modules/time-tracking/attendance-gaps-actions.ts:92-96,105-113,128-137` — `classifyAttendanceGapAction`: select+update del gap por id sin filtro company. MODIFICA.
- [HIGH] `src/modules/invoices/verifactu-actions.ts:138-142` — `upsertInvoiceSeriesAction`: update de serie fiscal por id sin filtro company (gate admin sí). MODIFICA.
- [HIGH] `src/modules/contracts/actions.ts:682-686,717-720` — `cleanupDuplicateContractPaymentsAction`: borra payments por `contract_id` sin verificar dueño del contrato. MODIFICA (leer contrato + verificar company antes).
- [HIGH] `src/modules/messaging/actions.ts:117-118` — `upsertMessageTemplateAction`: update por id sin filtro company. MODIFICA.
- [HIGH] `src/modules/messaging/actions.ts:129` — `deleteMessageTemplateAction`: soft-delete por id sin filtro company. MODIFICA.

### MEDIUM
- [MEDIUM] `src/modules/chat/actions.ts:515-544,553-604` — `createTeamThreadAction`/`getOrCreateDirectThreadAction`: añade miembros sin verificar que pertenezcan a `session.company_id` → canal de chat cross-tenant. MODIFICA (validar cada user_id contra la empresa).

### LOW (defensa en profundidad — hoy bloqueados por una lectura RLS previa, pero el write admin es unscoped)
- [LOW] `src/modules/proposals/actions.ts:933-937` — `markProposalAccepted` (write admin por id, gateado por lectura RLS previa).
- [LOW] `src/modules/proposals/actions.ts:1050+` — `convertAcceptedProposalToCustomerAction`.
- [LOW] `src/modules/proposals/actions.ts` self-heal (~184, ~236, ~518, ~558).
- [LOW] `src/modules/free-trials/actions.ts:228-233` — `installFreeTrialAction` (update del trial por id, gateado por lectura RLS).
- [LOW] `src/modules/products/documents-actions.ts:69` — `addProductDocumentAction` (insert sin check de producto padre).
- [LOW] `src/modules/products/certifications-actions.ts:116` — `addProductCertificationAction`.
- [LOW] `src/modules/products/filter-assignments-actions.ts:98,243`.
- [LOW] `src/modules/warehouses/lot-actions.ts:119` — `createStockLotAction` (insert sin `assertWarehouseCompany`).
- [LOW] `src/modules/chat/actions.ts:288-303` — `markChatThreadRead` (self-insert como miembro de thread arbitrario).
- [LOW] `src/modules/tenant/users/team-actions.ts:164-211` — `assignToTeamAction` (no valida `managerUserId`). ADITIVO.
- [LOW] `src/modules/routes/team-actions.ts:504-522` — `applyTeamDayRouteSafeAction` (scoped por user_id, no company). ADITIVO.

Fix común HIGH: añadir `.eq("company_id", session.company_id)` al `.update()/.delete()`, o leer la fila y verificar `row.company_id === session.company_id`. Todos MODIFICA (acotan una query existente; no borran datos).

---

## DIM 4 — SELECT de columnas inexistentes (18 confirmadas)

Mapa de columnas reconstruido desde `supabase/migrations/**` (CREATE TABLE + ALTER ADD COLUMN). Todas las columnas marcadas como inexistentes se verificaron ausentes en todo el árbol de migraciones.

### CLUSTER A — `companies` NO tiene `legal_name`/`trade_name`/`tax_id`/`phone`/`email`/`pdf_brand_color`
(Columnas reales: `name`, `slug`, `fiscal_data` jsonb, `primary_color`, `billing_email`, gmaps_*, smtp_*. Lo fiscal/marca vive en `company_settings`: `fiscal_legal_name`, `fiscal_tax_id`, `pdf_brand_color`, `contact_phone`, `contact_email`.) Fix: select `companies.name` + leer el resto de `company_settings`. Todos MODIFICA.

- [HIGH] `src/app/catalogo/[token]/page.tsx:138` — `companies(legal_name, trade_name, pdf_brand_color)` (página pública).
- [HIGH] `src/app/datasheet/[token]/page.tsx:133` — mismo trío (página pública).
- [HIGH] `src/modules/installations/pdf-generator.ts:844` — `companies(legal_name, trade_name, tax_id)` con `.single()` → THROW → PDF del parte falla.
- [HIGH] `src/modules/maintenance/public-confirmation-actions.ts:199` — `companies(name, phone, email)` (`phone`/`email` fantasma).
- [HIGH] `src/modules/installations/public-confirmation-actions.ts:208` — `companies(name, phone, email)`.
- [HIGH] `src/modules/contracts/pdf-generator.ts:1179` — `companies(legal_name, trade_name, tax_id)`.
- [MEDIUM] `src/modules/free-trials/pdf-generator.ts:866` — `companies(legal_name, trade_name, tax_id)` (degrada por fallback fiscal).
- [MEDIUM] `src/modules/savings/pdf-generator.ts:92` — `companies(legal_name, trade_name, tax_id)`.
- [MEDIUM] `src/modules/products/datasheet-pdf-v2.ts:382` — `companies(legal_name, trade_name, pdf_brand_color)`.
- [MEDIUM] `src/modules/products/catalog-pdf-v2.ts:220` — `companies(legal_name, trade_name, pdf_brand_color)`.
- [MEDIUM] `src/modules/products/datasheet-pdf.ts:211` — `companies(legal_name, trade_name)`.
- [MEDIUM] `src/modules/products/email-share-actions.ts:205` — `companies(legal_name, trade_name)`.

### CLUSTER B — `invoices.pending_cents` NO existe (reales: `total_cents`, `paid_amount_cents`)
Fix: calcular `total_cents - paid_amount_cents`. MODIFICA.

- [HIGH] `src/app/api/cron/daily/route.ts:1863` (filtro `.gt("pending_cents",0)` en :1867; uso en :1876/:1897) — la rutina automática de recordatorios de impago falla en silencio (no captura `error`, solo `data`) → no envía nada.
- [MEDIUM] `src/modules/invoices/smart-alerts.tsx:126,163,165` — alertas "facturas vencidas" / "pendiente de cobro €" siempre a 0 (try/catch).

### CLUSTER C — columnas renombradas
- [MEDIUM] `src/modules/products/smart-alerts.tsx:183` — `products.photo_url` (real `main_image_url`); alerta "sin foto" siempre 0. MODIFICA.
- [MEDIUM] `src/modules/incidents/smart-alerts.tsx:129` — `incidents.assigned_to` (real `assigned_user_id`); alerta "sin asignar" siempre 0. MODIFICA.
- [HIGH] `src/modules/points/cycles-actions.ts:215` — `user_profiles.department` (no existe; deriva de `user_roles`+`roles_catalog.default_department`); `/comisiones/[id]` con nombres/deptos en blanco. MODIFICA.
- [HIGH] `src/modules/time-tracking/punch-requests-actions.ts:135` — `user_profiles.email` (email vive en `auth.users`); panel de fichajes pendientes no resuelve nombres. MODIFICA.

### Informativo (fuera de las 21 tablas pero fallo silencioso real)
- `src/modules/points/my-commissions-card.tsx:104,155,170,187,219` — consulta tablas inexistentes `points_settings` (es columna jsonb de `company_settings`), `points_events`, `points_cycle_users`. Todo try/catch → tarjeta a ceros. Decidir: reescribir vs quitar.

---

## DIM 5 — Embeds PostgREST frágiles (14)

Todos resuelven hoy; el riesgo es la regla del proyecto (un fallo de relación tumba la query entera a `[]`/null en silencio). Fix: SELECT plano + lookup por id.

- [HIGH] `src/modules/maintenance/to-confirm-actions.ts:85-87` — `customers(...)`+`contracts(reference_code)` en `maintenance_jobs`, `listMaintenanceToConfirm`, `if(error) throw` SIN fallback.
- [HIGH] `src/modules/expenses/actions.ts:418` — `expense_categories(code,name)`+`customers(...)` en `expenses`, `listExpenses` (lista `/gastos`).
- [MEDIUM] `src/modules/wallet/actions.ts:54` — `contracts(reference_code)`,`customers(...)`,`invoices(full_reference,status)`, `listWalletEntries` (fallback solo cubre `invoice_id`).
- [MEDIUM] `src/modules/wallet/actions.ts:998` — `contracts(reference_code)`,`customers(...)`, `listPendingInvoiceWalletEntries`.
- [MEDIUM] `src/modules/invoices/verifactu-actions.ts:188-191` — `series:invoice_series(series_code)`, `listInvoicesV2`, `if(error) throw` sin fallback.
- [MEDIUM] `src/modules/savings/actions.ts:197` — `customers(...)`+`leads(...)`, `listSavingsProposals`.
- [MEDIUM] `src/modules/savings/actions.ts:562` — `product_categories(...)`, `listWizardProducts`.
- [MEDIUM] `src/modules/savings/actions.ts:626` — `product_categories!inner(...)`, `listWizardExtras` (`!inner` descarta filas sin FK).
- [MEDIUM] `src/modules/savings/actions.ts:647` — `product_attributes(key,label)` embed anidado, `listWizardExtras`.
- [MEDIUM] `src/modules/points/breakdown-actions.ts:174,215,235,255` — 4 embeds `customers(...)` (try/catch → degrada labels).
- [LOW] `src/modules/maintenance-plans/actions.ts:285` — `invoice_lines!inner(description)` (idempotencia, try/catch).
- [LOW] `src/modules/savings/actions.ts:721` — `product_categories(id,name)` (try/catch).
- [LOW] `src/modules/mailing/campaigns-actions.ts:57` — `email_templates(name)`, `listCampaignsAction`.
- [LOW] `src/modules/mailing/send-document-actions.ts:216` — `products(name)` (fail-soft).
- [MEDIUM] `src/app/(tenant)/gastos/[id]/page.tsx:50-52` — `expense_categories(...)`+`customers(...)` (detalle, null-guarded).

---

## DIM 6 — `schema.parse()` directo en server actions

**LIMPIO (0 violaciones).** Helpers en `src/shared/lib/zod-friendly.ts`: `parseOrFriendly` (línea 47),
`safeParseFriendly` (línea 65), `zBoolean` (línea 32). Las únicas `.parse()` de Zod son
`src/shared/lib/env.ts:28,36` (validación de env a nivel de módulo, no es server action). No hay `.parseAsync(`.

---

## DIM 7 — `z.coerce.boolean()`

**LIMPIO (0 violaciones).** El único texto `z.coerce.boolean(` es el comentario de advertencia
en `src/shared/lib/zod-friendly.ts:19-20`. El código usa `zBoolean()`.

---

## DIM 8 — `throw` de validación que el usuario debe leer (sistémico)

~200 sitios en `src/modules/**/actions.ts` hacen `throw new Error("<mensaje español al usuario>")`
en vez de `return { ok:false, error }`. En producción Next.js redacta `Error.message`, así que el
usuario ve un error genérico. Fix uniforme: devolver `{ ok:false, error }` (o usar `safeParseFriendly`)
y que el caller lo pinte. Excluidos los re-throws de errores de supabase (`throw new Error(error.message)`)
y centinelas internos (`"__skip__"`).

Prioridad ALTA (mensajes de negocio largos, los más dañinos al redactarse):
- [MEDIUM] `src/modules/free-trials/actions.ts:133` — "La fecha de entrega no puede ser anterior a hoy…"
- [MEDIUM] `src/modules/leads/actions.ts:779` — "Este lead tiene propuestas. Usa «Marcar como venta perdida»…"
- [MEDIUM] `src/modules/financiers/actions.ts:152` — "Una financiera de renting estricto no puede aceptar particulares…"
- [MEDIUM] `src/modules/customers/actions.ts:792` — "Ya existe otro cliente con ese DNI/CIF"
- [MEDIUM] `src/modules/expenses/actions.ts:193` — "Ya existe una categoría con código …"
- [MEDIUM] `src/modules/superadmin/companies/actions.ts:189` — "Ya existe una empresa con el slug …"
- [MEDIUM] `src/modules/tenant/users/actions.ts:125` — "Has alcanzado el límite de N usuarios"
- [MEDIUM] `src/modules/invoices/actions.ts:855` — "No se puede facturar un contrato cancelado."

Listado completo de líneas por módulo (clear-cut, español, visible al usuario):
incidents 34,103,115,269 · leads 328,479,684,741,756,767,791,804,816,870 ·
free-trials 114,117,120,133,189,200,210,445,448,450,452,465,468,1201,1219,1234,1253,1269 ·
maintenance-plans 107,120,210,351 · financiers 90,148,152,207,220,231,256,275 ·
installations 30,35,645,655,674,682,685,694,895,903,914,1386,1404,1418,1442,1465 ·
mailing 29,31,281,284,1001 · messaging 55,104 ·
gocardless 68,70,78,126,128,149,262,263,266,273,424,425,442,443,445,448 ·
maintenance 328,343,469,539,556 ·
expenses 59,61,127,160,162,165,193,206,208,248,250,251,252,491,492,503,504,523,524,525,548,549,550,568,569,571,574,632,670 ·
lost-sales 33,42,44,45 · mail 152,162,189,200 · products 276,285,301,312,315,333,348,496 ·
agenda 1171,1178,1187,1201,1325,1344,1374,1457,1469,1510,1521,1559,1571,1629,1637,1639,1646,1665,1673,1675,1678 ·
config/fiscal 54,103,180,187,225,227,230,233,239,249,271 ·
chat 308,319,326,333,342,456,464,466,485,495,497,520,522,555,556 ·
config/installations 10,11 · config/contracts 32 · config/company 32 · config/free-trials 25 ·
invoices 14,132,296,306,308,369,370,372,389,406,587,596,607,687,696,727,817,830,850,855,877,892,952,965,976,979,982,988,1002 ·
addresses 54,64,176 · config/modules 22,88,89 · config/google-maps 17,19 ·
customers/bank-accounts 50,119,121,160,172 · config/leads 10 · invoices/external-providers 17,19 ·
customers 549,724,773,792,821,840 · config/proposals 20 ·
proposals 361,638,654,655,657,800,801,842,843,871,884,926,1047,1055,1062,1096,1163 ·
contracts 191,273,275,284,443,737,753,763,793,801,1656,1661,1678,1756,1761,1773,1778,1811,1827,1848,1853,1989,2027,2037,2051 ·
superadmin/companies 15,189,291,336,337,349 · savings 60,62,141,143,496,498 ·
superadmin/catalogo 9 · config/units 18,57,71 · time-tracking 24,38,49 ·
tenant/users 15,16,125,159,164,279,281,327,342,345,367,414 · warehouses 33,39,97,118 ·
wallet 282,367,377,396,397,404,450,452,480,487,621,623,641,688,708,709,711,758,777,778,780.

---

## CONFIRMADO NO-BUG (para no re-marcar)
- `proposals` usa correctamente `chosen_plan_type` (nunca `plan_type`/`title`).
- `customers.legal_name`/`leads.legal_name` SÍ existen (solo `companies.legal_name` es fantasma).
- `incidents.title` SÍ existe (solo `maintenance_jobs.title` es fantasma — y ningún código vivo lo selecciona).
- `invoice_lines.tax_rate` SÍ existe.
- Numeración de facturas (`allocate_next_invoice_number`): contador atómico `FOR UPDATE`, patrón correcto.
- DIM 6 y DIM 7: limpios.
- Módulo `customers`: sin IDOR.

---

## RECOMENDACIÓN DE PRIORIZACIÓN
1. Arreglar el cron de impagos (`pending_cents`) — feature entera muerta en silencio.
2. Generadores #3/#4 (contracts/proposals): pasar a admin client + añadir índice único (limpiar duplicados antes).
3. Las 12 columnas fantasma de `companies` (páginas públicas + PDFs que petan).
4. Los 7 IDOR HIGH (todos fix de una línea, MODIFICA).
5. Caveat lexicográfico de `gen_reference_code` (LOW, solo >10k/empresa/año).
6. DIM 8 sistémico: migración gradual a `{ok:false,error}` empezando por los mensajes de negocio largos.
