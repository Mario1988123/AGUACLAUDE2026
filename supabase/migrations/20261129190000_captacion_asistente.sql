-- =============================================================================
-- Captación por WhatsApp — fase 5: asistente de IA, FAQ y base de conocimiento.
--
--   · captacion_faq: preguntas y respuestas de la empresa (plan §3.5). Campaña
--     nula = vale para toda la empresa.
--   · captacion_documentos: textos libres que el asistente puede usar
--     (horarios, zona, condiciones…). Sin pgvector (§3.6, fase 8): con pocos
--     documentos se meten enteros en el prompt, con caché.
--   · captacion_conversaciones: estado del asistente (identificación del
--     art. 50 del Reglamento de IA, silencio, contador de mensajes).
--   · captacion_mensajes: marca de «ya visto por la IA» (idempotencia) y
--     tokens de cada respuesta del asistente.
--   · Trigger de silencio: un mensaje saliente escrito por una persona (panel
--     o móvil) calla a la IA en esa conversación EN LA MISMA TRANSACCIÓN en la
--     que se guarda. La IA solo vuelve con «Devolver al asistente».
--
-- Solo aditiva. Escritura siempre con el cliente de servicio, después de
-- comprobar el rol en el servidor (admin y directores editan; los
-- comerciales leen).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversaciones y mensajes
-- -----------------------------------------------------------------------------
alter table public.captacion_conversaciones
  add column if not exists ia_identificada_at  timestamptz,
  add column if not exists ia_silenciada_at    timestamptz,
  add column if not exists ia_silenciada_motivo text
    check (ia_silenciada_motivo is null or ia_silenciada_motivo in
      ('panel', 'movil', 'pide_persona', 'pide_llamada', 'herramienta', 'tope', 'precio', 'rechazo', 'error')),
  add column if not exists ia_silenciada_por   uuid references auth.users(id) on delete set null,
  add column if not exists ia_devuelta_at      timestamptz,
  add column if not exists ia_mensajes         integer not null default 0 check (ia_mensajes >= 0);

comment on column public.captacion_conversaciones.ia_silenciada_at is
  'Cuándo se calló la IA (persona que escribe, petición de persona, tope…). Nula = nadie ha intervenido desde la última devolución.';
comment on column public.captacion_conversaciones.ia_mensajes is
  'Mensajes enviados por el asistente en esta conversación (tope en el código).';

alter table public.captacion_mensajes
  add column if not exists procesado_ia_at        timestamptz,
  add column if not exists modelo_ia              text,
  add column if not exists tokens_entrada         integer check (tokens_entrada is null or tokens_entrada >= 0),
  add column if not exists tokens_salida          integer check (tokens_salida is null or tokens_salida >= 0),
  add column if not exists tokens_cache_lectura   integer check (tokens_cache_lectura is null or tokens_cache_lectura >= 0),
  add column if not exists tokens_cache_escritura integer check (tokens_cache_escritura is null or tokens_cache_escritura >= 0);

comment on column public.captacion_mensajes.procesado_ia_at is
  'Entrante ya reclamado por el asistente (un turno por mensaje aunque Meta o el cron lo repitan).';

create index if not exists captacion_mensajes_ia_idx
  on public.captacion_mensajes(company_id, created_at)
  where autor = 'ia';

-- -----------------------------------------------------------------------------
-- Trigger de silencio
-- -----------------------------------------------------------------------------
create or replace function app.captacion_silenciar_ia()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.direccion = 'saliente'
     and new.origen in ('api', 'movil')
     and (new.autor = 'humano' or new.origen = 'movil') then
    update public.captacion_conversaciones
       set modo = case when modo = 'ia' then 'humano' else modo end,
           ia_silenciada_at = now(),
           ia_silenciada_motivo = case when new.origen = 'movil' then 'movil' else 'panel' end,
           ia_silenciada_por = new.usuario_id
     where id = new.conversacion_id
       and (modo = 'ia' or ia_silenciada_at is null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_captacion_mensajes_silenciar_ia on public.captacion_mensajes;
create trigger trg_captacion_mensajes_silenciar_ia
  after insert on public.captacion_mensajes
  for each row execute function app.captacion_silenciar_ia();

-- -----------------------------------------------------------------------------
-- FAQ
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_faq (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  campana_id  uuid references public.captacion_campanas(id) on delete cascade,
  pregunta    text not null check (char_length(btrim(pregunta)) between 3 and 300),
  respuesta   text not null check (char_length(btrim(respuesta)) between 1 and 2000),
  activa      boolean not null default true,
  orden       integer not null default 0,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.captacion_faq is
  'Preguntas frecuentes que usa el asistente de captación. campana_id nula = toda la empresa.';

create index if not exists captacion_faq_empresa_idx
  on public.captacion_faq(company_id, orden);

drop trigger if exists trg_captacion_faq_updated on public.captacion_faq;
create trigger trg_captacion_faq_updated
  before update on public.captacion_faq
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Documentos (textos libres)
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_documentos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  titulo      text not null check (char_length(btrim(titulo)) between 2 and 120),
  contenido   text not null check (char_length(btrim(contenido)) between 1 and 20000),
  activo      boolean not null default true,
  orden       integer not null default 0,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.captacion_documentos is
  'Textos libres de la empresa que el asistente de captación puede usar (entran enteros en el prompt).';

create index if not exists captacion_documentos_empresa_idx
  on public.captacion_documentos(company_id, orden);

drop trigger if exists trg_captacion_documentos_updated on public.captacion_documentos;
create trigger trg_captacion_documentos_updated
  before update on public.captacion_documentos
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: lectura para gestores y comerciales; escritura solo servidor.
-- -----------------------------------------------------------------------------
alter table public.captacion_faq enable row level security;
alter table public.captacion_faq force row level security;
alter table public.captacion_documentos enable row level security;
alter table public.captacion_documentos force row level security;

drop policy if exists captacion_faq_super on public.captacion_faq;
create policy captacion_faq_super on public.captacion_faq
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_faq_select on public.captacion_faq;
create policy captacion_faq_select on public.captacion_faq
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.captacion_gestor() or app.has_role('sales_rep') or app.has_role('telemarketer'))
  );

drop policy if exists captacion_documentos_super on public.captacion_documentos;
create policy captacion_documentos_super on public.captacion_documentos
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_documentos_select on public.captacion_documentos;
create policy captacion_documentos_select on public.captacion_documentos
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.captacion_gestor() or app.has_role('sales_rep') or app.has_role('telemarketer'))
  );

revoke insert, update, delete, truncate on table public.captacion_faq from authenticated;
revoke all on table public.captacion_faq from anon;
revoke insert, update, delete, truncate on table public.captacion_documentos from authenticated;
revoke all on table public.captacion_documentos from anon;
