-- =============================================================================
-- 20261002090200_numeracion_contadores_referencia.sql
--
-- Auditoría 2026-10-01, I25: numeración `max()+1` sin bloqueo.
--
-- PROBLEMA
--   Propuestas (P-), contratos (C-), instalaciones (I-), planes de
--   mantenimiento (M-), propuestas de ahorro (AH-), pruebas gratuitas (PG-) e
--   incidencias (INC-) calculan el siguiente código leyendo el último y
--   sumando 1, sin bloqueo:
--     - dos usuarios en el mismo segundo obtienen el mismo P-2026-0003;
--     - se ordena como TEXTO: al pasar de 9999, "P-2026-9999" > "P-2026-10000"
--       y se repite el 10000;
--     - el año sale de `now()` en UTC: lo creado el 1-ene entre las 00:00 y
--       las 01:00 de Madrid lleva el año anterior.
--   Y no hay índice único que lo impida (comprobado 2026-10-02: 0 duplicados
--   en las 8 tablas; ver SELECT al final).
--
-- ARREGLO
--   1) Tabla `public.reference_counters` (empresa, tabla, prefijo, año) con el
--      último número entregado.
--   2) `public.next_reference_code(p_company_id, p_table, p_prefix)`:
--      INSERT … ON CONFLICT DO UPDATE … RETURNING, que bloquea la fila del
--      contador hasta el fin de la transacción → dos llamadas simultáneas
--      reciben números distintos. El primer uso de cada (empresa, tabla,
--      prefijo, año) arranca desde el máximo NUMÉRICO existente en la tabla, y
--      en cada llamada se toma greatest(contador, máximo en tabla) para
--      convivir con el código antiguo que aún calcula max()+1 por su cuenta.
--      Año calculado en Europe/Madrid. Lista blanca de tablas.
--   3) `public.gen_reference_code` (la usan los triggers de incidents y
--      free_trials) pasa a delegar en next_reference_code. Misma firma.
--   4) Índices únicos (company_id, reference_code) en las 8 tablas: aunque un
--      módulo antiguo calcule mal, la base de datos ya no deja duplicar
--      (el INSERT falla con 23505 en vez de crear un duplicado silencioso).
--
-- PERMISOS
--   Igual que gen_reference_code desde 20260828110000: solo service_role (y el
--   dueño, para los triggers). Las llamadas desde la app van con el admin
--   client y el company_id de la sesión.
--
-- Idempotente. No modifica filas existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Contadores
-- -----------------------------------------------------------------------------
create table if not exists public.reference_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  table_name text not null,
  prefix text not null,
  year integer not null,
  last_value integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, table_name, prefix, year)
);

comment on table public.reference_counters is
  'Último número entregado por next_reference_code() por empresa, tabla, prefijo y año (Madrid). Auditoría 2026-10-01 I25.';

alter table public.reference_counters enable row level security;
-- Sin políticas: solo la toca next_reference_code (security definer) y
-- service_role.
revoke all on table public.reference_counters from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Siguiente código
-- -----------------------------------------------------------------------------
create or replace function public.next_reference_code(
  p_company_id uuid,
  p_table text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_year_prefix text;
  v_max_tabla integer;
  v_next integer;
begin
  if p_company_id is null then
    raise exception 'next_reference_code: company_id obligatorio';
  end if;
  if p_table not in (
    'proposals', 'contracts', 'installations', 'maintenance_contracts',
    'maintenance_jobs', 'savings_proposals', 'free_trials', 'incidents',
    'wallet_entries'
  ) then
    raise exception 'next_reference_code: tabla no permitida (%)', p_table;
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}$' then
    raise exception 'next_reference_code: prefijo no válido (%)', p_prefix;
  end if;

  v_year := extract(year from (now() at time zone 'Europe/Madrid'))::int;
  v_year_prefix := p_prefix || '-' || v_year || '-';

  -- Máximo NUMÉRICO ya usado en la tabla (incluye borrados lógicos).
  execute format(
    'select max(((regexp_match(reference_code, ''(\d+)$''))[1])::int)
       from public.%I
      where company_id = $1 and reference_code like $2',
    p_table
  )
  into v_max_tabla
  using p_company_id, v_year_prefix || '%';
  v_max_tabla := coalesce(v_max_tabla, 0);

  insert into public.reference_counters as rc
    (company_id, table_name, prefix, year, last_value, updated_at)
  values
    (p_company_id, p_table, p_prefix, v_year, v_max_tabla + 1, now())
  on conflict (company_id, table_name, prefix, year) do update
    set last_value = greatest(rc.last_value, v_max_tabla) + 1,
        updated_at = now()
  returning last_value into v_next;

  return v_year_prefix || lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function public.next_reference_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.next_reference_code(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3) gen_reference_code delega (misma firma; la usan los triggers)
-- -----------------------------------------------------------------------------
create or replace function public.gen_reference_code(
  p_company_id uuid,
  p_table text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.next_reference_code(p_company_id, p_table, p_prefix);
end;
$$;

revoke all on function public.gen_reference_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gen_reference_code(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4) Índices únicos. Antes de crearlos, comprobar que no hay duplicados:
--
--   select 'proposals' t, company_id, reference_code, count(*) from proposals
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'contracts', company_id, reference_code, count(*) from contracts
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'installations', company_id, reference_code, count(*) from installations
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'maintenance_contracts', company_id, reference_code, count(*) from maintenance_contracts
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'maintenance_jobs', company_id, reference_code, count(*) from maintenance_jobs
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'savings_proposals', company_id, reference_code, count(*) from savings_proposals
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'free_trials', company_id, reference_code, count(*) from free_trials
--    where reference_code is not null group by 2,3 having count(*) > 1
--   union all select 'incidents', company_id, reference_code, count(*) from incidents
--    where reference_code is not null group by 2,3 having count(*) > 1;
--
-- Resultado el 2026-10-02: 0 filas. Si alguna vez devuelve filas, esta
-- migración fallará en el índice correspondiente: renumerar a mano primero.
-- -----------------------------------------------------------------------------
create unique index if not exists uq_proposals_company_reference_code
  on public.proposals (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_contracts_company_reference_code
  on public.contracts (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_installations_company_reference_code
  on public.installations (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_maintenance_contracts_company_reference_code
  on public.maintenance_contracts (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_maintenance_jobs_company_reference_code
  on public.maintenance_jobs (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_savings_proposals_company_reference_code
  on public.savings_proposals (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_free_trials_company_reference_code
  on public.free_trials (company_id, reference_code) where reference_code is not null;
create unique index if not exists uq_incidents_company_reference_code
  on public.incidents (company_id, reference_code) where reference_code is not null;
