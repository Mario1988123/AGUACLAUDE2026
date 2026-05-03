-- =============================================================================
-- 20260503130000_message_templates.sql
-- Plantillas mensaje editables por admin (WhatsApp / Email).
-- Reemplaza la lista hardcoded en src/modules/messaging/templates.ts.
-- =============================================================================

create table if not exists public.message_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  key          text not null,
  label        text not null,
  channel      text not null check (channel in ('whatsapp','email','any')),
  subject      text,
  body         text not null,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, key)
);

create index if not exists idx_msg_tpl_company_active
  on public.message_templates(company_id, sort_order)
  where is_active = true;

create trigger trg_msg_tpl_updated
  before update on public.message_templates
  for each row execute function app.set_updated_at();

comment on table public.message_templates is
  'Plantillas mensaje WhatsApp/Email editables por admin. Variables: {nombre} {empresa} {comercial} {ref} {fecha}.';

-- RLS
alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;

drop policy if exists msg_tpl_super on public.message_templates;
create policy msg_tpl_super on public.message_templates
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists msg_tpl_select_tenant on public.message_templates;
create policy msg_tpl_select_tenant on public.message_templates
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists msg_tpl_admin_write on public.message_templates;
create policy msg_tpl_admin_write on public.message_templates
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- Seed por empresa: idempotente.
create or replace function app.seed_default_message_templates(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if exists (select 1 from public.message_templates where company_id = p_company_id) then
    return;
  end if;

  insert into public.message_templates (company_id, key, label, channel, subject, body, sort_order) values
    (p_company_id, 'saludo_inicial', 'Saludo inicial', 'any', 'Encantado de saludarle',
     E'Hola {nombre},\n\nSoy {comercial} de {empresa}. Le contacto para presentarle nuestras soluciones de tratamiento de agua.\n\n¿Cuándo le vendría bien que pase a hacerle un análisis de agua sin compromiso?\n\nUn saludo,\n{comercial}',
     10),
    (p_company_id, 'recordatorio_cita', 'Recordatorio de cita', 'whatsapp', null,
     'Hola {nombre}, le recuerdo que mañana tenemos cita. ¡Hasta entonces! — {comercial}',
     20),
    (p_company_id, 'envio_propuesta', 'Envío propuesta', 'email', 'Su propuesta {ref}',
     E'Hola {nombre},\n\nLe adjunto la propuesta {ref} con las condiciones que comentamos.\n\nQuedo a su disposición para cualquier duda.\n\nUn saludo,\n{comercial}\n{empresa}',
     30),
    (p_company_id, 'seguimiento_propuesta', 'Seguimiento propuesta', 'any', '¿Pudo ver la propuesta?',
     'Hola {nombre}, le escribo por si pudo revisar la propuesta {ref} que le envié. ¿Tiene alguna duda? — {comercial}',
     40),
    (p_company_id, 'instalacion_confirmada', 'Confirmación instalación', 'whatsapp', null,
     'Hola {nombre}, le confirmamos la instalación para el {fecha}. Pasaremos durante la mañana. ¡Hasta entonces! — {empresa}',
     50),
    (p_company_id, 'agradecimiento', 'Agradecimiento tras instalación', 'any', 'Gracias por confiar en nosotros',
     E'Hola {nombre},\n\nQuería agradecerle personalmente que haya confiado en {empresa}. Cualquier incidencia con su equipo, no dude en escribirnos.\n\nUn saludo,\n{comercial}',
     60);
end;
$$;

grant execute on function app.seed_default_message_templates(uuid) to authenticated;
