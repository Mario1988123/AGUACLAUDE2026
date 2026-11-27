-- =============================================================================
-- Captación por WhatsApp · FASE 7 (mando completo): cortacircuitos, costes,
-- reintento de propuestas y embudo. Solo aditiva.
--
--  · captacion_envios.coste_milicentimos: coste en milésimas de céntimo
--    (5,85 céntimos = 5850). coste_cents (entero) no puede guardar 5,85 sin
--    redondear; se rellena también, redondeado, por compatibilidad. EL GASTO
--    DEL MES SE CALCULA SUMANDO coste_milicentimos, sin contador aparte.
--  · captacion_campanas.pausa_automatica / pausada_at / reanudada_at: la pausa
--    del cortacircuitos (o de la conexión) no se levanta sola; al reanudarla a
--    mano se apunta reanudada_at y desde ahí cuentan la muestra del
--    cortacircuitos y el escalado (vuelve a empezar por 50).
--  · captacion_conexiones.aviso_gasto_80_mes / aviso_gasto_tope_mes: mes
--    ('AAAA-MM') del último aviso, para avisar una sola vez al mes.
--  · captacion_propuestas.envio_intentos / ultimo_intento_at: reintentos del
--    cron (como mucho 3) del PDF que no salió.
-- =============================================================================

alter table public.captacion_envios
  add column if not exists coste_milicentimos integer
    check (coste_milicentimos is null or coste_milicentimos >= 0),
  add column if not exists coste_categoria text;

comment on column public.captacion_envios.coste_milicentimos is
  'Coste del envío en milésimas de céntimo de euro (5,85 cts = 5850). Se apunta al entregarse (o leerse). El gasto del mes es la suma de esta columna.';
comment on column public.captacion_envios.coste_categoria is
  'Categoría de precio con la que se ha calculado el coste (marketing, utility, service…): la de Meta si llega en pricing.category; si no, marketing.';

alter table public.captacion_campanas
  add column if not exists pausa_automatica boolean not null default false,
  add column if not exists pausada_at timestamptz,
  add column if not exists reanudada_at timestamptz;

comment on column public.captacion_campanas.pausa_automatica is
  'La pausó el sistema (cortacircuitos, calidad o conexión). No se reanuda sola.';
comment on column public.captacion_campanas.reanudada_at is
  'Última reanudación a mano tras una pausa automática. La muestra del cortacircuitos y el escalado cuentan desde aquí.';

alter table public.captacion_conexiones
  add column if not exists aviso_gasto_80_mes text
    check (aviso_gasto_80_mes is null or aviso_gasto_80_mes ~ '^[0-9]{4}-[0-9]{2}$'),
  add column if not exists aviso_gasto_tope_mes text
    check (aviso_gasto_tope_mes is null or aviso_gasto_tope_mes ~ '^[0-9]{4}-[0-9]{2}$');

alter table public.captacion_propuestas
  add column if not exists envio_intentos smallint not null default 0
    check (envio_intentos >= 0 and envio_intentos <= 20),
  add column if not exists ultimo_intento_at timestamptz;

comment on column public.captacion_propuestas.envio_intentos is
  'Reintentos del cron para mandar el PDF que falló (como mucho 3; si ya no se puede, se deja en 3).';

create index if not exists captacion_propuestas_reintento_idx
  on public.captacion_propuestas(created_at)
  where envio_error is not null and enviada_at is null and revocada_at is null;

create index if not exists captacion_bloqueos_prospecto_idx
  on public.captacion_bloqueos(prospecto_id)
  where prospecto_id is not null;

create index if not exists captacion_envios_muestra_idx
  on public.captacion_envios(campana_id, reclamado_at desc)
  where reclamado_at is not null;

-- -----------------------------------------------------------------------------
-- Gasto del mes: SUMA de filas (sin contador). en_vuelo = enviados cuyo coste
-- aún no se sabe (sin estado de entrega); el código los cuenta a tarifa de
-- marketing para no pasarse del tope.
-- -----------------------------------------------------------------------------
create or replace function public.captacion_gasto_mes(p_company_id uuid, p_desde timestamptz)
returns table (confirmado_milicentimos bigint, en_vuelo integer, cobrados integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(e.coste_milicentimos), 0)::bigint,
         (count(*) filter (where e.coste_milicentimos is null and e.estado in ('enviado', 'entregado', 'leido')))::integer,
         (count(*) filter (where e.coste_milicentimos > 0))::integer
    from public.captacion_envios e
   where e.company_id = p_company_id
     and e.enviado_at >= p_desde;
