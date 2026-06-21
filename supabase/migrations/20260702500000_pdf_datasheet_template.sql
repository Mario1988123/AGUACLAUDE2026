-- =============================================================================
-- 20260702500000_pdf_datasheet_template.sql
-- Plantillas de ficha técnica (PDF) por empresa + colores + auto-IAGUA.
--
--   · company_settings.datasheet_template → 'standard' | 'iagua'
--   · company_settings.pdf_accent_color   → color de acento (el base ya existe
--     en pdf_brand_color). El acento se puede sobreescribir por producto con
--     products.datasheet_color_accent (ya existente).
--   · products.datasheet_extra (jsonb) → contenido editable de la página 2 de
--     IAGUA por producto: { hero_heading, features:[{title,desc}],
--     why:[...], ideal:[{title,desc}], badge:{label,desc} }.
--
-- Auto-activa IAGUA en la empresa infinityaqua (si existe). Resto: 'standard'.
-- Idempotente, aditivo.
-- =============================================================================

alter table public.company_settings
  add column if not exists datasheet_template text not null default 'standard';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_datasheet_template_check'
  ) then
    alter table public.company_settings
      add constraint company_settings_datasheet_template_check
      check (datasheet_template in ('standard', 'iagua'));
  end if;
end $$;

alter table public.company_settings
  add column if not exists pdf_accent_color text;

alter table public.products
  add column if not exists datasheet_extra jsonb;

-- Auto-activar IAGUA en infinityaqua (por slug o por nombre, tolerante).
insert into public.company_settings (company_id, datasheet_template)
select id, 'iagua'
from public.companies
where slug = 'infinityaqua'
   or lower(replace(name, ' ', '')) like '%infinityaqua%'
on conflict (company_id) do update set datasheet_template = 'iagua';

notify pgrst, 'reload schema';
