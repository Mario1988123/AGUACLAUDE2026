-- Borra la categoría vacía «Equipos con gas» de Infinity (Mario, 2026-11-25). Copia: respaldo-equipos-con-gas-2026-11-25.json
delete from public.product_categories where id = 'c1a3d861-d141-4bd6-93ef-507f59021868' and company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c' and not exists (select 1 from public.products where category_id = 'c1a3d861-d141-4bd6-93ef-507f59021868');
