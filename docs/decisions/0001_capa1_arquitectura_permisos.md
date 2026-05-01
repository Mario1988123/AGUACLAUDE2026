# ADR 0001 — Capa 1: Arquitectura multi-tenancy y permisos

- **Fecha:** 2026-05-01
- **Estado:** Propuesta (esperando respuestas a dudas § 11 de PROJECT_MEMORY.md)
- **Autor:** Claude (Opus 4.7) bajo dirección de Mario Ortigueira

---

## 1. Contexto

CRM SaaS multi-tenant. Un superadmin global gestiona empresas tenant. Cada empresa tiene su propia jerarquía interna de usuarios. Los datos NUNCA se mezclan entre empresas. Los permisos son críticos.

## 2. Modelo de actores

```
                   ┌────────────────────────┐
                   │    SUPERADMIN GLOBAL   │
                   │  (1..n usuarios)       │
                   │  Owner del SaaS        │
                   └───────────┬────────────┘
                               │ gestiona
                ┌──────────────┴──────────────┐
                │                             │
        ┌───────▼────────┐           ┌────────▼───────┐
        │   COMPANY A    │           │   COMPANY B    │
        │   (tenant)     │           │   (tenant)     │
        └───────┬────────┘           └────────┬───────┘
                │                             │
   ┌────────────┴────────────┐                ...
   │                         │
   │ company_admin (1..n)    │  ← nivel 1
   │                         │
   ├─ technical_director     │  ← nivel 2
   ├─ commercial_director    │
   └─ telemarketing_director │
        │                    │
        ├─ installer (n)     │  ← nivel 3 (subordinados a director técnico)
        ├─ sales_rep (n)     │  ← nivel 3 (subordinados a director comercial)
        └─ telemarketer (n)  │  ← nivel 3 (subordinados a director TMK)
```

## 3. Tablas core (Capa 1) — propuesta

> Solo el esqueleto multi-tenancy + permisos. Las tablas de negocio (leads, customers, etc.) van en Capa 2.

### 3.1 Globales (sin `company_id`)

| Tabla | Propósito | Notas |
|---|---|---|
| `companies` | Empresas tenant. Una fila = un cliente del SaaS. | Solo accesible al superadmin para CRUD. Cada empresa lee solo su propia fila. |
| `modules_catalog` | Catálogo cerrado de módulos disponibles (`leads`, `customers`, ...). | Seed inicial. No editable. |
| `roles_catalog` | Catálogo cerrado de los 8 roles. | Seed inicial. No editable. |
| `permissions_catalog` | Catálogo de permisos atómicos `(module, action, scope)`. | Seed inicial. |
| `role_permissions` | M:N rol ↔ permiso. Define qué puede cada rol. | Seed inicial. |
| `superadmins` | Lista de `auth.user_id` con rol superadmin. | Bypassa RLS de tablas tenant vía función `is_superadmin()`. |

### 3.2 Tenant (con `company_id`)

| Tabla | Propósito | RLS resumida |
|---|---|---|
| `company_settings` | Config general de la empresa (horario comercial, logo, datos fiscales...). | Solo admin de la empresa. |
| `company_modules` | Qué módulos tiene activos cada empresa (toggle del superadmin). | Lectura abierta a todos los users de la company. Escritura solo superadmin. |
| `user_profiles` | Perfil del usuario dentro de la empresa (nombre, foto, departamento, status). FK a `auth.users`. | Owner ve y edita su perfil. Admin de empresa ve y edita todos los de su empresa. |
| `user_roles` | Asignación rol ↔ usuario dentro de empresa. | Solo admin de empresa puede modificar. Lectura para `can(...)`. |
| `team_assignments` | Quién es jefe de quién (director X → operativo Y). | Solo admin/director crean y modifican. |
| `permission_overrides` | Excepciones puntuales por usuario (ej. "este sales_rep sí puede ver costes"). Opcional. | Solo admin. |

### 3.3 Estructura `permissions_catalog`

```
(module, action, scope)
```

- **module:** `leads` | `customers` | `proposals` | `contracts` | `installations` | `maintenance` | `incidents` | `products` | `warehouses` | `agenda` | `wallet` | `sales` | `dashboard` | `notifications` | `settings` | `free_trials` | `lost_sales` | `users_admin` | `superadmin_console`
- **action:** `view` | `create` | `update` | `delete` | `approve` | `assign` | `export`
- **scope:** `all_company` | `department` | `assigned_team` | `own` | `global` (solo superadmin)

Permisos a nivel **campo sensible** se gestionan por separado vía `field_restrictions` en la tabla `role_permissions` (columna jsonb). Ejemplo:

