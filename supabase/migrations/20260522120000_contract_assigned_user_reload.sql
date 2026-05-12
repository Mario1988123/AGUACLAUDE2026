-- ============================================================================
-- Garantizar contracts.assigned_user_id + recargar schema de PostgREST
-- ----------------------------------------------------------------------------
-- En sesión 2026-05-12 el backfill de sales_records falló con:
--   "column contracts.assigned_user_id does not exist"
-- aunque la migración 20260503150000_contract_assigned_user.sql YA la añade.
-- Causa típica: PostgREST mantiene cache del schema y no ve columnas
-- añadidas a posteriori hasta que recibe NOTIFY 'reload schema'.
--
-- Aquí: defensivo `add column if not exists` + notify para forzar reload.
-- ============================================================================

alter table public.contracts
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_contracts_assigned_user
  on public.contracts(company_id, assigned_user_id)
  where assigned_user_id is not null;

comment on column public.contracts.assigned_user_id is
  'Comercial responsable de la venta (puede diferir del creador). Usado para sales_records y ranking.';

notify pgrst, 'reload schema';
