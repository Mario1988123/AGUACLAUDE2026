-- =============================================================================
-- 20260501120600_seeds_modules_roles_permissions.sql
-- Capa 2 · Paso 2.7 · Seeds de catálogos: módulos, roles, permisos.
--
-- IDEMPOTENTE (ON CONFLICT DO NOTHING / UPDATE).
-- =============================================================================

-- ===========================================================================
-- modules_catalog (19 módulos del prompt maestro + auth/settings core)
-- ===========================================================================
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order) values
  ('settings',           'Configuración',          'Configuración global de la empresa', 'settings',     true,  true,  false,  0),
  ('users_admin',        'Usuarios',               'Alta y gestión de usuarios',          'users-cog',    true,  true,  false,  1),
  ('notifications',      'Notificaciones',         'Campana de notificaciones',           'bell',         true,  true,  false,  5),
  ('dashboard',          'Dashboard',              'KPIs y comparativas',                 'layout-dashboard', true,  false, false, 10),
  ('agenda',             'Agenda',                 'Calendario y tareas',                 'calendar',     true,  false, false, 20),
  ('leads',              'Leads',                  'Contactos potenciales',               'contact',      true,  false, false, 30),
  ('customers',          'Clientes',               'Gestión de clientes',                 'users',        true,  false, false, 40),
  ('proposals',          'Propuestas',             'Propuestas comerciales',              'file-text',    true,  false, false, 50),
  ('contracts',          'Contratos',              'Contratos firmados',                  'file-signature', true,  false, false, 60),
  ('free_trials',        'Pruebas gratuitas',      'Equipos en prueba',                   'gift',         true,  false, false, 70),
  ('lost_sales',         'Ventas perdidas',        'Recuperación TMK',                    'trending-down', true,  false, false, 80),
  ('products',           'Productos',              'Catálogo, precios, recambios',        'package',      true,  false, false, 90),
  ('warehouses',         'Almacenes',              'Almacenes, furgonetas, carga',        'warehouse',    true,  false, false, 100),
  ('installations',      'Instalaciones',          'Partes de trabajo',                   'wrench',       true,  false, false, 110),
  ('maintenance',        'Mantenimientos',         'Mantenimientos preventivos',          'shield-check', true,  false, false, 120),
  ('incidents',          'Incidencias',            'Gestión de incidencias',              'alert-triangle', true,  false, false, 130),
  ('sales',              'Ventas',                 'Acumulado de ventas y objetivos',     'trending-up',  true,  false, false, 140),
  ('wallet',             'Wallet',                 'Cobros y liquidaciones',              'wallet',       true,  false, false, 150),
  ('points',             'Programa de puntos',     'Puntos y comisiones',                 'star',         false, false, true,  160),
  ('time_tracking',      'Fichajes',               'Control horario',                     'clock',        false, false, true,  170),
  ('savings_calculator', 'Calculadora ahorro',     'Comparativa de gasto',                'calculator',   false, false, true,  180),
  ('invoicing',          'Facturación',            'Albaranes y facturas',                'receipt',      false, false, true,  190),
  ('superadmin_console', 'Consola Superadmin',     'Gestión global del SaaS',             'shield',       false, true,  false, 999)
on conflict (key) do update set
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  icon = excluded.icon,
  default_active = excluded.default_active,
  is_core = excluded.is_core,
  is_parked = excluded.is_parked,
  sort_order = excluded.sort_order;

