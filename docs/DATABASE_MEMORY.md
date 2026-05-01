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

> Estado: SQL escrito, **no aplicado todavía** (owner aplica al final tras auditoría completa).

### Globales
| Tabla | Propósito | Migración |
|---|---|---|
| `companies` | Empresas tenant (clientes del SaaS) | 20260501120100 |
| `superadmins` | user_ids con rol superadmin global | 20260501120100 |
| `modules_catalog` | Catálogo cerrado de módulos | 20260501120100 |
| `roles_catalog` | Catálogo cerrado de los 8 roles | 20260501120100 |
| `permissions_catalog` | Catálogo (module, action, scope) | 20260501120100 |
| `role_permissions` | M:N rol↔permiso + field_restrictions | 20260501120100 |

### Tenant Capa 1
| Tabla | Propósito | Migración |
|---|---|---|
| `company_settings` | Config empresa (1 fila/empresa) | 20260501120200 |
| `company_modules` | Módulos activos por empresa | 20260501120200 |
| `user_profiles` | Perfil user dentro de empresa | 20260501120200 |
| `user_roles` | M:N user↔role (multi-rol decisión 1.2) + único parcial admin | 20260501120200 |
| `team_assignments` | Jerarquía director↔operativo | 20260501120200 |
| `permission_overrides` | Excepciones puntuales | 20260501120200 |

## 4. Migraciones escritas

| # | Archivo | Resumen | Estado |
|---|---|---|---|
| 1 | `20260501120000_init_extensions_and_types.sql` | pgcrypto, pg_trgm, unaccent. Schema `app`. Enums (department_kind, user_status, company_status, permission_action, permission_scope). `app.set_updated_at()` trigger. | ✅ Escrita |
| 2 | `20260501120100_global_tables.sql` | 6 tablas globales | ✅ Escrita |
| 3 | `20260501120200_tenant_core_tables.sql` | 6 tablas tenant Capa 1 | ✅ Escrita |
| 4 | `20260501120300_helper_functions.sql` | `app.current_company_id()`, `app.is_superadmin()`, `app.current_user_roles()`, `app.current_user_departments()`, `app.has_role()`, `app.in_department()`, `app.is_team_member_of()`, `app.team_member_ids()`, `app.can()` | ✅ Escrita |
| 5 | `20260501120400_auth_hook.sql` | `public.custom_access_token_hook(event jsonb)` — añade company_id, is_superadmin, roles[], departments[] al JWT | ✅ Escrita |
| 6 | `20260501120500_rls_policies.sql` | RLS habilitada en todas. Policies superadmin_all + tenant_isolation + admin_manage. | ✅ Escrita |
| 7 | `20260501120600_seeds_modules_roles_permissions.sql` | 19 módulos + 8 roles + permissions_catalog poblada + role_permissions según ADR 0001 § 4 | ✅ Escrita |

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

### Funciones existentes (`app` schema)
- `app.set_updated_at()` — trigger BEFORE UPDATE para `updated_at`.
- `app.current_company_id()` — uuid del JWT.
- `app.is_superadmin()` — boolean del JWT.
- `app.current_user_roles()` — text[] de roles del JWT.
- `app.current_user_departments()` — text[] derivado.
- `app.has_role(role_key)` — boolean.
- `app.in_department(dept)` — boolean.
- `app.is_team_member_of(manager_user_id, role_key default null)` — boolean.
- `app.team_member_ids()` — uuid[] miembros del equipo del manager actual.
- `app.can(module, action, scope)` — comprueba permiso vía roles + overrides.

### Funciones existentes (`public` schema)
- `public.custom_access_token_hook(event jsonb)` — Auth Hook custom claims.

### Vistas previstas (Capa 2 negocio)
- `view_products_safe` — productos sin `cost`/`margin` para roles sin permiso.
- Otras vistas pre-filtradas por departamento si optimización lo pide.

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
