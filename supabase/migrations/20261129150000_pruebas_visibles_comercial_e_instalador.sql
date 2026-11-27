-- Pruebas gratuitas visibles para quien trabaja con ellas (fallo 2026-11-27).
--
-- 1) El instalador (rol installer) no tenía NINGÚN permiso sobre free_trials:
--    Sandro abría la prueba asignada desde la agenda/instalación y la RLS le
--    devolvía cero filas → página «no encontrada». Se le da «ver propias»
--    (la rama own ya admite assigned_installer_user_id = auth.uid()).
-- 2) El director técnico agenda e instala pruebas (puedeAgendarPrueba) pero
--    tampoco tenía permisos: se le da ver y editar toda la empresa, como al
--    admin en este módulo.
-- 3) La rama «own» solo miraba created_by: si el admin crea la prueba para el
--    lead/cliente de un comercial, el comercial dueño no la veía. Ahora
--    también la ve (y la gestiona) el comercial asignado al lead o al cliente.

-- 1 y 2: permisos por rol
insert into public.role_permissions (role_key, permission_id)
select r.role_key, pc.id
from (values
  ('installer', 'view', 'own'),
  ('technical_director', 'view', 'all_company'),
  ('technical_director', 'update', 'all_company')
) as r(role_key, action, scope)
join public.permissions_catalog pc
  on pc.module = 'free_trials'
 and pc.action::text = r.action
 and pc.scope::text = r.scope
where not exists (
  select 1 from public.role_permissions rp
  where rp.role_key = r.role_key and rp.permission_id = pc.id
);

-- 3: la rama own incluye al comercial dueño del lead o del cliente
drop policy if exists ft_select_by_scope on public.free_trials;
create policy ft_select_by_scope on public.free_trials
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('free_trials','view','all_company')
      or (app.can('free_trials','view','department') and (app.in_department('sales') or app.in_department('tech')))
      or (app.can('free_trials','view','own') and (
            created_by = auth.uid()
            or assigned_installer_user_id = auth.uid()
            or (lead_id is not null and exists (
                  select 1 from public.leads l
                  where l.id = free_trials.lead_id and l.assigned_user_id = auth.uid()))
            or (customer_id is not null and exists (
                  select 1 from public.customers c
                  where c.id = free_trials.customer_id and c.assigned_user_id = auth.uid()))
         ))
    )
  );

drop policy if exists ft_update on public.free_trials;
create policy ft_update on public.free_trials
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and status not in ('accepted','rejected','expired','removed')
    and (
      app.can('free_trials','update','all_company')
      or (app.can('free_trials','update','department') and (app.in_department('sales') or app.in_department('tech')))
      or (app.can('free_trials','update','own') and (
            created_by = auth.uid()
            or assigned_installer_user_id = auth.uid()
            or (lead_id is not null and exists (
                  select 1 from public.leads l
                  where l.id = free_trials.lead_id and l.assigned_user_id = auth.uid()))
            or (customer_id is not null and exists (
                  select 1 from public.customers c
                  where c.id = free_trials.customer_id and c.assigned_user_id = auth.uid()))
         ))
    )
  )
  with check (company_id = app.current_company_id());
