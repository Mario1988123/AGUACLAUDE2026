# Resumen de ejecución — Auditoría nocturna 2026-06-21

Trabajo autónomo mientras Mario duerme. Criterio: arreglar lo **seguro y verificado**;
lo que toca dinero/fiscal/PDF de cara al cliente o necesita ver la pantalla, **documentado
para revisión** (no tocado a ciegas). Todo build-verificado antes de commit.

> ⚠️ **Cuenta Supabase**: el conector MCP sigue apuntando a otra cuenta (TURIAVAL_PROYECTOS /
> turmalina-relojes), NO a aguaclaude2026 (osmofilter.com). No se ha podido consultar/aplicar
> en la BD real; todo el diagnóstico es por código. Reconectar cuando puedas (ver chat).

---

## ✅ HECHO y commiteado a `main` (auto-deploy Vercel)

| Commit | Qué |
|--------|-----|
| `6d77935` | (sesión previa) Fix `uniq_free_trials_ref` en pruebas gratuitas: `gen_reference_code` → SECURITY DEFINER. Migraciones `20260702100000` + `20260702200000` (captura auto de errores). |
| `79eb8ea` | Correlativos **C-** (contratos) y **P-** (propuestas) ahora leen el MAX con cliente admin (sin RLS) → ya no duplican número para comerciales scope 'own'. |
| `07fb4c2` | Informes de auditoría 01/02/03. |
| `15c20f9` | (1) Calc. ahorro: embed `product_attribute_values.value`/`product_attributes.label` (inexistentes) → `value_text`/`name`. (2) **UX autoscroll**: nuevo `ScrollToOnMount`; `/agenda` baja al calendario y `/clientes` a la tabla al abrir. |
| `202884f` | **Hora Madrid (display)**: `timeZone: Europe/Madrid` en horas/fechas de cara al cliente: emails recordatorio mantenimiento + confirmación instalación, páginas públicas `/m` y `/i`, PDF parte de instalación, avisos del cron diario. |

### ⚠️ Migraciones PENDIENTES de aplicar por Mario (en la BD de aguaclaude)
1. `20260702100000_gen_reference_code_security_definer.sql`
2. `20260702200000_error_reports_auto_capture.sql`

(El código ya desplegado degrada suave si aún no están aplicadas.)

---

## 🔶 PENDIENTE — requiere TU revisión (no tocado: dinero/fiscal/PDF o pantalla)

Orden por prioridad. Cada uno con el arreglo exacto.

### 1) [ALTO] Impagos no se envían — columna `invoices.pending_cents` NO existe
- `pending_cents` se **calcula en JS** (`invoices/actions.ts`: `total_cents - pagado`), NO es columna.
- Pero se consulta como si lo fuera en:
  - `src/app/api/cron/daily/route.ts:1863,1867` (`.select("...pending_cents...")` y `.gt("pending_cents",0)`) → el cron de recordatorios de impago **no envía nada**.
  - `src/modules/invoices/smart-alerts.tsx:126,163,165` (alerta "vencidas >30d").
- **Arreglo**: no se puede filtrar `pending_cents` en BD. Opciones: (a) traer facturas no pagadas por `status` + `due_date`, traer sus `contract_payments`/pagos y calcular pendiente en JS antes de decidir; o (b) añadir columna materializada `pending_cents` mantenida por trigger. Recomendado (a) para no tocar esquema.

### 2) [ALTO] SELECT a columnas inexistentes de `companies` (catálogo/ficha pública + PDFs)
- `companies` SOLO tiene: `name, slug, fiscal_data(jsonb), logo_url, primary_color`. **NO** tiene `legal_name`, `trade_name`, `tax_id`, `pdf_brand_color`. Esos viven en **`company_settings`** (`fiscal_legal_name`, `fiscal_trade_name`, `fiscal_tax_id`, `pdf_brand_color`) y/o `companies.fiscal_data`.
- SELECTs rotos:
  - `src/app/catalogo/[token]/page.tsx:138` y `src/app/datasheet/[token]/page.tsx:133` → `companies(legal_name, trade_name, pdf_brand_color)`.
  - `src/modules/free-trials/pdf-generator.ts:866` y `src/modules/contracts/pdf-generator.ts:1179` → `companies(legal_name, trade_name, tax_id)`.
- **Arreglo**: leer de `company_settings` (`fiscal_legal_name`, `fiscal_trade_name`, `fiscal_tax_id`, `pdf_brand_color`) y de `companies` (`name`, `primary_color`). NO lo apliqué porque son **documentos legales/PDF y páginas públicas**: mejor que verifiques qué nombre fiscal quieres mostrar (razón social de company_settings vs name).

### 3) [ALTO/CRÍTICO] Hora de Madrid en LÓGICA de servidor (cron diario)
Estos **cambian qué se procesa**, tocan facturación → no los apliqué solo. Informe `01_timezone.md`.
- `src/app/api/cron/daily/route.ts` (≈ líneas 264, 1163, 1202, 1334, 1505): "hoy/día 1/día 25" calculado con `toISOString().slice(0,10)` o `getDate()` en **UTC**. El cron corre a 22:00 UTC = medianoche Madrid → desfase garantizado: contratos se activan / pruebas caducan / **facturación recurrente se dispara el día equivocado**.
- **Arreglo**: usar helpers de `format-date.ts` → `madridDateKey(new Date())` para "hoy", `madridParts(new Date()).day` para día del mes, `madridDayRangeUtc()` para rangos. Probar con cuidado (afecta dinero).
- `src/modules/free-trials/actions.ts:130-131`: validación "no fecha pasada" con `setHours(0,0,0,0)` UTC → puede rechazar fechas válidas cerca de medianoche. Arreglo: comparar con `madridDateKey`.
- `src/modules/customers/delete-flow-actions.ts:144-160`: baja de cliente guarda `scheduled_at`/`uninstalled_at` de un `datetime-local` **sin** `madridLocalToUtcISO`. Arreglo: envolver con `madridLocalToUtcISO` (mismo patrón que el resto).

