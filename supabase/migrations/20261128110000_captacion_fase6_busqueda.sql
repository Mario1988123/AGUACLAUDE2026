-- =============================================================================
-- Módulo «Captación WhatsApp» — fase 6: búsqueda de negocios.
-- Plan: docs/PLAN_MODULO_CAPTACION_WHATSAPP.md (§3.2, §3.3, §4.2).
--
--   · captacion_tipologias   presets globales (etiquetas de OpenStreetMap)
--   · captacion_campanas     versión mínima: a quién y dónde (el resto, fase 3/7)
--   · captacion_busquedas    cola de trabajo: campaña × zona × fuente
--   · captacion_prospectos   negocios encontrados; un teléfono, una vez por empresa
--   · captacion_bloqueos     «nunca más», también para la búsqueda
--   · app.captacion_coincidencias()  ¿es ya cliente o lead de la empresa?
--
-- Escrituras solo desde el servidor (server actions y cron con el cliente de
-- servicio), como en la fase 1. Aditiva e idempotente.
-- =============================================================================

-- Quién gestiona el módulo dentro de la empresa (lectura de campañas,
-- búsquedas y bloqueos; todos los prospectos).
create or replace function app.captacion_gestor()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('telemarketing_director');
$$;
grant execute on function app.captacion_gestor() to authenticated;

