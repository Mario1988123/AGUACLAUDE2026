-- Mario (27-11): Infinity pasa a la plantilla de ficha técnica «Tarifa». Antes: standard.
update public.company_settings set datasheet_template = 'tarifa' where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c' and datasheet_template is distinct from 'tarifa';
