-- =============================================================================
-- 20261002090000_autocierre_fichajes_hora_madrid.sql
--
-- Auditoría 2026-10-01, C8: el autocierre de fichajes apuntaba 2 h de más
-- (1 h en invierno) en el registro de jornada.
--
-- PROBLEMA
--   app.autoclose_stale_punches() calculaba el fin de jornada así:
--     day_of_week = extract(isodow from punch.punched_at) - 1     -- en UTC
--     shift_end   = (punch.punched_at::date + sched.ends_at)::timestamptz
--   La base de datos trabaja en UTC, así que un horario que acaba a las 17:00
--   se cerraba a las 17:00 UTC = 19:00 en Madrid. Además el día de la semana y
--   la comprobación "hay salida el mismo día" también iban en UTC: un fichaje
--   de entrada entre las 00:00 y las 02:00 de Madrid caía en el día anterior.
--
-- ARREGLO
--   - Fecha, día de la semana y fin de jornada se calculan en Europe/Madrid:
--       ((punched_at at time zone 'Europe/Madrid')::date + ends_at)
--         at time zone 'Europe/Madrid'
--   - Si la entrada es POSTERIOR al fin de jornada (alguien que entra a hacer
--     una tarea fuera de horario), antes se insertaba una salida ANTERIOR a la
--     entrada. Ahora se cierra con duración cero y se marca para revisión
--     [decide: conservador, no inventar horas en un registro exigible].
--   - Misma firma (returns integer) para no romper a los llamantes
--     (cron horario y diario llaman a public.autoclose_stale_punches()).
--
-- DATOS
--   En producción hay 0 fichajes autocerrados (comprobado 2026-10-02), así que
--   no hay nada que corregir. Por si se aplicara tarde, el SELECT de
--   revisión está en docs/correcciones-datos-crons-2026-10-02.sql.
--
-- Idempotente (create or replace). No toca datos.
-- =============================================================================

create or replace function app.autoclose_stale_punches()
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  punch record;
  sched record;
  v_local_date date;
  v_iso_dow int;
  shift_end_iso timestamptz;
  v_reason text;
  total integer := 0;
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
            and (tp2.punched_at at time zone 'Europe/Madrid')::date
              = (tp.punched_at at time zone 'Europe/Madrid')::date
       )
  loop
    v_local_date := (punch.punched_at at time zone 'Europe/Madrid')::date;
    -- user_work_schedules.day_of_week: 0 = lunes ... 6 = domingo
    v_iso_dow := extract(isodow from (punch.punched_at at time zone 'Europe/Madrid'))::int;
    v_reason := 'Autocierre por olvido — hora de fin de jornada';

    select * into sched
      from public.user_work_schedules
     where user_id = punch.user_id
       and day_of_week = (v_iso_dow - 1);

    if sched.ends_at is not null then
      -- Fin de jornada en hora de pared de Madrid → instante real.
      shift_end_iso := (v_local_date + sched.ends_at) at time zone 'Europe/Madrid';
      -- Solo se autocierra si ya han pasado 2 h desde el fin de jornada.
      if now() < shift_end_iso + interval '2 hours' then
        continue;
      end if;
      if shift_end_iso <= punch.punched_at then
        -- Entrada posterior al fin de su horario: no inventamos horas.
        shift_end_iso := punch.punched_at;
        v_reason := 'Autocierre por olvido — entrada fuera de horario, revisar';
        -- Esperamos igualmente 10 h desde la entrada por si sigue trabajando.
        if now() < punch.punched_at + interval '10 hours' then
          continue;
        end if;
      end if;
    else
      -- Sin horario configurado: cerrar a entrada + 8 h, pero solo si ya han
      -- pasado al menos 10 h desde la entrada (margen de 2 h).
      if now() < punch.punched_at + interval '10 hours' then
        continue;
      end if;
      shift_end_iso := punch.punched_at + interval '8 hours';
    end if;

    insert into public.time_punches (
      company_id, user_id, punch_kind, punched_at, is_manual, manual_reason, auto_closed
    ) values (
      punch.company_id, punch.user_id, 'clock_out',
      shift_end_iso, true, v_reason, true
    );
    total := total + 1;
  end loop;
  return total;
end;
$$;

-- El wrapper público ya existe y delega en app.*; lo reafirmamos por si acaso
-- y lo dejamos solo para service_role (lo llaman los crons con el admin client).
create or replace function public.autoclose_stale_punches()
returns integer
language sql
security definer
set search_path = public, app
as $$
  select app.autoclose_stale_punches();
$$;

revoke all on function public.autoclose_stale_punches() from public, anon, authenticated;
grant execute on function public.autoclose_stale_punches() to service_role;
revoke all on function app.autoclose_stale_punches() from public, anon, authenticated;
