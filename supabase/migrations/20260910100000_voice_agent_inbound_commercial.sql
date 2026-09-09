-- =============================================================================
-- 20260910100000_voice_agent_inbound_commercial.sql
--
-- Fase 2 del agente de voz. La fase 1 (20260909100000) montó el saliente de
-- mantenimientos. Esto abre los otros dos canales de VOZ que pedía la
-- investigación, y cierra los cabos que quedaron sueltos:
--
--   · ENTRANTE (recepcionista).  Un número por empresa; quien llama puede ser
--     cliente, lead o un desconocido. No hay cola ni consentimiento que valga:
--     ha llamado él. Lo que sí hay es declaración de IA y salida a persona.
--
--   · COMERCIAL B2B.  La fase 1 dejó los guardarraíles puestos pero SIN punto
--     de entrada: no había forma de encolar una llamada comercial. Se añade el
--     concepto de campaña para poder medir y parar una tanda entera.
--
--   · SENDER DE WHATSAPP POR EMPRESA.  Hoy `WHATSAPP_TWILIO_FROM` es una env
--     var global: todas las empresas escriben desde el mismo número. Con el
--     cierre por WhatsApp tras la llamada eso pasa de ser feo a ser una fuga de
--     contexto entre empresas. Se mueve a la configuración del tenant.
--
--   · PURGA DE TRANSCRIPCIONES.  `transcript_retention_days` se guardaba y no
--     lo borraba nadie. Ahora hay columna de purga y función que la aplica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tipos nuevos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'voice_call_direction' and n.nspname = 'app') then
    create type app.voice_call_direction as enum ('outbound', 'inbound');
  end if;
end$$;

-- Resultados que solo se dan en el canal entrante. `ALTER TYPE ... ADD VALUE`
-- no permite usar el valor nuevo en la misma transacción, pero aquí solo lo
-- declaramos: quien lo escribe es el código, en otra transacción.
alter type app.voice_call_outcome add value if not exists 'incident_created';
alter type app.voice_call_outcome add value if not exists 'info_provided';
alter type app.voice_call_outcome add value if not exists 'appointment_booked';
alter type app.voice_call_outcome add value if not exists 'transferred';
alter type app.voice_call_outcome add value if not exists 'spam';

-- Origen de lead para lo que trae el agente de voz. Hasta ahora el enum solo
-- contemplaba captación humana (`cold_call` es saliente, `tmk` es la persona
-- del departamento). Sin un valor propio, los leads del agente se mezclarían
-- con los de un comercial y no habría forma de medir si la IA aporta algo.
alter type app.lead_origin add value if not exists 'inbound_call';
alter type app.lead_origin add value if not exists 'ia_voz';

-- -----------------------------------------------------------------------------
-- 2) voice_agent_settings — entrante, WhatsApp y transferencia
-- -----------------------------------------------------------------------------
alter table public.voice_agent_settings
  add column if not exists inbound_enabled        boolean not null default false,
  add column if not exists agent_id_inbound       text,
  -- Qué puede hacer la recepcionista. Apagar `inbound_can_book` la deja en
  -- modo "toma nota y avisa", que es como conviene empezar.
  add column if not exists inbound_can_book       boolean not null default true,
  add column if not exists inbound_can_open_incident boolean not null default true,
  -- Transferencia en caliente. Si está apagada, `escalar_humano` solo crea la
  -- tarea urgente y avisa; no intenta pasar la llamada.
  add column if not exists transfer_enabled       boolean not null default false,
  -- Cierre por WhatsApp tras confirmar una cita.
  add column if not exists whatsapp_confirm_enabled boolean not null default false,
  -- Sender de WhatsApp DE ESTA EMPRESA. NULL = usa el global de entorno, que es
  -- lo que hay hoy y lo que hay que dejar de hacer.
  add column if not exists whatsapp_sender        text,
  -- Credenciales propias de Twilio por empresa (subcuenta). El token va
  -- cifrado con ENCRYPTION_KEY, igual que las contraseñas SMTP.
  add column if not exists twilio_subaccount_sid  text,
  add column if not exists twilio_auth_token_enc  text;

