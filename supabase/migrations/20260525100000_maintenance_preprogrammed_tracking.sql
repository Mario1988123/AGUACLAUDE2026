-- =============================================================================
-- 20260525100000_maintenance_preprogrammed_tracking.sql
-- Formaliza el flujo de confirmación de mantenimientos:
--  · Añade valor 'preprogrammed' al enum app.maintenance_status (hasta
--    ahora era de facto, con fallback a 'scheduled' si el enum no lo
--    contenía — fuente: src/modules/maintenance/auto-schedule.ts L139).
--  · Añade columnas de tracking de confirmación + última llamada al
--    cliente, para que el equipo de admin/TMK sepa quién y cuándo
--    movió la fecha tras hablar con el cliente.
--
-- Flujo final:
--   1. Cron diario crea job en status='preprogrammed' a partir de la
--      periodicidad del contrato.
--   2. Listado y badge claro "Por confirmar" en /mantenimientos.
--   3. Admin / TMK abre el modal de /mantenimientos/por-confirmar, llama
--      al cliente, ajusta la fecha (±N días si hace falta), asigna
--      técnico y confirma → status='scheduled' + confirmed_at + confirmed_by.
-- =============================================================================

-- 1) Añadir 'preprogrammed' al enum (Postgres permite agregar valores
--    sin recrear el tipo). Idempotente: solo añade si no existe.
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'maintenance_status' and e.enumlabel = 'preprogrammed'
  ) then
    alter type app.maintenance_status add value 'preprogrammed' before 'scheduled';
  end if;
end $$;

-- 2) Columnas tracking
alter table public.maintenance_jobs
  add column if not exists confirmed_at      timestamptz,
  add column if not exists confirmed_by      uuid references auth.users(id) on delete set null,
  add column if not exists customer_called_at timestamptz,
  add column if not exists customer_called_by uuid references auth.users(id) on delete set null,
  add column if not exists original_scheduled_at timestamptz;

comment on column public.maintenance_jobs.confirmed_at is
  'Fecha/hora en que un usuario admin/TMK confirmó la fecha del mantenimiento tras hablar con el cliente. Cuando este campo está null, el job está en cola "por confirmar".';
comment on column public.maintenance_jobs.confirmed_by is
  'Usuario que confirmó la fecha. NULL hasta que se confirme.';
comment on column public.maintenance_jobs.customer_called_at is
  'Fecha/hora en la que se llamó al cliente para confirmar la fecha propuesta (puede haberse llamado sin haber confirmado todavía).';
comment on column public.maintenance_jobs.customer_called_by is
  'Usuario que registró haber llamado al cliente.';
comment on column public.maintenance_jobs.original_scheduled_at is
  'Fecha original propuesta por el cron al crear el job. Si admin la cambia tras hablar con el cliente, scheduled_at se actualiza pero esto se conserva para auditoría / análisis de desviaciones.';

-- (índice idx_mjobs_pending_confirm se crea en 20260525120000 — Postgres
--  no permite usar un valor de enum recién añadido en la misma
--  transacción).

notify pgrst, 'reload schema';
