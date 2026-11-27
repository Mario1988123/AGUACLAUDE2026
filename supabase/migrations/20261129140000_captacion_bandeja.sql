-- =============================================================================
-- 20261129140000_captacion_bandeja.sql
-- Captación WhatsApp · fase 2: bandeja manual.
--
--  · captacion_conversaciones: una por contacto (BSUID o teléfono) y empresa.
--  · captacion_mensajes: entrantes, salientes desde el panel, los escritos en
--    la app del móvil (coexistencia, smb_message_echoes) y el historial
--    importado (webhook history).
--  · Un trigger mantiene el resumen de la conversación (último mensaje,
--    no leídos, ventana de 24 h) de forma atómica.
--  · Lectura con RLS (gestores todo; comerciales lo suyo). Escritura solo con
--    el cliente de servicio (server actions y webhook).
--  · Ambas tablas en supabase_realtime para la bandeja en vivo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Conversaciones
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_conversaciones (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  prospecto_id      uuid references public.captacion_prospectos(id) on delete set null,
  bsuid             text,
  wa_id             text check (wa_id is null or wa_id ~ '^[0-9]{6,20}$'),
  telefono_e164     text check (telefono_e164 is null or telefono_e164 ~ '^\+[1-9][0-9]{5,19}$'),
  nombre_contacto   text,
  modo              text not null default 'humano' check (modo in ('ia', 'humano', 'cerrada')),
  ventana_hasta     timestamptz,
  atendida_por      uuid references auth.users(id) on delete set null,
  no_leidos         integer not null default 0 check (no_leidos >= 0),
  ultimo_mensaje_at timestamptz,
  ultimo_extracto   text,
  ultima_direccion  text check (ultima_direccion in ('entrante', 'saliente')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint captacion_conversaciones_contacto_ck check (bsuid is not null or wa_id is not null)
);

comment on table public.captacion_conversaciones is
  'Bandeja de captación: una conversación por contacto de WhatsApp y empresa. El resumen (último mensaje, no leídos, ventana) lo mantiene el trigger de captacion_mensajes.';
comment on column public.captacion_conversaciones.wa_id is
  'Teléfono tal como lo da Meta (solo dígitos, con prefijo). Puede faltar si el contacto usa nombre de usuario: entonces manda el BSUID.';
comment on column public.captacion_conversaciones.ventana_hasta is
  'Último entrante por la API + 24 h. Fuera de ella la API solo admite plantillas. Lo escrito desde la app del móvil no la abre.';

create unique index if not exists captacion_conversaciones_bsuid_uk
  on public.captacion_conversaciones(company_id, bsuid) where bsuid is not null;
create unique index if not exists captacion_conversaciones_wa_id_uk
  on public.captacion_conversaciones(company_id, wa_id) where wa_id is not null;
create index if not exists captacion_conversaciones_lista_idx
  on public.captacion_conversaciones(company_id, ultimo_mensaje_at desc nulls last);
create index if not exists captacion_conversaciones_prospecto_idx
  on public.captacion_conversaciones(prospecto_id) where prospecto_id is not null;
create index if not exists captacion_conversaciones_atendida_idx
  on public.captacion_conversaciones(atendida_por) where atendida_por is not null;

drop trigger if exists trg_captacion_conversaciones_updated on public.captacion_conversaciones;
create trigger trg_captacion_conversaciones_updated
  before update on public.captacion_conversaciones
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2) Mensajes
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_mensajes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  conversacion_id  uuid not null references public.captacion_conversaciones(id) on delete cascade,
  direccion        text not null check (direccion in ('entrante', 'saliente')),
  autor            text not null check (autor in ('contacto', 'ia', 'humano', 'sistema')),
  -- api: por la Cloud API · movil: escrito en la app (coexistencia) · historial: importado
  origen           text not null default 'api' check (origen in ('api', 'movil', 'historial')),
  usuario_id       uuid references auth.users(id) on delete set null,
  tipo             text not null default 'texto'
                     check (tipo in ('plantilla', 'texto', 'boton', 'documento', 'imagen', 'audio',
                                     'video', 'sticker', 'ubicacion', 'contactos', 'reaccion', 'otro')),
  cuerpo           text,
  payload_boton    text,
  media_id_meta    text,
  media_mime       text,
  media_nombre     text,
  wamid            text,
  responde_a_wamid text,
  estado           text not null default 'recibido'
                     check (estado in ('recibido', 'enviado', 'entregado', 'leido', 'fallido')),
  error_codigo     integer,
  error_texto      text,
  -- Hora que da Meta (timestamp del mensaje); created_at es cuándo llegó aquí.
  meta_at          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- Restricción completa (no índice parcial) para que PostgREST pueda usar
  -- on conflict (wamid). Los nulos no chocan entre sí.
  constraint captacion_mensajes_wamid_uk unique (wamid)
);

