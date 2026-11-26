-- Mario (26-11): portafiltros y portamembranas de Osmofilter pasan a accesorio en el maestro (sin subir version).
update public.catalog_products set kind = 'accessory'
 where supplier_reference in ('RO6029','RO6030','VF1016','VF1017','VF1051','VF1062') and kind = 'equipment';
