# Auditoría Hidromanager — 2026-07-06

Auditoría de seguimiento a la del 2026-06-11. Método: verificación directa de los
2 críticos estrella de junio + sub-auditoría del motor/rutas PDF (a mano) + barrido
multi-agente de (a) seguridad del código escrito **después** del 11-jun y (b)
calidad/rendimiento/robustez. Cada hallazgo lleva evidencia `archivo:línea`.

Estado marcado como **[VERIFICADO]** = abrí el código y lo confirmé en persona;
**[ANÁLISIS]** = hallazgo de agente con evidencia file:line, pendiente de blindar
con test.

## Estado de remediación (actualizado 2026-07-07)

| Hallazgo | Estado |
|---|---|
| S1 · Fuga PII agenda (CRÍTICO) | ✅ **CORREGIDO** (commit d54679b): `scoped()` acota las 9 lecturas admin a `company_id` |
| S2 · IDOR free-trials (IMPORTANTE) | ⚪ **FALSO POSITIVO**: el SELECT usa cliente RLS y `ft_select_by_scope` exige `company_id` como AND obligatorio → nunca devuelve trial ajeno. No requiere fix |
| S3 · Scope maintenance (MENOR) | ✅ **CORREGIDO** (commit 7c089aa): `.eq("company_id")` en `isLastContractedMaintenance` |
| S4 · product-datasheet sin auth (MENOR) | ✅ **CORREGIDO** (commit 50e771e): `requireSession` + validación de pertenencia |
| S5 · SSRF motor ficha (MENOR) | ✅ **CORREGIDO** (commit 50e771e): `isSafeRemoteUrl()` bloquea metadata/localhost/privadas |
| S6 · chat miembro sin validar (MENOR) | ⬜ Pendiente (sin fuga de lectura; solo notificaciones de mención) |
| S7 · chat sin allow-list MIME (MENOR) | ⬜ Pendiente (riesgo bajo: bucket privado, path con company_id) |

**Fase A (higiene):** A2 migración aplicada (owner). A3 Next→15.5.20 (commit 157b730).
A1 (tipos + quitar `as any`) **descartado**: los tipos reales rompen el build por
TS2349 de supabase-js con 176+ tablas; `Database = any` es un workaround deliberado.

**Fase D (tests) — ARRANCADA** (commit 30853bd): infraestructura vitest + 24 tests
de lógica pura de dinero (`computeSavings`, `formatEur`, mapeo de packs
`link-items`). `npm test` verde. Falta ampliar a numeración fiscal (verifactu),
haversine y ciclos de comisiones (todas puras), y a los flujos con BD cuando haya
entorno de test.

**Pendiente de mayor calado (requiere DECISIÓN):** §4 atomicidad dinero/stock —
sin transacciones (doble cobro / stock perdido). Es reescritura de flujos de
dinero → no se aborda en automático; hacer PRIMERO más tests de caracterización y
luego el refactor a RPC transaccional.

---

## 0. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Código | 204.462 líneas TS/TSX · 919 archivos · 44 módulos |
| `typecheck` | ✅ verde (0 errores) |
| Server actions | 227 archivos `"use server"` |
| `createAdminClient()` (salta RLS) | 286 usos / 100+ archivos |
| Tests automáticos | **0** (vitest instalado, sin pruebas) |
| `as any` | 1.006 (tipos de BD obsoletos) |
| `catch` | 1.457 (muchos fail-soft tras escritura crítica) |
| Vulns npm | 13 (1 crítica + 3 altas; crítica y 2 altas son dev-only) |

**Lo bueno:** la remediación que provocó la auditoría de junio funcionó. Los 2
críticos estrella (IDOR de leads y firma de contrato ajeno) están **cerrados**, y
el patrón se arregló de forma amplia (de 100+ archivos con admin client, solo 3
hacen `.delete()` sin `company_id`, y 2 son catálogo maestro superadmin —
legítimo). El motor HTML→PDF es seguro frente a inyección. Las rutas PDF de
contrato/factura validan pertenencia.

