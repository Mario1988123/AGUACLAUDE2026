-- =============================================================================
-- Contratos: cancelación + validación financiera
-- =============================================================================
-- Decisiones del usuario (2026-05-08):
--  - Renting: el contrato se VALIDA cuando la financiera confirma OK.
--    Se distingue de "signed" (firma del cliente) para que el comercial
--    no cuente la venta hasta validación.
--  - Cancelar contrato: borrado permanente solo si NO se ha firmado y
--    NO se ha empezado instalación. Aquí lo hacemos soft-delete con
--    razón porque ya hay otras dependencias (events, etc.).
-- =============================================================================

alter table public.contracts
  add column if not exists validated_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

create index if not exists idx_contracts_cancelled
  on public.contracts(company_id, cancelled_at) where cancelled_at is not null;

comment on column public.contracts.validated_by_user_id is
  'Usuario que valida el contrato (típicamente admin tras confirmación de financiera en renting).';
comment on column public.contracts.cancelled_at is
  'Fecha de cancelación del contrato. Si está set, se considera anulado.';