-- -----------------------------------------------------------------------------
-- 1) Tipologías (globales)
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_tipologias (
  clave             text primary key,
  nombre            text not null,
  etiquetas_osm     jsonb not null default '[]'::jsonb,
  terminos_busqueda text[] not null default '{}',
  orden             integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.captacion_tipologias.etiquetas_osm is
  'Lista de filtros de Overpass, uno por elemento: ["[\"leisure\"=\"fitness_centre\"]", …]. Se unen con OR.';

drop trigger if exists trg_captacion_tipologias_updated on public.captacion_tipologias;
create trigger trg_captacion_tipologias_updated
  before update on public.captacion_tipologias
  for each row execute function app.set_updated_at();

insert into public.captacion_tipologias (clave, nombre, etiquetas_osm, terminos_busqueda, orden) values
  ('oficina', 'Oficinas y despachos',
   '["[\"office\"~\"^(company|lawyer|accountant|tax_advisor|insurance|estate_agent|consulting|it|architect|financial|employment_agency|notary)$\"]"]',
   '{oficina,gestoría,asesoría,despacho}', 10),
  ('gimnasio', 'Gimnasios y centros deportivos',
   '["[\"leisure\"=\"fitness_centre\"]","[\"leisure\"=\"sports_centre\"]","[\"sport\"=\"fitness\"]"]',
   '{gimnasio,"centro deportivo"}', 20),
  ('clinica', 'Clínicas y consultas',
   '["[\"amenity\"~\"^(clinic|dentist|doctors)$\"]","[\"healthcare\"~\"^(clinic|dentist|physiotherapist|doctor)$\"]"]',
   '{clínica,dentista,fisioterapia}', 30),
  ('academia', 'Academias y escuelas infantiles',
   '["[\"amenity\"~\"^(language_school|music_school|driving_school|kindergarten|prep_school)$\"]"]',
   '{academia,autoescuela,"escuela infantil"}', 40),
  ('coworking', 'Coworking',
   '["[\"office\"=\"coworking\"]","[\"amenity\"=\"coworking_space\"]"]',
   '{coworking}', 50),
  ('peluqueria', 'Peluquerías y estética',
   '["[\"shop\"~\"^(hairdresser|beauty)$\"]"]',
   '{peluquería,"centro de estética"}', 60),
  ('restauracion', 'Restaurantes y cafeterías',
   '["[\"amenity\"~\"^(restaurant|cafe)$\"]"]',
   '{restaurante,cafetería}', 70),
  ('hotel', 'Hoteles y alojamientos',
   '["[\"tourism\"~\"^(hotel|hostel|guest_house)$\"]"]',
   '{hotel,hostal}', 80),
  ('taller', 'Talleres',
   '["[\"shop\"~\"^(car_repair|tyres|motorcycle_repair)$\"]","[\"craft\"~\"^(carpenter|metal_construction|electrician|plumber)$\"]"]',
   '{"taller mecánico",carpintería}', 90)
on conflict (clave) do nothing;

-- -----------------------------------------------------------------------------
-- 2) Campañas (versión mínima; fases 3, 4 y 7 añaden lo suyo)
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_campanas (
  id                           uuid primary key default gen_random_uuid(),
  company_id                   uuid not null references public.companies(id) on delete cascade,
  nombre                       text not null check (length(trim(nombre)) between 1 and 120),
  estado                       text not null default 'borrador'
                                 check (estado in ('borrador', 'activa', 'pausada', 'terminada')),
  motivo_pausa                 text,
  tipologia_clave              text references public.captacion_tipologias(clave) on delete set null,
  etiquetas_osm                jsonb not null default '[]'::jsonb,
  terminos_busqueda            text[] not null default '{}',
  zonas                        jsonb not null default '[]'::jsonb,
  plantilla_primer_contacto_id uuid references public.captacion_plantillas(id) on delete set null,
  plantilla_recordatorio_id    uuid references public.captacion_plantillas(id) on delete set null,
  recordatorio_dias            integer not null default 15 check (recordatorio_dias between 1 and 90),
  tope_diario                  integer not null default 200 check (tope_diario between 0 and 10000),
  escalado                     jsonb not null default '[{"dias":3,"tope":50},{"dias":3,"tope":100}]'::jsonb,
  lanzada_at                   timestamptz,
  horario                      jsonb not null default '{"dias":[1,2,3,4,5],"desde":"10:00","hasta":"19:00"}'::jsonb,
  responsable_user_id          uuid references auth.users(id) on delete set null,
  created_by                   uuid references auth.users(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on column public.captacion_campanas.zonas is
  'Lista de {tipo:"provincia", iso:"ES-V", nombre} · {tipo:"municipio", nombre, provincia_iso} · {tipo:"radio", lat, lng, km}.';

create index if not exists captacion_campanas_empresa_idx on public.captacion_campanas(company_id, estado);

drop trigger if exists trg_captacion_campanas_updated on public.captacion_campanas;
create trigger trg_captacion_campanas_updated
  before update on public.captacion_campanas
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3) Cola de búsquedas
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_busquedas (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  campana_id      uuid not null references public.captacion_campanas(id) on delete cascade,
  fuente          text not null default 'osm' check (fuente in ('osm', 'places')),
  zona            jsonb not null,
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente', 'en_curso', 'hecha', 'fallida')),
  cursor          jsonb,
  encontrados     integer not null default 0,
  nuevos          integer not null default 0,
  revisar         integer not null default 0,
  descartados     integer not null default 0,
  llamadas_places integer not null default 0,
  error           text,
  reclamada_at    timestamptz,
  terminada_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.captacion_busquedas.cursor is
  'Fichas sacadas de Overpass pendientes de leer su web ({fichas:[…], i}). Así una búsqueda larga se reparte entre varias pasadas.';
comment on column public.captacion_busquedas.llamadas_places is
  'El gasto de Places del mes se calcula SUMANDO esta columna, nunca con un contador aparte.';

create index if not exists captacion_busquedas_cola_idx
  on public.captacion_busquedas(estado, created_at) where estado in ('pendiente', 'en_curso');
create index if not exists captacion_busquedas_campana_idx
  on public.captacion_busquedas(campana_id, created_at desc);

drop trigger if exists trg_captacion_busquedas_updated on public.captacion_busquedas;
create trigger trg_captacion_busquedas_updated
  before update on public.captacion_busquedas
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) Prospectos
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_prospectos (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  campana_id             uuid references public.captacion_campanas(id) on delete set null,
  busqueda_id            uuid references public.captacion_busquedas(id) on delete set null,
  nombre_negocio         text not null,
  tipologia_clave        text,
  direccion              text,
  municipio              text,
  codigo_postal          text,
  lat                    double precision,
  lng                    double precision,
  telefono_e164          text check (telefono_e164 is null or telefono_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  es_movil               boolean generated always as (coalesce(telefono_e164 ~ '^\+34[67]', false)) stored,
  telefono_fuente        text check (telefono_fuente in ('osm', 'web_propia', 'whatsapp_web', 'manual')),
  telefono_url_fuente    text,
  prioridad              smallint not null default 0 check (prioridad between 0 and 3),
  web                    text,
  dominio                text,
  email                  text,
  osm_id                 text,
  place_id               text,
  bsuid                  text,
  etapa                  text not null default 'nuevo'
                           check (etapa in ('nuevo', 'revisar', 'en_cola', 'contactado', 'recordado',
                                            'interesado', 'conversando', 'caliente', 'convertido',
                                            'descartado', 'sin_respuesta', 'fallido')),
  revisar_motivo         text,
  cliente_coincidente_id uuid references public.customers(id) on delete set null,
  lead_coincidente_id    uuid references public.leads(id) on delete set null,
  lead_id                uuid references public.leads(id) on delete set null,
  assigned_user_id       uuid references auth.users(id) on delete set null,
  interes                smallint check (interes between 0 and 3),
  interes_resumen        text,
  aviso_interes_at       timestamptz,
  descartado_motivo      text,
  anonimizado_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column public.captacion_prospectos.telefono_fuente is
  'De dónde salió el teléfono. Nunca Google Places: de Places solo se guarda place_id.';
comment on column public.captacion_prospectos.telefono_url_fuente is
  'Página donde estaba publicado el teléfono (ficha de OSM o la web del negocio). Es la prueba de origen.';
comment on column public.captacion_prospectos.prioridad is
  '3 = móvil sacado de un enlace de WhatsApp en su web · 2 = móvil de su web · 1 = móvil de OSM · 0 = sin móvil.';

-- Un negocio se contacta UNA vez por empresa: lo impide la base, no un if.
create unique index if not exists captacion_prospectos_tel_uk
  on public.captacion_prospectos(company_id, telefono_e164) where telefono_e164 is not null;
create unique index if not exists captacion_prospectos_osm_uk
  on public.captacion_prospectos(company_id, osm_id) where osm_id is not null;
create unique index if not exists captacion_prospectos_place_uk
  on public.captacion_prospectos(company_id, place_id) where place_id is not null;
create unique index if not exists captacion_prospectos_bsuid_uk
  on public.captacion_prospectos(company_id, bsuid) where bsuid is not null;
create index if not exists captacion_prospectos_etapa_idx on public.captacion_prospectos(company_id, etapa);
create index if not exists captacion_prospectos_campana_idx on public.captacion_prospectos(campana_id, etapa);
create index if not exists captacion_prospectos_dominio_idx
  on public.captacion_prospectos(company_id, dominio) where dominio is not null;
create index if not exists captacion_prospectos_nombre_trgm
  on public.captacion_prospectos using gin (nombre_negocio gin_trgm_ops);

drop trigger if exists trg_captacion_prospectos_updated on public.captacion_prospectos;
create trigger trg_captacion_prospectos_updated
  before update on public.captacion_prospectos
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5) Bloqueos («nunca más»). Nunca se purgan por retención.
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_bloqueos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  ambito        text not null check (ambito in ('telefono', 'bsuid')),
  valor         text not null,
  motivo        text not null check (motivo in ('boton_no', 'baja_texto', 'queja', 'manual', 'cliente')),
  prospecto_id  uuid references public.captacion_prospectos(id) on delete set null,
  origen_wamid  text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint captacion_bloqueos_uk unique (company_id, ambito, valor)
);

-- -----------------------------------------------------------------------------
-- 6) ¿Ya es cliente o lead? (deduplicación, plan §4.2.7)
--    Teléfono: últimos 9 dígitos contra clientes, contactos, leads y
--    direcciones. Nombre: trigramas ≥ 0,6 con una dirección en el mismo CP.
--    Solo la usa el servidor (cliente de servicio).
-- -----------------------------------------------------------------------------
create or replace function app.captacion_coincidencias(
  p_company_id uuid,
  p_tel9       text,
  p_nombre     text,
  p_cp         text
)
returns table (customer_id uuid, lead_id uuid, motivo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tel as (
    select nullif(p_tel9, '') as t
  ),
  por_tel as (
    select c.id as customer_id, null::uuid as lead_id, 'telefono'::text as motivo
      from customers c, tel
     where tel.t is not null and c.company_id = p_company_id and c.deleted_at is null
       and (right(regexp_replace(coalesce(c.phone_primary, ''), '\D', '', 'g'), 9) = tel.t
         or right(regexp_replace(coalesce(c.phone_secondary, ''), '\D', '', 'g'), 9) = tel.t)
    union all
    select cc.customer_id, null, 'telefono'
      from customer_contacts cc, tel
     where tel.t is not null and cc.company_id = p_company_id
       and right(regexp_replace(coalesce(cc.phone, ''), '\D', '', 'g'), 9) = tel.t
    union all
    select null, l.id, 'telefono'
      from leads l, tel
     where tel.t is not null and l.company_id = p_company_id and l.deleted_at is null
       and (right(regexp_replace(coalesce(l.phone_primary, ''), '\D', '', 'g'), 9) = tel.t
         or right(regexp_replace(coalesce(l.phone_company, ''), '\D', '', 'g'), 9) = tel.t)
    union all
    select a.customer_id, a.lead_id, 'telefono'
      from addresses a, tel
     where tel.t is not null and a.company_id = p_company_id and a.deleted_at is null
       and right(regexp_replace(coalesce(a.contact_phone, ''), '\D', '', 'g'), 9) = tel.t
  ),
  por_nombre as (
    select a.customer_id, a.lead_id, 'nombre'::text as motivo
      from addresses a
      left join customers c on c.id = a.customer_id and c.deleted_at is null
      left join leads l on l.id = a.lead_id and l.deleted_at is null
     where p_cp is not null and p_nombre is not null
       and a.company_id = p_company_id and a.deleted_at is null and a.postal_code = p_cp
       and greatest(
             similarity(lower(unaccent(coalesce(c.trade_name, c.legal_name, ''))), lower(unaccent(p_nombre))),
             similarity(lower(unaccent(coalesce(l.trade_name, l.legal_name, ''))), lower(unaccent(p_nombre)))
           ) >= 0.6
  )
  select * from por_tel
  union all
  select * from por_nombre
  limit 5;
$$;

revoke all on function app.captacion_coincidencias(uuid, text, text, text) from public, anon, authenticated;
grant execute on function app.captacion_coincidencias(uuid, text, text, text) to service_role;

-- El esquema app no está expuesto en PostgREST: envoltorio en public, como
-- voice_claim_tasks (20261002100500_rpc_wrappers_voz_y_semillas_productos.sql).
create or replace function public.captacion_coincidencias(
  p_company_id uuid,
  p_tel9       text,
  p_nombre     text,
  p_cp         text
)
returns table (customer_id uuid, lead_id uuid, motivo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from app.captacion_coincidencias(p_company_id, p_tel9, p_nombre, p_cp);
$$;
revoke all on function public.captacion_coincidencias(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.captacion_coincidencias(uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 7) RLS
-- -----------------------------------------------------------------------------
alter table public.captacion_tipologias enable row level security;
alter table public.captacion_tipologias force row level security;
alter table public.captacion_campanas   enable row level security;
alter table public.captacion_campanas   force row level security;
alter table public.captacion_busquedas  enable row level security;
alter table public.captacion_busquedas  force row level security;
alter table public.captacion_prospectos enable row level security;
alter table public.captacion_prospectos force row level security;
alter table public.captacion_bloqueos   enable row level security;
alter table public.captacion_bloqueos   force row level security;

drop policy if exists captacion_tipologias_select on public.captacion_tipologias;
create policy captacion_tipologias_select on public.captacion_tipologias
  for select to authenticated using (true);
drop policy if exists captacion_tipologias_super on public.captacion_tipologias;
create policy captacion_tipologias_super on public.captacion_tipologias
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists captacion_campanas_super on public.captacion_campanas;
create policy captacion_campanas_super on public.captacion_campanas
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_campanas_select on public.captacion_campanas;
create policy captacion_campanas_select on public.captacion_campanas
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

drop policy if exists captacion_busquedas_super on public.captacion_busquedas;
create policy captacion_busquedas_super on public.captacion_busquedas
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_busquedas_select on public.captacion_busquedas;
create policy captacion_busquedas_select on public.captacion_busquedas
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

-- Prospectos: los gestores ven todos; comerciales y teleoperadores, los suyos.
drop policy if exists captacion_prospectos_super on public.captacion_prospectos;
create policy captacion_prospectos_super on public.captacion_prospectos
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_prospectos_select on public.captacion_prospectos;
create policy captacion_prospectos_select on public.captacion_prospectos
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.captacion_gestor() or assigned_user_id = auth.uid())
  );

drop policy if exists captacion_bloqueos_super on public.captacion_bloqueos;
create policy captacion_bloqueos_super on public.captacion_bloqueos
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_bloqueos_select on public.captacion_bloqueos;
create policy captacion_bloqueos_select on public.captacion_bloqueos
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

revoke insert, update, delete, truncate on table
  public.captacion_tipologias, public.captacion_campanas, public.captacion_busquedas,
  public.captacion_prospectos, public.captacion_bloqueos
  from anon, authenticated;
revoke all on table
  public.captacion_tipologias, public.captacion_campanas, public.captacion_busquedas,
  public.captacion_prospectos, public.captacion_bloqueos
  from anon;

notify pgrst, 'reload schema';
