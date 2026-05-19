-- ============================================================================
-- Módulo RRSS — calendario editorial + efemérides + posts multicanal
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-19: añadir módulo "RRSS" al CRM para
-- automatizar generación de contenido (Instagram, Facebook, LinkedIn,
-- Google Business, TikTok, Blog, Newsletter) con campañas multi-fase
-- por efemérides oficiales (UN/UNESCO/OMS/FAO/UNEP).
--
-- Tablas:
--   social_ephemerides     catálogo de efemérides (compartido, sin company_id)
--   social_settings        ajustes del módulo por empresa
--   social_channels        canales activos por empresa
--   social_campaigns       campañas multi-fase (3 fases típicas)
--   social_posts           publicaciones individuales programadas
--   social_post_metrics    métricas post-publicación
-- ============================================================================

-- =========================================================================
-- 1. social_ephemerides — catálogo global (no por empresa)
-- =========================================================================
create table if not exists public.social_ephemerides (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  month_of_year int not null check (month_of_year between 1 and 12),
  category text not null,
  is_official boolean not null default false,
  official_org text,
  description text,
  hashtags text[] default array[]::text[],
  importance text default 'medium' check (importance in ('high','medium','low')),
  default_campaign_phases int default 3,
  created_at timestamptz not null default now()
);

create index if not exists idx_se_month on public.social_ephemerides(month_of_year, day_of_month);

comment on table public.social_ephemerides is
  'Catálogo de efemérides relevantes (agua, medio ambiente, sequía, océanos, etc.). Compartido entre empresas. Se marca is_official=true solo si UN/UNESCO/OMS/FAO/UNEP/OMI/CMNUCC u otro organismo reconocido la reconoce.';

-- =========================================================================
-- 2. social_settings — ajustes del módulo por empresa
-- =========================================================================
create table if not exists public.social_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  brand_voice text default 'profesional, claro, cercano, educativo',
  primary_color text default '#0ea5e9',
  secondary_color text default '#ffffff',
  accent_color text default '#22c55e',
  visual_style text default 'limpio, profesional, moderno, azul agua, blanco, tonos naturales, sensación de pureza y confianza',
  banned_visual text default 'logos oficiales sin permiso, personas famosas, marcas de terceros, imágenes médicas engañosas, antes/después inventados, agua contaminada de forma desagradable',
  base_hashtags text[] default array[
    '#TratamientoDelAgua', '#AguaPotable', '#CalidadDelAgua', '#Aguaclaude'
  ],
  default_image_format text default '1080x1080',
  ai_prompt_style text,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  weekly_target jsonb default '{
    "instagram": 3,
    "facebook": 3,
    "linkedin": 2,
    "blog": 1,
    "newsletter_per_month": 1
  }'::jsonb,
  autonomous_mode boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 3. social_channels — canales activos por empresa
-- =========================================================================
create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in (
    'instagram','facebook','linkedin','tiktok',
    'google_business','blog','newsletter'
  )),
  is_active boolean not null default true,
  handle text,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, kind)
);

create index if not exists idx_sch_company on public.social_channels(company_id) where is_active = true;

-- =========================================================================
-- 4. social_campaigns — campañas multi-fase (típico 3 fases por efeméride)
-- =========================================================================
create table if not exists public.social_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  ephemeris_id uuid references public.social_ephemerides(id) on delete set null,
  start_at date,
  peak_at date,
  end_at date,
  goal text,
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_sc_company on public.social_campaigns(company_id, status);

