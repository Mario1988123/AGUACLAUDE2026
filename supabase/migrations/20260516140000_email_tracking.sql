-- =============================================================================
-- Mail tracking: aperturas y clicks (vía webhook Resend)
-- =============================================================================

alter table public.email_sends
  add column if not exists opened_at        timestamptz,
  add column if not exists opens_count      integer not null default 0,
  add column if not exists clicked_at       timestamptz,
  add column if not exists clicks_count     integer not null default 0,
  add column if not exists complained_at    timestamptz,
  add column if not exists last_event_at    timestamptz;

create index if not exists idx_sends_opens
  on public.email_sends(company_id, opened_at desc) where opened_at is not null;

comment on column public.email_sends.opens_count is
  'Nº de aperturas recibidas (Resend dispara email.opened cada vez que el cliente abre).';
comment on column public.email_sends.clicks_count is
  'Nº de clicks en links del email.';

notify pgrst, 'reload schema';
