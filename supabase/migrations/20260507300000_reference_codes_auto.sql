-- =============================================================================
-- 20260507300000_reference_codes_auto.sql
-- Reference codes auto-generados al INSERT en 4 tablas que aún los calculaban
-- en runtime: incidents (INC-YYYY-NNNN), free_trials (PG-YYYY-NNNN),
-- maintenance_jobs (MJ-YYYY-NNNN), wallet_entries (W-YYYY-NNNN).
--
-- Idempotente.
-- =============================================================================

-- Función genérica de generación de código secuencial por (company_id, año, prefijo)
create or replace function public.gen_reference_code(
  p_company_id uuid,
  p_table text,
  p_prefix text
)
returns text
language plpgsql
as $$
declare
  v_year integer;
  v_year_prefix text;
  v_last_code text;
  v_next_num integer;
begin
  v_year := extract(year from now())::int;
  v_year_prefix := p_prefix || '-' || v_year || '-';

  execute format(
    'select reference_code from public.%I
     where company_id = $1 and reference_code like $2
     order by reference_code desc
     limit 1',
    p_table
  )
  into v_last_code
  using p_company_id, v_year_prefix || '%';

  v_next_num := 1;
  if v_last_code is not null then
    v_next_num := coalesce(
      (regexp_match(v_last_code, '(\d+)$'))[1]::int + 1,
      1
    );
  end if;

  return v_year_prefix || lpad(v_next_num::text, 4, '0');
end $$;

-- Trigger para tablas que aún no tienen reference_code generado en BD
create or replace function public.fill_reference_code_on_insert()
returns trigger language plpgsql as $$
declare
  v_prefix text;
begin
  if new.reference_code is not null then
    return new;
  end if;
  if tg_argv[0] is null then
    return new;
  end if;
  v_prefix := tg_argv[0];
  new.reference_code := public.gen_reference_code(
    new.company_id, tg_table_name, v_prefix
  );
  return new;
end $$;

-- incidents.reference_code
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'incidents'
      and column_name = 'reference_code'
  ) then
    drop trigger if exists trg_incidents_ref_code on public.incidents;
    create trigger trg_incidents_ref_code
      before insert on public.incidents
      for each row execute function public.fill_reference_code_on_insert('INC');
  end if;
end $$;

-- free_trials.reference_code
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'free_trials'
      and column_name = 'reference_code'
  ) then
    drop trigger if exists trg_free_trials_ref_code on public.free_trials;
    create trigger trg_free_trials_ref_code
      before insert on public.free_trials
      for each row execute function public.fill_reference_code_on_insert('PG');
  end if;
end $$;

-- maintenance_jobs.reference_code
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'maintenance_jobs'
      and column_name = 'reference_code'
  ) then
    drop trigger if exists trg_maintenance_jobs_ref_code on public.maintenance_jobs;
    create trigger trg_maintenance_jobs_ref_code
      before insert on public.maintenance_jobs
      for each row execute function public.fill_reference_code_on_insert('MJ');
  end if;
end $$;

-- wallet_entries.reference_code
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wallet_entries'
      and column_name = 'reference_code'
  ) then
    drop trigger if exists trg_wallet_entries_ref_code on public.wallet_entries;
    create trigger trg_wallet_entries_ref_code
      before insert on public.wallet_entries
      for each row execute function public.fill_reference_code_on_insert('W');
  end if;
end $$;

-- Si la columna reference_code NO existe en alguna tabla, la añadimos
alter table public.incidents add column if not exists reference_code text;
alter table public.free_trials add column if not exists reference_code text;
alter table public.maintenance_jobs add column if not exists reference_code text;
alter table public.wallet_entries add column if not exists reference_code text;

-- Índices únicos por empresa
create unique index if not exists uniq_incidents_ref
  on public.incidents(company_id, reference_code) where reference_code is not null;
create unique index if not exists uniq_free_trials_ref
  on public.free_trials(company_id, reference_code) where reference_code is not null;
create unique index if not exists uniq_maintenance_jobs_ref
  on public.maintenance_jobs(company_id, reference_code) where reference_code is not null;
create unique index if not exists uniq_wallet_entries_ref
  on public.wallet_entries(company_id, reference_code) where reference_code is not null;

-- Backfill para filas existentes sin código (silencioso, fail-soft)
do $$
declare
  rec record;
begin
  for rec in
    select 'incidents'::text as t, 'INC'::text as p
    union all select 'free_trials', 'PG'
    union all select 'maintenance_jobs', 'MJ'
    union all select 'wallet_entries', 'W'
  loop
    begin
      execute format(
        'update public.%I set reference_code = public.gen_reference_code(company_id, %L, %L)
         where reference_code is null',
        rec.t, rec.t, rec.p
      );
    exception when others then
      raise notice 'Backfill % falló: %', rec.t, sqlerrm;
    end;
  end loop;
end $$;
