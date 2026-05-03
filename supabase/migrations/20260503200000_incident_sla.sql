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
