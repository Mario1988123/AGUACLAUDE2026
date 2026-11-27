-- Infinity Basic: FUENTE, FUENTE DE PIE y REGULAR se unifican en DISPENSADOR
-- (Mario 2026-11-27). Ninguna estaba en equipos de clientes ni en stock; solo
-- FUENTE DE PIE tenía 3 líneas de prueba gratuita, por eso es la que se queda.
-- Antes: FUENTE 7b653a77-d1ec-4ee0-8f0c-a62b7eb1d594, REGULAR 762e2116-2205-4495-aa68-3421780140b2,
--        FUENTE DE PIE e5e199a3-cdd5-4933-b774-16b566d42393 (gama f09d4a71 «Infinity Basic»).
update public.products set name = 'DISPENSADOR', updated_at = now()
 where id = 'e5e199a3-cdd5-4933-b774-16b566d42393' and name = 'FUENTE DE PIE';

update public.products set deleted_at = now(), is_active = false, updated_at = now()
 where id in ('7b653a77-d1ec-4ee0-8f0c-a62b7eb1d594', '762e2116-2205-4495-aa68-3421780140b2')
   and deleted_at is null;

update public.stock_alerts set status = 'dismissed', dismissed_at = now()
 where product_id in ('7b653a77-d1ec-4ee0-8f0c-a62b7eb1d594', '762e2116-2205-4495-aa68-3421780140b2')
   and status = 'active';
