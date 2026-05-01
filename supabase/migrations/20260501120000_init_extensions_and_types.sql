-- =============================================================================
-- 20260501120000_init_extensions_and_types.sql
-- Capa 2 · Paso 2.1 · Inicialización: extensiones, schema `app`, tipos enum,
-- funciones reutilizables (set_updated_at).
--
-- IDEMPOTENTE. Seguro re-ejecutar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid()
create extension if not exists pg_trgm;         -- búsquedas fuzzy y similitud
create extension if not exists unaccent;        -- normalización de acentos
-- pg_uuidv7 disponible en Supabase Postgres 17 — opcional, evaluar más
-- adelante para tablas grandes (events, wallet_entries, stock_movements).

-- -----------------------------------------------------------------------------
-- Schema dedicado para utilidades del proyecto (no contamina public)
-- -----------------------------------------------------------------------------
create schema if not exists app;
comment on schema app is 'Utilidades, helpers y enums propios del proyecto AGUACLAUDE2026.';

-- -----------------------------------------------------------------------------
-- Tipos enum globales
-- -----------------------------------------------------------------------------

-- Departamentos fijos de cada empresa tenant (decisión 1.13).
-- `tech` = técnico (instaladores, director técnico)
-- `sales` = comercial (sales_rep, director comercial)
-- `tmk` = telemarketing (telemarketer, director TMK)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'department_kind') then
    create type app.department_kind as enum ('tech', 'sales', 'tmk');
  end if;
end $$;

-- Estado de un usuario dentro de una empresa.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type app.user_status as enum ('invited', 'active', 'inactive', 'suspended');
  end if;
end $$;

-- Estado de una empresa tenant.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'company_status') then
    create type app.company_status as enum ('trial', 'active', 'suspended', 'cancelled');
  end if;
end $$;

-- Acciones genéricas de la matriz de permisos.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'permission_action') then
    create type app.permission_action as enum (
      'view', 'create', 'update', 'delete', 'approve', 'assign', 'export'
    );
  end if;
end $$;

-- Alcance de un permiso. `global` solo para superadmin.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'permission_scope') then
    create type app.permission_scope as enum (
      'global', 'all_company', 'department', 'assigned_team', 'own'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Funciones reutilizables
-- -----------------------------------------------------------------------------

-- Trigger genérico para actualizar `updated_at` al modificar una fila.
create or replace function app.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Trigger reutilizable: actualiza updated_at = now() en BEFORE UPDATE.';
