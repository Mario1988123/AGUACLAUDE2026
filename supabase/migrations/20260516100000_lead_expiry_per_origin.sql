-- =============================================================================
-- Lead expiry diferenciado por origen (TMK vs comercial)
-- =============================================================================
-- Decisión usuario 2026-05-09:
--  - Leads con origin='tmk' caducan a los 15 días por defecto.
--  - Leads creados por comercial (cualquier otro origen) caducan a 30 días.
--  - Al caducar: status='expired' Y se desasigna (assigned_user_id=null)
--    para que vuelva al pool de niveles 1/2.
--  - Se registra evento 'lead.unassigned_by_expiry' con previous user
--    para que el timeline conserve el historial.
-- =============================================================================

alter table public.company_settings
  add column if not exists lead_expiry_days_tmk integer not null default 15
    check (lead_expiry_days_tmk > 0),
  add column if not exists lead_expiry_days_commercial integer not null default 30
    check (lead_expiry_days_commercial > 0);

comment on column public.company_settings.lead_expiry_days_tmk is
  'Días desde assigned_at hasta caducar para leads de origen TMK. Default 15.';
comment on column public.company_settings.lead_expiry_days_commercial is
  'Días desde assigned_at hasta caducar para leads creados por comercial. Default 30.';

-- El antiguo lead_expiry_days queda como fallback solo si las nuevas columnas
-- no se han poblado (no debería pasar). No lo borramos para no romper código
-- existente.

notify pgrst, 'reload schema';
