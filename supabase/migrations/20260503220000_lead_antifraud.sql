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