```jsonb
{
  "products": {
    "hidden_fields": ["cost", "margin", "supplier_price"]
  },
  "customers": {
    "hidden_fields": ["iban_full", "bank_holder"]
  }
}
```

## 4. Matriz de permisos por rol

> ✅ tiene permiso · ❌ no tiene · ⚠️ con condición

| Módulo / Rol | superadmin | company_admin | tech_director | commercial_director | tmk_director | installer | sales_rep | telemarketer |
|---|---|---|---|---|---|---|---|---|
| **superadmin_console** (CRUD empresas, módulos activos, límites) | ✅ global | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **settings** (configuración empresa y módulos) | ❌ | ✅ all_company | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **users_admin** (crear/editar usuarios empresa) | ❌ | ✅ all_company | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **leads** view | ❌ | ✅ all_company | ❌ | ✅ department | ✅ department | ❌ | ✅ own | ✅ own |
| **leads** create | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **leads** update/delete | ❌ | ✅ | ❌ | ✅ department | ✅ department | ❌ | ✅ own | ✅ own |
| **leads** assign | ❌ | ✅ | ❌ | ✅ | ✅ ⚠️(solo a sales_rep) | ❌ | ❌ | ❌ |
| **customers** view | ❌ | ✅ | ❌ | ✅ department | ⚠️ ver pregunta 1.4 | ⚠️ assigned (sin email/banco) | ✅ own | ❌ |
| **customers** update | ❌ | ✅ | ❌ | ✅ department | ❌ | ❌ | ✅ own | ❌ |
| **proposals** view | ❌ | ✅ | ❌ | ✅ department | ❌ | ❌ | ✅ own | ❌ |
| **proposals** create | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **proposals** approve (precio bajo mínimo) | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **contracts** view | ❌ | ✅ | ⚠️ assigned (parte técnico) | ✅ department | ❌ | ⚠️ assigned (sin precio total) | ✅ own | ❌ |
| **contracts** create | ❌ | ✅ | ❌ | ✅ department | ❌ | ❌ | ✅ ⚠️(de propuesta propia) | ❌ |
| **installations** view | ❌ | ✅ | ✅ department | ⚠️ ver agenda equipo (sin parte detalle) | ❌ | ✅ own | ⚠️ assigned (estado básico) | ❌ |
| **installations** assign installer | ❌ | ✅ | ✅ department | ❌ | ❌ | ❌ | ❌ | ❌ |
| **installations** execute (parte trabajo) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ own | ❌ | ❌ |
| **maintenance** | ❌ | ✅ | ✅ department | ❌ | ❌ | ✅ own | ❌ | ❌ |
| **incidents** view | ❌ | ✅ | ✅ department | ⚠️ asociadas a sus clientes | ❌ | ✅ own | ⚠️ asociadas a sus clientes | ❌ |
| **incidents** create | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **products** view (con precios) | ❌ | ✅ | ⚠️ sin cost/margin | ✅ sin cost/margin | ⚠️ solo categoría/atributo | ⚠️ solo nombre/imagen/atributos técnicos | ✅ con precio mínimo autorizado | ⚠️ solo nombre/categoría |
| **products** create/update | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **products** ver `cost` y `margin` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **warehouses** view | ❌ | ✅ | ✅ all_company | ❌ | ❌ | ⚠️ solo su furgoneta | ❌ | ❌ |
| **warehouses** carga (mover stock) | ❌ | ✅ | ✅ | ❌ | ❌ | ⚠️ solicitar carga propia | ❌ | ❌ |
| **agenda** view | ❌ | ✅ all | ✅ department | ✅ department | ✅ department | ✅ own | ✅ own | ✅ own |
| **agenda** create event | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ own | ✅ own | ✅ own |
| **wallet** view | ❌ | ✅ all | ❌ | ✅ department aggregated | ❌ | ❌ | ✅ own | ❌ |
| **wallet** validate / liquidate | ❌ | ✅ | ❌ | ✅ ⚠️ pendiente confirmar | ❌ | ❌ | ❌ | ❌ |
| **wallet** record cobro | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (cobros de su instalación) | ✅ (de su contrato) | ❌ |
| **sales** view | ❌ | ✅ all | ❌ | ✅ department | ✅ department (TMK) | ❌ | ✅ own | ✅ own (los recuperados) |
| **dashboard** | ❌ | ✅ all | ✅ department | ✅ department | ✅ department | ✅ own | ✅ own | ✅ own |
| **notifications** | ❌ | ✅ propias | ✅ propias | ✅ propias | ✅ propias | ✅ propias | ✅ propias | ✅ propias |
| **free_trials** view/create/manage | ❌ | ✅ | ✅ department | ✅ department | ❌ | ✅ assigned | ✅ own | ❌ |
| **lost_sales** view | ❌ | ✅ | ❌ | ✅ department | ✅ department | ❌ | ⚠️ propias | ✅ own (asignadas para recuperar) |
| **lost_sales** assign for recovery | ❌ | ✅ | ❌ | ❌ | ✅ ⚠️ a telemarketers | ❌ | ❌ | ❌ |

