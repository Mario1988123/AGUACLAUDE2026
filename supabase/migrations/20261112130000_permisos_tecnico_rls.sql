-- =====================================================================
-- Permisos de técnicos (docs/PLAN_PERMISOS_TECNICOS.md, pasos M1–M3)
-- 2026-11-12 · NO APLICADA. Aplicar con Mario delante por la Management API
-- y hacer después el smoke test con el JWT de un técnico (ver el final).
--
-- "Solo técnico" = installer sin ningún otro rol (company_admin, directores,
-- sales_rep, telemarketer). Se lee de user_roles (fresco), no del JWT.
--
-- Antes de aplicar: el código ya no depende de estas lecturas (commits
-- aee877d y e101dbc: el técnico lee clientes, almacén y furgoneta con admin
-- + company_id). Revisar el inventario de lecturas RLS del técnico.
-- Comerciales (A5: tampoco ven cantidades) NO entran aquí: falta el
-- inventario de sus lecturas de stock (listProducts, propuestas…).
-- =====================================================================

begin;

-- ---------- M1 · funciones ----------

create or replace function app.es_solo_tecnico() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid() and ur.company_id = app.current_company_id()
                    and ur.revoked_at is null and ur.role_key = 'installer')
     and not exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid() and ur.company_id = app.current_company_id()
                    and ur.revoked_at is null
                    and ur.role_key in ('company_admin','technical_director','commercial_director',
                                        'telemarketing_director','sales_rep','telemarketer'))
$$;

-- Regla D3 + D4 (misma que listarClientesPendientes en role-scope.ts):
-- mantenimiento o instalación asignado a él y no cerrado, o cerrado < 24 h.
create or replace function app.cliente_pendiente_para_mi(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.installations i
          where i.company_id = app.current_company_id() and i.customer_id = p_customer_id
            and i.installer_user_id = auth.uid() and i.deleted_at is null
            and (i.status not in ('completed','cancelled') or i.completed_at > now() - interval '24 hours'))
      or exists (select 1 from public.maintenance_jobs m
          where m.company_id = app.current_company_id() and m.customer_id = p_customer_id
            and m.technician_user_id = auth.uid()
            and (m.status not in ('completed','cancelled') or m.completed_at > now() - interval '24 hours'))
$$;

revoke all on function app.es_solo_tecnico() from public, anon;
revoke all on function app.cliente_pendiente_para_mi(uuid) from public, anon;
grant execute on function app.es_solo_tecnico() to authenticated;
grant execute on function app.cliente_pendiente_para_mi(uuid) to authenticated;

-- ---------- M2 · customers: abrir los pendientes al técnico ----------
-- Igual que la política actual, cambiando la rama muerta
-- `has_role('installer') AND EXISTS(... WHERE false)`.
drop policy if exists customers_select_by_scope on public.customers;
create policy customers_select_by_scope on public.customers for select using (
  (company_id = app.current_company_id()) and (deleted_at is null) and (
    app.can('customers','view','all_company')
    or (app.can('customers','view','department') and app.in_department('sales'))
    or (app.can('customers','view','own') and (
          assigned_user_id = auth.uid()
          or exists (select 1 from public.leads l
                      where l.converted_to_customer_id = customers.id and l.created_by = auth.uid())))
    or (app.es_solo_tecnico() and app.cliente_pendiente_para_mi(customers.id))
  )
);
-- addresses hereda de customers (EXISTS) sin tocarla. UPDATE no cambia.

-- ---------- M3 · maintenance_jobs: el técnico solo los suyos ----------
drop policy if exists maintenance_jobs_select_tenant on public.maintenance_jobs;
create policy maintenance_jobs_select_tenant on public.maintenance_jobs for select using (
  company_id = app.current_company_id()
  and (not app.es_solo_tecnico() or technician_user_id = auth.uid())
);

drop policy if exists maintenance_jobs_modify on public.maintenance_jobs;
create policy maintenance_jobs_insert on public.maintenance_jobs for insert with check (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director') or app.has_role('installer')
       or app.has_role('commercial_director') or app.has_role('sales_rep'))
);
-- UPDATE: igual que antes, salvo el solo técnico, que solo toca los suyos.
-- sales_rep conserva su acceso (no se ha pedido cambiarlo).
create policy maintenance_jobs_update on public.maintenance_jobs for update using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director') or app.has_role('installer')
       or app.has_role('commercial_director') or app.has_role('sales_rep'))
  and (not app.es_solo_tecnico() or technician_user_id = auth.uid())
) with check (company_id = app.current_company_id());
-- DELETE solo nivel 1/2.
create policy maintenance_jobs_delete on public.maintenance_jobs for delete using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director') or app.has_role('commercial_director'))
);

-- ---------- M3 · almacenes y stock: cerrados al solo técnico ----------
-- Ojo: las políticas ALL también conceden SELECT, así que hay que quitar al
-- installer de las de escritura además de recortar las de lectura.

drop policy if exists warehouses_select_tenant on public.warehouses;
create policy warehouses_select_tenant on public.warehouses for select using (
  company_id = app.current_company_id()
  and (not app.es_solo_tecnico() or (kind = 'vehicle' and assigned_user_id = auth.uid()))
);
drop policy if exists warehouses_modify on public.warehouses;
create policy warehouses_modify on public.warehouses for all using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director'))
) with check (company_id = app.current_company_id());

