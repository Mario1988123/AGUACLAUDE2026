-- =============================================================================
-- correcciones-datos-crons-2026-10-02.sql
--
-- SQL de revisión/corrección de datos de la tanda "crons, fechas y
-- operaciones" (auditoría 2026-10-01). NO se ha ejecutado nada de esto.
-- Cada bloque tiene primero un SELECT; los UPDATE/DELETE van comentados y
-- solo deben ejecutarse si el SELECT devuelve filas y tras revisarlas.
--
-- Estado comprobado en producción el 2026-10-02 (solo lectura):
--   - time_punches con auto_closed = true ............ 0
--   - points_ledger con mes/año distinto al de Madrid .. 0
--   - email_outbox kind = 'maintenance_reminder' ....... 2 (status failed)
--   - maintenance_jobs duplicados por contrato y mes ... 0
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) C8 — Fichajes autocerrados con la hora en UTC (2 h de más en verano,
--    1 h en invierno). Solo afecta a autocierres hechos ANTES de aplicar la
--    migración 20261002090000. Hoy hay 0.
-- -----------------------------------------------------------------------------
select tp.id, tp.company_id, tp.user_id,
       tp.punched_at,
       (tp.punched_at at time zone 'Europe/Madrid') as salida_hora_madrid,
       s.ends_at as fin_jornada,
       ((tp.punched_at at time zone 'Europe/Madrid')::date + s.ends_at)
         at time zone 'Europe/Madrid' as salida_correcta
  from public.time_punches tp
  join public.user_work_schedules s
    on s.user_id = tp.user_id
   and s.day_of_week = extract(isodow from (tp.punched_at at time zone 'Europe/Madrid'))::int - 1
 where tp.auto_closed = true
   and tp.manual_reason = 'Autocierre por olvido — hora de fin de jornada'
   -- la salida guardada coincide con "fin de jornada en UTC"
   and (tp.punched_at at time zone 'UTC')::time = s.ends_at;

-- Corrección (registro horario: dejar rastro en edited_reason):
-- update public.time_punches tp
--    set punched_at = ((tp.punched_at at time zone 'Europe/Madrid')::date + s.ends_at)
--                       at time zone 'Europe/Madrid',
--        edited_reason = 'Corrección autocierre: se guardó en UTC (auditoría 2026-10-01 C8)'
--   from public.user_work_schedules s
--  where s.user_id = tp.user_id
--    and s.day_of_week = extract(isodow from (tp.punched_at at time zone 'Europe/Madrid'))::int - 1
--    and tp.auto_closed = true
--    and tp.manual_reason = 'Autocierre por olvido — hora de fin de jornada'
--    and (tp.punched_at at time zone 'UTC')::time = s.ends_at;


-- -----------------------------------------------------------------------------
-- 2) I1 — Recordatorios encolados para visitas que nunca se crearon
--    (maintenance-scheduler insertaba kind 'preventive', fuera del enum).
--    Hoy: 2 filas, ambas failed. No contienen nada que enviar.
-- -----------------------------------------------------------------------------
select id, company_id, kind, status, send_at, subject_type, subject_id
  from public.email_outbox
 where kind = 'maintenance_reminder';

-- Limpieza opcional (son avisos de visitas inexistentes):
-- delete from public.email_outbox
--  where kind = 'maintenance_reminder' and status = 'failed';


-- -----------------------------------------------------------------------------
-- 3) I36 — Asientos de puntos con mes/año calculado en UTC. Hoy: 0.
-- -----------------------------------------------------------------------------
select id, company_id, user_id, points, reason, awarded_at,
       period_year, period_month,
       extract(year from awarded_at at time zone 'Europe/Madrid')::int  as anio_madrid,
       extract(month from awarded_at at time zone 'Europe/Madrid')::int as mes_madrid
  from public.points_ledger
 where period_year  <> extract(year from awarded_at at time zone 'Europe/Madrid')
    or period_month <> extract(month from awarded_at at time zone 'Europe/Madrid');

-- OJO: si el ciclo de ese mes ya está cerrado/pagado, NO mover el asiento.
-- update public.points_ledger
--    set period_year  = extract(year from awarded_at at time zone 'Europe/Madrid')::int,
--        period_month = extract(month from awarded_at at time zone 'Europe/Madrid')::int
--  where period_year  <> extract(year from awarded_at at time zone 'Europe/Madrid')
--     or period_month <> extract(month from awarded_at at time zone 'Europe/Madrid');


-- -----------------------------------------------------------------------------
-- 4) I35 — Visitas de mantenimiento duplicadas (mismo contrato, misma fecha
--    teórica ±2 días). Para volver a pasar unas semanas después de aplicar,
--    porque el cron diario ahora SÍ recalcula la ventana de 12 meses.
-- -----------------------------------------------------------------------------
select a.contract_id, a.id as visita_a, b.id as visita_b,
       coalesce(a.original_scheduled_at, a.scheduled_at) as fecha_a,
       coalesce(b.original_scheduled_at, b.scheduled_at) as fecha_b,
       a.status as estado_a, b.status as estado_b
  from public.maintenance_jobs a
  join public.maintenance_jobs b
    on b.contract_id = a.contract_id
   and b.id > a.id
   and abs(extract(epoch from coalesce(a.original_scheduled_at, a.scheduled_at)
                            - coalesce(b.original_scheduled_at, b.scheduled_at))) < 2 * 86400
 where a.contract_id is not null
   and a.status <> 'cancelled' and b.status <> 'cancelled';

-- Corrección: decidir a mano cuál conservar (la confirmada/scheduled) y
-- cancelar la otra; NO borrar:
-- update public.maintenance_jobs set status = 'cancelled'
--  where id in ('<id de la visita teórica sobrante>');


-- -----------------------------------------------------------------------------
-- 5) C2 — Ejecuciones de cron que nunca registraron su fin (informativo).
--    Tras el despliegue, las nuevas deben tener ended_at.
-- -----------------------------------------------------------------------------
select job, count(*) as ejecuciones, count(ended_at) as terminadas,
       max(started_at) as ultima
  from public.cron_runs
 where started_at > now() - interval '30 days'
 group by job
 order by job;

-- Opcional: marcar las 22 ejecuciones huérfanas del cron diario como fallidas
-- para que el panel de salud no las cuente como "en curso":
-- update public.cron_runs
--    set ok = false,
--        summary = coalesce(summary, '{}'::jsonb)
--                  || '{"nota":"cortada a los 300 s (auditoría 2026-10-01 C2)"}'::jsonb
--  where job = 'daily' and ended_at is null and started_at < now() - interval '1 hour';