**Lo pendiente:** **1 crítico NUEVO** (fuga PII en agenda) en código posterior a
junio, 1 IDOR de escritura importante (free-trials), y un conjunto de problemas
**estructurales** que son la deuda real: 0 transacciones, 0 tests sobre lógica de
dinero/stock, tipos obsoletos y duplicación de la lógica de cobros/stock.

---

## 1. Verificación de la auditoría de junio (críticos estrella)

- **[VERIFICADO] IDOR leads — CERRADO.** `leads/actions.ts` `updateLeadAction`
  (:749), `deleteLeadAction` (:784), `markLeadAsLostAction` (:810), `updateLeadStatus`
  (:878): todas filtran `.eq("company_id", session.company_id)` y abortan si la
  fila no pertenece.
- **[VERIFICADO] Firma de contrato ajeno — CERRADO.** `contracts/actions.ts`
  `markContractSigned` (:760) lee el contrato con `.eq("company_id", …)` y lanza
  "no pertenece a tu empresa" antes de disparar wallet/instalación/sales.
- **[VERIFICADO] Patrón IDOR — remediado en amplitud.** Barrido: solo 3 archivos
  con `.delete()` sin `company_id`; 2 son `superadmin/catalogo` (cada export con
  `ensureSuperadmin()`, global legítimo) y 1 es `notifications/push-send` (tokens
  de dispositivo por usuario).

---

## 2. Hallazgos de seguridad NUEVOS (código posterior a 2026-06-11)

### 🔴 CRÍTICO

**S1 — [VERIFICADO] Fuga de PII cross-tenant en la agenda.**
`agenda/actions.ts:406` → `enrichTitlesFromSubjects` usa `const supabase =
createAdminClient()` (salta RLS) y resuelve `subject_id` de cada tarea sin
`company_id`: `customers` (:440), `leads` (:466), `installations` (:417),
`maintenance_jobs` (:424), `addresses` (:506/:526). Combinado con
`createAgendaEventAction` (:1397), que guarda `subject_type`/`subject_id`
arbitrarios sin validar pertenencia (`schemas.ts:26` los deja como uuid libre).
**Vector:** creo una tarea propia con `subject_type:"customer"`, `subject_id` =
UUID de un cliente de otra empresa → al abrir mi agenda me devuelve **nombre +
teléfono + dirección + coordenadas GPS** del cliente ajeno.
**Matiz de severidad:** requiere conocer un UUID ajeno válido (no adivinable), lo
que acota el riesgo práctico — pero es una ruptura de aislamiento vía service-role
y el fix es barato.
**Fix:** añadir `.eq("company_id", session.company_id)` a TODAS las lecturas admin
de `enrichTitlesFromSubjects`, y/o validar la pertenencia de `subject_id` en
`createAgendaEventAction` (como ya hace la rama `kind:"maintenance"`).

### 🟠 IMPORTANTE

**S2 — [ANÁLISIS] IDOR de escritura en free-trials.**
`free-trials/actions.ts:184` `installFreeTrialAction` carga
`.eq("id", id).single()` (:193) y hace `admin.update(...).eq("id", id)` (:228,
:233) **sin `company_id`**. Es un server action exportado e invocable directo (el
wrapper `signAndInstall` sí valida dueño, pero este no).
**Vector:** `installFreeTrialAction(trialAjenoId)` marca la prueba de otra empresa
como `installed` y crea `installations`/`customer_equipment` en MI empresa
referenciando el cliente/dirección ajenos.
**Fix:** cargar y actualizar con `.eq("company_id", session.company_id)` y abortar
si no pertenece.

### 🟡 MENORES

- **S3 — [ANÁLISIS]** `maintenance/actions.ts:742` `isLastContractedMaintenance`:
  carga el job `.eq("id", jobId)` con admin y solo `requireSession()` → filtra
  poco (devuelve `contract_id`/`customer_equipment_id` de un job ajeno). *Fix:
  `.eq("company_id", …)`.*
