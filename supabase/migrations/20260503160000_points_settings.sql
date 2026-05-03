-- =============================================================================
-- 20260503160000_points_settings.sql
-- Configuración del programa de puntos por empresa + columnas polimórficas
-- en points_ledger para soportar maintenance/incident/lead_captured además
-- de los enlaces existentes (contract_id, sales_record_id, installation_id).
--
-- NO crea tablas nuevas. Reutiliza points_ledger existente (parked_modules).
-- =============================================================================

-- 1) Config jsonb en company_settings
alter table public.company_settings
  add column if not exists points_settings jsonb not null default '{}'::jsonb;

comment on column public.company_settings.points_settings is
  'Configuración del programa de puntos. Estructura: {points_lead_captured, points_per_equipment_sold, tmk_split_percent, discount_penalty_percent, points_per_installation, points_per_maintenance, points_per_incident}';

-- 2) Polimórfico opcional en points_ledger para subjects no contemplados
alter table public.points_ledger
  add column if not exists subject_type text,
  add column if not exists subject_id   uuid,
  add column if not exists metadata     jsonb not null default '{}'::jsonb;

create index if not exists idx_pl_subject on public.points_ledger(subject_type, subject_id);

-- 3) Defaults razonables (función para sembrar)
create or replace function app.get_default_points_settings()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'points_lead_captured', 5,
    'points_per_equipment_sold', 50,
    'tmk_split_percent', 20,
    'discount_penalty_percent', 50,
    'points_per_installation', 30,
    'points_per_maintenance', 15,
    'points_per_incident', 20
  );
$$;

-- 4) RLS — points_ledger ya tiene policies del módulo aparcado.
-- Confirmamos que el usuario puede leer sus propios asientos y los managers
-- pueden leer los de su equipo (heredamos las policies existentes).
