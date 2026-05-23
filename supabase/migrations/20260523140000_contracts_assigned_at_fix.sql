-- =============================================================================
-- 20260523140000_contracts_assigned_at_fix.sql
-- La migración 20260522180000_contracts_assigned_user_backfill.sql fallaba
-- con "column assigned_at does not exist" en BBDD donde la migración
-- 20260503150000_contract_assigned_user.sql no se llegó a aplicar entera.
--
-- Esta migración es defensiva e idempotente:
--   1. Garantiza la columna assigned_at en contracts.
--   2. Backfillea assigned_user_id ← created_by para contratos sin
--      asignado.
--   3. Backfillea assigned_at ← created_at SOLO para los contratos que
--      ya tienen assigned_user_id (puede haberlos sin created_by →
--      ahí no se toca assigned_at).
--   4. Recarga schema PostgREST.
--
-- Se puede ejecutar las veces que sea: no duplica datos ni falla si la
-- columna ya existe.
-- =============================================================================

alter table public.contracts
  add column if not exists assigned_at timestamptz;

-- 1) assigned_user_id ← created_by donde está NULL
update public.contracts
   set assigned_user_id = created_by
 where assigned_user_id is null
   and created_by is not null;

-- 2) assigned_at ← created_at donde está NULL (solo si hay assigned_user_id)
update public.contracts
   set assigned_at = created_at
 where assigned_at is null
   and assigned_user_id is not null;

-- Índice por si la migración original no llegó a crearlo
create index if not exists idx_contracts_assigned_user
  on public.contracts (company_id, assigned_user_id)
  where assigned_user_id is not null;

comment on column public.contracts.assigned_user_id is
  'Comercial responsable de la venta (puede diferir del creador). Usado para sales_records, ranking de puntos y awardSalesBundleOnInstall.';
comment on column public.contracts.assigned_at is
  'Cuándo se asignó el contrato al comercial responsable.';

notify pgrst, 'reload schema';
