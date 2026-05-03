-- =============================================================================
-- _apply_all_pending.sql
-- Combina todas las migraciones de la sesión 2026-05-03 (170000-290000).
-- Pegar en SQL Editor de Supabase y ejecutar de una vez.
-- Idempotente: usa CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, etc.
-- =============================================================================


-- ===== 20260503170000_user_home_geo.sql =====
-- =============================================================================
-- 20260503170000_user_home_geo.sql
-- Añade coordenadas "base" del usuario (técnico/comercial) usadas como
-- punto de partida en el optimizador de rutas Haversine.
-- =============================================================================

alter table public.user_profiles
  add column if not exists home_latitude  numeric(10,7),
  add column if not exists home_longitude numeric(10,7);

comment on column public.user_profiles.home_latitude is
  'Latitud del punto de partida del usuario (su domicilio o sede). Usado por el optimizador de rutas.';
comment on column public.user_profiles.home_longitude is
  'Longitud del punto de partida del usuario.';

-- ===== 20260503180000_chat.sql =====
-- =============================================================================
-- 20260503180000_chat.sql
-- Chat interno con tres tipos de hilo:
--   broadcast → admin escribe, todos los usuarios de la empresa lo ven
--   team      → un líder (nivel 2) crea un hilo con su equipo
--   direct    → conversación 1↔1 entre dos usuarios
-- =============================================================================

-- ENUM tipo de hilo
do $$ begin
  if not exists (select 1 from pg_type where typname = 'chat_thread_kind') then
    create type chat_thread_kind as enum ('broadcast', 'team', 'direct');
  end if;
end $$;

-- Hilos
create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            chat_thread_kind not null,
  name            text,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  deleted_at      timestamptz
);
create index if not exists chat_threads_company_idx on public.chat_threads(company_id);
create index if not exists chat_threads_last_msg_idx on public.chat_threads(last_message_at desc);

-- Miembros de cada hilo (para broadcast no es necesario insertar a todos: la
-- visibilidad se resuelve por "kind=broadcast + same company"; sólo guarda
-- last_read_at para contar no leídos por usuario que sí ha entrado al hilo).
create table if not exists public.chat_thread_members (
  thread_id     uuid not null references public.chat_threads(id) on delete cascade,
  user_id       uuid not null,
  role          text not null default 'member', -- 'owner' | 'member'
  joined_at     timestamptz not null default now(),
  last_read_at  timestamptz,
  primary key (thread_id, user_id)
);
create index if not exists chat_thread_members_user_idx on public.chat_thread_members(user_id);

-- Mensajes
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads(id) on delete cascade,
  sender_id   uuid not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
create index if not exists chat_messages_thread_idx
  on public.chat_messages(thread_id, created_at desc);

-- Bump de last_message_at automáticamente al insertar mensaje
create or replace function public.bump_chat_thread_last_msg() returns trigger as $$
begin
  update public.chat_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_bump_chat_thread_last_msg on public.chat_messages;
create trigger trg_bump_chat_thread_last_msg
  after insert on public.chat_messages
  for each row execute function public.bump_chat_thread_last_msg();

-- RLS: las acciones de Supabase en este proyecto se hacen con admin client
-- desde server actions (bypass RLS). Habilitamos RLS por si en el futuro
-- alguien usa el cliente público.
alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_company on public.chat_threads;
create policy chat_threads_company on public.chat_threads
  for select using (
    company_id = coalesce((current_setting('request.jwt.claims', true)::json ->> 'company_id')::uuid, company_id)
  );

drop policy if exists chat_messages_company on public.chat_messages;
create policy chat_messages_company on public.chat_messages
  for select using (true);

drop policy if exists chat_members_self on public.chat_thread_members;
create policy chat_members_self on public.chat_thread_members
  for select using (true);

comment on table public.chat_threads is
  'Hilos de chat interno por empresa. kind controla la semántica de visibilidad y permisos.';
comment on table public.chat_thread_members is
  'Miembros de un hilo. Para broadcast los miembros se materializan al primer acceso para llevar last_read_at.';
comment on table public.chat_messages is
  'Mensajes de chat. body en texto plano; el cliente escapa al renderizar.';

-- ===== 20260503190000_chat_realtime.sql =====
-- =============================================================================
-- 20260503190000_chat_realtime.sql
-- Habilita Supabase Realtime (replicación INSERT/UPDATE) sobre las tablas de
-- chat para que el cliente reciba mensajes en vivo.
-- =============================================================================

