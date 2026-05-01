-- =============================================================================
-- 20260501120700_transversal_tables.sql
-- Capa 2 · Tablas TRANSVERSALES (sirven a múltiples módulos vía subject_type/id).
--
-- Tablas:
--   - events            timeline única (decisión #8)
--   - notifications     campana + push
--   - documents         referencias a archivos en Storage
--   - audit_log         escrituras a tablas sensibles
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enums transversales
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'subject_type') then
    create type app.subject_type as enum (
      'lead', 'customer', 'proposal', 'contract', 'free_trial',
      'installation', 'maintenance', 'incident',
      'product', 'warehouse', 'wallet_entry', 'user', 'company',
      'sales_record', 'lost_sale', 'price_approval'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'notification_severity') then
    create type app.notification_severity as enum ('info','success','warning','error');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'audit_op') then
    create type app.audit_op as enum ('INSERT','UPDATE','DELETE');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- events  (timeline único, decisión #8)
-- -----------------------------------------------------------------------------
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  subject_type    app.subject_type not null,
  subject_id      uuid not null,
  kind            text not null,                                   -- "lead.created", "proposal.sent", etc.
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid references auth.users(id) on delete set null,
  visibility      text not null default 'company' check (visibility in ('company','private','system'))
);

create index idx_events_subject on public.events(company_id, subject_type, subject_id, occurred_at desc);
create index idx_events_kind on public.events(company_id, kind, occurred_at desc);
create index idx_events_actor on public.events(company_id, actor_user_id, occurred_at desc) where actor_user_id is not null;

comment on table public.events is
  'Timeline polimórfico único. Usado por todas las fichas (lead, cliente, contrato...). Inmutable: solo INSERT.';
comment on column public.events.kind is
  'Identificador semántico del evento, ej. "lead.contacted", "wallet.payment_recorded".';
comment on column public.events.payload is
  'Datos específicos del evento. Estructura depende de kind.';

-- RLS
alter table public.events enable row level security;
alter table public.events force row level security;

drop policy if exists events_super on public.events;
create policy events_super on public.events
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists events_read_tenant on public.events;
create policy events_read_tenant on public.events
  for select to authenticated
  using (company_id = app.current_company_id());

-- Insert: cualquier authenticated dentro de su empresa (las verificaciones de
-- "puede generar este evento" se hacen en lógica de aplicación / triggers).
drop policy if exists events_insert_tenant on public.events;
create policy events_insert_tenant on public.events
  for insert to authenticated
  with check (company_id = app.current_company_id());

-- Sin UPDATE/DELETE para usuarios; el timeline es inmutable (solo superadmin).

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind              text not null,                                 -- "stock_low", "lead_expiring", "installation_tomorrow", ...
  severity          app.notification_severity not null default 'info',
  title             text not null,
  body              text,
  -- Subject opcional para enlazar
  subject_type      app.subject_type,
  subject_id        uuid,
  -- Acción opcional (deeplink dentro del CRM)
  action_url        text,
  -- Estado
  read_at           timestamptz,
  acted_at          timestamptz,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz
);

create index idx_notifications_recipient on public.notifications(recipient_user_id, read_at, created_at desc);
create index idx_notifications_company on public.notifications(company_id, created_at desc);
create index idx_notifications_kind on public.notifications(company_id, kind, created_at desc);

comment on table public.notifications is
  'Notificaciones in-app de la campana. Hard-delete cuando expires_at pasa.';

-- RLS
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists notifications_super on public.notifications;
create policy notifications_super on public.notifications
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists notifications_read_recipient on public.notifications;
create policy notifications_read_recipient on public.notifications
  for select to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications
  for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Insert: lo hacen triggers del sistema o admin/director vía service_role.
-- No exponemos insert directo a authenticated.

