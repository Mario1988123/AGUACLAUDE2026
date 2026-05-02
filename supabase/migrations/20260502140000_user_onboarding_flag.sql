-- =============================================================================
-- 20260502140000_user_onboarding_flag.sql
-- Placeholder para futuro tour onboarding (Driver.js o vídeo embebido).
-- Sólo añade columna; el usuario lo activará cuando se implemente el tour.
-- =============================================================================

alter table public.user_profiles
  add column if not exists has_seen_onboarding boolean not null default false,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_profiles.has_seen_onboarding is
  'true cuando el usuario ha completado o saltado el tour inicial del CRM.';
