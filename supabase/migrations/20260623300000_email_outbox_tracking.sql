-- =============================================================================
-- 20260623300000_email_outbox_tracking.sql
--
-- Tracking de aperturas/clics provider-agnostic para envíos SMTP. El pipeline
-- de Resend ya rellena `email_sends.opens_count/clicks_count` vía webhook;
-- para SMTP los endpoints /api/track/open/[id] y /api/track/click/[id]
-- actualizan estas columnas en email_outbox (donde sí escribe sendViaSmtp).
--
-- Decisión 2026-05-30: tracking en email_outbox para no romper el tracking
-- existente en email_sends ni los callers; el dashboard puede leer ambos.
-- =============================================================================

alter table public.email_outbox
  add column if not exists opened_at        timestamptz,
  add column if not exists opens_count      integer not null default 0,
  add column if not exists clicked_at       timestamptz,
  add column if not exists clicks_count     integer not null default 0,
  add column if not exists last_event_at    timestamptz;

create index if not exists idx_email_outbox_opens
  on public.email_outbox(company_id, opened_at desc)
  where opened_at is not null;

create index if not exists idx_email_outbox_clicks
  on public.email_outbox(company_id, clicked_at desc)
  where clicked_at is not null;

comment on column public.email_outbox.opens_count is
  'Nº aperturas registradas vía /api/track/open (pixel) — solo SMTP, no Resend.';
comment on column public.email_outbox.clicks_count is
  'Nº clics registrados vía /api/track/click (redirect) — solo SMTP, no Resend.';

notify pgrst, 'reload schema';
