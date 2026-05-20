-- ============================================================================
-- 20260620300000_invoice_reminders.sql
-- Idempotencia recordatorios impago. Sin esta tabla un cron de
-- retry mandaría el mismo aviso N veces.
-- ============================================================================

create table if not exists public.invoice_reminders_sent (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  level           smallint not null check (level in (1, 2, 3)),  -- 1=suave, 2=formal, 3=requerimiento
  sent_at         timestamptz not null default now(),
  channel         text not null default 'email',                 -- email | whatsapp | letter
  recipient_email text,
  template_key    text
);

create unique index if not exists uniq_invoice_reminders_level
  on public.invoice_reminders_sent(invoice_id, level);

create index if not exists idx_invoice_reminders_sent_at
  on public.invoice_reminders_sent(sent_at desc);


-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';
