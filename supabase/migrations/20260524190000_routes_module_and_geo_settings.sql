-- =============================================================================
-- 20260524190000_routes_module_and_geo_settings.sql
-- Bloque D + parte de B del plan 2026-05-24:
--  · Registra módulo "routes" en modules_catalog (rutas con IA, opcional
--    por empresa). Si OFF: /mi-dia solo cronológico, /rutas oculto.
--    Si ON: optimización + vista equipo. Calidad por Routes API solo si
--    además gmaps_features.smart_routes está activo.
--  · Añade settings de anti-fraude geo en company_settings:
--      geo_max_distance_start_m  (default 200) — al iniciar parte, si dist
--                                                a la dirección > N → warning
--      geo_off_road_threshold_m  (default 300) — Roads API: si snap > N,
--                                                event installation.geo_off_road
-- =============================================================================

-- Módulo Rutas con IA
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order)
values (
  'routes',
  'Rutas con IA',
  'Optimización de rutas diarias (instalaciones, mantenimientos, incidencias, visitas comerciales). Vista equipo para directores. Algoritmo local gratis; con Routes API de Google = ruta con tráfico real.',
  'map',
  false,           -- por defecto inactivo: add-on opt-in
  false,           -- no es core
  false,
  160
)
on conflict (key) do update set
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  icon = excluded.icon,
  is_parked = excluded.is_parked,
  sort_order = excluded.sort_order;

-- Settings anti-fraude geolocalización (global por empresa)
alter table public.company_settings
  add column if not exists geo_max_distance_start_m integer not null default 200,
  add column if not exists geo_off_road_threshold_m integer not null default 300;

comment on column public.company_settings.geo_max_distance_start_m is
  'Distancia máxima (m) entre la posición GPS del instalador al iniciar parte y la dirección registrada. Si se supera, se notifica al admin pero NO se bloquea (anti-fraude soft).';

comment on column public.company_settings.geo_off_road_threshold_m is
  'Umbral (m) del snap-to-roads de Google al cerrar instalación. Si el snap supera este valor, se registra event installation.geo_off_road para revisión manual.';

notify pgrst, 'reload schema';
