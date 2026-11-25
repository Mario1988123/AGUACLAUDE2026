-- =============================================================================
-- 20261127100000_pack_complemento.sql
-- Plan docs/PLAN_HORECA_COMPLEMENTO.md, fase F2, opción A (respuestas de Mario
-- del 2026-11-25): Horeca + ósmosis/UF en el mismo pack.
--
-- 1) `pack_role` en las tres tablas de líneas y en customer_equipment:
--      null          = como hoy (principal o extra, según parent_item_id).
--      'extra'       = accesorio del pack (grifo, enfriador…).
--      'complemento' = el otro equipo del pack (la ósmosis/UF de un Horeca o el
--                      Horeca de una ósmosis). Va incluido en el precio del
--                      principal, sin cuota propia, y se retira y se traspasa
--                      con él.
-- 2) `product_extra_targets.relacion` ('extra' por defecto | 'complemento').
-- 3) `product_categories_global.complementa_keys`: claves de categoría global
--    con las que se complementa (admite comodín final, p. ej. 'osmosis*').
-- 4) Tipo de equipo 'horeca': equipo identificable SIN mantenimiento propio
--    (ni visitas ni precio de mantenimiento). La UF se trata como 'osmosis'.
--    Se relajan los CHECK; relajar no invalida ninguna fila existente.
--
-- ADITIVA e IDEMPOTENTE. No toca datos: todo lo existente queda en null /
-- 'extra', que es el comportamiento de hoy (Infinity no cambia).
-- NO APLICADA: la aplica Mario. El código tolera que falte.
-- =============================================================================

-- 1) Rol dentro del pack ------------------------------------------------------
alter table public.proposal_items     add column if not exists pack_role text;
alter table public.contract_items     add column if not exists pack_role text;
alter table public.installation_items add column if not exists pack_role text;
alter table public.customer_equipment add column if not exists pack_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'proposal_items_pack_role_chk') then
    alter table public.proposal_items add constraint proposal_items_pack_role_chk
      check (pack_role is null or pack_role in ('extra', 'complemento'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_items_pack_role_chk') then
    alter table public.contract_items add constraint contract_items_pack_role_chk
      check (pack_role is null or pack_role in ('extra', 'complemento'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'installation_items_pack_role_chk') then
    alter table public.installation_items add constraint installation_items_pack_role_chk
      check (pack_role is null or pack_role in ('extra', 'complemento'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_pack_role_chk') then
    alter table public.customer_equipment add constraint ce_pack_role_chk
      check (pack_role is null or pack_role in ('extra', 'complemento'));
  end if;
end $$;

comment on column public.proposal_items.pack_role is
  'Pack: null = como hoy; extra = accesorio del principal; complemento = el otro equipo del pack (ósmosis/UF de un Horeca o al revés), incluido en el precio del principal.';
comment on column public.contract_items.pack_role is
  'Pack: null = como hoy; extra | complemento. Se copia de proposal_items.';
comment on column public.installation_items.pack_role is
  'Pack: null = como hoy; extra | complemento. Se copia de contract_items.';
comment on column public.customer_equipment.pack_role is
  'Pack: null = como hoy; extra | complemento. Un complemento se retira y se traspasa con su principal; se puede sustituir solo esa parte.';

-- 2) Relación de la regla de compatibilidad -----------------------------------
alter table public.product_extra_targets
  add column if not exists relacion text not null default 'extra';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_extra_targets_relacion_chk') then
    alter table public.product_extra_targets add constraint product_extra_targets_relacion_chk
      check (relacion in ('extra', 'complemento'));
  end if;
end $$;

comment on column public.product_extra_targets.relacion is
  'extra = el producto se ofrece como extra del objetivo; complemento = se ofrece como equipo complementario (Horeca ↔ ósmosis/UF).';

-- 3) Complementos por categoría global ----------------------------------------
alter table public.product_categories_global
  add column if not exists complementa_keys text[];

comment on column public.product_categories_global.complementa_keys is
  'Claves de categoría global con las que esta categoría forma pack de complemento (vale en las dos direcciones). Un * final es comodín: osmosis* = osmosis y sus hijas.';

-- 4) Tipo de equipo 'horeca' ---------------------------------------------------
-- Nombres reales de los CHECK (20261113090000_modelo_equipo_cliente.sql):
-- product_categories_tipo_equipo_chk, products_tipo_equipo_chk, ce_tipo_equipo_chk.
-- Se reescriben solo si todavía no admiten 'horeca' (idempotente).
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'product_categories_tipo_equipo_chk'
       and conrelid = 'public.product_categories'::regclass
       and pg_get_constraintdef(oid) not like '%horeca%'
  ) then
    alter table public.product_categories drop constraint product_categories_tipo_equipo_chk;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_categories_tipo_equipo_chk') then
    alter table public.product_categories add constraint product_categories_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis', 'horeca'));
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'products_tipo_equipo_chk'
       and conrelid = 'public.products'::regclass
       and pg_get_constraintdef(oid) not like '%horeca%'
  ) then
    alter table public.products drop constraint products_tipo_equipo_chk;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_tipo_equipo_chk') then
    alter table public.products add constraint products_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis', 'horeca'));
  end if;

  if exists (
    select 1 from pg_constraint
     where conname = 'ce_tipo_equipo_chk'
       and conrelid = 'public.customer_equipment'::regclass
       and pg_get_constraintdef(oid) not like '%horeca%'
  ) then
    alter table public.customer_equipment drop constraint ce_tipo_equipo_chk;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_tipo_equipo_chk') then
    alter table public.customer_equipment add constraint ce_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis', 'horeca'));
  end if;
end $$;

comment on column public.product_categories.tipo_equipo is
  'fuente | osmosis | horeca | null (no es equipo principal). Lo hereda el producto si no fija el suyo. horeca = equipo identificable sin mantenimiento propio; la UF cuenta como osmosis.';
comment on column public.products.tipo_equipo is
  'fuente | osmosis | horeca. Manda sobre el de la gama y el de la categoría. horeca no recibe visitas ni precio de mantenimiento.';

notify pgrst, 'reload schema';
