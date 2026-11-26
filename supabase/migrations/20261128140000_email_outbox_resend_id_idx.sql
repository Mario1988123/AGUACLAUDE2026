-- =============================================================================
-- 20261128140000_email_outbox_resend_id_idx.sql
--
-- El webhook de Resend (/api/webhooks/resend) ahora casa cada evento por
-- `resend_id` también en email_outbox (antes solo en email_sends, y
-- sendViaSmtp ni siquiera guardaba el id en email_outbox). Índice parcial
-- para que esa búsqueda no recorra la tabla entera.
--
-- Aditiva e idempotente. NO aplicada: la aplica Mario.
-- =============================================================================

create index if not exists idx_email_outbox_resend_id
  on public.email_outbox (resend_id)
  where resend_id is not null;