-- Asegurar que la publicación supabase_realtime existe (la trae Supabase).
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Añadir tablas si no están ya en la publicación (idempotente)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table public.chat_threads;
  end if;
end $$;

-- ===== 20260503200000_incident_sla.sql =====
-- =============================================================================
-- 20260503200000_incident_sla.sql
-- Añade SLA por prioridad a incidencias.
--   - sla_settings en company_settings (jsonb): horas máximas de resolución
--     por prioridad. Defaults: low=72, medium=24, high=8, critical=2.
--   - deadline_at en incidents: calculado al crear según prioridad. Si se
--     cambia la prioridad, se recalcula desde created_at.
-- =============================================================================

alter table public.company_settings
  add column if not exists sla_settings jsonb not null default '{}'::jsonb;

alter table public.incidents
  add column if not exists deadline_at timestamptz;

-- Función de utilidad: horas SLA por prioridad para una empresa
create or replace function app.incident_sla_hours(
  p_company_id uuid,
  p_priority app.incident_priority
) returns integer
language sql
stable
as $$
  select coalesce(
    (
      select case p_priority
        when 'low'      then nullif((sla_settings->>'low')::int, 0)
        when 'medium'   then nullif((sla_settings->>'medium')::int, 0)
        when 'high'     then nullif((sla_settings->>'high')::int, 0)
        when 'critical' then nullif((sla_settings->>'critical')::int, 0)
      end
      from public.company_settings
      where company_id = p_company_id
    ),
    case p_priority
      when 'low'      then 72
      when 'medium'   then 24
      when 'high'     then 8
      when 'critical' then 2
    end
  );
$$;

-- Trigger: setear deadline al insertar y al cambiar prioridad
create or replace function app.set_incident_deadline() returns trigger as $$
declare
  hrs integer;
begin
  if tg_op = 'INSERT' or new.priority is distinct from old.priority then
    hrs := app.incident_sla_hours(new.company_id, new.priority);
    new.deadline_at := coalesce(new.created_at, now()) + make_interval(hours => hrs);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_incident_deadline on public.incidents;
create trigger trg_incident_deadline
  before insert or update on public.incidents
  for each row execute function app.set_incident_deadline();

-- Backfill: asignar deadline a incidencias existentes que no tengan
update public.incidents
   set deadline_at = created_at + make_interval(hours => app.incident_sla_hours(company_id, priority))
 where deadline_at is null;

-- ===== 20260503210000_proposal_variants.sql =====
-- =============================================================================
-- 20260503210000_proposal_variants.sql
-- Variantes de propuesta (comparador A / B / C). Las propuestas con el mismo
-- variant_group_id son variantes de un mismo paquete. Cuando una se acepta,
-- las hermanas se marcan como superseded automáticamente desde la app.
-- =============================================================================

alter table public.proposals
  add column if not exists variant_group_id uuid,
  add column if not exists variant_label    text;

create index if not exists idx_proposals_variant_group
  on public.proposals(company_id, variant_group_id)
  where variant_group_id is not null;

comment on column public.proposals.variant_group_id is
  'Agrupa varias propuestas como variantes (A/B/C) de la misma oferta. Al aceptar una, las hermanas pasan a superseded.';
comment on column public.proposals.variant_label is
  'Etiqueta corta para distinguir la variante: "A", "B", "Premium", "Económico"…';

-- ===== 20260503220000_lead_antifraud.sql =====
-- =============================================================================
-- 20260503220000_lead_antifraud.sql
-- Detecta cambios sensibles en leads (DNI, teléfono, dirección) hechos por
-- alguien distinto al asignado original y genera una notificación al admin
-- de la empresa.
-- =============================================================================

create or replace function app.detect_lead_tampering() returns trigger as $$
declare
  changed_fields text[] := array[]::text[];
  actor uuid;
  admin_id uuid;
