-- Corrige en el catálogo MAESTRO medidas y pesos erróneos con los datos de Osmofilter (Mario, 2026-11-25).
-- No sube version: ninguna empresa recibe aviso; los productos de las empresas no se tocan.
-- Valores anteriores: RO1073P 40×40×445 mm, 10 g · FRO1046 fondo 410 mm, 10 g · RO5064 alto 410 mm.
update public.catalog_products set dim_width_mm = 153, dim_height_mm = 333, dim_depth_mm = 461, weight_grams = 8700
 where supplier_reference = 'RO1073P' and dim_width_mm = 40 and dim_height_mm = 40 and dim_depth_mm = 445 and weight_grams = 10;
update public.catalog_products set dim_depth_mm = 400, weight_grams = 15800
 where supplier_reference = 'FRO1046' and dim_depth_mm = 410 and weight_grams = 10;
update public.catalog_products set dim_height_mm = 415
 where supplier_reference = 'RO5064' and dim_height_mm = 410;
