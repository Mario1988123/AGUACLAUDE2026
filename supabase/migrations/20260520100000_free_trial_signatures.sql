-- =============================================================================
-- 20260520100000_free_trial_signatures.sql
-- Captura de firmas (cliente + comercial) en el albarán de prueba gratuita.
-- Las imágenes se guardan en bucket privado "free-trial-signatures" — esta
-- tabla solo guarda los paths para luego embeber en el PDF.
-- =============================================================================

alter table public.free_trials
  add column if not exists customer_signature_path        text,
  add column if not exists customer_signer_name           text,
  add column if not exists customer_signer_tax_id         text,
  add column if not exists customer_signed_at             timestamptz,
  add column if not exists representative_signature_path  text,
  add column if not exists representative_user_id         uuid references auth.users(id) on delete set null,
  add column if not exists representative_signed_at       timestamptz;

create index if not exists idx_free_trials_signed
  on public.free_trials(company_id)
  where customer_signature_path is not null;

comment on column public.free_trials.customer_signature_path is
  'Path en bucket free-trial-signatures con la firma manuscrita del cliente';
comment on column public.free_trials.representative_signature_path is
  'Path en bucket free-trial-signatures con la firma del comercial/representante';

notify pgrst, 'reload schema';
