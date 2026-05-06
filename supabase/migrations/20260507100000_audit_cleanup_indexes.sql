-- =============================================================================
-- 20260507100000_audit_cleanup_indexes.sql
-- Auditoría 2026-05-07: limpieza BD + índices críticos.
--
-- 1. DROP de tablas obsoletas sustituidas por otras (sin uso en código).
-- 2. DROP de columnas duplicadas semánticamente.
-- 3. CREATE de índices que faltan en columnas FK frecuentemente filtradas.
-- 4. Idempotente: IF EXISTS / IF NOT EXISTS en todas las cláusulas.
-- =============================================================================

-- ===== 1. Tablas obsoletas =====
-- Reemplazadas por equivalentes más generales. Sin filas usadas en
-- queries activas tras grep de src/.
drop table if exists public.installation_steps_log cascade;        -- → events
drop table if exists public.contract_clauses_used cascade;          -- → contracts.clauses_snapshot
drop table if exists public.contract_photos cascade;                -- → documents
drop table if exists public.proposal_payment_options cascade;       -- obsoleta tras proposal_overhaul

-- ===== 2. Columnas duplicadas en installations =====
-- La migración del wizard añadió `started_geo_lat/lng` mientras que la
-- tabla original ya tenía `geo_started_lat/lng`. Conservamos el nombre
-- estándar y soltamos la duplicada.
alter table public.installations
  drop column if exists started_geo_lat,
  drop column if exists started_geo_lng;

-- ===== 3. Índices críticos en FK =====

create index if not exists idx_incidents_maintenance_job
  on public.incidents(maintenance_job_id)
  where maintenance_job_id is not null;

create index if not exists idx_contract_payments_collected_by
  on public.contract_payments(collected_by_user_id)
  where collected_by_user_id is not null;

-- Helper para crear índice solo si la columna existe (varias migraciones
-- van añadiendo columnas opcionales). Antes la SQL fallaba con
-- "column free_trial_id does not exist" si la migración aún no estaba.
create or replace function public._idx_if_col(
  p_table text,
  p_column text,
  p_idx_name text,
  p_where text default null
)
returns void
language plpgsql
as $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_column
  ) then
    execute format(
      'create index if not exists %I on public.%I(%I) %s',
      p_idx_name, p_table, p_column,
      coalesce('where ' || p_where, '')
    );
  end if;
end $$;

select public._idx_if_col(
  'wallet_entries', 'installation_id', 'idx_wallet_entries_installation',
  'installation_id is not null'
);
select public._idx_if_col(
  'wallet_entries', 'free_trial_id', 'idx_wallet_entries_free_trial',
  'free_trial_id is not null'
);
select public._idx_if_col(
  'stock_movements', 'free_trial_id', 'idx_stock_movements_free_trial',
  'free_trial_id is not null'
);
select public._idx_if_col(
  'stock_movements', 'maintenance_id', 'idx_stock_movements_maintenance',
  'maintenance_id is not null'
);

create index if not exists idx_maintenance_contracts_plan
  on public.maintenance_contracts(plan_id);

-- Composite para listAgendaMonth/listAgenda (filtra company + status + tiempo)
create index if not exists idx_agenda_events_company_status_time
  on public.agenda_events(company_id, status, starts_at)
  where deleted_at is null;

-- Para cron de cleanup de notificaciones expiradas
create index if not exists idx_notifications_expires_at
  on public.notifications(expires_at)
  where expires_at is not null;

-- Para auditoría eficiente
create index if not exists idx_audit_log_company_changed_desc
  on public.audit_log(company_id, changed_at desc);

-- Índices en columnas de scope que son las que más filtramos
-- (nivel 3 ve solo lo suyo)
create index if not exists idx_leads_assigned_user
  on public.leads(assigned_user_id)
  where deleted_at is null and assigned_user_id is not null;

create index if not exists idx_customers_assigned_user
  on public.customers(assigned_user_id)
  where deleted_at is null and assigned_user_id is not null;

create index if not exists idx_proposals_created_by
  on public.proposals(created_by)
  where deleted_at is null;

create index if not exists idx_contracts_created_by
  on public.contracts(created_by)
  where deleted_at is null;

create index if not exists idx_contracts_signed_by_user_id
  on public.contracts(signed_by_user_id)
  where deleted_at is null and signed_by_user_id is not null;

-- team_assignments para resolver scope de directores rápido
create index if not exists idx_team_assignments_manager
  on public.team_assignments(manager_user_id, company_id)
  where revoked_at is null;

drop function public._idx_if_col(text, text, text, text);
