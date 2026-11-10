-- =============================================================================
-- user_profiles: un usuario NO puede cambiarse a sí mismo la empresa, el
-- estado ni el aviso de cambio de contraseña (revisión de seguridad 2026-11-11).
--
-- La política user_profiles_update_self solo exige user_id = auth.uid(), y el
-- rol authenticated tiene UPDATE sobre todas las columnas. Con un PATCH a
-- /rest/v1/user_profiles un empleado podía:
--   · poner company_id = <otra empresa> → el hook del JWT le daba esa empresa;
--   · poner status = 'active' estando suspendido.
-- Esas columnas solo las cambia el servidor con service_role (alta de usuarios,
-- suspensiones, markPasswordChangedAction), al que este trigger no afecta.
-- =============================================================================

create or replace function app.user_profiles_proteger_columnas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and old.user_id = auth.uid()
     and (
       new.company_id is distinct from old.company_id
       or new.status is distinct from old.status
       or new.must_change_password is distinct from old.must_change_password
       or new.user_id is distinct from old.user_id
     )
  then
    raise exception 'No puedes cambiar la empresa, el estado ni la contraseña obligatoria de tu propio perfil'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_proteger_columnas on public.user_profiles;
create trigger trg_user_profiles_proteger_columnas
  before update on public.user_profiles
  for each row execute function app.user_profiles_proteger_columnas();
