-- =============================================================================
-- Captación por WhatsApp — fase 4: propuesta ligera, página privada y visitas.
--
--   · captacion_campana_productos: qué equipos propone cada campaña (plan
--     §3.2), en orden; la primera es la recomendada. Solo el qué: el precio
--     nunca se copia aquí, se lee de Productos al generar.
--   · captacion_propuestas: la propuesta de cada «Sí» con su código público
--     (12 caracteres base32, 60 bits) y la FOTO de las líneas (lista blanca de
--     §3.4: nunca costes ni márgenes).
--   · captacion_visitas: una fila por visitante y día. visitante_hash =
--     SHA-256 de IP + agente + día + sal; la IP no se guarda.
--   · public.captacion_registrar_pulso(): el latido de la página. Solo deja
--     crecer los valores (como mucho 15 s por latido y nunca más que el reloj)
--     y marca, una sola vez, cuándo avisar al responsable (§4.8).
--   · Columnas nuevas: captacion_conexiones.url_privacidad y
--     propuesta_precios (decisión 2: sin precios por defecto, por empresa);
--     captacion_campanas.texto_carta y que_incluye.
--   · Bucket privado captacion-propuestas (solo el cliente de servicio).
--
-- Solo aditiva. Escritura siempre con el cliente de servicio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columnas nuevas
-- -----------------------------------------------------------------------------

alter table public.captacion_conexiones
  add column if not exists url_privacidad text
    check (url_privacidad is null or (url_privacidad ~ '^https://' and char_length(url_privacidad) <= 500)),
  add column if not exists propuesta_precios text[] not null default '{}'
    check (propuesta_precios <@ array['cash', 'renting', 'rental']::text[]);

comment on column public.captacion_conexiones.url_privacidad is
  'Política de privacidad de la empresa (no la de Hidromanager). Vacía: el pie de /p/ lleva los datos fiscales y la baja por WhatsApp, sin enlace.';
comment on column public.captacion_conexiones.propuesta_precios is
  'Qué precios enseña la propuesta (tipos de plan: cash, renting, rental). Vacío = sin precios (decisión 2 de Mario).';

alter table public.captacion_campanas
  add column if not exists texto_carta text check (texto_carta is null or char_length(texto_carta) <= 280),
  add column if not exists que_incluye text check (que_incluye is null or char_length(que_incluye) <= 400);

comment on column public.captacion_campanas.texto_carta is
  'Cuerpo de la carta de la propuesta (máx. 280). Vacío: texto por defecto.';
comment on column public.captacion_campanas.que_incluye is
  'Bloque «Qué incluye», una línea por punto (máx. 4). Vacío: el bloque no sale.';

-- -----------------------------------------------------------------------------
-- Equipos de cada campaña
-- -----------------------------------------------------------------------------

create table if not exists public.captacion_campana_productos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  campana_id  uuid not null references public.captacion_campanas(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  orden       smallint not null default 0 check (orden between 0 and 99),
  created_at  timestamptz not null default now(),
  unique (campana_id, product_id)
);

create index if not exists captacion_campana_productos_campana_idx
  on public.captacion_campana_productos(company_id, campana_id, orden);

-- -----------------------------------------------------------------------------
-- Propuestas
-- -----------------------------------------------------------------------------

