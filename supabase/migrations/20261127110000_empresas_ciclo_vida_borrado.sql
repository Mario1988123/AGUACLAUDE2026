-- =============================================================================
-- Empresas: ciclo de vida y borrado definitivo (superadmin) — 2026-11-27
-- =============================================================================
-- ADITIVA. No cambia ni borra datos salvo marcar las dos empresas protegidas.
--
-- 1. companies.protegida: una empresa protegida no se puede borrar nunca, ni
--    desde la app ni con un DELETE a mano (trigger). aquaroo e INFINITY AQUA
--    quedan protegidas. Además sus ids van FIJOS en el trigger y en la función,
--    así que desmarcar la columna no basta para borrarlas.
--
-- 2. public.borrar_empresa_definitiva(p_company_id, p_confirmar_nombre, p_actor):
--    borra todos los datos de la empresa en el orden que piden las claves
--    foráneas RESTRICT / NO ACTION, y devuelve lo que la app tiene que limpiar
--    fuera de la base de datos:
--      · usuarios: cuentas de auth.users que SOLO eran de esta empresa (se
--        borran desde la app con auth.admin.deleteUser, que limpia también
--        identidades y sesiones). Las de superadmin o las que también están en
--        otra empresa no salen en la lista.
--      · ficheros: objetos de Storage cuyo primer segmento de ruta es el id de
--        la empresa (así suben todas las acciones). Se borran desde la app con
--        la API de Storage: Supabase no deja borrar storage.objects por SQL.
--    Solo la puede ejecutar service_role (la acción de servidor, tras comprobar
--    que quien llama es superadmin); p_actor tiene que estar en superadmins.
--
-- El estado (activa / pausada / baja) NO necesita columna nueva: ya existe
-- companies.status (app.company_status: trial, active, suspended, cancelled) y
-- companies.cancelled_at. Lo que faltaba era que se respetase: eso va en el
-- código (requireSession), no aquí.
-- =============================================================================

alter table public.companies
  add column if not exists protegida boolean not null default false;

comment on column public.companies.protegida is
  'Si true, la empresa no se puede borrar (trigger trg_companies_no_borrar_protegida y función borrar_empresa_definitiva).';

update public.companies
   set protegida = true
 where id in (
   '1d5d958b-9ce4-4bd9-8db9-0a4884765e0f', -- aquaroo
   'f02d586c-0dc6-49e4-83e5-e0f6e688237c'  -- INFINITY AQUA
 )
   and protegida is distinct from true;

-- -----------------------------------------------------------------------------
-- Trigger: ningún DELETE (ni a mano ni en cascada) puede llevarse una empresa
-- protegida.
-- -----------------------------------------------------------------------------
create or replace function app.impedir_borrar_empresa_protegida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.protegida
     or old.id in (
       '1d5d958b-9ce4-4bd9-8db9-0a4884765e0f'::uuid,
       'f02d586c-0dc6-49e4-83e5-e0f6e688237c'::uuid
     ) then
    raise exception 'La empresa «%» está protegida y no se puede borrar.', old.name
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_companies_no_borrar_protegida on public.companies;
create trigger trg_companies_no_borrar_protegida
  before delete on public.companies
  for each row execute function app.impedir_borrar_empresa_protegida();

