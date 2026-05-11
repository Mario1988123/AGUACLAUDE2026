-- =============================================================================
-- 20260521100000_mailing_template_key.sql
-- Cachear template_key en email_sends para que se pueda agrupar por flujo
-- aunque la plantilla haya sido editada o renombrada después del envío.
-- También permite listar emails por plantilla sin JOIN.
-- =============================================================================

alter table public.email_sends
  add column if not exists template_key text;

create index if not exists idx_sends_template_key
  on public.email_sends(company_id, template_key, created_at desc)
  where template_key is not null;

-- Backfill desde el join con email_templates (idempotente)
update public.email_sends s
   set template_key = t.key
  from public.email_templates t
 where s.template_id = t.id
   and s.template_key is null;

notify pgrst, 'reload schema';
