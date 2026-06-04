-- =============================================================================
-- 20260604100700_product_attributes_is_critical.sql
-- Fase 1 del Plan Productos v2.
-- Añade flag `is_critical` a los catálogos de atributos. Si un atributo crítico
-- está vacío al generar ficha técnica, el PDF se genera igualmente pero
-- aparece un banner amarillo arriba a admin (no bloquea, según decisión usuario
-- 2026-06-04). Banner se descarta con product_alerts_dismissed.
-- =============================================================================

alter table public.product_attributes_global
  add column if not exists is_critical boolean not null default false;

alter table public.product_attributes
  add column if not exists is_critical boolean not null default false;

comment on column public.product_attributes_global.is_critical is
  'Atributo clave del sector para este tipo de producto (ej. caudal nominal en ósmosis, dureza máx en descalcificador). Si falta el valor en un producto, la ficha técnica generada muestra banner de aviso a admin.';

notify pgrst, 'reload schema';