create table if not exists public.captacion_propuestas (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  prospecto_id       uuid references public.captacion_prospectos(id) on delete set null,
  campana_id         uuid references public.captacion_campanas(id) on delete set null,
  conversacion_id    uuid references public.captacion_conversaciones(id) on delete set null,
  codigo             text not null unique check (codigo ~ '^[a-z2-7]{12}$'),
  nombre_negocio     text not null check (char_length(nombre_negocio) between 1 and 200),
  tipo_negocio       text,
  localidad          text,
  -- Foto de los equipos y precios al generar (lista blanca, plan §3.4).
  lineas             jsonb not null default '[]'::jsonb check (jsonb_typeof(lineas) = 'array'),
  carta              text,
  que_incluye        text,
  con_precios        boolean not null default false,
  pdf_ruta           text,
  pdf_bytes          integer,
  pdf_paginas        smallint,
  media_id_meta      text,
  enviada_at         timestamptz,
  envio_error        text,
  caduca_at          timestamptz not null,
  revocada_at        timestamptz,
  proposal_id        uuid references public.proposals(id) on delete set null,
  primera_visita_at  timestamptz,
  visitas            integer not null default 0,
  segundos_total     integer not null default 0,
  scroll_max         smallint not null default 0 check (scroll_max between 0 and 100),
  aviso_lectura_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists captacion_propuestas_prospecto_idx
  on public.captacion_propuestas(company_id, prospecto_id, created_at desc);

drop trigger if exists trg_captacion_propuestas_updated on public.captacion_propuestas;
create trigger trg_captacion_propuestas_updated
  before update on public.captacion_propuestas
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Visitas
-- -----------------------------------------------------------------------------

create table if not exists public.captacion_visitas (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  propuesta_id    uuid not null references public.captacion_propuestas(id) on delete cascade,
  visitante_hash  text not null check (visitante_hash ~ '^[0-9a-f]{64}$'),
  dia             date not null,
  inicio_at       timestamptz not null default now(),
  ultimo_at       timestamptz not null default now(),
  segundos        integer not null default 0 check (segundos between 0 and 86400),
  scroll_max      smallint not null default 0 check (scroll_max between 0 and 100),
  dispositivo     text check (dispositivo in ('movil', 'escritorio')),
  descargo_pdf    boolean not null default false,
  unique (propuesta_id, visitante_hash)
);

create index if not exists captacion_visitas_propuesta_idx
  on public.captacion_visitas(propuesta_id, dia);

-- -----------------------------------------------------------------------------
-- Latido de la página (lo llama /api/captacion/visita con el cliente de servicio)
-- -----------------------------------------------------------------------------

create or replace function public.captacion_registrar_pulso(
  p_codigo      text,
  p_hash        text,
  p_dia         date,
  p_segundos    integer,
  p_scroll      integer,
  p_dispositivo text
) returns table (r_propuesta_id uuid, r_company_id uuid, r_avisar boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_company  uuid;
  v_seg      integer := greatest(0, least(coalesce(p_segundos, 0), 86400));
  v_scroll   integer := greatest(0, least(coalesce(p_scroll, 0), 100));
  v_disp     text := case when p_dispositivo in ('movil', 'escritorio') then p_dispositivo end;
  v_total    integer;
  v_max      integer;
  v_dias     integer;
  v_avisar   boolean := false;
begin
  -- La revocada no se mide; la caducada sí (que vuelva a abrirla es señal).
  select id, company_id into v_id, v_company
    from public.captacion_propuestas
   where codigo = p_codigo and revocada_at is null;
  if v_id is null then
    return;
  end if;

  insert into public.captacion_visitas as v
    (company_id, propuesta_id, visitante_hash, dia, segundos, scroll_max, dispositivo)
  values (v_company, v_id, p_hash, p_dia, least(v_seg, 15), v_scroll, v_disp)
  on conflict (propuesta_id, visitante_hash) do update
     set segundos = greatest(
           v.segundos,
           least(
             v_seg,
             v.segundos + 15,
             v.segundos + ceil(extract(epoch from (now() - v.ultimo_at)))::integer + 2
           )
         ),
         scroll_max = greatest(v.scroll_max, v_scroll),
         dispositivo = coalesce(v.dispositivo, excluded.dispositivo),
         ultimo_at = now();

  select coalesce(sum(segundos), 0), coalesce(max(scroll_max), 0), count(distinct dia)
    into v_total, v_max, v_dias
    from public.captacion_visitas
   where propuesta_id = v_id;

  update public.captacion_propuestas
     set primera_visita_at = coalesce(primera_visita_at, now()),
         visitas = (select count(*) from public.captacion_visitas where propuesta_id = v_id),
         segundos_total = least(v_total, 2147483647),
         scroll_max = v_max
   where id = v_id;

  -- Aviso «la está leyendo» (§4.8): más de 60 s, scroll > 70 % o vuelve otro
  -- día. Una sola vez: lo decide la propia actualización.
  if v_total > 60 or v_max > 70 or v_dias >= 2 then
    update public.captacion_propuestas
       set aviso_lectura_at = now()
     where id = v_id and aviso_lectura_at is null;
    v_avisar := found;
  end if;

  return query select v_id, v_company, v_avisar;
end;
$$;

revoke all on function public.captacion_registrar_pulso(text, text, date, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.captacion_registrar_pulso(text, text, date, integer, integer, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- RLS: lectura para gestores; escritura solo con el cliente de servicio.
-- -----------------------------------------------------------------------------

alter table public.captacion_campana_productos enable row level security;
alter table public.captacion_propuestas enable row level security;
alter table public.captacion_visitas enable row level security;

drop policy if exists captacion_campana_productos_super on public.captacion_campana_productos;
create policy captacion_campana_productos_super on public.captacion_campana_productos
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_campana_productos_select on public.captacion_campana_productos;
create policy captacion_campana_productos_select on public.captacion_campana_productos
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

drop policy if exists captacion_propuestas_super on public.captacion_propuestas;
create policy captacion_propuestas_super on public.captacion_propuestas
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_propuestas_select on public.captacion_propuestas;
create policy captacion_propuestas_select on public.captacion_propuestas
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

drop policy if exists captacion_visitas_super on public.captacion_visitas;
create policy captacion_visitas_super on public.captacion_visitas
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists captacion_visitas_select on public.captacion_visitas;
create policy captacion_visitas_select on public.captacion_visitas
  for select to authenticated
  using (company_id = app.current_company_id() and app.captacion_gestor());

revoke insert, update, delete, truncate on table public.captacion_campana_productos from authenticated;
revoke insert, update, delete, truncate on table public.captacion_propuestas from authenticated;
revoke insert, update, delete, truncate on table public.captacion_visitas from authenticated;
revoke all on table public.captacion_campana_productos from anon;
revoke all on table public.captacion_propuestas from anon;
revoke all on table public.captacion_visitas from anon;

-- -----------------------------------------------------------------------------
-- Bucket privado de los PDF (ruta company_id/prospecto_id/codigo.pdf). Sin
-- políticas: solo lo lee y escribe el cliente de servicio.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captacion-propuestas', 'captacion-propuestas', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
