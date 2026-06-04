-- =============================================================================
-- 20260604100400_product_public_shares.sql
-- Fase 1 del Plan Productos v2.
-- URLs públicas (sin login) para ficha técnica de un producto o catálogo
-- de varios. Token aleatorio + caducidad por defecto 60 días (decisión
-- usuario 2026-06-04).
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_share_type') then
    create type app.product_share_type as enum (
      'product_datasheet',       -- ficha técnica de un único producto
      'category_catalog',        -- catálogo de toda una categoría
      'custom_catalog'           -- catálogo de una selección manual
    );
  end if;
end $$;

create table if not exists public.product_public_shares (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  share_type              app.product_share_type not null,

  -- Contenido (uno o varios según share_type)
  product_ids             uuid[],
  category_ids            uuid[],

  -- Configuración de visibilidad
  pricing_visibility      jsonb,                                  -- por producto: qué precios pintar
  show_company_branding   boolean not null default true,
  show_company_contact    boolean not null default true,
  custom_title            text,
  custom_intro            text,                                   -- introducción opcional

  -- Token de acceso
  share_token             text not null unique
                          default encode(gen_random_bytes(24), 'hex'),
  expires_at              timestamptz default (now() + interval '60 days'),

  -- Métricas
  view_count              integer not null default 0,
  last_viewed_at          timestamptz,
  last_viewed_ip          inet,
  last_viewed_user_agent  text,

  -- Auditoría
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  revoked_at              timestamptz,
  revoke_reason           text
);

create index if not exists idx_pps_token on public.product_public_shares(share_token)
  where revoked_at is null;
create index if not exists idx_pps_company on public.product_public_shares(company_id, created_at desc);

alter table public.product_public_shares enable row level security;
alter table public.product_public_shares force row level security;

drop policy if exists pps_super on public.product_public_shares;
create policy pps_super on public.product_public_shares
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Lectura: admin y directores ven los shares creados; nivel 3 ve solo los suyos
-- (los que ellos crearon para enviar a un lead/cliente).
drop policy if exists pps_select_tenant on public.product_public_shares;
create policy pps_select_tenant on public.product_public_shares
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('technical_director')
      or app.has_role('telemarketing_director')
      or created_by = auth.uid()
    )
  );

-- Inserción: cualquier usuario autenticado en la empresa (la app filtrará
-- según rol qué botón "Crear URL pública" se muestra).
drop policy if exists pps_insert_tenant on public.product_public_shares;
create policy pps_insert_tenant on public.product_public_shares
  for insert to authenticated
  with check (company_id = app.current_company_id());

-- Actualización (revocar, prorrogar caducidad, edit título): solo admin
-- o quien lo creó.
drop policy if exists pps_update_owner_or_admin on public.product_public_shares;
create policy pps_update_owner_or_admin on public.product_public_shares
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or created_by = auth.uid())
  )
  with check (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or created_by = auth.uid())
  );

-- IMPORTANTE: la resolución pública del token NO la hace una policy "anon".
-- Se hará desde un server action / route handler con admin client que
-- valide el token y `revoked_at is null` y `(expires_at is null or expires_at > now())`.
-- Así evitamos exponer toda la tabla a anónimos.

comment on table public.product_public_shares is
  'URLs públicas hasheadas para compartir fichas técnicas y catálogos. Caducidad por defecto 60 días. Resolución desde server con admin client + validación de token.';
comment on column public.product_public_shares.share_token is
  'Token aleatorio de 48 chars hex. Único. Se resuelve server-side con admin client.';
comment on column public.product_public_shares.expires_at is
  'Caducidad por defecto: now() + 60 días. Override permitido por admin (sin caducidad si NULL explícito tras creación).';

notify pgrst, 'reload schema';
