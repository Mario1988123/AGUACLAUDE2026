-- ============================================================================
-- Columnas que el código escribe y que NO existen en producción (2026-09-10)
-- ----------------------------------------------------------------------------
-- Encontradas contrastando cada .insert()/.update() del código contra
-- information_schema de la base real. Las dos hacen fallar el UPDATE/INSERT
-- entero (PostgREST 42703/PGRST204), así que la función que las usa no ha
-- funcionado nunca en producción:
--
--   · contracts.validated_at                        → validar un contrato
--     devolvía error siempre (el código ya tiene reintento sin la columna).
--   · company_settings.proposal_default_validity_days → el admin cambiaba la
--     validez por defecto de las propuestas y no se guardaba, sin avisar.
--
-- Aditiva y idempotente: no toca datos ni rompe nada si ya existieran.
-- ============================================================================

alter table public.contracts
  add column if not exists validated_at timestamptz;

comment on column public.contracts.validated_at is
  'Cuándo se validó el contrato firmado. Pareja de validated_by_user_id.';

alter table public.company_settings
  add column if not exists proposal_default_validity_days integer;

comment on column public.company_settings.proposal_default_validity_days is
  'Días de validez por defecto de una propuesta nueva. NULL = 30 (default del código).';
