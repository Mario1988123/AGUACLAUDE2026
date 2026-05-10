-- =============================================================================
-- 20260518100000_incident_email_templates.sql
-- Plantillas de email para flujo de incidencias (sistema, una por empresa).
-- Se semilla por empresa al crear la empresa o se ejecuta manualmente.
-- =============================================================================

create or replace function public.seed_incident_email_templates(p_company uuid)
returns void language plpgsql as $$
begin
  -- Insertar solo si no existe ya (el partial unique index no permite ON CONFLICT directo)
  if not exists (select 1 from public.email_templates where company_id = p_company and key = 'incident_assigned') then
    insert into public.email_templates (
      company_id, key, name, description, kind, subject, body_html, body_text,
      variables, is_system, is_active
    ) values (
      p_company, 'incident_assigned', 'Incidencia asignada',
      'Email al cliente cuando se le asigna técnico a su incidencia',
      'transactional',
      'Tu incidencia se está atendiendo · {{incident_title}}',
      '<p>Hola {{customer_name}},</p>'
      '<p>Tu incidencia <strong>{{incident_title}}</strong> ha sido asignada a nuestro técnico {{technician_name}}.</p>'
      '<p>Plazo estimado de resolución: <strong>{{deadline_at}}</strong>.</p>'
      '<p>Te avisaremos cuando esté resuelta. Si tienes urgencia, llámanos al {{company_phone}}.</p>',
      'Hola {{customer_name}}, tu incidencia "{{incident_title}}" ha sido asignada a {{technician_name}}. Plazo estimado: {{deadline_at}}.',
      array['customer_name', 'incident_title', 'technician_name', 'deadline_at', 'company_phone'],
      true, true
    );
  end if;

  if not exists (select 1 from public.email_templates where company_id = p_company and key = 'incident_sla_warning') then
    insert into public.email_templates (
      company_id, key, name, description, kind, subject, body_html, body_text,
      variables, is_system, is_active
    ) values (
      p_company, 'incident_sla_warning', 'Incidencia en proceso (recordatorio)',
      'Email al cliente cuando llevamos 50% del SLA sin resolver la incidencia',
      'transactional',
      'Tu incidencia sigue en proceso · {{incident_title}}',
      '<p>Hola {{customer_name}},</p>'
      '<p>Te informamos que tu incidencia <strong>{{incident_title}}</strong> sigue en proceso de resolución.</p>'
      '<p>Plazo estimado: {{deadline_at}}.</p>'
      '<p>Estamos trabajando en ello. Te avisaremos en cuanto esté solucionada.</p>',
      'Hola {{customer_name}}, tu incidencia "{{incident_title}}" sigue en proceso. Plazo: {{deadline_at}}.',
      array['customer_name', 'incident_title', 'deadline_at'],
      true, true
    );
  end if;

  if not exists (select 1 from public.email_templates where company_id = p_company and key = 'incident_resolved') then
    insert into public.email_templates (
      company_id, key, name, description, kind, subject, body_html, body_text,
      variables, is_system, is_active
    ) values (
      p_company, 'incident_resolved', 'Incidencia resuelta',
      'Email al cliente cuando se cierra la incidencia',
      'transactional',
      'Tu incidencia se ha resuelto · {{incident_title}}',
      '<p>Hola {{customer_name}},</p>'
      '<p>Tu incidencia <strong>{{incident_title}}</strong> se ha resuelto en {{resolution_hours}} horas.</p>'
      '<p>Si tienes cualquier consulta sobre la solución aplicada, no dudes en contactarnos.</p>'
      '<p>Gracias por tu confianza.</p>',
      'Hola {{customer_name}}, tu incidencia "{{incident_title}}" se ha resuelto en {{resolution_hours}}h.',
      array['customer_name', 'incident_title', 'resolution_hours'],
      true, true
    );
  end if;
end $$;

-- Backfill: ejecutar para todas las empresas existentes
do $$
declare c record;
begin
  for c in select id from public.companies where deleted_at is null loop
    perform public.seed_incident_email_templates(c.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
