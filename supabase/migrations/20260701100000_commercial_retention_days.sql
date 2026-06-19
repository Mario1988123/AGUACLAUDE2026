-- =============================================================================
-- 20260701100000_commercial_retention_days.sql
-- Plan "duración de cliente para el comercial" (2026-06-19).
--
-- El admin define cuántos días un comercial (sales_rep, nivel 3) sigue VIENDO
-- a un cliente al que le ha vendido, para poder recontactarlo y ofrecerle
-- futuras ventas. Por defecto 0 = DESACTIVADO (comportamiento actual: el
-- comercial solo ve sus clientes asignados). Un valor N>0 = el comercial
-- también ve, durante N días tras la firma del contrato, a los clientes que
-- vendió aunque ya no estén asignados a él.
-- =============================================================================

alter table public.company_settings
  add column if not exists commercial_retention_days integer not null default 0;

comment on column public.company_settings.commercial_retention_days is
  'Días que un comercial (sales_rep) sigue viendo a un cliente tras venderle (firma de contrato). 0 = desactivado. Solo amplía visibilidad, nunca la reduce.';

notify pgrst, 'reload schema';