> **Nota:** las celdas con ⚠️ son las que necesitan tu confirmación (preguntas 1.3 a 1.13 en `PROJECT_MEMORY.md § 11`).

## 5. RLS pattern definitivo

Cada tabla tenant cumple este patrón:

```sql
-- Habilitar RLS
alter table <tabla> enable row level security;

-- Función helper que devuelve company_id del JWT
create or replace function auth.company_id() returns uuid
  language sql stable
  as $$ select (auth.jwt() ->> 'company_id')::uuid $$;

-- Función helper que comprueba si el user actual es superadmin
create or replace function auth.is_superadmin() returns boolean
  language sql stable
  as $$ select coalesce((auth.jwt() ->> 'is_superadmin')::boolean, false) $$;

-- Función helper que comprueba un permiso
create or replace function auth.can(p_module text, p_action text, p_scope text default null)
  returns boolean language plpgsql stable security definer ...

-- POLICY 1: Superadmin lo ve todo
create policy "<tabla>_superadmin_all"
  on <tabla> for all
  using (auth.is_superadmin())
  with check (auth.is_superadmin());

-- POLICY 2: Aislamiento por empresa
create policy "<tabla>_tenant_isolation"
  on <tabla> for select
  using (company_id = auth.company_id());

-- POLICY 3: Inserts solo en mi empresa
create policy "<tabla>_insert_own_company"
  on <tabla> for insert
  with check (company_id = auth.company_id());

-- POLICY 4: Update/delete según scope (delegado a auth.can())
create policy "<tabla>_modify_by_permission"
  on <tabla> for update
  using (
    company_id = auth.company_id()
    and auth.can('<modulo>', 'update', /* scope evaluado contra fila */)
  );
```

## 6. Custom JWT claims

Al hacer login, un Auth Hook añade al JWT:

```json
{
  "sub": "<auth.user_id>",
  "company_id": "<uuid>",
  "is_superadmin": false,
  "role": "sales_rep",
  "department": "sales",
  "team_lead_id": "<uuid director>"
}
```

- Generado por Auth Hook (Postgres function `public.custom_access_token_hook(event jsonb)`).
- Permite que las RLS no necesiten joins extra → rendimiento alto.
- Cuando admin cambia rol/empresa → forzamos refresh de sesión.

## 7. Departamentos

Tres departamentos fijos por empresa:

```sql
create type department_kind as enum ('tech', 'sales', 'tmk');
```

Roles asignados por departamento:
- `tech` → `technical_director`, `installer`
- `sales` → `commercial_director`, `sales_rep`
- `tmk` → `telemarketing_director`, `telemarketer`

`company_admin` y `superadmin` no tienen departamento.

## 8. Equipos / asignaciones

Tabla `team_assignments`:

```
(company_id, manager_user_id, member_user_id, role_at_assignment)
```

Permite que `sales_rep` X tenga como jefe al `commercial_director` Y. El director ve a los miembros de su equipo (scope `assigned_team`).

## 9. Aprobaciones de precio

Diseño previsto:

```
Tabla `price_approvals`:
- id, company_id, requested_by_user_id, proposal_id, requested_price, min_authorized_price
- status: pending | approved | rejected
- approver_user_id, decided_at, decision_note
```

Notificación a director departamento + admin. Cualquiera puede aprobar.

## 10. Anti-fugas — controles obligatorios

1. **Toda tabla tenant** lleva `company_id NOT NULL` con FK a `companies`.
2. **Toda RLS policy** filtra por `company_id = auth.company_id()`.
3. **Toda inserción** valida `company_id = auth.company_id()` en `with check`.
4. **Storage**: bucket `documents` con policy que valida `name like auth.company_id() || '/%'`.
5. **Edge Functions** que usen `service_role` deben validar `company_id` manualmente antes de cualquier query.
6. **Test de RLS**: tests automáticos con dos usuarios de empresas distintas verificando que ninguno ve datos del otro.

## 11. Preguntas pendientes para cerrar Capa 1

Ver `PROJECT_MEMORY.md § 11`. 13 preguntas concretas. Las celdas ⚠️ de la matriz § 4 dependen de estas respuestas.
