-- =============================================================================
-- 20260604100500_certifications_catalog.sql
-- Fase 1 del Plan Productos v2.
-- Catálogo global de certificaciones del sector tratamiento de agua.
-- Seed con las 18 más frecuentes (basado en investigación de fichas técnicas
-- BWT / Cillit / Pentair / Kinetico / Culligan / Hidrowater / Atlas Filtri /
-- Lenntech, 2026-06-03).
-- =============================================================================

create table if not exists public.certifications_catalog (
  key            text primary key,                          -- "ce", "nsf_58", "acs_fr", ...
  name_es        text not null,
  category       text not null check (category in (
    'eu', 'es', 'usa', 'country_eu', 'iso', 'sector'
  )),
  description_es text,
  logo_url       text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Seed solo si la tabla está vacía (idempotente).
insert into public.certifications_catalog (key, name_es, category, description_es, sort_order)
select key, name_es, category, description_es, sort_order from (values
  -- UE
  ('ce',             'Marcado CE',                                       'eu', 'Conformidad europea (Directivas 2014/30/UE EMC y 2014/35/UE Baja Tensión).',         10),
  ('rohs',           'RoHS 2011/65/UE',                                  'eu', 'Restricción de sustancias peligrosas en equipos eléctricos.',                       20),
  ('regl_10_2011',   'Reglamento UE 10/2011',                            'eu', 'Materiales y objetos plásticos en contacto con alimentos.',                         30),
  -- España
  ('rd_3_2023',      'RD 3/2023',                                        'es', 'Criterios técnico-sanitarios del agua de consumo humano (transpone Directiva (UE) 2020/2184).', 40),
  -- País-EU
  ('acs_fr',         'ACS (Francia)',                                    'country_eu', 'Attestation de Conformité Sanitaire — materiales en contacto con agua de consumo. Validez 5 años.', 50),
  ('dvgw_de',        'DVGW (Alemania)',                                  'country_eu', 'Asociación alemana del gas y agua. Normas W270/W534.',                     60),
  ('ktw_de',         'KTW-BWGL (Alemania)',                              'country_eu', 'Materiales en contacto con agua de consumo, Alemania.',                    70),
  ('wras_uk',        'WRAS (Reino Unido)',                               'country_eu', 'Water Regulations Advisory Scheme — BS 6920-1.',                           80),
  ('kiwa_nl',        'KIWA (Países Bajos)',                              'country_eu', 'BRL-K17504. Ampliamente aceptada en UE.',                                  90),
  -- USA (frecuentes también en EU para OI y dispensadores)
  ('nsf_42',         'NSF/ANSI 42',                                      'usa', 'Efectos estéticos del agua: cloro, sabor, olor, partículas.',                      100),
  ('nsf_53',         'NSF/ANSI 53',                                      'usa', 'Efectos en salud: plomo, COVs, quistes, cromo VI, arsénico V, mercurio, amianto.', 110),
  ('nsf_58',         'NSF/ANSI 58',                                      'usa', 'Sistemas de ósmosis inversa para agua potable. Incluye reducción TDS.',            120),
  ('nsf_55a',        'NSF/ANSI 55 Clase A',                              'usa', 'Esterilizadores UV — desinfección (40 mJ/cm² mínimo).',                            130),
  ('nsf_55b',        'NSF/ANSI 55 Clase B',                              'usa', 'Esterilizadores UV — tratamiento complementario (16 mJ/cm² mínimo).',              140),
  ('nsf_401',        'NSF/ANSI 401',                                     'usa', 'Contaminantes emergentes (fármacos, BPA, pesticidas).',                            150),
  ('nsf_372',        'NSF/ANSI 372',                                     'usa', '"Lead Free" — restricción de plomo en componentes.',                               160),
  -- ISO / gestión
  ('iso_9001',       'ISO 9001',                                         'iso', 'Sistema de gestión de calidad.',                                                    170),
  ('iso_14001',      'ISO 14001',                                        'iso', 'Sistema de gestión medioambiental.',                                                180),
  ('iso_22000',      'ISO 22000 / HACCP',                                'iso', 'Seguridad alimentaria — para línea Horeca / vending.',                              190)
) as defaults(key, name_es, category, description_es, sort_order)
where not exists (select 1 from public.certifications_catalog);

alter table public.certifications_catalog enable row level security;

-- Catálogo global: lectura todos los autenticados, escritura solo superadmin.
drop policy if exists cc_read on public.certifications_catalog;
create policy cc_read on public.certifications_catalog
  for select to authenticated using (true);

drop policy if exists cc_write_super on public.certifications_catalog;
create policy cc_write_super on public.certifications_catalog
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

comment on table public.certifications_catalog is
  'Catálogo global de certificaciones del sector agua. Seed inicial 2026-06-04 con 19 entradas. Editable solo por superadmin.';

notify pgrst, 'reload schema';
