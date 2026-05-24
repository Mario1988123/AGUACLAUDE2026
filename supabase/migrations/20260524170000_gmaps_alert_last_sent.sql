-- =============================================================================
-- 20260524170000_gmaps_alert_last_sent.sql
-- Columna informativa para idempotencia diaria del cron
-- /api/cron/gmaps-budget-alert. Si ya se envió aviso hoy a la empresa,
-- no se vuelve a enviar.
-- =============================================================================

alter table public.company_settings
  add column if not exists gmaps_alert_last_sent_day date;

comment on column public.company_settings.gmaps_alert_last_sent_day is
  'Última fecha en la que el cron /api/cron/gmaps-budget-alert envió aviso de consumo. Garantiza un único envío por empresa y día.';

notify pgrst, 'reload schema';
