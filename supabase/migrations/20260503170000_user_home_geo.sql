-- =============================================================================
-- 20260503170000_user_home_geo.sql
-- Añade coordenadas "base" del usuario (técnico/comercial) usadas como
-- punto de partida en el optimizador de rutas Haversine.
-- =============================================================================

alter table public.user_profiles
  add column if not exists home_latitude  numeric(10,7),
  add column if not exists home_longitude numeric(10,7);

comment on column public.user_profiles.home_latitude is
  'Latitud del punto de partida del usuario (su domicilio o sede). Usado por el optimizador de rutas.';
comment on column public.user_profiles.home_longitude is
  'Longitud del punto de partida del usuario.';