### 4) [ALTO] `invoice_lines`: el código usa `discount_pct`, la columna es `discount_percent`
- `src/modules/invoices/verifactu-actions.ts:391,577` (insert), `src/app/api/pdf/invoice-verifactu/[id]/route.ts:64,122`, `src/modules/invoices/verifactu-pdf.ts:45`.
- **Arreglo**: renombrar `discount_pct` → `discount_percent` en esos sitios (insert + select + tipos). Es fiscal (Verifactu) → revísalo tú; el valor insertado es 0, riesgo bajo, pero es facturación.

### 5) [ALTO] IDOR / falta guard de empresa (informe 02)
Server actions con `createAdminClient()` (salta RLS) sin filtrar por `company_id`/rol:
- `src/modules/addresses/actions.ts:129-133` (`upsertAddressAction`).
- `src/modules/maintenance-plans/actions.ts:354-361` (`cancelMaintenanceContractAction`).
- `src/modules/time-tracking/attendance-gaps-actions.ts:92-137`.
- `src/modules/invoices/verifactu-actions.ts:138-142` (`upsertInvoiceSeriesAction` — serie fiscal de otra empresa).
- `src/modules/contracts/actions.ts:682-720` (`cleanupDuplicateContractPaymentsAction`).
- **Arreglo**: añadir `.eq("company_id", session.company_id)` y/o comprobación de pertenencia + gate de rol. Revisar uno a uno (cada uno tiene su matiz).

### 6) [MEDIO] Índices únicos de correlativos (tras el fix de duplicados)
- `contracts` y `proposals` NO tienen índice único en `reference_code` → puede haber duplicados YA existentes. Antes de añadir `unique(company_id, reference_code)` hay que **limpiar duplicados**. Migración + limpieza → tu decisión.

### 7) Esquema BD (informe 03) — revisar
- `invoice_taxes` y `gocardless_webhook_events` sin RLS.
- 9 pares de migraciones con timestamp idéntico (orden no determinista).
- ~17 tablas inertes (lista en `03_esquema_bd.md`) — decidir si limpiar.
- ~32 FK a `auth.users` sin `ON DELETE` (borrar usuario puede bloquearse).

---

## 🎨 UX — estado

Auditorías UX completas: `04_ux_responsive.md` y `05_ux_flujos.md`.

### ✅ Hecho (commits `15c20f9` + `121458a`)
- Componente reutilizable `ScrollToOnMount` (`src/shared/components/scroll-to-on-mount.tsx`).
- **Autoscroll al contenido** en 7 páginas: `/agenda`, `/clientes`, `/productos`, `/facturas`, `/mantenimientos`, `/leads`, `/contratos`.
- `flex-wrap` en cabeceras de `/clientes` y `/productos` (botones ya no ocupan fila entera ni se salen en móvil).

### 🔸 Pendiente UX (todo de bajo riesgo, listo para aplicar)
- **Autoscroll en el resto** (mismo patrón): `propuestas` (ancla antes de `proposals.length===0`, id `prop-content`), `pruebas-gratuitas` (Card "Listado" :147, id `pruebas-content`), `incidencias` (Card "Listado" :76, id `incid-content`), `wallet` (:428), `gastos`, `comisiones`, `contratos/alquileres`. NO en `dashboard` ni fichas. `instalaciones` tiene varias vistas → anclar con cuidado.
- **Plan responsive por patrón** (informe 04, aplicar y revisar en pantalla):
  - P1: `w-full sm:w-auto` en submits/selects de las barras de filtros (instalaciones, mantenimientos, contratos, wallet, agenda, productos).
  - P2: botones-icono de fila a 44px en móvil (`h-10 w-10 sm:h-8 sm:w-8`) — 66 ocurrencias; mejor crear un componente compartido.
  - P4: `min-w-[680-720px]` a tablas en `overflow-x-auto` sin min-w.
  - P5: envolver tablas desnudas (`/ventas`, `/comisiones`, histórico wallet) en `ResponsiveTableWrapper`.
- **Flujos / menos clics** (informe 05): mover acciones de cabecera a menú overflow en fichas con 5 botones; plegar filtros de leads/productos/wallet en `<details>`; revisar dobles modales (agendar tarea, equipo en ficha cliente).
- **Adopción de primitivas**: `src/shared/ui/layout/` (PageHeader/FilterBar) apenas se usa; migrar páginas a ellas unificaría el responsive (revisar caso a caso).

---

## Próximos pasos sugeridos
1. Aplicar las 2 migraciones pendientes.
2. Reconectar Supabase MCP a la cuenta osmofilter.com.
3. Revisar y dar OK a los puntos 1-4 de arriba (impagos, companies, hora-cron, discount_pct).
4. Relanzar auditoría UX responsive y aplicar mejoras por patrón.
