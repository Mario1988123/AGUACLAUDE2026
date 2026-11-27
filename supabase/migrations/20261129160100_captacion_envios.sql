-- =============================================================================
-- Captación por WhatsApp — fase 3: envíos de plantilla con tope.
--
--   · captacion_envios: una fila por plantilla que sale fuera de ventana
--     (primer contacto o recordatorio). (prospecto_id, tipo) único: LA BASE
--     impide un segundo primer contacto y un segundo recordatorio.
--   · public.captacion_reclamar_envios(): reserva atómica con
--     «for update skip locked», como public.voice_claim_tasks. Dos pasadas
--     del cron a la vez no cogen la misma fila.
--   · public.captacion_cerrar_envios_colgados(): lo que lleva más de N
--     minutos en «reclamado» se da por fallido con «resultado desconocido».
--     No se reintenta solo: es mejor perder un envío que mandar dos (§5.3).
--   · RLS de lectura para gestores; los comerciales pueden ver la lista de
--     bloqueos (la amplían ellos, §2.2) y las plantillas aprobadas (bandeja).
--
-- Solo aditiva. Escritura siempre con el cliente de servicio.
-- =============================================================================

create table if not exists public.captacion_envios (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  prospecto_id     uuid not null references public.captacion_prospectos(id) on delete cascade,
  campana_id       uuid references public.captacion_campanas(id) on delete set null,
  plantilla_id     uuid references public.captacion_plantillas(id) on delete set null,
  tipo             text not null check (tipo in ('primer_contacto', 'recordatorio')),
  estado           text not null default 'en_cola'
                     check (estado in ('en_cola', 'reclamado', 'enviado', 'entregado', 'leido', 'fallido', 'cancelado')),
  -- Cuándo puede salir como pronto. La cola se ordena por aquí.
  programado_at    timestamptz not null default now(),
  reclamado_at     timestamptz,
  token_reclamo    uuid,
  wamid            text,
  enviado_at       timestamptz,
  entregado_at     timestamptz,
  leido_at         timestamptz,
  cancelado_motivo text,
  error_codigo     integer,
  error_texto      text,
  -- Se apunta al entregarse cuando se conozca la tarifa (pendiente, §7).
  coste_cents      integer check (coste_cents is null or coste_cents >= 0),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint captacion_envios_prospecto_tipo_uk unique (prospecto_id, tipo),
  -- Restricción completa (no índice parcial) para poder filtrar y casar por
  -- wamid; los nulos no chocan entre sí.
  constraint captacion_envios_wamid_uk unique (wamid)
);

comment on table public.captacion_envios is
  'Plantillas de captación fuera de ventana (primer contacto y recordatorio). Único (prospecto_id, tipo).';

create index if not exists captacion_envios_cola_idx
  on public.captacion_envios(company_id, estado, programado_at);
create index if not exists captacion_envios_enviados_idx
  on public.captacion_envios(company_id, enviado_at)
  where enviado_at is not null;
create index if not exists captacion_envios_campana_idx
  on public.captacion_envios(campana_id, enviado_at);
create index if not exists captacion_envios_reclamados_idx
  on public.captacion_envios(reclamado_at)
  where estado = 'reclamado';

drop trigger if exists trg_captacion_envios_updated on public.captacion_envios;
create trigger trg_captacion_envios_updated
  before update on public.captacion_envios
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Reserva atómica (patrón de public.voice_claim_tasks)
-- -----------------------------------------------------------------------------
-- security invoker: la llama el cliente de servicio, que se salta la RLS. Con
-- definer y force row level security el update podría no tocar nada.
create or replace function public.captacion_reclamar_envios(
  p_company_id uuid,
  p_campana_id uuid,
  p_limite     integer,
  p_token      uuid
)
returns setof public.captacion_envios
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.captacion_envios e
     set estado        = 'reclamado',
         reclamado_at  = now(),
         token_reclamo = p_token
   where e.id in (
     select id from public.captacion_envios
      where company_id = p_company_id
        and campana_id = p_campana_id
        and estado = 'en_cola'
        and programado_at <= now()
      -- Primero los recordatorios: ya se pagó su primer mensaje y tienen fecha (§4.3.5).
      order by (tipo = 'recordatorio') desc, programado_at
      limit greatest(least(p_limite, 100), 0)
      for update skip locked
   )
  returning e.*;
$$;
revoke all on function public.captacion_reclamar_envios(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.captacion_reclamar_envios(uuid, uuid, integer, uuid) to service_role;

-- Envíos colgados en «reclamado»: el proceso murió entre reservar y apuntar la
-- respuesta de Meta. No se sabe si salió: se da por fallido, sin reintento.
create or replace function public.captacion_cerrar_envios_colgados(p_minutos integer default 15)
returns table (id uuid, company_id uuid, prospecto_id uuid)
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.captacion_envios e
     set estado        = 'fallido',
         error_texto   = 'Resultado desconocido: el envío se quedó a medias y no se reintenta para no mandar dos.',
         token_reclamo = null
   where e.estado = 'reclamado'
     and e.reclamado_at < now() - make_interval(mins => greatest(p_minutos, 5))
  returning e.id, e.company_id, e.prospecto_id;
$$;
revoke all on function public.captacion_cerrar_envios_colgados(integer) from public, anon, authenticated;
grant execute on function public.captacion_cerrar_envios_colgados(integer) to service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.captacion_envios enable row level security;
alter table public.captacion_envios force row level security;

drop policy if exists captacion_envios_super on public.captacion_envios;
create policy captacion_envios_super on public.captacion_envios
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_envios_select on public.captacion_envios;
create policy captacion_envios_select on public.captacion_envios
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

revoke insert, update, delete, truncate on table public.captacion_envios from authenticated;
revoke all on table public.captacion_envios from anon;

-- Bloqueos: los comerciales también los ven (añadir es de todos, §2.2; quitar,
-- solo company_admin, y se comprueba en el servidor).
drop policy if exists captacion_bloqueos_select_comercial on public.captacion_bloqueos;
create policy captacion_bloqueos_select_comercial on public.captacion_bloqueos
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('sales_rep') or app.has_role('telemarketer'))
  );

-- Plantillas aprobadas: las ve quien usa la bandeja, para el selector de
-- «ventana cerrada».
drop policy if exists captacion_plantillas_select_comercial on public.captacion_plantillas;
create policy captacion_plantillas_select_comercial on public.captacion_plantillas
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and estado = 'aprobada'
    and (app.has_role('sales_rep') or app.has_role('telemarketer'))
  );
