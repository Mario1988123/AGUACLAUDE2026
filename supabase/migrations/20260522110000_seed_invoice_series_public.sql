-- ============================================================================
-- Wrappers public para RPC del schema app
-- ----------------------------------------------------------------------------
-- PostgREST solo expone los schemas `public` y `graphql_public`. Las funciones
-- creadas en `app.*` no son accesibles vía `supabase.rpc("nombre")`. Antes
-- pasaba con `next_invoice_number` (resuelto en migración 20260507200000) y
-- ahora detectamos los mismos fallos en:
--   - `seed_default_invoice_series`   (modules/invoices/actions.ts:106)
--   - `seed_default_message_templates`(modules/messaging/actions.ts:27,83)
--   - `seed_default_clauses`          (modules/contracts/actions.ts:296,
--                                     modules/config/contracts/actions.ts:53)
--   - `autoclose_stale_punches`       (api/cron/hourly, daily,
--                                     modules/time-tracking/actions.ts)
-- ============================================================================

create or replace function public.seed_default_invoice_series(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_invoice_series(p_company_id);
$$;
grant execute on function public.seed_default_invoice_series(uuid) to authenticated;

create or replace function public.seed_default_message_templates(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_message_templates(p_company_id);
$$;
grant execute on function public.seed_default_message_templates(uuid) to authenticated;

create or replace function public.seed_default_clauses(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_clauses(p_company_id);
$$;
grant execute on function public.seed_default_clauses(uuid) to authenticated;

create or replace function public.autoclose_stale_punches()
returns integer
language sql
security definer
set search_path = public, app
as $$
  select app.autoclose_stale_punches();
$$;
grant execute on function public.autoclose_stale_punches() to authenticated;

-- pgrst reload
notify pgrst, 'reload schema';
