-- =============================================================================
-- BACKFILL: tareas de agenda "Mantenimiento" (con cliente) → mantenimientos reales
-- =============================================================================
-- Contexto: hasta ahora, agendar un "Mantenimiento" desde /agenda creaba SOLO un
-- agenda_events (kind='maintenance'), no un maintenance_job, así que NO aparecía
-- en /mantenimientos ni lo veía el instalador. Ya está corregido para los nuevos.
-- Este script convierte los YA EXISTENTES (tareas de agenda de mantenimiento con
-- cliente) en mantenimientos reales (maintenance_jobs) y archiva la tarea de
-- agenda original (deleted_at) para que no salga duplicada.
--
-- CÓMO USARLO en el editor SQL de Supabase:
--   1) Ejecuta SOLO el PASO 1 (SELECT) para ver QUÉ y CUÁNTAS se van a convertir.
--   2) Si te cuadra, ejecuta el PASO 2 (la transacción BEGIN…COMMIT).
-- Es reentrante: lo ya convertido queda archivado (deleted_at) y no se repite.
-- NO toca los mantenimientos programados desde /mantenimientos (no son agenda).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- PASO 1 — PREVISUALIZACIÓN (no cambia nada). Revisa el listado y el total.
-- ----------------------------------------------------------------------------
select
  ae.id              as agenda_event_id,
  ae.company_id,
  ae.subject_id      as customer_id,
  ae.title,
  ae.status          as agenda_status,
  ae.starts_at,
  ae.assigned_user_id as technician_user_id
from public.agenda_events ae
join public.customers c
  on c.id = ae.subject_id
 and c.company_id = ae.company_id
 and c.deleted_at is null
where ae.kind = 'maintenance'
  and ae.subject_type = 'customer'
  and ae.subject_id is not null
  and ae.deleted_at is null
order by ae.starts_at;

-- ----------------------------------------------------------------------------
-- PASO 2 — CONVERSIÓN (transacción). Ejecuta este bloque completo.
-- ----------------------------------------------------------------------------
begin;

-- 2a) Crear el mantenimiento real a partir de cada tarea de agenda.
insert into public.maintenance_jobs
  (company_id, customer_id, kind, status, scheduled_at,
   technician_user_id, notes, created_by, completed_at)
select
  ae.company_id,
  ae.subject_id,
  'one_off'::app.maintenance_kind,
  (case ae.status
     when 'in_progress' then 'in_progress'
     when 'completed'   then 'completed'
     when 'cancelled'   then 'cancelled'
     when 'no_show'     then 'cancelled'
     when 'rescheduled' then 'rescheduled'
     else 'scheduled'
   end)::app.maintenance_status,
  ae.starts_at,
  ae.assigned_user_id,
  nullif(concat_ws(' — ', nullif(ae.title, ''), nullif(ae.description, '')), ''),
  ae.created_by,
  (case when ae.status = 'completed' then coalesce(ae.updated_at, ae.starts_at) else null end)
from public.agenda_events ae
join public.customers c
  on c.id = ae.subject_id
 and c.company_id = ae.company_id
 and c.deleted_at is null
where ae.kind = 'maintenance'
  and ae.subject_type = 'customer'
  and ae.subject_id is not null
  and ae.deleted_at is null;

-- 2b) Archivar la tarea de agenda original (mismo filtro) para no duplicar:
--     la agenda ya muestra los mantenimientos reales como tareas.
update public.agenda_events ae
set deleted_at = now()
where ae.kind = 'maintenance'
  and ae.subject_type = 'customer'
  and ae.subject_id is not null
  and ae.deleted_at is null
  and exists (
    select 1 from public.customers c
     where c.id = ae.subject_id
       and c.company_id = ae.company_id
       and c.deleted_at is null
  );

commit;
