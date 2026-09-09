-- =============================================================================
-- 20260909100000_voice_agent_module.sql
-- Módulo AGENTE DE VOZ IA (2026-09-09).
--
-- Un agente de IA que llama por teléfono. DOS propósitos que NO se mezclan
-- nunca, ni en la misma cola, ni con el mismo número, ni con el mismo prompt:
--
--   1. 'service'    → agendar mantenimientos a CLIENTES PROPIOS con contrato.
--                     Base legal: ejecución del contrato (art. 6.1.b RGPD).
--                     Sale de numeración geográfica/900. NO es llamada
--                     comercial → NO usa el rango 400 (de hecho el BOE lo
--                     PROHÍBE para atención al cliente).
--
--   2. 'commercial' → captación en frío. SOLO a personas jurídicas (empresas).
--                     NUNCA a un particular. Requiere numeración 400 desde el
--                     17-oct-2026 (Resolución 14-abr-2026, BOE-A-2026-8409),
--                     ventana 9-21 L-V y consulta de exclusión previa.
--
-- La separación NO se confía al prompt del agente. Se impone aquí, con CHECK
-- constraints y un trigger que revalida contra la fila real de customers/leads.
-- Si alguien intenta encolar una llamada comercial a un particular, la BD la
-- rechaza. Es la única garantía que sobrevive a un bug en el código de arriba.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'voice_call_purpose' and n.nspname = 'app') then
    create type app.voice_call_purpose as enum ('service', 'commercial');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'voice_task_status' and n.nspname = 'app') then
    create type app.voice_task_status as enum (
      'pending',      -- en cola, esperando ventana horaria
      'calling',      -- reservada por el marcador, llamada en curso
      'done',         -- resuelta (ver outcome)
      'failed',       -- agotados los intentos
      'cancelled'     -- anulada a mano o por opt-out
    );
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'voice_call_outcome' and n.nspname = 'app') then
    create type app.voice_call_outcome as enum (
      'confirmed',        -- servicio: cita confirmada
      'rescheduled',      -- servicio: cliente eligió otra fecha
      'postponed',        -- servicio: cliente pide que le llamen más adelante
      'lead_created',     -- comercial: interés → lead para humano
      'not_interested',   -- comercial: no interesa
      'escalated',        -- pidió hablar con una persona
      'no_answer',        -- no contesta
      'voicemail',        -- buzón
      'busy',
      'wrong_number',
      'opted_out',        -- pide no ser llamado nunca más
      'failed'            -- error técnico
    );
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 1) voice_agent_settings — configuración por empresa
-- -----------------------------------------------------------------------------
create table if not exists public.voice_agent_settings (
  company_id                uuid primary key references public.companies(id) on delete cascade,

  -- Interruptor maestro. Dos, de hecho: se puede tener el de servicio
  -- encendido y el comercial apagado (que es lo recomendado).
  service_enabled           boolean not null default false,
  commercial_enabled        boolean not null default false,

  provider                  text not null default 'elevenlabs'
                              check (provider in ('elevenlabs', 'twilio', 'retell', 'vapi')),

  -- Un agente distinto por propósito. NO se comparte: prompts distintos,
  -- herramientas distintas, voz distinta si se quiere.
  agent_id_service          text,
  agent_id_commercial       text,

  -- Numeración. Separada por propósito y validada por la BD.
  --  · servicio  → geográfico/800/900. Prohibido usar 400 aquí (BOE).
  --  · comercial → obligatorio 400 desde el 17-oct-2026.
  caller_id_service         text,
  caller_id_commercial      text,

  -- Ventana de llamada. La de servicio es de cortesía (no hay obligación
  -- legal); la comercial es la que impone la norma: 9-21, L-V, sin festivos.
  service_window_start      smallint not null default 10 check (service_window_start between 0 and 23),
  service_window_end        smallint not null default 20 check (service_window_end between 1 and 24),
  commercial_window_start   smallint not null default 9  check (commercial_window_start between 9 and 20),
  commercial_window_end     smallint not null default 21 check (commercial_window_end between 10 and 21),

  -- Reintentos
  max_attempts              smallint not null default 3 check (max_attempts between 1 and 5),
  retry_hours               smallint not null default 24 check (retry_hours between 1 and 168),

  -- Tope de gasto. Un bucle de agente sin límite es una factura de cuatro
  -- cifras en una noche. Corte duro, no aviso.
  monthly_minutes_cap       integer not null default 500 check (monthly_minutes_cap >= 0),
  usage_month               date,                    -- primer día del mes en curso
  minutes_used_month        numeric(10,2) not null default 0,
  max_call_seconds          smallint not null default 300 check (max_call_seconds between 30 and 900),

  -- Escalado a persona (Ley 10/2025: el cliente debe poder pedir un humano)
  escalation_phone          text,

  -- RGPD: por defecto transcripción sí, audio no.
  record_audio              boolean not null default false,
  transcript_retention_days smallint not null default 90
                              check (transcript_retention_days between 7 and 365),

  -- Personalización del guion por empresa (se inyecta en el prompt base)
  company_pitch             text,
  forbidden_topics          text,

  -- Secreto por tenant para firmar las llamadas del agente a /api/voice-agent/tools/*.
  -- Se guarda el HASH, nunca el secreto en claro.
  tool_secret_hash          text,
  tool_secret_rotated_at    timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- El 400 es EXCLUSIVAMENTE saliente y EXCLUSIVAMENTE comercial.
  -- Usarlo para atención al cliente está prohibido por la resolución.
  constraint voice_caller_service_not_400
    check (caller_id_service is null or caller_id_service !~ '^\+?34?400'),
  -- La numeración comercial española tiene que ser del rango 400 (9 dígitos).
  -- Se admite NULL mientras la empresa no la haya dado de alta con su operador.
  constraint voice_caller_commercial_is_400
    check (caller_id_commercial is null or caller_id_commercial ~ '^\+34400\d{6}$'),
  constraint voice_service_window_order
    check (service_window_end > service_window_start),
  constraint voice_commercial_window_order
    check (commercial_window_end > commercial_window_start)
);

comment on table public.voice_agent_settings is
  'Configuración del agente de voz IA por empresa. Servicio y comercial se configuran por separado a propósito: número, agente, ventana y activación son independientes.';
comment on column public.voice_agent_settings.caller_id_commercial is
  'Número del rango 400 (obligatorio para llamadas comerciales desde el 17-oct-2026, Resolución 14-abr-2026). Lo asigna la CNMC al operador; se pide a través del operador. NULL = la empresa aún no puede hacer campañas comerciales.';
comment on column public.voice_agent_settings.caller_id_service is
  'Número geográfico/800/900 de la empresa. El BOE PROHÍBE usar el rango 400 para atención al cliente, así que las llamadas de mantenimiento salen de aquí.';
comment on column public.voice_agent_settings.tool_secret_hash is
  'SHA-256 del secreto que el agente presenta en /api/voice-agent/tools/*. El secreto en claro se muestra UNA vez al generarlo y no se vuelve a guardar.';

drop trigger if exists trg_voice_agent_settings_updated on public.voice_agent_settings;
create trigger trg_voice_agent_settings_updated
  before update on public.voice_agent_settings
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2) voice_do_not_call — lista de exclusión propia, por empresa
--    Se consulta SIEMPRE, en los dos propósitos. Un "no me llaméis más" vale
--    para todo, no solo para el marketing.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_do_not_call (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  phone_e164   text not null,
  reason       text,
  source       text not null default 'manual'
                 check (source in ('manual', 'call_optout', 'whatsapp_optout', 'import', 'robinson')),
  customer_id  uuid references public.customers(id) on delete set null,
  lead_id      uuid references public.leads(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (company_id, phone_e164)
);

create index if not exists idx_voice_dnc_phone
  on public.voice_do_not_call(company_id, phone_e164);

comment on table public.voice_do_not_call is
  'Exclusión telefónica por empresa. Bloquea llamadas del agente en AMBOS propósitos. Un opt-out en una llamada comercial también corta los avisos de servicio automáticos por voz.';

-- -----------------------------------------------------------------------------
-- 2bis) voice_consents — base legal para llamar, POR CANAL.
--
--   El consentimiento es por canal: un opt-in para email (email_consents) NO
--   autoriza llamadas, y al revés tampoco. Por eso esta tabla existe en vez de
--   reutilizar customer_consents/email_consents.
--
--   Append-only, igual que customer_consents: una revocación es una fila nueva
--   con granted=false, nunca un UPDATE. El histórico ES la prueba.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_consents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete cascade,
  phone_e164   text,
  -- 'consent'            → opt-in expreso. Caduca a los 2 años (Circular 1/2023).
  -- 'legitimate_interest'→ art. 19 LOPDGDD (contacto profesional de una persona
  --                        jurídica) o relación contractual previa con producto
  --                        similar. No caduca por plazo, pero exige oposición.
  basis        text not null check (basis in ('consent', 'legitimate_interest')),
  granted      boolean not null,
  source       text not null,           -- 'web_form','contract_sign','call','import','manual'
  evidence     jsonb not null default '{}'::jsonb,
  granted_at   timestamptz not null default now(),
  recorded_by  uuid references auth.users(id) on delete set null,
  constraint voice_consent_has_subject
    check (customer_id is not null or lead_id is not null)
);

create index if not exists idx_voice_consents_lead
  on public.voice_consents(lead_id, granted_at desc) where lead_id is not null;
create index if not exists idx_voice_consents_customer
  on public.voice_consents(customer_id, granted_at desc) where customer_id is not null;

comment on table public.voice_consents is
  'Base legal para llamar POR TELÉFONO. Separada de email_consents a propósito: el consentimiento es por canal y un opt-in de email no autoriza una llamada.';

-- -----------------------------------------------------------------------------
-- 3) voice_call_tasks — la cola. Una fila = una intención de llamar.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_call_tasks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,

  purpose            app.voice_call_purpose not null,
  status             app.voice_task_status not null default 'pending',

  -- A quién se llama. Redundante a propósito: el trigger lo revalida contra
  -- la fila real, y el CHECK de abajo lo usa sin tener que hacer un subquery.
  target_party_kind  app.party_kind not null,
  customer_id        uuid references public.customers(id) on delete cascade,
  lead_id            uuid references public.leads(id) on delete cascade,
  maintenance_job_id uuid references public.maintenance_jobs(id) on delete cascade,

  to_phone_e164      text not null,
  contact_name       text,

  attempts           smallint not null default 0,
  max_attempts       smallint not null default 3,
  next_attempt_at    timestamptz not null default now(),

  outcome            app.voice_call_outcome,
  outcome_notes      text,

  -- Reserva optimista del marcador: evita que dos ejecuciones solapadas del
  -- cron llamen dos veces a la misma persona.
  locked_at          timestamptz,
  lock_token         uuid,

  -- Clave de deduplicación. Para servicio es el job: un job, una llamada viva.
  dedupe_key         text not null,

  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- ===========================================================================
  -- LA REGLA MADRE. Sin esto, todo lo demás son buenas intenciones.
  -- ===========================================================================
  -- 1. Una llamada COMERCIAL nunca puede ir a un particular.
  constraint voice_task_commercial_never_individual
    check (purpose <> 'commercial' or target_party_kind = 'company'),
  -- 2. Una llamada COMERCIAL va contra un lead, nunca contra un cliente con
  --    contrato ni contra un mantenimiento.
  constraint voice_task_commercial_targets_lead
    check (purpose <> 'commercial' or (lead_id is not null
                                       and customer_id is null
                                       and maintenance_job_id is null)),
  -- 3. Una llamada de SERVICIO exige cliente propio + mantenimiento concreto.
  --    Sin job no hay nada que agendar, y sin cliente no hay contrato que
  --    ejecutar: perdería la cobertura del art. 6.1.b RGPD.
  constraint voice_task_service_targets_customer_job
    check (purpose <> 'service' or (customer_id is not null
                                    and maintenance_job_id is not null
                                    and lead_id is null)),
  constraint voice_task_attempts_sane
    check (attempts >= 0 and attempts <= max_attempts + 1)
);

-- Una sola tarea VIVA por dedupe_key. Si el cliente ya tiene una llamada en
-- cola para su mantenimiento, no se encola otra.
create unique index if not exists uq_voice_task_alive
  on public.voice_call_tasks(company_id, dedupe_key)
  where status in ('pending', 'calling');

create index if not exists idx_voice_task_due
  on public.voice_call_tasks(status, next_attempt_at)
  where status = 'pending';

create index if not exists idx_voice_task_company
  on public.voice_call_tasks(company_id, purpose, status, next_attempt_at desc);

create index if not exists idx_voice_task_job
  on public.voice_call_tasks(maintenance_job_id)
  where maintenance_job_id is not null;

comment on table public.voice_call_tasks is
  'Cola del agente de voz. Los CHECK constraints impiden estructuralmente que una llamada comercial salga hacia un particular o hacia un cliente con contrato.';

drop trigger if exists trg_voice_call_tasks_updated on public.voice_call_tasks;
create trigger trg_voice_call_tasks_updated
  before update on public.voice_call_tasks
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) Trigger de validación: revalida contra la fila REAL.
--    El CHECK de arriba confía en la columna target_party_kind. Este trigger
--    comprueba que esa columna no miente, que el teléfono no está excluido, y
--    que el mantenimiento pertenece a la misma empresa y al mismo cliente.
-- -----------------------------------------------------------------------------
create or replace function app.voice_task_validate()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_kind        app.party_kind;
  v_company     uuid;
  v_job_company uuid;
  v_job_customer uuid;
begin
  -- 1) Exclusión telefónica: vale para los dos propósitos.
  if exists (
    select 1 from public.voice_do_not_call d
    where d.company_id = new.company_id
      and d.phone_e164 = new.to_phone_e164
  ) then
    raise exception 'VOICE_DNC: el teléfono % está en la lista de exclusión de la empresa', new.to_phone_e164
      using errcode = 'check_violation';
  end if;

  -- 2) Comercial → el destino tiene que ser una persona JURÍDICA de verdad.
  if new.purpose = 'commercial' then
    select l.party_kind, l.company_id into v_kind, v_company
      from public.leads l where l.id = new.lead_id;
    if v_kind is null then
      raise exception 'VOICE_TARGET: lead % no encontrado', new.lead_id
        using errcode = 'check_violation';
    end if;
    if v_company <> new.company_id then
      raise exception 'VOICE_TENANT: el lead pertenece a otra empresa'
        using errcode = 'check_violation';
    end if;
    if v_kind <> 'company' then
      raise exception 'VOICE_B2C_BLOCKED: prohibido encolar una llamada comercial a un particular (lead %)', new.lead_id
        using errcode = 'check_violation';
    end if;
    if new.target_party_kind <> v_kind then
      raise exception 'VOICE_KIND_MISMATCH: target_party_kind no coincide con el lead real'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 3) Servicio → cliente propio + job propio + los dos de la misma empresa.
  if new.purpose = 'service' then
    select c.party_kind, c.company_id into v_kind, v_company
      from public.customers c where c.id = new.customer_id and c.deleted_at is null;
    if v_kind is null then
      raise exception 'VOICE_TARGET: cliente % no encontrado o borrado', new.customer_id
        using errcode = 'check_violation';
    end if;
    if v_company <> new.company_id then
      raise exception 'VOICE_TENANT: el cliente pertenece a otra empresa'
        using errcode = 'check_violation';
    end if;
    if new.target_party_kind <> v_kind then
      raise exception 'VOICE_KIND_MISMATCH: target_party_kind no coincide con el cliente real'
        using errcode = 'check_violation';
    end if;

    select m.company_id, m.customer_id into v_job_company, v_job_customer
      from public.maintenance_jobs m where m.id = new.maintenance_job_id;
    if v_job_company is null then
      raise exception 'VOICE_TARGET: mantenimiento % no encontrado', new.maintenance_job_id
        using errcode = 'check_violation';
    end if;
    if v_job_company <> new.company_id or v_job_customer is distinct from new.customer_id then
      raise exception 'VOICE_TENANT: el mantenimiento no corresponde a ese cliente/empresa'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_voice_task_validate on public.voice_call_tasks;
create trigger trg_voice_task_validate
  before insert or update of purpose, target_party_kind, customer_id, lead_id,
                             maintenance_job_id, to_phone_e164
  on public.voice_call_tasks
  for each row execute function app.voice_task_validate();

-- -----------------------------------------------------------------------------
-- 5) voice_call_attempts — cada intento real de llamada, con su transcripción.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_call_attempts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  task_id             uuid not null references public.voice_call_tasks(id) on delete cascade,
  purpose             app.voice_call_purpose not null,

  provider            text not null,
  provider_call_id    text,
  from_number         text,
  to_phone_e164       text not null,

  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  duration_seconds    integer,
  cost_cents          integer,

  outcome             app.voice_call_outcome,
  transcript          text,
  summary             text,
  recording_url       text,

  -- Prueba de cumplimiento. Sin estas tres columnas no puedes demostrar
  -- nada ante una reclamación, y son exactamente lo que te van a pedir.
  ai_disclosure_given     boolean not null default false,  -- art. 50 RIA
  human_escalation_offered boolean not null default false,  -- Ley 10/2025
  human_escalation_requested boolean not null default false,

  error_message       text,
  created_at          timestamptz not null default now(),

  unique (provider, provider_call_id)
);

create index if not exists idx_voice_attempt_task
  on public.voice_call_attempts(task_id, started_at desc);
create index if not exists idx_voice_attempt_company
  on public.voice_call_attempts(company_id, started_at desc);

comment on column public.voice_call_attempts.ai_disclosure_given is
  'El agente declaró ser una IA al inicio (art. 50 Reglamento UE de IA, aplicable desde el 2-ago-2026). Es la prueba de cumplimiento.';
comment on column public.voice_call_attempts.human_escalation_offered is
  'Se ofreció explícitamente pasar con una persona (Ley 10/2025). Debe ser true en el 100% de las llamadas contestadas.';

-- -----------------------------------------------------------------------------
-- 6) RLS — todo por company_id, igual que el resto del proyecto.
-- -----------------------------------------------------------------------------
alter table public.voice_agent_settings enable row level security;
alter table public.voice_do_not_call    enable row level security;
alter table public.voice_call_tasks     enable row level security;
alter table public.voice_call_attempts  enable row level security;
alter table public.voice_consents       enable row level security;

drop policy if exists voice_consents_super on public.voice_consents;
create policy voice_consents_super on public.voice_consents
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_consents_select on public.voice_consents;
create policy voice_consents_select on public.voice_consents
  for select to authenticated using (company_id = app.current_company_id());

-- Append-only: se puede insertar, nunca actualizar ni borrar. El histórico
-- de consentimientos es la prueba ante la AEPD; si se puede editar, no lo es.
drop policy if exists voice_consents_insert on public.voice_consents;
create policy voice_consents_insert on public.voice_consents
  for insert to authenticated with check (company_id = app.current_company_id());

-- voice_agent_settings: leer nivel 1/2, escribir solo company_admin.
drop policy if exists voice_settings_super on public.voice_agent_settings;
create policy voice_settings_super on public.voice_agent_settings
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_settings_select on public.voice_agent_settings;
create policy voice_settings_select on public.voice_agent_settings
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists voice_settings_write on public.voice_agent_settings;
create policy voice_settings_write on public.voice_agent_settings
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- voice_do_not_call: cualquiera de la empresa puede añadir una exclusión
-- (si un cliente te dice "no me llaméis", quien lo oiga debe poder anotarlo).
-- Borrar, solo admin: quitar a alguien de la lista de exclusión es delicado.
drop policy if exists voice_dnc_super on public.voice_do_not_call;
create policy voice_dnc_super on public.voice_do_not_call
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_dnc_select on public.voice_do_not_call;
create policy voice_dnc_select on public.voice_do_not_call
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists voice_dnc_insert on public.voice_do_not_call;
create policy voice_dnc_insert on public.voice_do_not_call
  for insert to authenticated with check (company_id = app.current_company_id());

drop policy if exists voice_dnc_delete on public.voice_do_not_call;
create policy voice_dnc_delete on public.voice_do_not_call
  for delete to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'));

-- voice_call_tasks / attempts: lectura para nivel 1/2 (los que gestionan la
-- cola). Escritura desde el servidor (admin client / cron).
drop policy if exists voice_tasks_super on public.voice_call_tasks;
create policy voice_tasks_super on public.voice_call_tasks
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_tasks_select on public.voice_call_tasks;
create policy voice_tasks_select on public.voice_call_tasks
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin')
         or app.has_role('technical_director')
         or app.has_role('telemarketing_director')
         or app.has_role('commercial_director'))
  );

drop policy if exists voice_tasks_write on public.voice_call_tasks;
create policy voice_tasks_write on public.voice_call_tasks
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin')
         or app.has_role('technical_director')
         or app.has_role('telemarketing_director'))
  )
  with check (
    company_id = app.current_company_id()
    and (app.has_role('company_admin')
         or app.has_role('technical_director')
         or app.has_role('telemarketing_director'))
  );

drop policy if exists voice_attempts_super on public.voice_call_attempts;
create policy voice_attempts_super on public.voice_call_attempts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists voice_attempts_select on public.voice_call_attempts;
create policy voice_attempts_select on public.voice_call_attempts
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin')
         or app.has_role('technical_director')
         or app.has_role('telemarketing_director')
         or app.has_role('commercial_director'))
  );

-- -----------------------------------------------------------------------------
-- 7) RPC de reserva atómica del marcador.
--    El cron llama a esto en vez de hacer SELECT + UPDATE. Con dos ejecuciones
--    solapadas (Vercel reintenta), el SELECT+UPDATE llamaría dos veces al
--    mismo cliente. Este UPDATE ... RETURNING no.
-- -----------------------------------------------------------------------------
create or replace function app.voice_claim_tasks(
  p_purpose app.voice_call_purpose,
  p_limit   integer default 10,
  p_token   uuid default gen_random_uuid()
)
returns setof public.voice_call_tasks
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update public.voice_call_tasks t
     set status     = 'calling',
         locked_at  = now(),
         lock_token = p_token,
         attempts   = t.attempts + 1
   where t.id in (
     select id from public.voice_call_tasks
      where status = 'pending'
        and purpose = p_purpose
        and next_attempt_at <= now()
      order by next_attempt_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning t.*;
$$;

revoke all on function app.voice_claim_tasks(app.voice_call_purpose, integer, uuid) from public, anon, authenticated;

-- Devuelve al estado 'pending' las tareas que quedaron colgadas en 'calling'
-- (el proceso murió a mitad, la plataforma nunca mandó el webhook).
create or replace function app.voice_release_stale_tasks(p_minutes integer default 15)
returns integer
language sql
security definer
set search_path = public, app, pg_temp
as $$
  with released as (
    update public.voice_call_tasks
       set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
           locked_at = null,
           lock_token = null,
           next_attempt_at = now() + make_interval(mins => p_minutes)
     where status = 'calling'
       and locked_at < now() - make_interval(mins => p_minutes)
    returning 1
  )
  select count(*)::integer from released;
$$;

revoke all on function app.voice_release_stale_tasks(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) Catálogo de módulos — OPT-IN, apagado por defecto.
--    Este módulo cuesta dinero por minuto y tiene implicaciones legales.
--    Nadie se lo encuentra encendido sin haberlo pedido.
-- -----------------------------------------------------------------------------
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order)
values (
  'voice_agent',
  'Agente de voz IA',
  'Un asistente de IA que llama por teléfono. Agenda los mantenimientos pendientes con tus clientes (llamada de servicio, sin restricción legal) y, opcionalmente y por separado, hace captación comercial solo a empresas. Nunca llama a particulares con fines comerciales.',
  'phone-call',
  false,           -- OPT-IN: apagado por defecto
  false,
  false,
  75
)
on conflict (key) do update set
  label_es       = excluded.label_es,
  description_es = excluded.description_es,
  icon           = excluded.icon,
  is_parked      = excluded.is_parked,
  sort_order     = excluded.sort_order;

notify pgrst, 'reload schema';