comment on column public.voice_agent_settings.whatsapp_sender is
  'Número WhatsApp Business de ESTA empresa, formato whatsapp:+34XXXXXXXXX. NULL = cae al WHATSAPP_TWILIO_FROM global (compartido entre tenants: solo aceptable en pruebas).';
comment on column public.voice_agent_settings.inbound_can_book is
  'Si false, la recepcionista puede informar y tomar nota pero no cierra citas. Recomendado empezar así.';

-- El número de la recepcionista vive en `voice_inbound_numbers` (abajo), y es
-- ahí donde se impide que sea del rango 400: el BOE lo reserva a llamadas
-- comerciales salientes y prohíbe usarlo para atención al cliente. Un 400
-- además no admite llamadas entrantes, así que la restricción es doblemente
-- cierta y basta con tenerla en un sitio.

-- -----------------------------------------------------------------------------
-- 3) voice_inbound_numbers — enrutado del canal entrante
--
--    Una llamada entrante llega con un `To`. Ese número es lo ÚNICO que nos
--    dice de qué empresa es la llamada, así que es único a nivel global: dos
--    empresas no pueden compartir número o las llamadas de una acabarían
--    leyendo los datos de la otra.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_inbound_numbers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  phone_e164  text not null,
  label       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),

  -- Único GLOBAL, no por empresa. Es la clave de enrutado.
  constraint voice_inbound_number_unique unique (phone_e164),
  -- Un 400 es exclusivamente saliente y exclusivamente comercial.
  constraint voice_inbound_not_400 check (phone_e164 !~ '^\+?34?400'),
  constraint voice_inbound_e164 check (phone_e164 ~ '^\+[1-9]\d{7,14}$')
);

create index if not exists idx_voice_inbound_company
  on public.voice_inbound_numbers(company_id) where active;

comment on table public.voice_inbound_numbers is
  'Números que atiende la recepcionista IA. El número es único a nivel global porque es lo único que identifica la empresa en una llamada entrante.';

-- -----------------------------------------------------------------------------
-- 4) voice_call_attempts — admitir llamadas entrantes
--
--    Una entrante no tiene tarea: nadie la encoló. Así que `task_id` pasa a ser
--    opcional y el intento guarda por su cuenta a quién identificó.
-- -----------------------------------------------------------------------------
alter table public.voice_call_attempts
  alter column task_id drop not null;

alter table public.voice_call_attempts
  add column if not exists direction   app.voice_call_direction not null default 'outbound',
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists lead_id     uuid references public.leads(id) on delete set null,
  add column if not exists incident_id uuid,
  add column if not exists transcript_purged_at timestamptz;

-- Una saliente SIEMPRE cuelga de una tarea; una entrante nunca.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voice_attempt_direction_task') then
    alter table public.voice_call_attempts
      add constraint voice_attempt_direction_task
      check (
        (direction = 'outbound' and task_id is not null)
        or (direction = 'inbound' and task_id is null)
      );
  end if;
end$$;

create index if not exists idx_voice_attempt_inbound
  on public.voice_call_attempts(company_id, started_at desc)
  where direction = 'inbound';

-- Índice para la purga: solo mira lo que aún tiene transcripción sin purgar.
create index if not exists idx_voice_attempt_purge
  on public.voice_call_attempts(ended_at)
  where transcript_purged_at is null and transcript is not null;

comment on column public.voice_call_attempts.transcript_purged_at is
  'Cuándo se borró la transcripción por retención. La FILA se conserva (métricas, prueba de que se declaró la IA); el contenido conversacional no.';

-- -----------------------------------------------------------------------------
-- 5) Campañas comerciales
--
--    La fase 1 dejó el carril comercial construido pero sin entrada. Una
--    campaña permite encolar una tanda, medirla, y —lo que importa— PARARLA
--    entera de golpe si algo va mal.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_campaigns (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  status      text not null default 'draft'
                check (status in ('draft', 'running', 'paused', 'done')),
  -- Solo comercial: el saliente de servicio no es una campaña, es una cola
  -- operativa que se rellena sola.
  purpose     app.voice_call_purpose not null default 'commercial',
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint voice_campaign_commercial_only check (purpose = 'commercial')
);

