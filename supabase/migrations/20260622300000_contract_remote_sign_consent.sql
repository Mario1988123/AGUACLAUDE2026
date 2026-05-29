-- =============================================================================
-- 20260622300000_contract_remote_sign_consent.sql
-- DocuSign-like: persistir el consentimiento explícito del firmante y dejar
-- rastro de cuándo lo aceptó (antes solo se validaba en cliente, no se
-- guardaba). Refuerza el valor probatorio de la firma remota.
-- =============================================================================

alter table public.contract_remote_signatures
  add column if not exists consent_accepted_at timestamptz;

comment on column public.contract_remote_signatures.consent_accepted_at is
  'Fecha/hora en que el firmante marcó la casilla de aceptación de términos antes de firmar. Parte del rastro probatorio.';

notify pgrst, 'reload schema';
