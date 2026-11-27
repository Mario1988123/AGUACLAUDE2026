-- =============================================================================
-- Captación por WhatsApp · Fase 8 (endurecimiento)
--
--  1. Retención automática (plan §3 y §8): candidatos, anonimización por lotes
--     y purga de captacion_webhook_eventos a los 30 días.
--  2. Panel de salud para Vercomi (/superadmin/captacion): conteos exactos por
--     empresa en una sola llamada (PostgREST corta en 1.000 filas).
--  3. Propuesta con plantilla de cabecera DOCUMENT fuera de la ventana de 24 h:
--     captacion_envios admite el tipo «documento» (para el coste y para que la
--     base impida mandarla dos veces al mismo prospecto).
--
-- Aditiva. Lo único que se borra y se vuelve a crear es el CHECK de
-- captacion_envios.tipo, para ampliarlo. Todas las funciones son solo para
-- service_role: las llama el servidor con el cliente de servicio.
--
-- NUNCA se tocan captacion_bloqueos, los prospectos con lead ni los leads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Índice para la purga de eventos por fecha (el que hay es parcial).
-- -----------------------------------------------------------------------------
create index if not exists captacion_webhook_eventos_recibido_idx
  on public.captacion_webhook_eventos (recibido_at);

-- -----------------------------------------------------------------------------
-- 1. captacion_envios.tipo admite «documento» (propuesta con plantilla).
-- -----------------------------------------------------------------------------
alter table public.captacion_envios drop constraint if exists captacion_envios_tipo_check;
alter table public.captacion_envios
  add constraint captacion_envios_tipo_check
  check (tipo = any (array['primer_contacto'::text, 'recordatorio'::text, 'documento'::text]));

-- -----------------------------------------------------------------------------
-- 2. Retención
-- -----------------------------------------------------------------------------

-- Último movimiento de un prospecto: su propia fila, el último mensaje de sus
-- conversaciones, sus envíos y las visitas a sus propuestas. greatest() ignora
-- los nulos.
create or replace function public.captacion_ultimo_movimiento(p_company_id uuid, p_prospecto_id uuid)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(
    (select greatest(p.created_at, p.updated_at)
       from public.captacion_prospectos p
      where p.company_id = p_company_id and p.id = p_prospecto_id),
    (select max(c.ultimo_mensaje_at)
       from public.captacion_conversaciones c
      where c.company_id = p_company_id and c.prospecto_id = p_prospecto_id),
    (select max(greatest(e.updated_at, e.enviado_at, e.entregado_at, e.leido_at))
       from public.captacion_envios e
      where e.company_id = p_company_id and e.prospecto_id = p_prospecto_id),
    (select max(v.ultimo_at)
       from public.captacion_visitas v
       join public.captacion_propuestas pr on pr.id = v.propuesta_id
      where pr.company_id = p_company_id and pr.prospecto_id = p_prospecto_id)
  );
$$;

revoke all on function public.captacion_ultimo_movimiento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.captacion_ultimo_movimiento(uuid, uuid) to service_role;

-- Etapas que nunca se anonimizan: ha mostrado interés o ya es lead.
-- (Se repite en captacion_anonimizar_prospectos y en retencion-logica.ts.)

