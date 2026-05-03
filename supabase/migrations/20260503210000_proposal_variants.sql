-- =============================================================================
-- 20260503210000_proposal_variants.sql
-- Variantes de propuesta (comparador A / B / C). Las propuestas con el mismo
-- variant_group_id son variantes de un mismo paquete. Cuando una se acepta,
-- las hermanas se marcan como superseded automáticamente desde la app.
-- =============================================================================

alter table public.proposals
  add column if not exists variant_group_id uuid,
  add column if not exists variant_label    text;

create index if not exists idx_proposals_variant_group
  on public.proposals(company_id, variant_group_id)
  where variant_group_id is not null;

comment on column public.proposals.variant_group_id is
  'Agrupa varias propuestas como variantes (A/B/C) de la misma oferta. Al aceptar una, las hermanas pasan a superseded.';
comment on column public.proposals.variant_label is
  'Etiqueta corta para distinguir la variante: "A", "B", "Premium", "Económico"…';