- **S4 — [VERIFICADO]** `api/pdf/product-datasheet/[id]/route.ts:18`: **sin
  `requireSession` ni token**; sirve la ficha de cualquier producto por UUID
  (generador sin scope). Solo datos de producto (sin PII), pero es un DOR. *Fix:
  exigir sesión + validar `company_id` del producto.*
- **S5 — [VERIFICADO] SSRF en el motor de ficha.** `datasheet-iagua-html.tsx:86`
  `fetchDataUri()` hace `fetch()` server-side a URLs de BD (`main_image_url`,
  `fiscal_logo_url`). Un admin de tenant podría apuntar a `http://169.254.169.254`
  (metadata cloud) o `localhost`. *Fix: validar https + host/bucket permitido
  antes del fetch.*
- **S6 — [ANÁLISIS]** `chat/actions.ts:632/:594`: al crear hilo directo/grupo se
  insertan miembros con `userIds` del navegador sin verificar que pertenecen a
  `session.company_id` (las LECTURAS sí filtran, así que no hay lectura de mensajes
  ajenos; sí notificaciones de mención). *Fix: verificar `user_roles` activo.*
- **S7 — [ANÁLISIS]** `chat/actions.ts:889` `sendChatAttachmentAction`: valida
  tamaño (8 MB) pero **no** el MIME (acepta SVG/HTML). Riesgo bajo (bucket privado,
  path con `company_id`, servido desde dominio Supabase sin cookies de la app).
  *Fix: allow-list de MIME.*

### ✅ Módulos revisados y limpios
superadmin/catálogo (cada export con `ensureSuperadmin`), time-tracking, config/pdf,
referrals, products/extra-targets, customers/equipment-pack, savings, resto de
maintenance, crons (`verifyCronAuth`). Rutas PDF de **contrato** (`requireSession`
+ rol + RLS + `company_id`), **factura** (`getInvoice` verifica `company_id !==
session → throw`) y **contrato público por token** (token ≥32, validado, con
caducidad/cancelación): seguras. Motor HTML→PDF (satori/JSX): **sin inyección** (el
contenido editable va como texto hijo de JSX, no concatenado en HTML).

---

## 3. Rendimiento

### 3a. N+1 reales (bucle con `await …from()` dentro) — top 8
1. `api/cron/daily/route.ts` — 32 bucles (cabeceras :272/:1211/:1367/:1601/:1882):
   UPDATE contracts / INSERT maintenance_jobs / invoices / agenda_events /
   notifications, **uno por contrato/empresa**. El mayor foco del sistema.
2. `customers/import-actions.ts:143` — SELECT+INSERT customers + INSERT addresses
   **por fila de CSV** (4-5 queries × N).
3. `warehouses/import-actions.ts:113` — 3 queries de stock por línea.
4. `contracts/post-sign.ts:85` (+ gemelo en `markContractSigned`) — INSERT
   wallet_entries + UPDATE contract_payments **por pago**.
5. `products/catalog-copy-helpers.ts:109/:178/:236` — INSERT por atributo/imagen/doc.
6. `free-trials/actions.ts:1297` — 3 queries de stock por ítem al retirar prueba.
7. `leads/import-actions.ts:110` — INSERT leads fila a fila.
8. `agenda/actions.ts:1380` — `computeIsOutsideHours()` = 2 queries por ocurrencia
   de evento recurrente (evento diario/anual → hasta 2×365 queries).

### 3b. Páginas con awaits secuenciales paralelizables
- **`clientes/[id]/page.tsx`** — 37 `await`, 3 `Promise.all`; ~18 fetches
  independientes en cascada (:119-197) colapsables a 1-2 rondas `Promise.all`. La
  página más lenta.
- **`contratos/[id]/page.tsx`** — 18 `await`, 1 `Promise.all`.
- **`dashboard/page.tsx`** — 10 `await`, 3 `Promise.all` (ya parcial; margen menor).

### 3c. Listados sin límite (reventarán con volumen)
- `products/actions.ts:19` `listProducts` y `:145` `listProductsForProposal` — **sin
  `.limit/.range`**; cargan todo el catálogo y alimentan selects de propuestas/contratos.
