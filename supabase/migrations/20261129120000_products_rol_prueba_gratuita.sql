-- =============================================================================
-- 20261129120000_products_rol_prueba_gratuita.sql
-- Pruebas gratuitas (Mario 2026-11-26): marcar con un clic, en la ficha del
-- producto, qué productos se pueden elegir en una prueba gratuita.
--
-- NO cambia el esquema: la marca es un papel más en products.roles
-- (text[] sin CHECK, migración 20260609110000), el valor 'free_trial_role'.
-- El código ya funciona sin esta migración; aquí solo se documenta el valor
-- nuevo en el comentario de la columna.
--
-- Mientras una empresa no marque ningún producto, el alta de la prueba sigue
-- ofreciendo todos (y avisa). No se marca nada de oficio: lo marca el admin.
-- =============================================================================

comment on column public.products.roles is
  'Papeles ADICIONALES del producto (además de kind): sellable_standalone, configurator_extra, spare_part_role, accessory_role, free_trial_role (se puede elegir en una prueba gratuita).';
