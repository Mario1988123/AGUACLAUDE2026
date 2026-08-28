-- =============================================================================
-- 20260828100000_seed_wrappers_service_role.sql
--
-- Cierra la DERIVA local↔remoto detectada el 2026-07-13 y reconfirmada el
-- 2026-08-28 consultando el remoto:
--
--   · PostgREST expone únicamente `public,graphql_public` (verificado vía
--     Management API: db_schema = "public,graphql_public").
--   · Las funciones viven sólo en el schema `app`:
--         app.seed_default_clauses          ✔ existe
--         app.seed_default_clauses_v2       ✔ existe
--         app.seed_default_message_templates ✔ existe
--         app.seed_default_invoice_series   ✘ NO existe en el remoto
--   · Por tanto TODAS las llamadas `supabase.rpc("seed_default_*")` del código
--     fallaban EN SILENCIO (PGRST202), porque los call-sites ignoraban {error}:
--         - empresas nuevas sin cláusulas de contrato por defecto,
--         - sin plantillas de mensajería por defecto,
--         - sin series de facturación por defecto.
--
-- La migración 20260522110000_seed_invoice_series_public.sql ya creaba estos
-- wrappers pero NUNCA llegó al remoto, y además los concedía a `authenticated`:
-- eso es el mismo agujero de clase C1 que se cerró en 20260712100000 y
-- 20260713100000 — reciben un p_company_id ARBITRARIO y son security definer,
-- así que un usuario autenticado podría sembrar datos en OTRA empresa vía
-- /rest/v1/rpc. Aquí se crean SOLO para service_role; la app las llama siempre
-- con el cliente admin (ver modules/contracts/actions.ts, config/contracts,
-- messaging/actions.ts, invoices/actions.ts).
--
-- Idempotente y aditiva: se puede aplicar sobre local y sobre el remoto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) app.seed_default_invoice_series — falta en el remoto. Se (re)define aquí
--    con el mismo cuerpo que 20260503310000_invoicing.sql para que exista en
--    ambos lados. `create or replace` no pisa nada si ya está igual.
-- -----------------------------------------------------------------------------
create or replace function app.seed_default_invoice_series(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if p_company_id is null then
    raise exception 'p_company_id no puede ser null';
  end if;
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'invoice'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'invoice', 'A', 'Facturas', extract(year from current_date)::int, 1, true, true);
  end if;
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'credit_note'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'credit_note', 'R', 'Rectificativas', extract(year from current_date)::int, 1, true, true);
  end if;
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'proforma'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'proforma', 'P', 'Proforma', extract(year from current_date)::int, 1, true, true);
  end if;
end;
$$;

-- La función `app.*` no es alcanzable por PostgREST, pero por higiene (y por
-- coherencia con 20260712100000/20260713100000) le quitamos el grant abierto.
revoke all on function app.seed_default_invoice_series(uuid) from public, anon, authenticated;
grant execute on function app.seed_default_invoice_series(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 1) Wrappers en `public` — SOLO service_role
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_invoice_series(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_invoice_series(p_company_id);
$$;
revoke all on function public.seed_default_invoice_series(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_invoice_series(uuid) to service_role;

create or replace function public.seed_default_message_templates(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_message_templates(p_company_id);
$$;
revoke all on function public.seed_default_message_templates(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_message_templates(uuid) to service_role;

create or replace function public.seed_default_clauses(p_company_id uuid)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.seed_default_clauses(p_company_id);
$$;
revoke all on function public.seed_default_clauses(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_clauses(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Higiene: las funciones `app.seed_*` seguían con grant a authenticated
--    heredado de sus migraciones originales. No son alcanzables vía PostgREST,
--    pero se revocan igualmente (defensa en profundidad, por si algún día se
--    expone el schema `app`).
-- -----------------------------------------------------------------------------
revoke all on function app.seed_default_clauses(uuid) from public, anon, authenticated;
grant execute on function app.seed_default_clauses(uuid) to service_role;

do $$ begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'seed_default_clauses_v2'
  ) then
    revoke all on function app.seed_default_clauses_v2(uuid) from public, anon, authenticated;
    grant execute on function app.seed_default_clauses_v2(uuid) to service_role;
  end if;
end $$;

revoke all on function app.seed_default_message_templates(uuid) from public, anon, authenticated;
grant execute on function app.seed_default_message_templates(uuid) to service_role;

notify pgrst, 'reload schema';
