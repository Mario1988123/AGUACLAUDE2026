-- ============================================================================
-- Agenda — sugerencia de fechas por radio de ruta
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-19 (capa 3 reserva horas):
--   Al agendar una instalación, sugerimos días donde el técnico tiene OTRAS
--   instalaciones cerca (≤ X km) — así optimizamos rutas. Configurable por
--   empresa. Si una dirección no tiene lat/lng la sugerencia se omite.
-- ============================================================================

alter table public.company_settings
  add column if not exists scheduling_max_route_radius_km int default 15;

comment on column public.company_settings.scheduling_max_route_radius_km is
  'Radio en km para considerar dos instalaciones "en la misma ruta". Si el cliente nuevo está a ≤ X km de otra instalación del técnico ese día, sugerimos esa fecha. Default 15 km.';

notify pgrst, 'reload schema';