$$;

revoke all on function public.captacion_gasto_mes(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.captacion_gasto_mes(uuid, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- Muestra del cortacircuitos: los últimos p_tamano envíos INTENTADOS de la
-- campaña (reclamado_at puesto y ya resueltos), desde p_desde si se da.
-- noes = prospectos de la muestra con bloqueo (dijeron «No» o pidieron la baja).
-- -----------------------------------------------------------------------------
create or replace function public.captacion_muestra_cortacircuitos(
  p_company_id uuid,
  p_campana_id uuid,
  p_desde timestamptz,
  p_tamano integer default 100
)
returns table (intentos integer, fallidos integer, prospectos integer, noes integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with m as (
    select e.prospecto_id, e.estado
      from public.captacion_envios e
     where e.company_id = p_company_id
       and e.campana_id = p_campana_id
       and e.reclamado_at is not null
       and e.estado in ('enviado', 'entregado', 'leido', 'fallido')
       and (p_desde is null or e.reclamado_at >= p_desde)
     order by e.reclamado_at desc
     limit greatest(least(coalesce(p_tamano, 100), 1000), 1)
  )
  select (select count(*) from m)::integer,
         (select count(*) from m where m.estado = 'fallido')::integer,
         (select count(distinct m.prospecto_id) from m)::integer,
         (select count(distinct b.prospecto_id)
            from public.captacion_bloqueos b
           where b.company_id = p_company_id
             and b.prospecto_id in (select m.prospecto_id from m))::integer;
$$;

revoke all on function public.captacion_muestra_cortacircuitos(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.captacion_muestra_cortacircuitos(uuid, uuid, timestamptz, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Embudo (de la empresa o de una campaña) con SQL agregado: PostgREST corta en
-- 1.000 filas, así que nada de contar en el código.
--   contactados  = prospectos con el primer mensaje enviado
--   entregados   = primer mensaje entregado o leído
--   si           = etapa interesado, caliente o convertido
--   no           = prospectos con bloqueo («No» o baja)
--   interesados  = pidieron llamada (caliente) o convertidos
--   leads        = con lead creado
-- -----------------------------------------------------------------------------
create or replace function public.captacion_embudo(p_company_id uuid, p_campana_id uuid default null)
returns table (
  prospectos integer,
  en_cola integer,
  contactados integer,
  entregados integer,
  recordados integer,
  si integer,
  no integer,
  interesados integer,
  leads integer,
  conversando integer,
  sin_respuesta integer,
  fallidos integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with p as (
    select id, etapa, lead_id
      from public.captacion_prospectos
     where company_id = p_company_id
       and (p_campana_id is null or campana_id = p_campana_id)
  ),
  e as (
    select prospecto_id, tipo, estado, enviado_at
      from public.captacion_envios
     where company_id = p_company_id
       and (p_campana_id is null or campana_id = p_campana_id)
  )
  select (select count(*) from p)::integer,
         (select count(*) from p where etapa = 'en_cola')::integer,
         (select count(distinct prospecto_id) from e where tipo = 'primer_contacto' and enviado_at is not null)::integer,
         (select count(distinct prospecto_id) from e where tipo = 'primer_contacto' and estado in ('entregado', 'leido'))::integer,
         (select count(distinct prospecto_id) from e where tipo = 'recordatorio' and enviado_at is not null)::integer,
         (select count(*) from p where etapa in ('interesado', 'caliente', 'convertido'))::integer,
         (select count(distinct b.prospecto_id)
            from public.captacion_bloqueos b
            join p on p.id = b.prospecto_id
           where b.company_id = p_company_id)::integer,
         (select count(*) from p where etapa in ('caliente', 'convertido'))::integer,
         (select count(*) from p where lead_id is not null)::integer,
         (select count(*) from p where etapa = 'conversando')::integer,
         (select count(*) from p where etapa = 'sin_respuesta')::integer,
         (select count(*) from p where etapa = 'fallido')::integer;
$$;

revoke all on function public.captacion_embudo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.captacion_embudo(uuid, uuid) to service_role;
