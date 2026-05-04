-- =============================================================================
-- 20260504140000_autoclose_intraday.sql
-- La función app.autoclose_stale_punches() original sólo cerraba fichajes
-- de DÍAS PASADOS (filtro punched_at::date < current_date). Esto hace que
-- un trabajador que olvida fichar la salida no vea autocierre hasta el
-- día siguiente (cuando corre el cron diario a las 7am).
--
-- Esta versión también cierra fichajes del día actual cuando el fin de
-- jornada + 2h ya ha pasado. Además crea incidencias para que el usuario
-- sepa que se autocerró su fichaje y pueda revisarlo.
-- =============================================================================

create or replace function app.autoclose_stale_punches() returns integer
language plpgsql
security definer
as $$
declare
  punch record;
  sched record;
  closed_at_iso timestamptz;
  total integer := 0;
  jornada_end_today timestamptz;
begin
  for punch in
    select tp.id, tp.user_id, tp.company_id, tp.punched_at
      from public.time_punches tp
     where tp.punch_kind = 'clock_in'
       and not exists (
         select 1 from public.time_punches tp2
          where tp2.user_id = tp.user_id
            and tp2.punch_kind = 'clock_out'
            and tp2.punched_at > tp.punched_at
            and tp2.punched_at::date = tp.punched_at::date
       )
       and tp.punched_at < now() - interval '2 hours'
  loop
    -- Buscar horario del día correspondiente al clock_in
    select * into sched
      from public.user_work_schedules
     where user_id = punch.user_id
       and day_of_week = ((extract(isodow from punch.punched_at)::int - 1) % 7);

    if sched.ends_at is not null then
      jornada_end_today := (punch.punched_at::date + sched.ends_at)::timestamptz;
    else
      jornada_end_today := punch.punched_at + interval '8 hours';
    end if;

    -- Sólo cerramos si ya pasó el fin de jornada + 2h. Esto cubre tanto
    -- olvidos del día anterior como del día en curso si es muy tarde.
    if now() < jornada_end_today + interval '2 hours' then
      continue;
    end if;

    closed_at_iso := jornada_end_today + interval '2 hours';

    insert into public.time_punches (
      company_id, user_id, punch_kind, punched_at, is_manual, manual_reason, auto_closed
    ) values (
      punch.company_id, punch.user_id, 'clock_out',
      closed_at_iso, true, 'Autocierre por olvido del clock_out', true
    );

    -- Incidencia para que el usuario revise (si la tabla existe)
    begin
      insert into public.incidents (
        company_id, kind, severity, title, description,
        subject_type, subject_id, status, assigned_user_id, created_by
      ) values (
        punch.company_id,
        'time_tracking.autoclose',
        'warning',
        'Fichaje autocerrado',
        format(
          'Se ha autocerrado tu fichaje del %s (entrada %s) por olvido del clock_out. Revisa la jornada en /fichajes.',
          to_char(punch.punched_at, 'DD/MM/YYYY'),
          to_char(punch.punched_at at time zone 'Europe/Madrid', 'HH24:MI')
        ),
        'user', punch.user_id, 'open',
        punch.user_id, null
      );
    exception
      when undefined_table then null;
      when others then null;
    end;

    total := total + 1;
  end loop;
  return total;
end;
$$;

grant execute on function app.autoclose_stale_punches() to authenticated;

notify pgrst, 'reload schema';