create index if not exists idx_voice_campaigns_company
  on public.voice_campaigns(company_id, created_at desc);

drop trigger if exists trg_voice_campaigns_updated on public.voice_campaigns;
create trigger trg_voice_campaigns_updated
  before update on public.voice_campaigns
  for each row execute function app.set_updated_at();

alter table public.voice_call_tasks
  add column if not exists campaign_id uuid references public.voice_campaigns(id) on delete set null;

create index if not exists idx_voice_task_campaign
  on public.voice_call_tasks(campaign_id) where campaign_id is not null;

-- Una tarea de servicio nunca pertenece a una campaña comercial.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voice_task_campaign_commercial') then
    alter table public.voice_call_tasks
      add constraint voice_task_campaign_commercial
      check (campaign_id is null or purpose = 'commercial');
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 6) RLS de lo nuevo
-- -----------------------------------------------------------------------------
alter table public.voice_inbound_numbers enable row level security;
alter table public.voice_campaigns       enable row level security;

drop policy if exists voice_inbound_super on public.voice_inbound_numbers;
create policy voice_inbound_super on public.voice_inbound_numbers
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_inbound_select on public.voice_inbound_numbers;
create policy voice_inbound_select on public.voice_inbound_numbers
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists voice_inbound_write on public.voice_inbound_numbers;
create policy voice_inbound_write on public.voice_inbound_numbers
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

drop policy if exists voice_campaigns_super on public.voice_campaigns;
create policy voice_campaigns_super on public.voice_campaigns
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_campaigns_select on public.voice_campaigns;
create policy voice_campaigns_select on public.voice_campaigns
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin')
         or app.has_role('commercial_director')
         or app.has_role('telemarketing_director'))
  );

drop policy if exists voice_campaigns_write on public.voice_campaigns;
create policy voice_campaigns_write on public.voice_campaigns
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('telemarketing_director'))
  )
  with check (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('telemarketing_director'))
  );

-- -----------------------------------------------------------------------------
-- 7) Purga de transcripciones (RGPD)
--
--    Se borra el CONTENIDO, no la fila. La fila es la prueba de que se declaró
--    ser una IA y de que se ofreció hablar con una persona; eso hay que poder
--    demostrarlo mucho después de que la conversación deje de ser necesaria.
-- -----------------------------------------------------------------------------
create or replace function app.voice_purge_transcripts(p_limit integer default 500)
returns integer
language sql
security definer
set search_path = public, app, pg_temp
as $$
  with vencidos as (
    select a.id
      from public.voice_call_attempts a
      join public.voice_agent_settings s on s.company_id = a.company_id
     where a.transcript_purged_at is null
       and a.ended_at is not null
       and a.ended_at < now() - make_interval(days => s.transcript_retention_days)
     order by a.ended_at
     limit greatest(p_limit, 0)
  ), purgados as (
    update public.voice_call_attempts a
       set transcript = null,
           summary = null,
           recording_url = null,
           transcript_purged_at = now()
      from vencidos v
     where a.id = v.id
    returning 1
  )
  select count(*)::integer from purgados;
$$;

revoke all on function app.voice_purge_transcripts(integer) from public, anon, authenticated;

comment on function app.voice_purge_transcripts(integer) is
  'Borra el contenido conversacional pasado el plazo de retención de cada empresa. Conserva la fila: duración, coste y las pruebas de cumplimiento no caducan con la conversación.';

-- -----------------------------------------------------------------------------
-- 8) Resolver la empresa de una llamada entrante
--
--    Se hace en SQL y con `security definer` para que el webhook entrante no
--    necesite un cliente admin sin filtrar. Devuelve solo lo justo.
-- -----------------------------------------------------------------------------
create or replace function app.voice_company_for_inbound(p_to_number text)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select n.company_id
    from public.voice_inbound_numbers n
   where n.phone_e164 = p_to_number
     and n.active
   limit 1;
$$;

revoke all on function app.voice_company_for_inbound(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