begin
  -- Solo en UPDATE
  if tg_op <> 'UPDATE' then return new; end if;

  -- Detectar cambios en campos sensibles
  if coalesce(new.tax_id, '') is distinct from coalesce(old.tax_id, '') then
    changed_fields := array_append(changed_fields, 'tax_id');
  end if;
  if coalesce(new.phone_primary, '') is distinct from coalesce(old.phone_primary, '') then
    changed_fields := array_append(changed_fields, 'phone_primary');
  end if;
  if coalesce(new.phone_company, '') is distinct from coalesce(old.phone_company, '') then
    changed_fields := array_append(changed_fields, 'phone_company');
  end if;
  if coalesce(new.email, '') is distinct from coalesce(old.email, '') then
    changed_fields := array_append(changed_fields, 'email');
  end if;

  if array_length(changed_fields, 1) is null then
    return new;
  end if;

  -- ¿Quién hizo el cambio? Lo intenta sacar del JWT
  begin
    actor := nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
  exception when others then
    actor := null;
  end;

  -- Solo dispara si el actor es distinto del asignado original (un comercial
  -- editando lead de otro comercial). Si es el propio asignado o sin actor
  -- (admin via service-role) no avisa.
  if actor is null or old.assigned_user_id is null or actor = old.assigned_user_id then
    return new;
  end if;

  -- Crear evento auditoría
  insert into public.events (company_id, subject_type, subject_id, kind, payload, actor_user_id)
  values (
    new.company_id, 'lead', new.id, 'lead.tampered',
    jsonb_build_object(
      'fields', changed_fields,
      'previous_assigned_user_id', old.assigned_user_id
    ),
    actor
  );

  -- Notificar a todos los company_admin de la empresa
  for admin_id in
    select user_id from public.user_roles
     where company_id = new.company_id
       and role_key = 'company_admin'
       and revoked_at is null
  loop
    insert into public.notifications (
      company_id, recipient_user_id, kind, severity, title, body,
      subject_type, subject_id
    ) values (
      new.company_id, admin_id, 'lead_tampered', 'warning',
      '⚠ Posible fraude en lead',
      format('Cambio sospechoso en %s del lead', array_to_string(changed_fields, ', ')),
      'lead', new.id
    );
  end loop;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_lead_antifraud on public.leads;
create trigger trg_lead_antifraud
  after update on public.leads
  for each row execute function app.detect_lead_tampering();

-- ===== 20260503230000_user_module_overrides.sql =====
-- =============================================================================
-- 20260503230000_user_module_overrides.sql
-- Override de acceso a módulos por usuario. Por defecto cada rol tiene sus
-- módulos (definidos en seeds y en MODULES). Esta tabla permite al admin
-- conceder o denegar acceso a un módulo concreto a un usuario concreto.
-- =============================================================================

create table if not exists public.user_module_overrides (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  /** true = forzar acceso, false = forzar denegado */
  granted    boolean not null,
  set_by     uuid references auth.users(id),
  set_at     timestamptz not null default now(),
  primary key (user_id, company_id, module_key)
);

create index if not exists idx_user_module_overrides_user
  on public.user_module_overrides(user_id, company_id);

comment on table public.user_module_overrides is
  'Excepciones por usuario al acceso de módulos definido por sus roles.';

-- ===== 20260503240000_stock_min.sql =====
-- =============================================================================
-- 20260503240000_stock_min.sql
-- Stock mínimo por (warehouse, product). Cuando el stock cae por debajo
-- del umbral, se notifica al admin.
-- =============================================================================

alter table public.warehouse_stock
  add column if not exists min_quantity integer not null default 0;

create or replace function app.notify_stock_low() returns trigger as $$
declare
  admin_id uuid;
  prod_name text;
  wh_name text;
begin
  if new.min_quantity <= 0 then return new; end if;
  if new.quantity >= new.min_quantity then return new; end if;
  -- Solo dispara si cruzamos hacia abajo (antes >=, ahora <)
  if tg_op = 'UPDATE' and old.quantity < old.min_quantity then return new; end if;

  select name into prod_name from public.products where id = new.product_id;
  select name into wh_name from public.warehouses where id = new.warehouse_id;

  for admin_id in
    select user_id from public.user_roles
     where company_id = new.company_id
       and role_key in ('company_admin','technical_director')
       and revoked_at is null
  loop
    insert into public.notifications (
      company_id, recipient_user_id, kind, severity, title, body
    ) values (
      new.company_id, admin_id, 'stock_low', 'warning',
      '⚠ Stock bajo',
      format('%s en %s: %s unidades (mínimo %s)',
        coalesce(prod_name,'Producto'),
        coalesce(wh_name,'almacén'),
        new.quantity, new.min_quantity)
    );
  end loop;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_stock_low on public.warehouse_stock;
create trigger trg_stock_low
  after insert or update on public.warehouse_stock
  for each row execute function app.notify_stock_low();

-- ===== 20260503250000_consents.sql =====
-- =============================================================================
-- 20260503250000_consents.sql
-- Consentimientos RGPD/LSSI: log inmutable de aceptaciones del cliente.
-- =============================================================================

