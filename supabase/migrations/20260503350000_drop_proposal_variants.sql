-- =============================================================================
-- 20260503350000_drop_proposal_variants.sql
-- Retira las columnas de variantes de propuesta. La feature se eliminó
-- (decisión usuario): para ofrecer dos opciones se crean dos propuestas
-- separadas y el cliente acepta una.
-- =============================================================================

alter table public.proposals
  drop column if exists variant_group_id,
  drop column if exists variant_label;