-- ===========================================================================
-- roles_catalog (8 roles)
-- ===========================================================================
insert into public.roles_catalog (key, label_es, level, default_department, description_es, is_global, sort_order) values
  ('superadmin',              'Superadministrador',     0, null,    'Owner del SaaS. Gestiona empresas tenant.', true,  0),
  ('company_admin',           'Administrador empresa',  1, null,    'Único admin por empresa. Controla todos los módulos.', false, 10),
  ('technical_director',      'Director técnico',       2, 'tech',  'Dirige instaladores y operaciones técnicas.', false, 20),
  ('commercial_director',     'Director comercial',     2, 'sales', 'Dirige equipo comercial.', false, 21),
  ('telemarketing_director',  'Director telemarketing', 2, 'tmk',   'Dirige equipo telemarketing y recuperación de ventas perdidas.', false, 22),
  ('installer',               'Instalador',             3, 'tech',  'Operativo nivel 3 técnico.', false, 30),
  ('sales_rep',               'Comercial',              3, 'sales', 'Operativo nivel 3 comercial.', false, 31),
  ('telemarketer',            'Teleoperador',           3, 'tmk',   'Operativo nivel 3 telemarketing.', false, 32)
on conflict (key) do update set
  label_es = excluded.label_es,
  level = excluded.level,
  default_department = excluded.default_department,
  description_es = excluded.description_es,
  is_global = excluded.is_global,
  sort_order = excluded.sort_order;

-- ===========================================================================
-- permissions_catalog
-- Generamos los permisos por módulo desde la matriz documentada en ADR 0001.
-- Catálogo completo: por cada módulo y acción aplicable, una entrada por scope.
-- ===========================================================================