-- Candidatos a anonimizar, de todas las empresas (o de una). La retención de
-- cada empresa es captacion_conexiones.retencion_dias (365 si no hay conexión),
-- acotada a 30..3650 como su CHECK. Prefiltro por updated_at: el último
-- movimiento nunca es anterior a él.
create or replace function public.captacion_retencion_candidatos(
  p_ahora timestamptz,
  p_limite integer default 500,
  p_company_id uuid default null
)
returns table (
  id uuid,
  company_id uuid,
  etapa text,
  lead_id uuid,
  anonimizado_at timestamptz,
  ultimo_movimiento timestamptz,
  retencion_dias integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with base as (
    select p.id, p.company_id, p.etapa, p.lead_id, p.anonimizado_at, p.updated_at,
           greatest(30, least(coalesce(c.retencion_dias, 365), 3650)) as dias
      from public.captacion_prospectos p
      left join public.captacion_conexiones c on c.company_id = p.company_id
     where p.anonimizado_at is null
       and p.lead_id is null
       and p.etapa not in ('interesado', 'caliente', 'convertido')
       and (p_company_id is null or p.company_id = p_company_id)
  ),
  pre as (
    select b.*
      from base b
     where b.updated_at < least(coalesce(p_ahora, now()), now()) - make_interval(days => b.dias)
  )
  select pre.id, pre.company_id, pre.etapa, pre.lead_id, pre.anonimizado_at, m.ultimo, pre.dias
    from pre
    cross join lateral (select public.captacion_ultimo_movimiento(pre.company_id, pre.id) as ultimo) m
   where m.ultimo < least(coalesce(p_ahora, now()), now()) - make_interval(days => pre.dias)
   order by pre.updated_at
   limit greatest(least(coalesce(p_limite, 500), 5000), 1);
$$;

revoke all on function public.captacion_retencion_candidatos(timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.captacion_retencion_candidatos(timestamptz, integer, uuid) to service_role;

-- Anonimiza un lote de prospectos de UNA empresa. Vuelve a comprobarlo todo
-- (la base manda, no quien llama) y bloquea las filas antes de tocarlas.
--  · Envíos aún en cola: cancelados (no puede salir nada a un anonimizado).
--  · Conversaciones del prospecto y sus mensajes: borrados.
--  · Visitas de sus propuestas: borradas. Propuestas: revocadas y sin datos
--    del negocio. El PDF lo borra el servidor de Storage (la base no puede) y
--    después vacía pdf_ruta: mientras tanto la propuesta está revocada y /p/
--    no la sirve.
--  · Prospecto: se vacían los datos; se conservan teléfono, osm_id, place_id,
--    etapa, campaña y fechas para no volver a escribirle (plan §8) y para las
--    cifras del embudo.
--  · captacion_bloqueos: NO se toca nunca.
-- p_ahora no puede ir por delante del reloj de la base.
create or replace function public.captacion_anonimizar_prospectos(
  p_company_id uuid,
  p_ids uuid[],
  p_ahora timestamptz default now()
)
returns table (
  prospectos integer,
  conversaciones integer,
  mensajes integer,
  visitas integer,
  propuestas integer,
  envios_cancelados integer
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ahora timestamptz := least(coalesce(p_ahora, now()), now());
  v_dias integer;
  v_antes timestamptz;
  v_ids uuid[];
  v_conv uuid[];
  v_prop uuid[];
  n_p integer := 0;
  n_c integer := 0;
  n_m integer := 0;
  n_v integer := 0;
  n_pr integer := 0;
  n_e integer := 0;
begin
  if p_company_id is null or p_ids is null or cardinality(p_ids) = 0 then
    return query select 0, 0, 0, 0, 0, 0;
    return;
  end if;

  select greatest(30, least(coalesce(
           (select c.retencion_dias from public.captacion_conexiones c where c.company_id = p_company_id),
           365), 3650))
    into v_dias;
  v_antes := v_ahora - make_interval(days => v_dias);

  -- Segunda mirada con las filas bloqueadas.
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ids
    from (
      select p.id
        from public.captacion_prospectos p
       where p.company_id = p_company_id
         and p.id = any(p_ids)
         and p.anonimizado_at is null
         and p.lead_id is null
         and p.etapa not in ('interesado', 'caliente', 'convertido')
       for update of p
    ) s
   where public.captacion_ultimo_movimiento(p_company_id, s.id) < v_antes;

  if cardinality(v_ids) = 0 then
    return query select 0, 0, 0, 0, 0, 0;
    return;
  end if;

  update public.captacion_envios
     set estado = 'cancelado',
         cancelado_motivo = 'Retención: datos anonimizados',
         token_reclamo = null
   where company_id = p_company_id
     and prospecto_id = any(v_ids)
     and estado = 'en_cola';
  get diagnostics n_e = row_count;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_conv
    from public.captacion_conversaciones c
   where c.company_id = p_company_id
     and c.prospecto_id = any(v_ids);

  delete from public.captacion_mensajes
   where company_id = p_company_id
     and conversacion_id = any(v_conv);
  get diagnostics n_m = row_count;

  delete from public.captacion_conversaciones
   where company_id = p_company_id
     and id = any(v_conv);
  get diagnostics n_c = row_count;

  select coalesce(array_agg(pr.id), '{}'::uuid[]) into v_prop
    from public.captacion_propuestas pr
   where pr.company_id = p_company_id
     and pr.prospecto_id = any(v_ids);

  delete from public.captacion_visitas
   where company_id = p_company_id
     and propuesta_id = any(v_prop);
  get diagnostics n_v = row_count;

  update public.captacion_propuestas
     set revocada_at = coalesce(revocada_at, v_ahora),
         nombre_negocio = 'Negocio anonimizado',
         localidad = null,
         carta = null,
         media_id_meta = null,
         envio_error = null
   where company_id = p_company_id
     and id = any(v_prop);
  get diagnostics n_pr = row_count;

  update public.captacion_prospectos
     set nombre_negocio = 'Negocio anonimizado',
         direccion = null,
         municipio = null,
         codigo_postal = null,
         lat = null,
         lng = null,
         web = null,
         dominio = null,
         email = null,
         telefono_url_fuente = null,
         bsuid = null,
         cliente_coincidente_id = null,
         lead_coincidente_id = null,
         assigned_user_id = null,
         interes_resumen = null,
         descartado_motivo = null,
         revisar_motivo = null,
         anonimizado_at = v_ahora
   where company_id = p_company_id
     and id = any(v_ids);
  get diagnostics n_p = row_count;

  return query select n_p, n_c, n_m, n_v, n_pr, n_e;
end;
$$;

revoke all on function public.captacion_anonimizar_prospectos(uuid, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.captacion_anonimizar_prospectos(uuid, uuid[], timestamptz) to service_role;

-- Purga de eventos de webhook por tandas. Nunca borra nada de los últimos 30
-- días, se le pida la fecha que se le pida.
create or replace function public.captacion_purgar_webhook_eventos(p_antes timestamptz, p_limite integer default 1000)
returns integer
language sql
volatile
set search_path = public, pg_temp
as $$
  with lote as (
    select w.id
      from public.captacion_webhook_eventos w
     where w.recibido_at < least(coalesce(p_antes, now() - interval '30 days'), now() - interval '30 days')
     order by w.recibido_at
     limit greatest(least(coalesce(p_limite, 1000), 5000), 1)
  ),
  borrados as (
    delete from public.captacion_webhook_eventos w
     using lote
     where w.id = lote.id
    returning 1
  )
  select count(*)::integer from borrados;
$$;

revoke all on function public.captacion_purgar_webhook_eventos(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.captacion_purgar_webhook_eventos(timestamptz, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Panel de salud (superadmin): una fila por empresa con el módulo activo.
--    p_hoy_desde y p_mes_desde son el inicio del día y del mes en Madrid.
-- -----------------------------------------------------------------------------
create or replace function public.captacion_salud_empresas(p_hoy_desde timestamptz, p_mes_desde timestamptz)
returns table (
  company_id uuid,
  empresa text,
  estado text,
  calidad text,
  limite_diario_meta integer,
  margen_seguridad integer,
  numero_e164 text,
  envios_activos boolean,
  ia_activa boolean,
  ultimo_webhook_at timestamptz,
  ultimo_error text,
  tope_gasto_mensual_cents integer,
  retencion_dias integer,
  ultimo_aviso_campo text,
  ultimo_aviso_evento text,
  ultimo_aviso_at timestamptz,
  envios_hoy integer,
  fallidos_24h integer,
  gasto_confirmado_milicentimos bigint,
  gasto_en_vuelo integer,
  campanas_activas integer,
  campanas_pausadas integer,
  eventos_pendientes integer,
  eventos_error integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.company_id,
         co.name::text,
         c.estado,
         c.calidad,
         c.limite_diario_meta,
         c.margen_seguridad,
         c.numero_e164,
         c.envios_activos,
         c.ia_activa,
         c.ultimo_webhook_at,
         c.ultimo_error,
         c.tope_gasto_mensual_cents,
         c.retencion_dias,
         av.campo,
         av.evento,
         av.recibido_at,
         (select count(*) from public.captacion_envios e
           where e.company_id = m.company_id and e.enviado_at >= p_hoy_desde)::integer,
         (select count(*) from public.captacion_envios e
           where e.company_id = m.company_id and e.estado = 'fallido'
             and e.updated_at >= now() - interval '24 hours')::integer,
         (select coalesce(sum(e.coste_milicentimos), 0) from public.captacion_envios e
           where e.company_id = m.company_id and e.enviado_at >= p_mes_desde)::bigint,
         (select count(*) from public.captacion_envios e
           where e.company_id = m.company_id and e.enviado_at >= p_mes_desde
             and e.coste_milicentimos is null and e.estado in ('enviado', 'entregado', 'leido'))::integer,
         (select count(*) from public.captacion_campanas k
           where k.company_id = m.company_id and k.estado = 'activa')::integer,
         (select count(*) from public.captacion_campanas k
           where k.company_id = m.company_id and k.estado = 'pausada')::integer,
         (select count(*) from public.captacion_webhook_eventos w
           where w.company_id = m.company_id and w.procesado_at is null and w.error is null)::integer,
         (select count(*) from public.captacion_webhook_eventos w
           where w.company_id = m.company_id and w.procesado_at is null and w.error is not null)::integer
    from public.company_modules m
    join public.companies co on co.id = m.company_id
    left join public.captacion_conexiones c on c.company_id = m.company_id
    left join lateral (
      select w.campo, w.cuerpo -> 'value' ->> 'event' as evento, w.recibido_at
        from public.captacion_webhook_eventos w
       where w.company_id = m.company_id
         and w.campo not in ('messages', 'smb_message_echoes', 'history', 'smb_app_state_sync')
       order by w.recibido_at desc
       limit 1
    ) av on true
   where m.module_key = 'captacion'
     and m.is_active = true
   order by co.name;
$$;

revoke all on function public.captacion_salud_empresas(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.captacion_salud_empresas(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