- Truncado silencioso (datos invisibles sin aviso): `listProposals` (200),
  `listLeads` (200), `listCustomers` (2000).
- Referencia bien hecha: `listContracts` / `listInvoices` usan `.range()` paginado.

---

## 4. Robustez

**Contexto:** no existe **ninguna transacción real** (solo 2 `rpc` de numeración
fiscal). Todo write multi-tabla es no atómico y muchos pasos son `catch` fail-soft.

### 4a. Operaciones multi-tabla sin transacción — top 6
1. **`contracts/post-sign.ts` `runPostSignSideEffects`** — cascada de firma
   (wallet + contract_payments + installations + items + sales_records + reserva
   stock + events), cada paso en su try/catch. **Doble cobro posible:** si INSERT
   `wallet_entries` (:85-107) tiene éxito pero el UPDATE
   `contract_payments.wallet_entry_id` falla, la idempotencia (basada en
   `wallet_entry_id IS NULL`) re-inserta el cobro en la siguiente ejecución.
2. **`contracts/actions.ts:760` `markContractSigned`** — copia inline (~600 líneas)
   del flujo anterior, con los mismos riesgos y ya divergiendo en manejo de errores.
3. **`warehouses/transfer-actions.ts:19` `transferStockAction`** — decrementa
   origen (:47) → incrementa destino (:62) → movimientos (:78). Si falla el destino
   tras decrementar origen, **el stock se evapora**. Sin compensación.
4. **`installations/actions.ts:1464` `completeInstallation`** — decrementa stock
   (:1719) → INSERT customer_equipment (:1791) → activa contrato (:1826) → puntos
   (:1894). No atómico (ver 4b).
5. **`free-trials/actions.ts:~1275` (retirar prueba)** — UPDATE removed + stock por
   ítem; fallo intermedio deja prueba "retirada" con stock a medio devolver.
6. **`customers/uninstall-actions.ts:383`** — reincorporación de stock al
   desinstalar sin atomicidad.

### 4b. `catch` que continúan tras escritura crítica (corrompen datos)
1. **`installations/actions.ts:1811`** — si falla INSERT `customer_equipment`, solo
   `console.error` y el bucle sigue; luego activa contrato y da puntos. Como el
   stock **ya se decrementó (:1719)**: **stock perdido, sin equipo registrado, pero
   el negocio lo da por completado y paga puntos.**
2. **`installations/actions.ts:1719`** — `decrementStockForInstallation` en `catch
   {}` vacío → **stock fantasma** silenciado.
3. **`contracts/post-sign.ts:191`** — si falla INSERT `installation_items`, solo
   log; la instalación queda **creada sin líneas**. Igual en :108 (wallet) y :339
   (sales_records).

---

## 5. Deuda / estructura

### 5a. Top archivos (god files a trocear)
`cron/daily/route.ts` (2221) · `contracts/actions.ts` (2196) · `agenda/actions.ts`
(2012) · `installations/actions.ts` (1947) · `installation-wizard.tsx` (1752) ·
`contracts/pdf-generator.ts` (1499) · `proposals/actions.ts` (1473).

### 5b. Duplicación
1. **Efectos post-firma duplicados**: `post-sign.ts` (canónico) vs los ~600 inline
   de `markContractSigned`. Toda corrección de dinero/stock hay que hacerla dos
   veces; ya divergen.
2. **Mutación de stock copy-paste en ~20 archivos** (`transfer-actions`,
   `free-trials`, `warehouses/import`, `loading-request`, `purchase`, `stock-count`,
   `uninstall`, `stock-decrement`…): patrón `select stock → update/insert → insert
   movements` sin un `adjustStock()` central → el bug de atomicidad está replicado.
3. **5+ generadores PDF** de ~1000-1500 líneas reimplementan paginación/cabecera/pie
   sobre `pdf-lib`, compartiendo solo el sanitizer.

