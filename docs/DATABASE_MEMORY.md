# DATABASE_MEMORY.md — AGUACLAUDE2026

> **Estado de la base de datos.** Lista de tablas, propósito, relaciones, RLS, migraciones. Actualizar **al ejecutar cada migración**. Si una tabla no aparece aquí, no existe.

---

## 1. Convenciones

- **Idioma:** nombres en inglés, snake_case, plural (`leads`, `companies`, `wallet_entries`).
- **Sufijos estándar:**
  - `_id` → FK
  - `_at` → timestamp con timezone (`created_at`, `updated_at`, `deleted_at`)
  - `_by` → FK a `auth.users` (`created_by`, `updated_by`)
- **PK:** siempre `id uuid default gen_random_uuid() primary key`.
- **company_id:** obligatorio en toda tabla tenant. NOT NULL. Index B-tree.
- **Soft-delete:** decisión pendiente (duda #19).
- **Timestamps:** `created_at timestamptz not null default now()` + trigger `set_updated_at()` para `updated_at`.
- **RLS:** habilitada por defecto en TODAS las tablas tenant. Policies derivadas de JWT claim `company_id`.
- **Documentación:** cada tabla y columna lleva `COMMENT ON ...` en español explicando propósito.

## 2. Mapa de tablas globales vs tenant

> Cerrado para Capa 1. Capa 2 ampliará con tablas de negocio.

### Globales (sin `company_id` — propiedad superadmin)
- `auth.users` (Supabase managed)
- `companies`
- `superadmins` (lista de user_ids con rol superadmin global)
- `roles_catalog` (8 roles fijos predefinidos — duda #11 ✅ resuelta)
- `permissions_catalog` (catálogo `(module, action, scope)`)
- `role_permissions` (M:N rol ↔ permiso, con `field_restrictions jsonb`)
- `modules_catalog` (lista cerrada de módulos)
- `product_categories_global` (catálogo del superadmin precargable por empresas)
- `product_attributes_global`
- `financing_partners_global` (pendiente confirmación duda #15)

### Tenant (con `company_id` obligatorio) — Capa 1
- `company_settings` (config empresa)
- `company_modules` (módulos activos por empresa, los enciende/apaga superadmin)
- `user_profiles` (perfil dentro de empresa, FK a `auth.users`)
- `user_roles` (asignación rol ↔ user en empresa)
- `team_assignments` (jerarquía director ↔ operativo)
- `permission_overrides` (excepciones puntuales — opcional)

### Tenant (con `company_id` obligatorio) — Capa 2 prevista
- `addresses` (única, polimórfica con `owner_type` + `owner_id`)
- `events` (timeline única — duda #8 ✅ resuelta)
- `notifications`
- `documents` (única, polimórfica)
- `agenda_events` (única, tipo discriminado)
- `leads`, `customers`, `customer_bank_accounts`, `customer_contacts`
- `products`, `product_categories` (locales empresa), `product_attributes` (locales), `product_attribute_values`, `product_images`, `product_compatibilities`
- `proposals`, `proposal_items`, `proposal_payment_options`
- `contracts`, `contract_items`, `contract_payments`, `contract_signatures`
- `free_trials`, `free_trial_items` (entidad independiente — duda #17 ✅ resuelta)
- `installations`, `installation_steps`, `installation_photos`, `installation_signatures`
- `maintenance_jobs`, `maintenance_items_replaced`
- `incidents`
- `warehouses`, `warehouse_locations`, `warehouse_stock`, `stock_movements`, `loading_requests`
- `wallet_entries`
- `sales_records`
- `lost_sales`
- `price_approvals`
- `customer_equipment` (incluye equipos no nuestros para mantenimientos)

## 3. Tablas existentes

| Tabla | Propósito | Migración | Notas |
|---|---|---|---|
| _(ninguna todavía)_ | | | Capa 2 aún no ejecutada |

## 4. Migraciones aplicadas

> Numeración: `00000_descripcion.sql` en `supabase/migrations/`. Una migración = un cambio atómico.

| # | Archivo | Aplicada en | Resumen |
|---|---|---|---|
| – | – | – | Ninguna ejecutada todavía |

## 5. Reglas anti-duplicación

> Lecciones aprendidas para no romper la pulcritud del modelo:

- **Direcciones:** una sola tabla `addresses` polimórfica con `owner_type` + `owner_id` (lead, customer, installation_site). NO crear `lead_addresses`, `customer_addresses`, etc. — pendiente confirmar tras duda #8.
- **Productos y recambios:** un solo árbol `products` con `is_consumable boolean` o `kind enum`. NO duplicar entre `products` y `spare_parts`.
- **Pagos / Wallet:** una sola tabla `wallet_entries`. Vincular via `source_type` + `source_id` a contrato/instalación/etc. NO `contract_payments` + `installation_payments`.
- **Tareas / Agenda:** una sola tabla `agenda_events` que recoja visita, instalación, llamada, mantenimiento, incidencia, recordatorio, manual. Tipo discriminado.
- **Documentos:** una sola tabla `documents` con `kind` + `subject_type` + `subject_id` y URL a Storage. NO `contract_documents`, `installation_documents`, etc.
- **Notificaciones:** una sola tabla `notifications` con `kind` + `subject_type/id` + `target_user_id` + `read_at`. Aplicable a campana, push, email log.
- **Eventos / Timeline:** ✅ Decidido (duda #8): tabla única `events(id, company_id, subject_type, subject_id, kind, payload jsonb, occurred_at, actor_user_id)`. `subject_type` validado por `CHECK` enum. Trigger valida existencia de `subject_id` antes de insert.
- **Pruebas gratuitas:** ✅ Decidido (duda #17): tabla independiente `free_trials` (no es tipo de `contracts`). Si el cliente acepta → genera nuevo `contract` vinculado por `source_free_trial_id`.
- **Versionado propuestas:** ✅ Decidido (duda #2): editar = nueva fila, anterior `status='superseded'`. Trazabilidad por `parent_proposal_id` autoreferencial.

## 6. Vistas y funciones SQL

> Vacío todavía.

Patrones previstos:
- `view_products_safe` → productos sin `cost`/`margin` (para roles sin permiso de campo).
- `fn_company_id()` → función SECURITY DEFINER que devuelve el `company_id` del usuario actual desde JWT.
- Trigger `set_updated_at()` reusable.
- Trigger `audit_log()` reusable (si decidimos auditoría).

## 7. RLS — patrón base previsto

```sql
-- Patrón estándar para tablas tenant
alter table <tabla> enable row level security;

-- SELECT: solo de mi empresa
create policy "<tabla>_select_own_company"
  on <tabla> for select
  using (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- INSERT: solo en mi empresa
create policy "<tabla>_insert_own_company"
  on <tabla> for insert
  with check (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- UPDATE/DELETE: depende de scope (own/department/assigned/all_company)
-- Se modelan con función helper que mira el rol del usuario
```

## 8. Índices imprescindibles (lista provisional)

- `(company_id)` en todas las tablas tenant.
- `(company_id, created_at desc)` en tablas de timeline (leads, wallet_entries, etc.).
- `(company_id, status)` donde haya estados.
- `(assigned_user_id)` en leads, instalaciones, etc.
- GIN en `payload jsonb` si hacemos timeline única.

## 9. Storage buckets previstos

- `documents` — bucket único, RLS por path prefix `/{company_id}/...`.
  - Subcarpetas: `/products/`, `/contracts/`, `/installations/`, `/proposals/`, `/avatars/`, `/logos/`.

---

> **Antes de crear cualquier tabla**, esta sección debe documentarla con: nombre, propósito (1 línea español), columnas clave, FKs, RLS resumida, índices, y "no duplicar con X".
