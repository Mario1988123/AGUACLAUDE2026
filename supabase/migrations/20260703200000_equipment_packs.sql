-- =============================================================================
-- 20260703200000_equipment_packs.sql
-- PACKS de equipos: 1 equipo PRINCIPAL + N EXTRAS (ej. ósmosis + enfriador + grifo).
--
-- Enfoque (Plan packs 2026-07-02): reutilizar la cadena que YA es multi-producto
-- (proposal_items → contract_items → installation_items → customer_equipment) y el
-- motor de stock por línea. Solo falta un VÍNCULO padre-hijo para no perder que un
-- extra "pertenece" a un equipo principal, y declarar QUÉ extras admite cada
-- equipo (por categoría y/o por equipo concreto) reutilizando el rol de producto
-- `configurator_extra` que ya existe.
--
-- ADITIVA: solo añade columnas/tablas nullable. No cambia el comportamiento actual
-- (parent_item_id/parent_equipment_id quedan NULL en todo lo existente = línea suelta).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Vínculo padre-hijo en las tablas de líneas de la cadena de venta/instalación.
--    NULL = línea principal o suelta. Con valor = extra que cuelga de esa línea.
--    on delete cascade: si se borra la línea principal del pack, sus extras se van
--    con ella (están dentro del mismo agregado propuesta/contrato/instalación).
-- -----------------------------------------------------------------------------
alter table public.proposal_items
  add column if not exists parent_item_id uuid
  references public.proposal_items(id) on delete cascade;

alter table public.contract_items
  add column if not exists parent_item_id uuid
  references public.contract_items(id) on delete cascade;

alter table public.installation_items
  add column if not exists parent_item_id uuid
  references public.installation_items(id) on delete cascade;

create index if not exists idx_proposal_items_parent
  on public.proposal_items(parent_item_id) where parent_item_id is not null;
create index if not exists idx_contract_items_parent
  on public.contract_items(parent_item_id) where parent_item_id is not null;
create index if not exists idx_installation_items_parent
  on public.installation_items(parent_item_id) where parent_item_id is not null;

comment on column public.proposal_items.parent_item_id is
  'Pack: si NO es null, esta línea es un EXTRA que cuelga del proposal_item principal indicado. NULL = principal/suelto.';
comment on column public.contract_items.parent_item_id is
  'Pack: si NO es null, esta línea es un EXTRA del contract_item principal indicado. NULL = principal/suelto.';
comment on column public.installation_items.parent_item_id is
  'Pack: si NO es null, esta línea es un EXTRA del installation_item principal indicado. NULL = principal/suelto.';

-- -----------------------------------------------------------------------------
-- 2) Vínculo padre-hijo en el equipo del cliente (el resultado final del pack).
--    on delete set null: si el equipo principal se borrase físicamente, el extra
--    NO se elimina (la baja real del cliente es soft, is_active=false, y se
--    gestiona en aplicación con cascada opcional). Evita perder equipos por error.
-- -----------------------------------------------------------------------------
alter table public.customer_equipment
  add column if not exists parent_equipment_id uuid
  references public.customer_equipment(id) on delete set null;

create index if not exists idx_customer_equipment_parent
  on public.customer_equipment(company_id, parent_equipment_id)
  where parent_equipment_id is not null;

comment on column public.customer_equipment.parent_equipment_id is
  'Pack: si NO es null, este equipo es un EXTRA que pertenece al equipo principal indicado. NULL = principal/suelto.';

-- -----------------------------------------------------------------------------
-- 3) Compatibilidad de extras: un producto marcado como extra (rol
--    configurator_extra) declara de qué CATEGORÍA(S) y/o de qué EQUIPO(S)
--    concreto(s) es extra. FKs duras (no polimórfico), como el resto del modelo.
--    Exactamente uno de los dos objetivos por fila (categoría XOR equipo).
-- -----------------------------------------------------------------------------
create table if not exists public.product_extra_targets (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  extra_product_id            uuid not null references public.products(id) on delete cascade,
  target_category_id          uuid references public.product_categories(id) on delete cascade,
  target_equipment_product_id uuid references public.products(id) on delete cascade,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  -- categoría XOR equipo: exactamente uno relleno
  check (
    (target_category_id is null)::int + (target_equipment_product_id is null)::int = 1
  )
);

-- Dedup: un mismo extra no repite el mismo objetivo (categoría o equipo).
create unique index if not exists uq_extra_target_category
  on public.product_extra_targets(company_id, extra_product_id, target_category_id)
  where target_category_id is not null;
create unique index if not exists uq_extra_target_equipment
  on public.product_extra_targets(company_id, extra_product_id, target_equipment_product_id)
  where target_equipment_product_id is not null;

create index if not exists idx_extra_targets_extra
  on public.product_extra_targets(company_id, extra_product_id);
create index if not exists idx_extra_targets_category
  on public.product_extra_targets(company_id, target_category_id)
  where target_category_id is not null;
create index if not exists idx_extra_targets_equipment
  on public.product_extra_targets(company_id, target_equipment_product_id)
  where target_equipment_product_id is not null;

alter table public.product_extra_targets enable row level security;
alter table public.product_extra_targets force row level security;

drop policy if exists extra_targets_super on public.product_extra_targets;
create policy extra_targets_super on public.product_extra_targets for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists extra_targets_select_tenant on public.product_extra_targets;
create policy extra_targets_select_tenant on public.product_extra_targets for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists extra_targets_modify on public.product_extra_targets;
create policy extra_targets_modify on public.product_extra_targets for all to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('technical_director')
         or app.has_role('commercial_director'))
  )
  with check (company_id = app.current_company_id());

comment on table public.product_extra_targets is
  'Compatibilidad de EXTRAS del configurador de packs: cada fila declara que el producto extra_product_id (rol configurator_extra) se ofrece como extra de una categoría (target_category_id) o de un equipo concreto (target_equipment_product_id).';

notify pgrst, 'reload schema';
