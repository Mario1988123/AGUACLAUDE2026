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

> Pendiente de validar tras Capa 1.

### Globales (sin `company_id` — propiedad superadmin)
- `auth.users` (Supabase managed)
- `companies`
- `roles_catalog` (catálogo de roles base — ¿editables por empresa? duda #11)
- `permissions_catalog`
- `modules_catalog` (lista de módulos disponibles)
- `product_categories_global` (catálogo del superadmin que las empresas pueden precargar)
- `product_attributes_global`
- `financing_partners_global` (si financieras globales — duda #15)
- `system_logs` (auditoría de superadmin)

### Tenant (con `company_id` obligatorio)
> Pendiente diseño Capa 2.

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
- **Eventos / Timeline:** decisión pendiente (duda #8). Si tabla única → `timeline_events(subject_type, subject_id, kind, payload jsonb, occurred_at, actor_id)`.

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