-- =========================================================================
-- 5. social_posts — publicaciones individuales
-- =========================================================================
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Programación
  scheduled_at timestamptz not null,
  channel text not null check (channel in (
    'instagram','facebook','linkedin','tiktok',
    'google_business','blog','newsletter'
  )),
  -- Clasificación
  content_type text not null check (content_type in (
    'educational','ephemeris','commercial_soft','technical_authority','local','visual_reel'
  )),
  ephemeris_id uuid references public.social_ephemerides(id) on delete set null,
  campaign_id uuid references public.social_campaigns(id) on delete set null,
  campaign_phase int check (campaign_phase between 1 and 3),
  -- Contenido
  topic text not null,
  copy_main text not null,
  copy_short text,
  copy_linkedin text,
  cta text,
  hashtags text[] default array[]::text[],
  -- Imagen
  image_prompt text,
  image_prompt_alt text,
  image_url text,
  image_alt_text text,
  image_format text default '1080x1080',
  -- Targeting
  target_segment text check (target_segment in ('hogar','empresa','hosteleria','comunidad','administradores','general')),
  intent_level text default 'low' check (intent_level in ('low','medium','high')),
  -- SEO (para blog)
  seo_title text,
  seo_meta_description text,
  seo_excerpt text,
  -- Newsletter
  email_subject text,
  -- Reel
  reel_script text,
  -- Estado
  status text not null default 'draft' check (status in (
    'draft','review','approved','published','failed','cancelled'
  )),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  -- Auditoría
  notes text,
  review_notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sp_company_date on public.social_posts(company_id, scheduled_at);
create index if not exists idx_sp_status on public.social_posts(company_id, status) where status != 'published';
create index if not exists idx_sp_campaign on public.social_posts(campaign_id) where campaign_id is not null;
create index if not exists idx_sp_ephemeris on public.social_posts(ephemeris_id) where ephemeris_id is not null;

-- =========================================================================
-- 6. social_post_metrics — métricas post-publicación
-- =========================================================================
create table if not exists public.social_post_metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  reach int default 0,
  impressions int default 0,
  clicks int default 0,
  comments int default 0,
  shares int default 0,
  saves int default 0,
  likes int default 0,
  leads_generated int default 0,
  conversions int default 0,
  notes text
);

create index if not exists idx_spm_post on public.social_post_metrics(post_id, recorded_at desc);

-- =========================================================================
-- RLS — multi-tenant
-- =========================================================================
alter table public.social_settings enable row level security;
alter table public.social_channels enable row level security;
alter table public.social_campaigns enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_metrics enable row level security;
alter table public.social_ephemerides enable row level security;

-- Ephemerides: lectura para todos los autenticados (catálogo público).
drop policy if exists se_read on public.social_ephemerides;
create policy se_read on public.social_ephemerides for select to authenticated using (true);
drop policy if exists se_super on public.social_ephemerides;
create policy se_super on public.social_ephemerides for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

-- Resto: tenant scope.
do $$
declare t text;
begin
  for t in select unnest(array[
    'social_settings','social_channels','social_campaigns',
    'social_posts','social_post_metrics'
  ]::text[]) loop
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id()) with check (company_id = app.current_company_id())',
      t || '_tenant', t
    );
  end loop;
end $$;