-- Helper: insertar permiso si no existe
create or replace function app._upsert_permission(
  p_module text,
  p_action app.permission_action,
  p_scope app.permission_scope,
  p_description text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.permissions_catalog (module, action, scope, description_es)
  values (p_module, p_action, p_scope, p_description)
  on conflict (module, action, scope) do update
    set description_es = coalesce(excluded.description_es, permissions_catalog.description_es)
  returning id into v_id;
  return v_id;
end;
$$;

-- Generamos permisos para los módulos principales con scopes razonables.
-- (Nota: no toda combinación módulo×acción×scope tiene sentido; se generan
--  las útiles. Los permisos no usados simplemente nunca se asignarán a roles.)

do $$
declare
  m text;
  modules text[] := array[
    'settings', 'users_admin', 'dashboard', 'agenda',
    'leads', 'customers', 'proposals', 'contracts', 'free_trials', 'lost_sales',
    'products', 'warehouses', 'installations', 'maintenance', 'incidents',
    'sales', 'wallet', 'notifications',
    'points', 'time_tracking', 'savings_calculator', 'invoicing'
  ];
  scope_a app.permission_scope;
  scopes app.permission_scope[] := array['all_company','department','assigned_team','own']::app.permission_scope[];
  action_a app.permission_action;
  actions app.permission_action[] := array['view','create','update','delete','approve','assign','export']::app.permission_action[];
begin
  foreach m in array modules loop
    foreach action_a in array actions loop
      foreach scope_a in array scopes loop
        perform app._upsert_permission(m, action_a, scope_a, null);
      end loop;
    end loop;
  end loop;

  -- Permisos del superadmin_console solo en scope global
  foreach action_a in array actions loop
    perform app._upsert_permission('superadmin_console', action_a, 'global', null);
  end loop;
end $$;

-- ===========================================================================
-- role_permissions
-- Asignamos a cada rol los permisos según matriz de ADR 0001 § 4.
-- Para simplicidad usamos un upsert por (role_key, module, action, scope).
-- ===========================================================================

create or replace function app._grant(
  p_role_key text,
  p_module text,
  p_action app.permission_action,
  p_scope app.permission_scope,
  p_field_restrictions jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare
  v_perm_id uuid;
begin
  select id into v_perm_id
    from public.permissions_catalog
   where module = p_module and action = p_action and scope = p_scope;

  if v_perm_id is null then
    raise exception 'Permission not found: % % %', p_module, p_action, p_scope;
  end if;

  insert into public.role_permissions (role_key, permission_id, field_restrictions)
  values (p_role_key, v_perm_id, p_field_restrictions)
  on conflict (role_key, permission_id) do update
    set field_restrictions = excluded.field_restrictions;
end;
$$;

-- ----- superadmin: superadmin_console all global; el resto se gestiona vía
-- app.is_superadmin() en RLS, no necesita permisos catalogados aquí.
do $$
declare
  a app.permission_action;
begin
  for a in select unnest(array['view','create','update','delete','approve','assign','export']::app.permission_action[]) loop
    perform app._grant('superadmin', 'superadmin_console', a, 'global');
  end loop;
end $$;

-- ----- company_admin: all_company en TODO menos superadmin_console
do $$
declare
  m text;
  a app.permission_action;
  modules text[] := array[
    'settings', 'users_admin', 'dashboard', 'agenda',
    'leads', 'customers', 'proposals', 'contracts', 'free_trials', 'lost_sales',
    'products', 'warehouses', 'installations', 'maintenance', 'incidents',
    'sales', 'wallet', 'notifications', 'points', 'time_tracking',
    'savings_calculator', 'invoicing'
  ];
begin
  foreach m in array modules loop
    for a in select unnest(array['view','create','update','delete','approve','assign','export']::app.permission_action[]) loop
      perform app._grant('company_admin', m, a, 'all_company');
    end loop;
  end loop;
end $$;

-- ----- technical_director: department en módulos técnicos
do $$
declare
  a app.permission_action;
  m text;
  modules text[] := array['installations','maintenance','incidents','warehouses','agenda','dashboard','products'];
begin
  foreach m in array modules loop
    for a in select unnest(array['view','create','update','assign','export']::app.permission_action[]) loop
      perform app._grant('technical_director', m, a, 'department');
    end loop;
  end loop;
  perform app._grant('technical_director', 'incidents', 'approve', 'department');
  -- Sin precios visibles
  perform app._grant('technical_director', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost", "margin", "supplier_price"]}}'::jsonb);
  -- Notificaciones propias
  perform app._grant('technical_director', 'notifications', 'view', 'own');
end $$;

-- ----- commercial_director: department en módulos comerciales
do $$
declare
  a app.permission_action;
  m text;
  modules text[] := array['leads','customers','proposals','contracts','sales','wallet','agenda','dashboard'];
begin
  foreach m in array modules loop
    for a in select unnest(array['view','create','update','assign','export']::app.permission_action[]) loop
      perform app._grant('commercial_director', m, a, 'department');
    end loop;
  end loop;
  perform app._grant('commercial_director', 'proposals', 'approve', 'department');
  perform app._grant('commercial_director', 'wallet', 'approve', 'department');
  -- Productos: ver con precios pero sin cost/margin
  perform app._grant('commercial_director', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost", "margin", "supplier_price"]}}'::jsonb);
  perform app._grant('commercial_director', 'free_trials', 'view', 'department');
  perform app._grant('commercial_director', 'free_trials', 'create', 'department');
  perform app._grant('commercial_director', 'lost_sales', 'view', 'department');
  perform app._grant('commercial_director', 'notifications', 'view', 'own');
end $$;

-- ----- telemarketing_director
do $$
declare
  a app.permission_action;
  m text;
begin
  for a in select unnest(array['view','create','update','assign','export']::app.permission_action[]) loop
    perform app._grant('telemarketing_director', 'leads', a, 'department');
    perform app._grant('telemarketing_director', 'lost_sales', a, 'department');
    perform app._grant('telemarketing_director', 'agenda', a, 'department');
    perform app._grant('telemarketing_director', 'sales', 'view', 'department');
    perform app._grant('telemarketing_director', 'dashboard', 'view', 'department');
  end loop;
  perform app._grant('telemarketing_director', 'lost_sales', 'assign', 'department');
  -- Lectura de leads ya entregados a comercial (decisión 1.4: solo lectura)
  -- (El scope `department` filtra vista; la edición la deniega RLS específica.)
  perform app._grant('telemarketing_director', 'notifications', 'view', 'own');
  -- Productos: solo categoría/atributo (sin precios)
  perform app._grant('telemarketing_director', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost","margin","supplier_price","price_pvp","price_min_sales_rep","price_min_absolute","renting_options","alquiler_options"]}}'::jsonb);
end $$;

-- ----- installer (nivel 3 técnico)
do $$
declare
  a app.permission_action;
begin
  perform app._grant('installer', 'installations', 'view', 'own');
  perform app._grant('installer', 'installations', 'update', 'own');
  perform app._grant('installer', 'maintenance', 'view', 'own');
  perform app._grant('installer', 'maintenance', 'update', 'own');
  perform app._grant('installer', 'incidents', 'view', 'own');
  perform app._grant('installer', 'incidents', 'create', 'own');
  perform app._grant('installer', 'agenda', 'view', 'own');
  perform app._grant('installer', 'dashboard', 'view', 'own');
  perform app._grant('installer', 'notifications', 'view', 'own');
  perform app._grant('installer', 'wallet', 'create', 'own');                  -- registrar cobros
  -- Productos: solo nombre, imagen, atributos técnicos. Sin precios.
  perform app._grant('installer', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost","margin","supplier_price","price_pvp","price_min_sales_rep","price_min_absolute","renting_options","alquiler_options"]}}'::jsonb);
  -- Almacenes: solo su furgoneta (scope own filtrará)
  perform app._grant('installer', 'warehouses', 'view', 'own');
end $$;

-- ----- sales_rep (nivel 3 comercial)
do $$
declare
  a app.permission_action;
  m text;
begin
  for m in select unnest(array['leads','customers','proposals','contracts','free_trials','wallet','sales','agenda','dashboard']::text[]) loop
    perform app._grant('sales_rep', m, 'view', 'own');
    perform app._grant('sales_rep', m, 'create', 'own');
    perform app._grant('sales_rep', m, 'update', 'own');
  end loop;
  perform app._grant('sales_rep', 'incidents', 'create', 'own');
  perform app._grant('sales_rep', 'notifications', 'view', 'own');
  -- Productos: ve con precios PVP y price_min_sales_rep, pero NO el absoluto, cost, margin (decisión 1.6)
  perform app._grant('sales_rep', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost","margin","supplier_price","price_min_absolute"]}}'::jsonb);
end $$;

-- ----- telemarketer (nivel 3 TMK)
do $$
begin
  perform app._grant('telemarketer', 'leads', 'view', 'own');
  perform app._grant('telemarketer', 'leads', 'create', 'own');
  perform app._grant('telemarketer', 'leads', 'update', 'own');
  perform app._grant('telemarketer', 'lost_sales', 'view', 'own');
  perform app._grant('telemarketer', 'lost_sales', 'update', 'own');
  perform app._grant('telemarketer', 'agenda', 'view', 'own');
  perform app._grant('telemarketer', 'agenda', 'create', 'own');
  perform app._grant('telemarketer', 'sales', 'view', 'own');                  -- decisión 1.8: ve venta del lead que entregó (para comisión)
  perform app._grant('telemarketer', 'dashboard', 'view', 'own');
  perform app._grant('telemarketer', 'notifications', 'view', 'own');
  perform app._grant('telemarketer', 'incidents', 'create', 'own');
  -- Productos: solo nombre/categoría, sin precios
  perform app._grant('telemarketer', 'products', 'view', 'all_company',
    '{"products": {"hidden_fields": ["cost","margin","supplier_price","price_pvp","price_min_sales_rep","price_min_absolute","renting_options","alquiler_options"]}}'::jsonb);
end $$;

-- Limpieza: eliminar las funciones helper que solo se usaron en este seed
drop function app._grant(text, text, app.permission_action, app.permission_scope, jsonb);
drop function app._upsert_permission(text, app.permission_action, app.permission_scope, text);
