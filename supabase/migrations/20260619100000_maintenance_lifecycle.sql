-- ============================================================================
-- 20260619100000_maintenance_lifecycle.sql
-- Lifecycle completo de mantenimientos:
--   - Estado 'preprogrammed' previo a 'scheduled' (decisión 2026-05-19).
--   - Flag renewal_offered_at en contracts para registrar si tras la
--     última visita se ofreció renovación al cliente.
--   - Flag renewal_declined_at + renewal_call_scheduled_at para
--     trazar el caso "cliente captivo sin contrato + llamada TMK".
-- ============================================================================

-- 1) Añadir 'preprogrammed' al enum maintenance_status.
do $$ begin
  if not exists (
    select 1
    from pg_enum
    where enumlabel = 'preprogrammed'
      and enumtypid = (select oid from pg_type where typname = 'maintenance_status')
  ) then
    alter type app.maintenance_status add value 'preprogrammed' before 'scheduled';
  end if;
end $$;

-- 2) Flags de renovación en contracts.
alter table public.contracts
  add column if not exists renewal_offered_at   timestamptz,
  add column if not exists renewal_accepted_at  timestamptz,
  add column if not exists renewal_declined_at  timestamptz,
  add column if not exists renewal_call_scheduled_at timestamptz,
  add column if not exists renewal_offered_by_user_id uuid references auth.users(id) on delete set null,
  -- Si la oferta dio lugar a un contrato nuevo (renovación), guardamos
  -- el id para enlazar contratos en cadena (timeline cliente).
  add column if not exists renewal_new_contract_id uuid references public.contracts(id) on delete set null;

comment on column public.contracts.renewal_offered_at is
  'Fecha en que el técnico ofreció renovación al cliente al cerrar la última visita de mantenimiento.';
comment on column public.contracts.renewal_accepted_at is
  'Fecha en que el cliente aceptó la renovación. Si está informado, debe haber un renewal_new_contract_id.';
comment on column public.contracts.renewal_declined_at is
  'Fecha en que el cliente rechazó la renovación. Si está informado, se crea una tarea de llamada en la agenda.';
comment on column public.contracts.renewal_call_scheduled_at is
  'Fecha programada para la llamada de seguimiento tras rechazo de renovación (TMK).';