-- =========================================================================
-- SEED — catálogo de efemérides oficiales (UN/UNESCO/OMS/FAO/UNEP/OMI…)
-- =========================================================================
insert into public.social_ephemerides
  (slug, name, day_of_month, month_of_year, category, is_official, official_org, description, hashtags, importance) values
  -- ENERO
  ('dia-mundial-de-la-educacion-ambiental', 'Día Mundial de la Educación Ambiental', 26, 1, 'medio_ambiente', false, null, 'Fecha de concienciación no oficial: importancia de la educación para la sostenibilidad.', array['#EducacionAmbiental','#MedioAmbiente'], 'medium'),
  -- FEBRERO
  ('dia-mundial-de-los-humedales', 'Día Mundial de los Humedales', 2, 2, 'agua', true, 'Convención Ramsar / ONU', 'Conmemora la firma de la Convención Ramsar (1971) sobre humedales de importancia internacional.', array['#DiaMundialDeLosHumedales','#Humedales','#Ramsar'], 'high'),
  ('dia-mundial-del-cancer', 'Día Mundial contra el Cáncer', 4, 2, 'salud', true, 'OMS / UICC', 'Concienciación sobre prevención. Solo para mencionar agua y salud si aplica.', array['#DiaMundialContraElCancer'], 'low'),
  -- MARZO
  ('dia-mundial-de-los-bosques', 'Día Internacional de los Bosques', 21, 3, 'medio_ambiente', true, 'ONU / FAO', 'Importancia de los bosques para el ciclo del agua y la biodiversidad.', array['#DiaInternacionalDeLosBosques','#Bosques','#CicloDelAgua'], 'high'),
  ('dia-mundial-del-agua', 'Día Mundial del Agua', 22, 3, 'agua', true, 'ONU', 'Fecha central del calendario AGUACLAUDE. Tema cambia cada año (UN-Water).', array['#DiaMundialDelAgua','#WorldWaterDay','#Agua'], 'high'),
  ('dia-meteorologico-mundial', 'Día Meteorológico Mundial', 23, 3, 'medio_ambiente', true, 'OMM (Organización Meteorológica Mundial)', 'Relación entre clima, agua y previsión.', array['#DiaMeteorologicoMundial'], 'medium'),
  -- ABRIL
  ('dia-de-la-tierra', 'Día Internacional de la Madre Tierra', 22, 4, 'medio_ambiente', true, 'ONU', 'Promueve armonía con la naturaleza y consumo responsable.', array['#DiaDeLaTierra','#EarthDay'], 'high'),
  -- MAYO
  ('dia-mundial-de-las-abejas', 'Día Mundial de las Abejas', 20, 5, 'medio_ambiente', true, 'ONU / FAO', 'Biodiversidad y polinización; tangencial al agua.', array['#DiaMundialDeLasAbejas'], 'low'),
  ('dia-internacional-diversidad-biologica', 'Día Internacional de la Diversidad Biológica', 22, 5, 'medio_ambiente', true, 'ONU', 'Biodiversidad y ecosistemas acuáticos.', array['#DiaDeLaBiodiversidad','#Biodiversidad'], 'medium'),
  -- JUNIO
  ('dia-mundial-medio-ambiente', 'Día Mundial del Medio Ambiente', 5, 6, 'medio_ambiente', true, 'ONU / PNUMA', 'Mayor fecha ambiental anual; el tema varía cada año (PNUMA).', array['#DiaMundialDelMedioAmbiente','#WorldEnvironmentDay'], 'high'),
  ('dia-mundial-de-los-oceanos', 'Día Mundial de los Océanos', 8, 6, 'oceanos', true, 'ONU', 'Importancia de los océanos para el planeta; lucha contra plásticos y contaminación.', array['#DiaMundialDeLosOceanos','#WorldOceansDay','#Oceanos'], 'high'),
  ('dia-lucha-desertificacion-sequia', 'Día Mundial de Lucha contra la Desertificación y la Sequía', 17, 6, 'sequia', true, 'ONU', 'Acción frente a la degradación del suelo y la escasez de agua.', array['#DiaContraLaSequia','#Sequía','#Desertificacion'], 'high'),
  ('dia-mundial-hidrografia', 'Día Mundial de la Hidrografía', 21, 6, 'agua', true, 'OMI / OHI', 'Importancia de la cartografía de aguas.', array['#DiaMundialDeLaHidrografia'], 'low'),
  -- JULIO
  ('dia-internacional-libre-bolsas-plastico', 'Día Internacional Libre de Bolsas de Plástico', 3, 7, 'plastico', false, 'Reset the Earth (no oficial UN)', 'Fecha de concienciación no oficial; reducir plásticos de un solo uso.', array['#SinPlastico','#PlasticFreeDay'], 'medium'),
  ('dia-mundial-poblacion', 'Día Mundial de la Población', 11, 7, 'medio_ambiente', true, 'ONU', 'Crecimiento poblacional y presión sobre recursos hídricos.', array['#DiaMundialDeLaPoblacion'], 'low'),
  -- AGOSTO
  ('dia-internacional-juventud', 'Día Internacional de la Juventud', 12, 8, 'social', true, 'ONU', 'Tangencial; jóvenes y sostenibilidad.', array['#DiaInternacionalDeLaJuventud'], 'low'),
  -- SEPTIEMBRE
  ('dia-mundial-limpieza', 'Día Mundial de la Limpieza (World Cleanup Day)', 20, 9, 'medio_ambiente', false, 'Let''s Do It World (no oficial UN)', 'Movimiento global de limpieza de espacios naturales. Reconocido por PNUMA en años recientes.', array['#WorldCleanupDay','#DiaMundialDeLaLimpieza'], 'high'),
  ('dia-cero-emisiones', 'Día Internacional de las Cero Emisiones', 21, 9, 'medio_ambiente', false, null, 'Concienciación no oficial.', array['#CeroEmisiones'], 'low'),
  ('dia-mundial-rios', 'Día Mundial de los Ríos', 27, 9, 'agua', false, 'Iniciativa de ONG (no oficial UN; cuarto domingo de septiembre — fecha aproximada)', 'Concienciación sobre estado de los ríos.', array['#DiaMundialDeLosRios','#Rios'], 'medium'),
  -- OCTUBRE
  ('dia-mundial-habitat', 'Día Mundial del Hábitat', 6, 10, 'medio_ambiente', true, 'ONU-Hábitat', 'Vivienda, agua y saneamiento como derecho. (Primer lunes de octubre — fecha aproximada)', array['#DiaMundialDelHabitat'], 'medium'),
  ('dia-internacional-reduccion-desastres', 'Día Internacional para la Reducción del Riesgo de Desastres', 13, 10, 'medio_ambiente', true, 'ONU', 'Incluye inundaciones y sequías.', array['#ReduccionDeRiesgos'], 'medium'),
  ('dia-mundial-lavado-manos', 'Día Mundial del Lavado de Manos', 15, 10, 'salud', true, 'OMS / UNICEF', 'Higiene básica y acceso a agua segura.', array['#DiaMundialDelLavadoDeManos','#GlobalHandwashingDay'], 'high'),
  ('dia-mundial-alimentacion', 'Día Mundial de la Alimentación', 16, 10, 'medio_ambiente', true, 'FAO', 'Agua como recurso clave para la alimentación.', array['#DiaMundialDeLaAlimentacion','#FAO'], 'medium'),
  -- NOVIEMBRE
  ('dia-mundial-ciudades', 'Día Mundial de las Ciudades', 31, 10, 'medio_ambiente', true, 'ONU-Hábitat', 'Sostenibilidad urbana y agua.', array['#WorldCitiesDay'], 'low'),
  ('dia-mundial-eficiencia-energetica', 'Día Mundial del Ahorro de Energía', 21, 10, 'sostenibilidad', false, null, 'No oficial UN. Eficiencia energética también en tratamiento de agua.', array['#AhorroEnergetico'], 'low'),
  ('dia-mundial-pesca', 'Día Mundial de la Pesca', 21, 11, 'oceanos', false, null, 'No oficial UN. Estado de océanos y biodiversidad acuática.', array['#DiaMundialDeLaPesca'], 'low'),
  ('dia-mundial-retrete', 'Día Mundial del Retrete / Saneamiento', 19, 11, 'agua', true, 'ONU', 'Acceso a saneamiento seguro como derecho humano.', array['#DiaMundialDelRetrete','#WorldToiletDay','#Saneamiento'], 'high'),
  -- DICIEMBRE
  ('dia-internacional-cobertura-sanitaria', 'Día Internacional de la Cobertura Sanitaria Universal', 12, 12, 'salud', true, 'ONU / OMS', 'Incluye acceso a agua segura.', array['#DiaCoberturaSanitaria'], 'low'),
  ('dia-mundial-suelo', 'Día Mundial del Suelo', 5, 12, 'medio_ambiente', true, 'FAO', 'Calidad del suelo y agua subterránea.', array['#DiaMundialDelSuelo','#WorldSoilDay'], 'high'),
  ('dia-derechos-humanos', 'Día de los Derechos Humanos', 10, 12, 'social', true, 'ONU', 'Agua como derecho humano (Resolución 64/292 de 2010).', array['#DerechosHumanos','#DerechoAlAgua'], 'medium')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
