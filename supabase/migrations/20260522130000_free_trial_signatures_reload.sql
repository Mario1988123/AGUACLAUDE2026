-- ============================================================================
-- Garantizar columnas de firma en free_trials + recargar schema PostgREST
-- ----------------------------------------------------------------------------
-- En sesión 2026-05-12 firmar una prueba gratuita devolvía:
--   "Could not find the 'customer_signature_path' column of 'free_trials'
--    in the schema cache"
-- aunque la migración 20260520100000_free_trial_signatures.sql las añadió.
-- Causa: cache de PostgREST tras deploy. Aquí reaplicamos columns con
-- `if not exists` (idempotente) + forzamos reload del cache.
-- ============================================================================

alter table public.free_trials
  add column if not exists customer_signature_path        text,
  add column if not exists customer_signer_name           text,
  add column if not exists customer_signer_tax_id         text,
  add column if not exists customer_signed_at             timestamptz,
  add column if not exists representative_signature_path  text,
  add column if not exists representative_user_id         uuid references auth.users(id) on delete set null,
  add column if not exists representative_signed_at       timestamptz,
  add column if not exists is_provisional_install         boolean default false,
  add column if not exists conditions_signed              boolean default false;

create index if not exists idx_free_trials_signed
  on public.free_trials(company_id)
  where customer_signature_path is not null;

notify pgrst, 'reload schema';
