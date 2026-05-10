-- =============================================================================
-- GoCardless: contador de reintentos en pagos + intentos en webhook events
-- =============================================================================

alter table public.gocardless_payments
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

alter table public.gocardless_webhook_events
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

create index if not exists gc_payments_retry_failed
  on public.gocardless_payments(company_id, status, retry_count)
  where status = 'failed';

create index if not exists gc_events_retry_pending
  on public.gocardless_webhook_events(company_id, retry_count)
  where processed_at is null;

notify pgrst, 'reload schema';