drop policy if exists notifications_delete_self on public.notifications;
create policy notifications_delete_self on public.notifications
  for delete to authenticated
  using (recipient_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- documents  (referencias a archivos en Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  subject_type  app.subject_type not null,
  subject_id    uuid not null,
  kind          text not null,                                     -- "contract_signed", "installation_photo", "product_datasheet", "logo", "signature"...
  filename      text not null,
  storage_bucket text not null default 'documents',
  storage_path  text not null,                                     -- "{company_id}/{module}/{uuid}.ext"
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  width_px      integer,                                            -- para imágenes
  height_px     integer,
  uploaded_by   uuid references auth.users(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  deleted_at    timestamptz,                                        -- soft-delete
  unique (storage_bucket, storage_path)
);

create index idx_documents_subject on public.documents(company_id, subject_type, subject_id) where deleted_at is null;
create index idx_documents_kind on public.documents(company_id, kind) where deleted_at is null;

comment on table public.documents is
  'Tabla única de documentos. storage_path apunta a Supabase Storage (bucket "documents", carpeta /{company_id}/...).';

-- RLS
alter table public.documents enable row level security;
alter table public.documents force row level security;

drop policy if exists documents_super on public.documents;
create policy documents_super on public.documents
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists documents_read_tenant on public.documents;
create policy documents_read_tenant on public.documents
  for select to authenticated
  using (company_id = app.current_company_id() and deleted_at is null);

drop policy if exists documents_insert_tenant on public.documents;
create policy documents_insert_tenant on public.documents
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and storage_path like (app.current_company_id()::text || '/%')
  );

drop policy if exists documents_update_tenant on public.documents;
create policy documents_update_tenant on public.documents
  for update to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

drop policy if exists documents_delete_admin on public.documents;
create policy documents_delete_admin on public.documents
  for delete to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or uploaded_by = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- audit_log  (escrituras en tablas sensibles)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  table_name  text not null,
  record_id   uuid not null,
  operation   app.audit_op not null,
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb,
  diff        jsonb,                                                -- campos que cambiaron, generado por trigger
  ip_address  inet,
  user_agent  text
);

create index idx_audit_table on public.audit_log(company_id, table_name, record_id, changed_at desc);
create index idx_audit_user on public.audit_log(company_id, changed_by, changed_at desc);

comment on table public.audit_log is
  'Auditoría de escrituras en tablas sensibles (contratos, wallet, precios). Sin lecturas en MVP. Inmutable.';

-- Trigger reutilizable que se aplicará después a tablas concretas
create or replace function app.audit_trigger() returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_company_id uuid;
  k text;
begin
  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_company_id := (v_old->>'company_id')::uuid;
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_company_id := (v_new->>'company_id')::uuid;
    -- Diff: solo campos que cambiaron
    for k in select jsonb_object_keys(v_new) loop
      if (v_old->k) is distinct from (v_new->k) then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', v_old->k, 'new', v_new->k));
      end if;
    end loop;
  elsif TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_company_id := (v_new->>'company_id')::uuid;
  end if;

  insert into public.audit_log (company_id, table_name, record_id, operation, changed_by, old_data, new_data, diff)
  values (
    v_company_id,
    TG_TABLE_NAME,
    coalesce((case when v_new is null then v_old else v_new end)->>'id', '')::uuid,
    TG_OP::app.audit_op,
    auth.uid(),
    v_old,
    v_new,
    case when TG_OP = 'UPDATE' then v_diff else null end
  );

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

comment on function app.audit_trigger() is
  'Trigger AFTER INSERT/UPDATE/DELETE para auditoría. Aplicar manualmente a las tablas a auditar.';

-- RLS audit_log (solo superadmin lee global; admin de empresa lee la suya)
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_super on public.audit_log;
create policy audit_log_super on public.audit_log
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists audit_log_read_admin on public.audit_log;
create policy audit_log_read_admin on public.audit_log
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- Sin INSERT/UPDATE/DELETE para users; lo hace el trigger SECURITY DEFINER.