### 5c. Tipos de BD obsoletos
`database.types.ts` (01-jul) no tiene `product_extra_targets` ni `referrals` →
explica gran parte de los **1.006 `as any`**. Al castear a `any`, TypeScript deja
de avisar si olvidas un `.eq("company_id")` — **desactiva la red de tipos justo en
las queries donde el aislamiento importa.**

### 5d. Vulnerabilidades npm
- **Runtime:** `nodemailer` (crítico/alto: SMTP/CRLF injection, lectura de fichero
  arbitraria + SSRF vía opción `raw`) → subir a `nodemailer@9` (breaking).
  `postcss <8.5.10` vía `next` (XSS moderada) → subir `next`/`postcss`.
- **Dev-only (no van al bundle):** `vitest`/`@vitest/mocker` (crítico), `vite`
  (alto), `tar`/`supabase` CLI (moderadas).

---

## 6. Tests
**0 tests** sobre 204k líneas que mueven dinero/contratos/stock/SEPA. Vitest ya
configurado → coste de arranque cero. 5 zonas de mayor ROI:
1. **Cobros al firmar** — `post-sign.ts:runPostSignSideEffects`: firmar 2× no
   duplica wallet_entries/sales_records (idempotencia); fallo del UPDATE
   contract_payments no genera cobro doble.
2. **Conservación de stock en transferencia** — `transfer-actions.ts`: origen+destino
   se conservan; stock insuficiente no muta nada.
3. **Cierre de instalación** — `completeInstallation`: si falla el INSERT de equipo,
   el stock NO queda decrementado ni se dan puntos (hoy sí — 4b.1).
4. **Importes por plan** — `post-sign.ts:288` + pricing de proposals: tabla de casos
   cash/rental/renting.
5. **Numeración fiscal** — `invoices/actions.ts:382` + `verifactu:659`: correlativa
   sin huecos/duplicados bajo concurrencia (AEAT/VeriFactu).

---

## 7. Plan de mejoras priorizado

### Fase A — Higiene inmediata (horas, sin riesgo, sin subagentes)
- **A1.** Regenerar `database.types.ts` (`supabase gen types`) → eliminar `as any`
  del cliente Supabase empezando por leads/contracts/wallet/invoices. Recupera la
  protección de tipos anti-IDOR.
- **A2.** Aplicar la migración `20260703200000_equipment_packs.sql` al remoto.
- **A3.** `npm audit fix` para el clúster runtime; evaluar `nodemailer@9` (breaking).

### Fase B — Cerrar los IDOR nuevos (rápido, alto valor de seguridad)
- **B1.** S1 agenda: `company_id` en `enrichTitlesFromSubjects` + validar
  `subject_id` en `createAgendaEventAction`. **(crítico)**
- **B2.** S2 free-trials `installFreeTrialAction`: filtrar/abortar por `company_id`.
- **B3.** S3–S7: scope en maintenance, auth en `product-datasheet`, allow-list host
  del fetch de ficha (SSRF), validar miembros de chat, allow-list MIME de adjuntos.

### Fase C — Atomicidad del dinero/stock (la deuda que más duele)
- **C1.** `adjustStock()` central (idealmente RPC/función Postgres transaccional) y
  migrar los ~20 call-sites → mata el bug de atomicidad replicado y la duplicación.
- **C2.** Envolver la cascada de firma y `completeInstallation` en RPC atómica
  (all-or-nothing); dejar de tragar errores tras escritura crítica.
- **C3.** Unificar `markContractSigned` para que use `post-sign.ts` (borrar el inline).

### Fase D — Red de seguridad (tests)
- Los 5 tests de §6, empezando por cobros al firmar y stock. No busca cobertura
  alta: blinda el dinero.

### Fase E — Rendimiento
- Paralelizar `clientes/[id]` y `contratos/[id]` con `Promise.all`.
- Paginar `listProducts`/`listProductsForProposal`; convertir el truncado silencioso
  de leads/customers/proposals en paginación con aviso.
- Batch de los N+1 del cron diario y de los imports (insert masivo en vez de fila a fila).

---

*Generado el 2026-07-06. Seguimiento de AUDITORIA_2026-06-11.md.*
