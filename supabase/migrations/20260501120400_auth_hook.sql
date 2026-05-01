-- =============================================================================
-- 20260501120400_auth_hook.sql
-- Capa 2 · Paso 2.5 · Auth Hook: Custom Access Token.
--
-- Añade al JWT los claims:
--   - company_id          (uuid o null si superadmin)
--   - is_superadmin       (boolean)
--   - roles               (text[])
--   - departments         (text[]) — derivados de roles
--   - full_name           (string)
--
-- Configurado en supabase/config.toml:
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
--
-- IMPORTANTE en producción Supabase managed: hay que activar manualmente
-- "Custom Access Token Hook" desde el dashboard apuntando a esta función.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, app, auth
as $$
declare
  v_user_id    uuid;
  v_claims     jsonb;
  v_is_super   boolean;
  v_company_id uuid;
  v_roles      text[];
  v_depts      text[];
  v_full_name  text;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- ¿Superadmin?
  select exists(select 1 from public.superadmins where user_id = v_user_id)
    into v_is_super;

  if v_is_super then
    v_claims := v_claims
      || jsonb_build_object(
        'is_superadmin', true,
        'roles', jsonb_build_array('superadmin'),
        'departments', '[]'::jsonb
      );
    return jsonb_build_object('claims', v_claims);
  end if;

  -- Tenant user
  select p.company_id, p.full_name
    into v_company_id, v_full_name
    from public.user_profiles p
   where p.user_id = v_user_id;

  if v_company_id is null then
    -- Usuario sin empresa: devolver claims base sin tenant data.
    -- Útil para flujos de invitación inicial.
    v_claims := v_claims || jsonb_build_object('is_superadmin', false);
    return jsonb_build_object('claims', v_claims);
  end if;

  -- Roles activos
  select coalesce(array_agg(role_key), array[]::text[])
    into v_roles
    from public.user_roles
   where user_id = v_user_id
     and company_id = v_company_id
     and revoked_at is null;

  -- Departamentos derivados de roles
  select coalesce(array_agg(distinct rc.default_department::text), array[]::text[])
    into v_depts
    from public.roles_catalog rc
   where rc.key = any(v_roles)
     and rc.default_department is not null;

  v_claims := v_claims
    || jsonb_build_object(
      'is_superadmin', false,
      'company_id', v_company_id,
      'roles', to_jsonb(v_roles),
      'departments', to_jsonb(v_depts),
      'full_name', coalesce(v_full_name, '')
    );

  return jsonb_build_object('claims', v_claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth Hook que añade company_id, is_superadmin, roles[], departments[] al JWT.';

-- Permisos para que el Auth backend pueda invocar la función
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- También dar SELECT al supabase_auth_admin sobre las tablas que lee la función
grant select on public.superadmins to supabase_auth_admin;
grant select on public.user_profiles to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;
grant select on public.roles_catalog to supabase_auth_admin;
