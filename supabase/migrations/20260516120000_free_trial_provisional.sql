-- =============================================================================
-- Pruebas gratuitas: distinguir instalación provisional vs definitiva
-- =============================================================================
-- Decisión usuario 2026-05-09:
--  - "Provisional": el comercial deja el equipo conectado de cualquier
--    manera para que el cliente lo pruebe. Si acepta, hay que reubicar
--    bien antes de validar el contrato.
--  - "Definitiva": instalación profesional desde el principio. Si acepta,
--    no hay que volver a tocar nada — solo validar el contrato.
-- =============================================================================

alter table public.free_trials
  add column if not exists is_provisional_install boolean not null default false;

comment on column public.free_trials.is_provisional_install is
  'Si true, la instalación de la prueba es provisional (cualquier conexión rápida). Al aceptar habrá que reubicar/instalar definitivamente. Default false (definitiva).';

notify pgrst, 'reload schema';