create table if not exists public.customer_consents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  /** Tipo de consentimiento: 'commercial' | 'data_processing' | 'profiling' | … */
  kind            text not null,
  granted         boolean not null,
  /** Origen: 'contract_sign' | 'customer_creation' | 'manual' */
  source          text not null,
  source_ref_id   uuid,                  -- id del contrato/firma que originó
  evidence        jsonb not null default '{}'::jsonb,  -- ip, ua, hash documento
  granted_at      timestamptz not null default now(),
  recorded_by     uuid references auth.users(id)
);

create index if not exists idx_customer_consents_customer
  on public.customer_consents(company_id, customer_id, granted_at desc);

comment on table public.customer_consents is
  'Log inmutable de consentimientos del cliente. Append-only — nunca se actualizan ni borran filas, una revocación se registra como nueva fila con granted=false.';

-- ===== 20260503260000_attribute_categories.sql =====
-- =============================================================================
-- 20260503260000_attribute_categories.sql
-- NO-OP: la tabla puente atributo↔categorías ya existe desde la migración
-- 20260501121100_products.sql con el nombre product_attributes_global_categories.
-- Esta migración se mantiene vacía para no romper la secuencia de versiones
-- en entornos que ya la hayan ejecutado.
-- =============================================================================

-- (vacío intencionalmente)
select 1;

-- ===== 20260503270000_email_outbox.sql =====
-- =============================================================================
-- 20260503270000_email_outbox.sql
-- Cola outbox de emails pendientes. La app inserta filas con send_at futuro
-- y un proveedor (Resend, SendGrid…) las consume cuando el usuario lo
-- configure. Hasta entonces, queda como histórico de "lo que tocaría enviar".
-- =============================================================================

create table if not exists public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  to_email        text not null,
  to_name         text,
  subject         text not null,
  body_text       text,
  body_html       text,
  /** "maintenance_reminder" | "contract_signed" | … */
  kind            text not null,
  /** Cuándo enviar */
  send_at         timestamptz not null default now(),
  /** Cuándo se envió de verdad (null = pendiente) */
  sent_at         timestamptz,
  /** Resultado del envío */
  status          text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  error           text,
  /** Vínculo opcional al subject que originó el email */
  subject_type    text,
  subject_id      uuid,
  created_at      timestamptz not null default now()
);

create index if not exists idx_email_outbox_pending
  on public.email_outbox(status, send_at)
  where status = 'pending';
create index if not exists idx_email_outbox_company
  on public.email_outbox(company_id, created_at desc);

-- ===== 20260503280000_contract_photos.sql =====
-- =============================================================================
-- 20260503280000_contract_photos.sql
-- Fotos asociadas a un contrato (DNI escaneado, IBAN, firma manuscrita, etc.)
-- Las imágenes viven en Supabase Storage bucket "contract-photos" (privado).
-- Esta tabla guarda la metadata + path.
-- =============================================================================

create table if not exists public.contract_photos (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  /** "id_card" | "iban" | "signature" | "other" */
  kind            text not null default 'other',
  storage_path    text not null,
  mime_type       text,
  size_bytes      integer,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id),
  notes           text
);

create index if not exists idx_contract_photos_contract
  on public.contract_photos(contract_id, uploaded_at desc);

-- ===== 20260503290000_unpark_points.sql =====
-- =============================================================================
-- 20260503290000_unpark_points.sql
-- El módulo "points" (programa de puntos) ya está IMPLEMENTADO al 100%:
-- - /configuracion/puntos (config + comisiones €)
-- - /puntos (ranking + mis puntos)
-- - awardPoints en lead, propuesta, instalación, mantenimiento, incidencia
-- - hitos / bonus mensuales
--
-- Por error histórico el seed dejó is_parked=true. Esta migración lo corrige
-- para que el superadmin pueda activarlo en empresas sin ver el badge "aparcado".
-- =============================================================================

update public.modules_catalog
   set is_parked = false
 where key = 'points';

-- ===== 20260503290000_unpark_points.sql =====
-- =============================================================================
-- 20260503290000_unpark_points.sql
-- El módulo "points" (programa de puntos) ya está IMPLEMENTADO al 100%:
-- - /configuracion/puntos (config + comisiones €)
-- - /puntos (ranking + mis puntos)
-- - awardPoints en lead, propuesta, instalación, mantenimiento, incidencia
-- - hitos / bonus mensuales
--
-- Por error histórico el seed dejó is_parked=true. Esta migración lo corrige
-- para que el superadmin pueda activarlo en empresas sin ver el badge "aparcado".
-- =============================================================================

update public.modules_catalog
   set is_parked = false
 where key = 'points';