-- -----------------------------------------------------------------------------
-- Borrado definitivo
-- -----------------------------------------------------------------------------
-- Orden: las tablas con company_id se borran por pasadas. En cada pasada se
-- intenta borrar cada tabla pendiente dentro de un subbloque (savepoint); si
-- una clave RESTRICT / NO ACTION lo impide (23503) porque otra tabla de la
-- empresa aún apunta a ella, se deja para la pasada siguiente. Así el orden sale
-- de las claves reales que haya en ese momento y no de una lista escrita a mano
-- que se queda vieja con cada migración. Si una pasada no avanza, se aborta con
-- el último error (y no se ha borrado nada: todo va en la misma transacción).
--
-- Las tablas cuya FK a companies es ON DELETE SET NULL (error_reports,
-- invoice_verifactu_events, superadmin_audit_log) NO se vacían: quien diseñó
-- esa FK quiso conservar las filas. Se quedan con company_id a null.
-- -----------------------------------------------------------------------------
create or replace function public.borrar_empresa_definitiva(
  p_company_id uuid,
  p_confirmar_nombre text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_protegidas constant uuid[] := array[
    '1d5d958b-9ce4-4bd9-8db9-0a4884765e0f'::uuid, -- aquaroo
    'f02d586c-0dc6-49e4-83e5-e0f6e688237c'::uuid  -- INFINITY AQUA
  ];
  v_empresa record;
  v_pendientes text[];
  v_siguientes text[];
  v_tabla text;
  v_n bigint;
  v_pasada int := 0;
  v_ultimo_error text;
  v_recuentos jsonb := '{}'::jsonb;
  v_usuarios uuid[] := '{}';
  v_ficheros jsonb := '[]'::jsonb;
  v_n_verifactu bigint := 0;
begin
  if p_company_id is null then
    raise exception 'Falta la empresa.' using errcode = 'P0001';
  end if;
  if p_actor is null
     or not exists (select 1 from public.superadmins s where s.user_id = p_actor) then
    raise exception 'Solo un superadmin puede borrar empresas.' using errcode = 'P0001';
  end if;
  if p_company_id = any (v_protegidas) then
    raise exception 'Esta empresa está protegida y no se puede borrar.' using errcode = 'P0001';
  end if;

  select id, name, slug, status::text as status, protegida
    into v_empresa
    from public.companies
   where id = p_company_id
   for update;
  if not found then
    raise exception 'La empresa no existe.' using errcode = 'P0001';
  end if;
  if v_empresa.protegida then
    raise exception 'La empresa «%» está protegida y no se puede borrar.', v_empresa.name
      using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_confirmar_nombre, '')) <> btrim(v_empresa.name) then
    raise exception 'El nombre escrito no coincide con el de la empresa.' using errcode = 'P0001';
  end if;
  if v_empresa.status = 'active' then
    raise exception 'Una empresa activa no se puede borrar: pausa o da de baja la empresa antes.'
      using errcode = 'P0001';
  end if;

  -- Los registros VeriFactu son inmutables por ley (trigger
  -- verifactu_records_immutable): si los hay, no se puede borrar.
  if to_regclass('public.invoice_verifactu_records') is not null then
    execute 'select count(*) from public.invoice_verifactu_records where company_id = $1'
      into v_n_verifactu using p_company_id;
    if v_n_verifactu > 0 then
      raise exception 'La empresa tiene % registros VeriFactu, que la ley obliga a conservar. Dala de baja en lugar de borrarla.', v_n_verifactu
        using errcode = 'P0001';
    end if;
  end if;

  -- 1) Cuentas de Auth que SOLO pertenecen a esta empresa. Se calcula ANTES de
  --    borrar perfiles y roles.
  with candidatos as (
    select user_id from public.user_profiles where company_id = p_company_id
    union
    select user_id from public.user_roles where company_id = p_company_id
    union
    select user_id from public.customer_portal_accounts where company_id = p_company_id
  )
  select coalesce(array_agg(distinct c.user_id), '{}')
    into v_usuarios
    from candidatos c
   where c.user_id is not null
     and not exists (select 1 from public.superadmins s where s.user_id = c.user_id)
     and not exists (
       select 1 from auth.users u
        where u.id = c.user_id
          and coalesce(u.raw_app_meta_data ->> 'is_superadmin', 'false') = 'true'
     )
     and not exists (
       select 1 from public.user_roles r
        where r.user_id = c.user_id and r.company_id <> p_company_id
     )
     and not exists (
       select 1 from public.user_profiles p
        where p.user_id = c.user_id and p.company_id <> p_company_id
     )
     and not exists (
       select 1 from public.customer_portal_accounts a
        where a.user_id = c.user_id and a.company_id <> p_company_id
     );

  -- 2) Ficheros de Storage con prefijo de empresa (catalog-global es del maestro).
  if to_regclass('storage.objects') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)), '[]'::jsonb)
        from storage.objects o
       where o.bucket_id <> 'catalog-global'
         and split_part(o.name, '/', 1) = $1
    $q$ into v_ficheros using p_company_id::text;
  end if;

  -- 3) Tablas de public con company_id que caen con la empresa: las que tienen
  --    FK a companies ON DELETE CASCADE, y las que guardan company_id sin FK.
  select coalesce(array_agg(format('%I.%I', n.nspname, c.relname) order by c.relname), '{}')
    into v_pendientes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and c.relname <> 'companies'
     and not exists (
       -- excluir las que apuntan a companies con SET NULL / SET DEFAULT
       select 1 from pg_constraint f
        where f.contype = 'f'
          and f.conrelid = c.oid
          and f.confrelid = 'public.companies'::regclass
          and f.conkey = array[a.attnum]
          and f.confdeltype in ('n', 'd')
     );

  -- 4) Borrado por pasadas.
  while coalesce(array_length(v_pendientes, 1), 0) > 0 loop
    v_pasada := v_pasada + 1;
    v_siguientes := '{}';
    foreach v_tabla in array v_pendientes loop
      begin
        execute format('delete from %s where company_id = $1', v_tabla) using p_company_id;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_recuentos := v_recuentos || jsonb_build_object(v_tabla, v_n);
        end if;
      exception when foreign_key_violation then
        v_siguientes := v_siguientes || v_tabla;
        v_ultimo_error := sqlerrm;
      end;
    end loop;

    if coalesce(array_length(v_siguientes, 1), 0) = coalesce(array_length(v_pendientes, 1), 0) then
      raise exception 'No se pudo borrar la empresa: hay datos que bloquean el borrado (% ). Último error: %',
        array_to_string(v_siguientes, ', '), v_ultimo_error
        using errcode = 'P0001';
    end if;
    v_pendientes := v_siguientes;
    if v_pasada > 50 then
      raise exception 'Borrado de empresa: demasiadas pasadas.' using errcode = 'P0001';
    end if;
  end loop;

  -- 5) La empresa. La cascada se lleva lo que hayan añadido los triggers de
  --    auditoría al borrar (audit_log) y lo que quede.
  delete from public.companies where id = p_company_id;

  -- 6) Rastro en la auditoría del superadmin (affected_company_id va a null
  --    porque la empresa ya no existe; el id y el nombre quedan en payload).
  insert into public.superadmin_audit_log (actor_user_id, action, affected_company_id, payload)
  values (
    p_actor,
    'company.deleted.db',
    null,
    jsonb_build_object(
      'company_id', v_empresa.id,
      'name', v_empresa.name,
      'slug', v_empresa.slug,
      'filas', v_recuentos,
      'pasadas', v_pasada,
      'usuarios_a_borrar', coalesce(array_length(v_usuarios, 1), 0),
      'ficheros_a_borrar', jsonb_array_length(v_ficheros)
    )
  );

  return jsonb_build_object(
    'company_id', v_empresa.id,
    'name', v_empresa.name,
    'filas', v_recuentos,
    'pasadas', v_pasada,
    'usuarios', to_jsonb(v_usuarios),
    'ficheros', v_ficheros
  );
end;
$$;

comment on function public.borrar_empresa_definitiva(uuid, text, uuid) is
  'Superadmin: borra una empresa y todos sus datos. Devuelve usuarios de Auth y ficheros de Storage que la app debe borrar después. Solo service_role.';

revoke all on function public.borrar_empresa_definitiva(uuid, text, uuid) from public;
revoke all on function public.borrar_empresa_definitiva(uuid, text, uuid) from anon, authenticated;
grant execute on function public.borrar_empresa_definitiva(uuid, text, uuid) to service_role;
