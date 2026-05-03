-- =============================================================================
-- 20260503150000_contract_assigned_user.sql
-- Añade contracts.assigned_user_id para que admin/director comercial pueda
-- reasignar contratos a comerciales y filtrar "mi cartera" en /contratos.
-- =============================================================================

alter table public.contracts
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at      timestamptz;

create index if not exists idx_contracts_assigned
  on public.contracts(company_id, assigned_user_id)
  where assigned_user_id is not null;

comment on column public.contracts.assigned_user_id is
  'Comercial responsable del contrato. Usado por filtro mi cartera y métricas individuales.';
