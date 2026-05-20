-- ============================================================================
-- 20260620400000_contract_audit_log.sql
-- Trazabilidad de cambios en contratos. Decisión 2026-05-20: cualquier
-- cambio a campos clave (importe, plazo, financiera, IBAN) queda registrado
-- para auditoría legal / disputas con clientes.
-- ============================================================================

create table if not exists public.contract_audit_log (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  field        text not null,
  old_value    text,
  new_value    text,
  changed_by   uuid references auth.users(id) on delete set null,
  changed_at   timestamptz not null default now()
);

create index if not exists idx_contract_audit_contract
  on public.contract_audit_log(contract_id, changed_at desc);

create index if not exists idx_contract_audit_company
  on public.contract_audit_log(company_id, changed_at desc);

-- Trigger que captura cambios en columnas clave del contrato
create or replace function public.fn_contract_audit_trigger()
returns trigger as $$
declare
  changed_user uuid;
begin
  -- Usuario actual desde JWT (current_setting de Supabase auth)
  begin
    changed_user := ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid;
  exception when others then
    changed_user := null;
  end;

  -- Detectar cambios en campos clave
  if new.total_cash_cents is distinct from old.total_cash_cents then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'total_cash_cents', old.total_cash_cents::text, new.total_cash_cents::text, changed_user);
  end if;
  if new.monthly_cents is distinct from old.monthly_cents then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'monthly_cents', old.monthly_cents::text, new.monthly_cents::text, changed_user);
  end if;
  if new.duration_months is distinct from old.duration_months then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'duration_months', old.duration_months::text, new.duration_months::text, changed_user);
  end if;
  if new.plan_type is distinct from old.plan_type then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'plan_type', old.plan_type::text, new.plan_type::text, changed_user);
  end if;
  if new.financier_id is distinct from old.financier_id then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'financier_id', old.financier_id::text, new.financier_id::text, changed_user);
  end if;
  if new.status is distinct from old.status then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'status', old.status::text, new.status::text, changed_user);
  end if;
  if new.maintenance_periodicity_months is distinct from old.maintenance_periodicity_months then
    insert into public.contract_audit_log(contract_id, company_id, field, old_value, new_value, changed_by)
    values (new.id, new.company_id, 'maintenance_periodicity_months', old.maintenance_periodicity_months::text, new.maintenance_periodicity_months::text, changed_user);
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_contract_audit on public.contracts;
create trigger trg_contract_audit
  after update on public.contracts
  for each row execute function public.fn_contract_audit_trigger();

alter table public.contract_audit_log enable row level security;
drop policy if exists contract_audit_company on public.contract_audit_log;
create policy contract_audit_company on public.contract_audit_log
  for select
  using (
    company_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id'))::uuid
    or coalesce(((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'is_superadmin')::boolean), false)
  );


-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';
