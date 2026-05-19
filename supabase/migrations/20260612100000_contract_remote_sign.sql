-- ============================================================================
-- Contratos — firma remota por email (DocuSign-like)
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-19:
--   El comercial no siempre está con el cliente. Necesitamos enviarle el
--   contrato por email para que lo firme online sin tener que crearse cuenta.
--
-- Flujo:
--   1. Admin/comercial pulsa "Enviar para firmar por email" → action genera
--      token único (UUID + 32 chars random) + envía email al cliente.
--   2. Cliente abre el link /firmar-contrato/<token> (público, sin auth).
--   3. Verifica que el email coincide con el del cliente.
--   4. Ve el contrato (PDF preview) y firma con canvas.
--   5. Submit guarda firma + IP + user-agent + trace.
--   6. El contrato pasa a 'signed' y aparece etiqueta "Firmado por email".
--
-- Seguridad:
--   · Token único de 48+ chars (UUID + 32 random).
--   · Expira en 14 días.
--   · Solo válido una vez (signed_at = NOT NULL → no se vuelve a abrir).
--   · No expone otros datos del cliente sin verificar email.
-- ============================================================================

create table if not exists public.contract_remote_signatures (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  contract_id         uuid not null references public.contracts(id) on delete cascade,
  /**
   * Token único en URL. Generado al crear. 48+ chars.
   */
  token               text not null unique,
  /**
   * Email al que se envió el link. El cliente debe introducirlo de nuevo
   * para verificar.
   */
  signer_email        text not null,
  signer_name         text,
  /**
   * Fecha en que se mandó. Tracker.
   */
  sent_at             timestamptz not null default now(),
  sent_by_user_id     uuid references auth.users(id) on delete set null,
  /**
   * Cuando el cliente abrió el link por primera vez.
   */
  opened_at           timestamptz,
  /**
   * Firma final: data URL PNG inline.
   */
  signed_at           timestamptz,
  signature_data_url  text,
  signer_ip           inet,
  signer_user_agent   text,
  /**
   * 14 días por defecto. Configurable por empresa más tarde.
   */
  expires_at          timestamptz not null default (now() + interval '14 days'),
  cancelled_at        timestamptz,
  cancellation_reason text
);

create index if not exists idx_crs_token on public.contract_remote_signatures(token);
create index if not exists idx_crs_contract on public.contract_remote_signatures(contract_id);
create index if not exists idx_crs_company on public.contract_remote_signatures(company_id);

comment on table public.contract_remote_signatures is
  'Firmas remotas por email tipo DocuSign. Token único en URL, sin auth necesaria. Validación por email del cliente.';

-- RLS: solo tenant scope (no anon — el acceso público va por la action server).
alter table public.contract_remote_signatures enable row level security;
drop policy if exists crs_super on public.contract_remote_signatures;
create policy crs_super on public.contract_remote_signatures
  for all to authenticated using (app.is_superadmin())
  with check (app.is_superadmin());
drop policy if exists crs_tenant on public.contract_remote_signatures;
create policy crs_tenant on public.contract_remote_signatures
  for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

-- Plantilla de email "contract_send_remote_sign" — la añadimos a
-- system-templates para que esté disponible vía fallback.

notify pgrst, 'reload schema';
