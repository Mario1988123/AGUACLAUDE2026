-- =============================================================================
-- 20260621000000_email_outbox_columns_and_resend.sql
-- FIX CRÍTICO: el envío de email fallaba con
--   "Could not find the 'related_id' column of 'email_outbox'".
-- La migración smtp_dual_setup añadió columnas a email_sends pero NO a
-- email_outbox, mientras que sendViaSmtp() inserta en email_outbox columnas
-- que nunca se crearon (related_type/related_id, sender_user_id, send_type,
-- trigger_event, from_account_type, from_email, from_name).
--
-- Además, el CHECK de email_sends.from_account_type no contemplaba 'resend'
-- (añadido al implementar el híbrido SMTP+Resend), lo que haría fallar el
-- insert de envíos hechos por Resend.
-- =============================================================================

-- 1. Columnas que faltaban en email_outbox -----------------------------------
alter table public.email_outbox
  add column if not exists send_type         text,
  add column if not exists trigger_event     text,
  add column if not exists sender_user_id    uuid references auth.users(id) on delete set null,
  add column if not exists related_type      text,
  add column if not exists related_id        uuid,
  add column if not exists from_account_type text,
  add column if not exists from_email        text,
  add column if not exists from_name         text,
  add column if not exists resend_id         text;

-- 2. Permitir 'resend' en email_sends.from_account_type ----------------------
do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'email_sends'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%from_account_type%';
  if conname is not null then
    execute format('alter table public.email_sends drop constraint %I', conname);
  end if;
end $$;

alter table public.email_sends
  add constraint email_sends_from_account_type_check
  check (
    from_account_type is null or
    from_account_type in ('user','company_manual','company_automated','resend')
  );

notify pgrst, 'reload schema';