-- Tablas con el mismo patrón: select de empresa + modify ALL con installer.
do $$
declare
  t record;
begin
  for t in select * from (values
      ('warehouse_stock',     'warehouse_stock_select_tenant',     'warehouse_stock_modify'),
      ('stock_movements',     'stock_movements_select_tenant',     'stock_movements_modify'),
      ('warehouse_locations', 'warehouse_locations_select_tenant', 'warehouse_locations_modify')
    ) as v(tabla, pol_sel, pol_mod)
  loop
    execute format('drop policy if exists %I on public.%I', t.pol_sel, t.tabla);
    execute format($p$create policy %I on public.%I for select using (
      company_id = app.current_company_id() and not app.es_solo_tecnico())$p$, t.pol_sel, t.tabla);
    execute format('drop policy if exists %I on public.%I', t.pol_mod, t.tabla);
    execute format($p$create policy %I on public.%I for all using (
      company_id = app.current_company_id()
      and (app.has_role('company_admin') or app.has_role('technical_director')))
      with check (company_id = app.current_company_id())$p$, t.pol_mod, t.tabla);
  end loop;
end $$;

drop policy if exists stockres_select_tenant on public.stock_reservations;
create policy stockres_select_tenant on public.stock_reservations for select using (
  company_id = app.current_company_id() and not app.es_solo_tecnico()
);
drop policy if exists stockres_modify on public.stock_reservations;
create policy stockres_modify on public.stock_reservations for all using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director') or app.has_role('commercial_director'))
) with check (company_id = app.current_company_id());

drop policy if exists wst_select_tenant on public.warehouse_stock_thresholds;
create policy wst_select_tenant on public.warehouse_stock_thresholds for select using (
  company_id = app.current_company_id() and not app.es_solo_tecnico()
);
drop policy if exists stockalerts_select_tenant on public.stock_alerts;
create policy stockalerts_select_tenant on public.stock_alerts for select using (
  company_id = app.current_company_id() and not app.es_solo_tecnico()
);

drop policy if exists sl_select on public.stock_lots;
create policy sl_select on public.stock_lots for select using (
  company_id = app.current_company_id() and not app.es_solo_tecnico()
);
drop policy if exists sl_manage on public.stock_lots;
create policy sl_manage on public.stock_lots for all using (
  company_id = app.current_company_id()
  and exists (select 1 from public.user_roles ur
               where ur.user_id = auth.uid() and ur.revoked_at is null
                 and ur.role_key = any (array['company_admin','technical_director']))
) with check (company_id = app.current_company_id());

drop policy if exists sc_select on public.stock_counts;
create policy sc_select on public.stock_counts for select using (
  company_id = app.current_company_id() and not app.es_solo_tecnico()
);
drop policy if exists sc_manage on public.stock_counts;
create policy sc_manage on public.stock_counts for all using (
  company_id = app.current_company_id()
  and exists (select 1 from public.user_roles ur
               where ur.user_id = auth.uid() and ur.revoked_at is null
                 and ur.role_key = any (array['company_admin','technical_director']))
) with check (company_id = app.current_company_id());

drop policy if exists sci_all on public.stock_count_items;
create policy sci_all on public.stock_count_items for all using (
  not app.es_solo_tecnico()
  and exists (select 1 from public.stock_counts sc
               where sc.id = stock_count_items.count_id and sc.company_id = app.current_company_id())
);

-- Órdenes de carga: el técnico solo ve las de su furgoneta y no escribe
-- (registrarMovimientoFurgoneta y deliverLoadingRequestAction van con admin).
drop policy if exists loading_requests_select_tenant on public.loading_requests;
create policy loading_requests_select_tenant on public.loading_requests for select using (
  company_id = app.current_company_id()
  and (not app.es_solo_tecnico() or exists (
        select 1 from public.warehouses w
         where w.company_id = loading_requests.company_id
           and w.kind = 'vehicle' and w.assigned_user_id = auth.uid()
           and w.id in (loading_requests.source_warehouse_id, loading_requests.destination_warehouse_id)))
);
drop policy if exists loading_requests_modify on public.loading_requests;
create policy loading_requests_modify on public.loading_requests for all using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director'))
) with check (company_id = app.current_company_id());

drop policy if exists loading_request_items_select_tenant on public.loading_request_items;
create policy loading_request_items_select_tenant on public.loading_request_items for select using (
  company_id = app.current_company_id()
  and (not app.es_solo_tecnico() or exists (
        select 1 from public.loading_requests lr
         where lr.id = loading_request_items.loading_request_id))
);
drop policy if exists loading_request_items_modify on public.loading_request_items;
create policy loading_request_items_modify on public.loading_request_items for all using (
  company_id = app.current_company_id()
  and (app.has_role('company_admin') or app.has_role('technical_director'))
) with check (company_id = app.current_company_id());

commit;

-- ---------- Smoke test (con el JWT de Sandro o Fernando, Mario delante) ----------
-- /rest/v1/warehouse_stock            → []
-- /rest/v1/warehouses                 → solo su furgoneta
-- /rest/v1/customers?select=id        → solo sus pendientes
-- /rest/v1/maintenance_jobs?select=id → solo los suyos
-- PATCH /rest/v1/warehouse_stock      → 0 filas o 42501
-- Y de punta a punta: registrar carga en /mi-furgoneta y cerrar un
-- mantenimiento con recambio (el descuento sale de su furgoneta).
