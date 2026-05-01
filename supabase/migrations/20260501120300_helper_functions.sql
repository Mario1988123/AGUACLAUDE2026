-- =============================================================================
-- 20260501120300_helper_functions.sql
-- Capa 2 · Paso 2.4 · Funciones helper para RLS y permisos.
--
-- Todas en schema `app` (no podemos crear funciones en `auth`).
-- Funciones STABLE para que el planner las cachee dentro de la query.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app.current_company_id() — devuelve el company_id del JWT del usuario actual
-- -----------------------------------------------------------------------------
create or replace function app.current_company_id()
  returns uuid
  language sql
  stable
  security invoker
as $$
  select nullif(auth.jwt() ->> 'company_id', '')::uuid
$$;

comment on function app.current_company_id() is
  'Devuelve el company_id del JWT actual. NULL si no hay JWT (anon).';

-- -----------------------------------------------------------------------------
-- app.is_superadmin() — true si el usuario actual es superadmin global
-- -----------------------------------------------------------------------------
create or replace function app.is_superadmin()
  returns boolean
  language sql
  stable
  security invoker
as $$
  select coalesce((auth.jwt() ->> 'is_superadmin')::boolean, false)
$$;

comment on function app.is_superadmin() is
  'True si el usuario actual está en superadmins (vía JWT claim).';

-- -----------------------------------------------------------------------------
-- app.current_user_roles() — array de roles del JWT actual
-- -----------------------------------------------------------------------------
create or replace function app.current_user_roles()
  returns text[]
  language sql
  stable
  security invoker
as $$
  select coalesce(
    array(select jsonb_array_elements_text(auth.jwt() -> 'roles')),
    array[]::text[]
  )
$$;

comment on function app.current_user_roles() is
  'Devuelve roles del JWT del usuario actual. Array vacío si no hay claim.';

-- -----------------------------------------------------------------------------
-- app.current_user_departments() — array de departamentos derivados
-- -----------------------------------------------------------------------------
create or replace function app.current_user_departments()
  returns text[]
  language sql
  stable
  security invoker
as $$
  select coalesce(
    array(select jsonb_array_elements_text(auth.jwt() -> 'departments')),
    array[]::text[]
  )
$$;

comment on function app.current_user_departments() is
  'Devuelve departamentos del JWT del usuario actual (derivados de roles).';

-- -----------------------------------------------------------------------------
-- app.has_role(role_key) — true si el usuario actual tiene ese rol
-- -----------------------------------------------------------------------------
create or replace function app.has_role(p_role_key text)
  returns boolean
  language sql
  stable
  security invoker
as $$
  select p_role_key = any(app.current_user_roles())
$$;

-- -----------------------------------------------------------------------------
-- app.in_department(department) — true si el usuario actual está en ese dpto
-- -----------------------------------------------------------------------------
create or replace function app.in_department(p_dept text)
  returns boolean
  language sql
  stable
  security invoker
as $$
  select p_dept = any(app.current_user_departments())
$$;

-- -----------------------------------------------------------------------------
-- app.is_team_member_of(manager_user_id, role_key default null) —
-- true si el usuario actual es miembro del equipo del manager dado.
-- -----------------------------------------------------------------------------
create or replace function app.is_team_member_of(
  p_manager_user_id uuid,
  p_for_role_key text default null
)
  returns boolean
  language sql
  stable
  security invoker
as $$
  select exists (
    select 1
    from public.team_assignments ta
    where ta.manager_user_id = p_manager_user_id
      and ta.member_user_id = auth.uid()
      and ta.revoked_at is null
      and (p_for_role_key is null or ta.for_role_key = p_for_role_key)
      and ta.company_id = app.current_company_id()
  )
$$;

-- -----------------------------------------------------------------------------
-- app.team_member_ids() — ids de los miembros del equipo del usuario actual
-- (para scope `assigned_team` en directores)
-- -----------------------------------------------------------------------------
create or replace function app.team_member_ids()
  returns uuid[]
  language sql
  stable
  security invoker
as $$
  select coalesce(array_agg(member_user_id), array[]::uuid[])
  from public.team_assignments
  where manager_user_id = auth.uid()
    and revoked_at is null
    and company_id = app.current_company_id()
$$;

comment on function app.team_member_ids() is
  'IDs de miembros del equipo del usuario actual (cuando es manager). Para scope assigned_team.';

-- -----------------------------------------------------------------------------
-- app.can(module, action, scope) — comprueba si el usuario actual tiene ese
-- permiso a través de cualquiera de sus roles. Considera permission_overrides.
-- NOTE: scope-row checks (ej. "esta fila es mía") se hacen en cada policy
-- individual; esta función solo dice si el rol concede el permiso.
-- -----------------------------------------------------------------------------
create or replace function app.can(
  p_module text,
  p_action app.permission_action,
  p_scope app.permission_scope default null
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, app
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid := app.current_company_id();
  v_has boolean;
  v_overridden boolean;
  v_override_grants boolean;
begin
  -- Superadmin tiene todo
  if app.is_superadmin() then
    return true;
  end if;

  if v_user_id is null or v_company_id is null then
    return false;
  end if;

  -- ¿Algún rol del usuario tiene el permiso?
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    join public.permissions_catalog pc on pc.id = rp.permission_id
    where ur.user_id = v_user_id
      and ur.company_id = v_company_id
      and ur.revoked_at is null
      and pc.module = p_module
      and pc.action = p_action
      and (p_scope is null or pc.scope = p_scope)
  ) into v_has;

  -- Override puntual del usuario: ¿tiene un grant/revoke explícito?
  select exists (
    select 1
    from public.permission_overrides po
    join public.permissions_catalog pc on pc.id = po.permission_id
    where po.user_id = v_user_id
      and po.company_id = v_company_id
      and pc.module = p_module
      and pc.action = p_action
      and (p_scope is null or pc.scope = p_scope)
      and (po.expires_at is null or po.expires_at > now())
  ),
  coalesce(
    (select po.granted
       from public.permission_overrides po
       join public.permissions_catalog pc on pc.id = po.permission_id
      where po.user_id = v_user_id
        and po.company_id = v_company_id
        and pc.module = p_module
        and pc.action = p_action
        and (p_scope is null or pc.scope = p_scope)
        and (po.expires_at is null or po.expires_at > now())
      order by po.created_at desc
      limit 1),
    false
  )
  into v_overridden, v_override_grants;

  if v_overridden then
    return v_override_grants;
  end if;

  return v_has;
end;
$$;

comment on function app.can(text, app.permission_action, app.permission_scope) is
  'Comprueba si el usuario actual tiene el permiso (módulo, acción, scope) por cualquier rol o override. Superadmin siempre true.';

-- -----------------------------------------------------------------------------
-- Otorgar EXECUTE a authenticated en todas las helpers
-- -----------------------------------------------------------------------------
grant usage on schema app to authenticated, anon, service_role;
grant execute on function app.current_company_id() to authenticated, anon;
grant execute on function app.is_superadmin() to authenticated, anon;
grant execute on function app.current_user_roles() to authenticated, anon;
grant execute on function app.current_user_departments() to authenticated, anon;
grant execute on function app.has_role(text) to authenticated;
grant execute on function app.in_department(text) to authenticated;
grant execute on function app.is_team_member_of(uuid, text) to authenticated;
grant execute on function app.team_member_ids() to authenticated;
grant execute on function app.can(text, app.permission_action, app.permission_scope) to authenticated;