comment on table public.captacion_mensajes is
  'Mensajes de la bandeja de captación. wamid único global: el mismo webhook dos veces no duplica.';

create index if not exists captacion_mensajes_conversacion_idx
  on public.captacion_mensajes(conversacion_id, meta_at);
create index if not exists captacion_mensajes_empresa_idx
  on public.captacion_mensajes(company_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3) Resumen de la conversación, atómico
-- -----------------------------------------------------------------------------
create or replace function app.captacion_mensaje_resumen()
-- security invoker: corre con el rol que inserta (el de servicio, que se salta la
-- RLS). Con definer y force row level security el update podría no tocar nada.
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.captacion_conversaciones c
     set ultimo_mensaje_at = greatest(coalesce(c.ultimo_mensaje_at, new.meta_at), new.meta_at),
         ultimo_extracto   = case when c.ultimo_mensaje_at is null or new.meta_at >= c.ultimo_mensaje_at
                                  then left(coalesce(new.cuerpo, '[' || new.tipo || ']'), 140)
                                  else c.ultimo_extracto end,
         ultima_direccion  = case when c.ultimo_mensaje_at is null or new.meta_at >= c.ultimo_mensaje_at
                                  then new.direccion else c.ultima_direccion end,
         no_leidos         = c.no_leidos + case when new.direccion = 'entrante' and new.origen = 'api' then 1 else 0 end,
         ventana_hasta     = case when new.direccion = 'entrante' and new.origen = 'api'
                                  then greatest(coalesce(c.ventana_hasta, new.meta_at + interval '24 hours'),
                                                new.meta_at + interval '24 hours')
                                  else c.ventana_hasta end
   where c.id = new.conversacion_id;
  return null;
end;
$$;

drop trigger if exists trg_captacion_mensajes_resumen on public.captacion_mensajes;
create trigger trg_captacion_mensajes_resumen
  after insert on public.captacion_mensajes
  for each row execute function app.captacion_mensaje_resumen();

-- -----------------------------------------------------------------------------
-- 4) RLS: lectura; la escritura va por el cliente de servicio
-- -----------------------------------------------------------------------------
alter table public.captacion_conversaciones enable row level security;
alter table public.captacion_conversaciones force row level security;
alter table public.captacion_mensajes       enable row level security;
alter table public.captacion_mensajes       force row level security;

-- ¿Quién ve una conversación? Gestores: todas las de su empresa. Comerciales:
-- las que atienden o las de prospectos asignados a ellos. Se escribe en línea
-- (sin función security definer que relea la tabla) para no arriesgar una
-- recursión de políticas con force row level security.
drop policy if exists captacion_conversaciones_super on public.captacion_conversaciones;
create policy captacion_conversaciones_super on public.captacion_conversaciones
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_conversaciones_select on public.captacion_conversaciones;
create policy captacion_conversaciones_select on public.captacion_conversaciones
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.captacion_gestor()
      or atendida_por = auth.uid()
      or exists (
        select 1 from public.captacion_prospectos p
         where p.id = captacion_conversaciones.prospecto_id
           and p.assigned_user_id = auth.uid()
      )
    )
  );

-- Mensajes: los de conversaciones visibles (el exists aplica la RLS de arriba).
drop policy if exists captacion_mensajes_super on public.captacion_mensajes;
create policy captacion_mensajes_super on public.captacion_mensajes
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_mensajes_select on public.captacion_mensajes;
create policy captacion_mensajes_select on public.captacion_mensajes
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.captacion_conversaciones c
       where c.id = captacion_mensajes.conversacion_id
    )
  );

-- -----------------------------------------------------------------------------
-- 5) Tiempo real
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captacion_conversaciones'
  ) then
    alter publication supabase_realtime add table public.captacion_conversaciones;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captacion_mensajes'
  ) then
    alter publication supabase_realtime add table public.captacion_mensajes;
  end if;
end $$;
