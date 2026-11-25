-- =============================================================================
-- Captación — Google Places con tope mensual (decisión de Mario del 25-11-2026:
-- 1.000 llamadas al mes, el tramo gratuito de Text Search Enterprise).
--
-- La clave es de la plataforma (proyecto aguaclaude), así que el tope es de
-- TODAS las empresas juntas. Se cuenta con una fila por llamada (el registro),
-- nunca con un contador que se incrementa: lección de barrido.ts de
-- Osmofilter, donde el contador llegó a 5.000 con 2.400 llamadas reales.
--
-- Reserva atómica: un candado de transacción serializa a quien reserva, así el
-- cron y el botón «Procesar ahora» no se pasan del tope aunque coincidan.
-- =============================================================================

create table if not exists public.captacion_places_llamadas (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  busqueda_id uuid references public.captacion_busquedas(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists captacion_places_llamadas_fecha_idx on public.captacion_places_llamadas(created_at);

alter table public.captacion_places_llamadas enable row level security;
alter table public.captacion_places_llamadas force row level security;
revoke all on table public.captacion_places_llamadas from anon, authenticated;

comment on table public.captacion_places_llamadas is
  'Una fila por llamada a Places Text Search. El tope mensual se cuenta aquí (mes natural, hora de Madrid).';

create or replace function public.captacion_reservar_llamada_places(p_busqueda_id uuid, p_tope integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inicio timestamptz := (date_trunc('month', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v_usadas integer;
  v_company uuid;
begin
  perform pg_advisory_xact_lock(hashtext('captacion_places_tope'));
  select count(*) into v_usadas from captacion_places_llamadas where created_at >= v_inicio;
  if v_usadas >= p_tope then
    return -1;
  end if;
  select company_id into v_company from captacion_busquedas where id = p_busqueda_id;
  if v_company is null then
    raise exception 'búsqueda % no existe', p_busqueda_id;
  end if;
  insert into captacion_places_llamadas (company_id, busqueda_id) values (v_company, p_busqueda_id);
  update captacion_busquedas set llamadas_places = llamadas_places + 1 where id = p_busqueda_id;
  return v_usadas + 1;
end;
$$;

comment on function public.captacion_reservar_llamada_places(uuid, integer) is
  'Reserva una llamada a Places dentro del tope del mes (todas las empresas). Devuelve las usadas tras reservar, o -1 si ya no quedan.';

revoke all on function public.captacion_reservar_llamada_places(uuid, integer) from public, anon, authenticated;
grant execute on function public.captacion_reservar_llamada_places(uuid, integer) to service_role;

create or replace function public.captacion_llamadas_places_mes()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from captacion_places_llamadas
   where created_at >= (date_trunc('month', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
$$;
revoke all on function public.captacion_llamadas_places_mes() from public, anon, authenticated;
grant execute on function public.captacion_llamadas_places_mes() to service_role;

notify pgrst, 'reload schema';
