-- =============================================================================
-- 20260525110000_autoclose_at_shift_end.sql
-- Ajuste del autocierre de fichajes:
--
--   ANTES: cerraba el clock_out en (fin_jornada + 2h) → saldo del día
--          quedaba en +2h artificiales, no cuadraba.
--   AHORA: detecta el fichaje sin cerrar +2h tras el FIN DE JORNADA
--          (no tras el clock_in) y guarda la salida exactamente a la
--          hora de fin de jornada, así el saldo del día queda en +0min
--          como si hubiera fichado puntual.
--
-- Decisión usuario 2026-05-15: el autocierre no penaliza, solo cierra.
-- Quien quiera corregir, usa /fichajes "Solicitar fichaje".
-- =============================================================================

create or replace function app.autoclose_stale_punches() returns integer
language plpgsql
security definer
as $$
declare
  punch record;
  sched record;
  shift_end_iso timestamptz;
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
            and tp2.punched_at::date = tp.punched_at::date
       )
  loop
    -- Buscar horario del día correspondiente al clock_in
    select * into sched
      from public.user_work_schedules
     where user_id = punch.user_id
       and day_of_week = ((extract(isodow from punch.punched_at)::int - 1) % 7);

    if sched.ends_at is not null then
      -- Fin de jornada EXACTO (sin +2h). Solo se autocierra si ya
      -- han pasado 2h o más desde ese fin de jornada.
      shift_end_iso := (punch.punched_at::date + sched.ends_at)::timestamptz;
      if now() < shift_end_iso + interval '2 hours' then
        continue; -- aún no toca cerrar
      end if;
    else
      -- Sin horario configurado: cerrar a clock_in + 8h, pero solo si
      -- ya han pasado al menos 10h desde el clock_in (margen de 2h).
      if now() < punch.punched_at + interval '10 hours' then
        continue;
      end if;
      shift_end_iso := punch.punched_at + interval '8 hours';
    end if;

    insert into public.time_punches (
      company_id, user_id, punch_kind, punched_at, is_manual, manual_reason, auto_closed
    ) values (
      punch.company_id, punch.user_id, 'clock_out',
      shift_end_iso, true, 'Autocierre por olvido — hora de fin de jornada', true
    );
    total := total + 1;
  end loop;
  return total;
end;
$$;

grant execute on function app.autoclose_stale_punches() to authenticated;

comment on function app.autoclose_stale_punches() is
  'Cierra fichajes olvidados +2h tras el fin de jornada. Guarda la hora exacta de fin de jornada (no fin+2h) para que el saldo del día quede en cero.';
