-- =============================================================================
-- 20260503340000_proposal_overhaul.sql
-- Rediseño completo de la propuesta:
--   - estado nuevo "pending_approval" en proposal_status
--   - plan elegido para TODA la propuesta (proposals.chosen_plan_type)
--   - duración elegida (proposals.chosen_duration_months) — permanencia o renting
--   - flag requires_approval + approved_by/approved_at
--   - por línea (proposal_items): instalación, mantenimiento, fianza,
--     toggle "1ª cuota cobrada ahora" para alquiler
-- =============================================================================

-- 1) Añadir 'pending_approval' al enum si falta
do $$ begin
  begin
    alter type app.proposal_status add value if not exists 'pending_approval';
  exception when others then null;
  end;
end $$;

-- 2) Plan elegido y aprobación a nivel propuesta
alter table public.proposals
  add column if not exists chosen_plan_type        app.pricing_plan_type,
  add column if not exists chosen_duration_months  integer,
  add column if not exists requires_approval       boolean not null default false,
  add column if not exists approved_by             uuid references auth.users(id),
  add column if not exists approved_at             timestamptz;

-- 3) Configuración por línea (instalación / mantenimiento / fianza / 1ª cuota)
alter table public.proposal_items
  add column if not exists installation_included      boolean not null default true,
  add column if not exists installation_price_cents   integer,
  add column if not exists maintenance_included       boolean not null default false,
  add column if not exists maintenance_until_date     date,
  add column if not exists maintenance_price_cents    integer,
  add column if not exists maintenance_periodicity_months integer,
  add column if not exists deposit_cents              integer,
  add column if not exists charge_first_payment_now   boolean not null default false;

comment on column public.proposals.chosen_plan_type is
  'Plan único elegido para TODA la propuesta. Si el cliente quiere otro plan, se hace propuesta nueva (variante).';
comment on column public.proposals.requires_approval is
  'true si alguna cuota/precio cae por debajo del mínimo autorizado. Bloquea envío hasta que nivel 1/2 lo apruebe.';
comment on column public.proposal_items.charge_first_payment_now is
  'Solo alquiler: si true, la 1ª cuota se cobra al firmar contrato y queda registrada en wallet; el cliente paga N-1 cuotas restantes a partir del mes siguiente.';
