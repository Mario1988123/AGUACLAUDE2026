-- ============================================================================
-- 20260620200000_cron_runs.sql
-- Observabilidad de crons (decisión 2026-05-20). Hoy hay >60 catch
-- silenciosos en daily/hourly. Sin esta tabla nadie sabe si un cron
-- corrió, falló o tardó.
-- ============================================================================

create table if not exists public.cron_runs (
  id              uuid primary key default gen_random_uuid(),
  job             text not null,                    -- "daily", "hourly", "purchase-suggestions", "boe-check", etc.
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  ok              boolean,
  duration_ms     integer,
  errors_count    integer not null default 0,
  summary         jsonb not null default '{}'::jsonb
);

create index if not exists idx_cron_runs_job_started
  on public.cron_runs(job, started_at desc);

create index if not exists idx_cron_runs_ok
  on public.cron_runs(ok, started_at desc)
  where ok = false;

comment on table public.cron_runs is
  'Telemetría de cada ejecución de cron. ok=true → todo bien. ok=false → revisar errors_count/summary. ok=null → en curso o muerto.';


-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';
