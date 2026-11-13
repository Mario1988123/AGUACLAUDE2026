-- =============================================================================
-- scripts/datos_modelo_equipo_infinity.sql — M4 del plan
-- docs/PLAN_MODELO_EQUIPO_CLIENTE.md. SOLO Infinity Aqua (f02d586c-…).
--
-- REQUISITO: aplicada antes la migración 20261113090000_modelo_equipo_cliente.sql.
-- Se ejecuta CON MARIO DELANTE. Es una sola transacción: si una gama no se
-- encuentra por su nombre exacto, aborta y no cambia nada.
-- Regla 0: no se renombra ni se mueve de categoría ningún producto.
-- Idempotente: se puede repetir sin duplicar variantes ni equipos.
--
-- NO hace el recuento de stock por variante (decisión 10): eso va por el
-- flujo de recuento del almacén, que deja movimiento.
-- =============================================================================

begin;

do $$
declare
  v_co constant uuid := 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';
  v_gama uuid;
  v_hija uuid;
  v_par record;
  v_n integer;
begin
  -- 1) Tipo en categorías (dispensadores = fuente, decisión 2).
  update public.product_categories set tipo_equipo = 'fuente'
   where company_id = v_co and lower(btrim(name)) in ('fuente', 'fuentes', 'dispensadores');
  update public.product_categories set tipo_equipo = 'osmosis'
   where company_id = v_co and lower(btrim(name)) in ('osmosis inversa', 'ósmosis flujo directo', 'osmosis flujo directo');

  -- Regla 0: Blue, Blue-S y Beast son ósmosis aunque su categoría diga otra cosa.
  update public.products set tipo_equipo = 'osmosis'
   where company_id = v_co and deleted_at is null
     and lower(btrim(name)) in ('infinity blue', 'infinity blue- s', 'infinity blue-s', 'infinity beast', 'golden eye');

  -- 2) Variantes. Gama → denominaciones (nombre exacto de la lista de Mario).
  for v_par in
    select * from (values
      ('infinity basic',              array['FIORD','425','525','725','ESSENTIAL','FUENTE DE PIE','FIORD BLACK','REGULAR','FUENTE']),
      ('infinity basic s (compact)',  array['FIORD S','SOBREMESA','750 S','630','S PREMIUM','COMPACT']),
      ('infinity indic',              array['FIORD PLUS','INDIC','INFINITY PLUS']),
      ('infinity direct basic',       array['SMART','FLUJO DIRECTO','JAVA','STELLA'])
    ) as t(gama, hijas)
  loop
    select id into v_gama from public.products
     where company_id = v_co and deleted_at is null and lower(btrim(name)) = v_par.gama;
    if v_gama is null then
      raise exception 'No encuentro la gama «%» en Infinity (¿nombre distinto?)', v_par.gama;
    end if;
    insert into public.products (company_id, kind, name, category_id, stock_managed, is_active, gama_id)
    select v_co, g.kind, h.nombre, g.category_id, g.stock_managed, true, g.id
      from public.products g
      cross join unnest(v_par.hijas) as h(nombre)
     where g.id = v_gama
       and not exists (
         select 1 from public.products p
          where p.company_id = v_co and p.gama_id = v_gama and p.deleted_at is null
            and lower(btrim(p.name)) = lower(h.nombre));
  end loop;

  -- Productos que YA existen y pasan a ser variantes (sin renombrar).
  for v_par in
    select * from (values ('infinity 1300', 'infinity indic'), ('infinity cool', 'infinity direct basic'))
      as t(hija, gama)
  loop
    select id into v_gama from public.products
     where company_id = v_co and deleted_at is null and lower(btrim(name)) = v_par.gama;
    select id into v_hija from public.products
     where company_id = v_co and deleted_at is null and lower(btrim(name)) = v_par.hija;
    if v_gama is null or v_hija is null then
      raise exception 'No encuentro «%» o «%»', v_par.hija, v_par.gama;
    end if;
    update public.products set gama_id = v_gama where id = v_hija and gama_id is distinct from v_gama;
  end loop;

  -- 3) CORSA FIORD S (figuraba como de otra marca) → variante FIORD S de Basic S (decisión 8).
  select p.id into v_hija from public.products p
    join public.products g on g.id = p.gama_id
   where p.company_id = v_co and lower(btrim(g.name)) = 'infinity basic s (compact)'
     and lower(btrim(p.name)) = 'fiord s' and p.deleted_at is null;
  update public.customer_equipment ce
     set product_id = v_hija, external_equipment_model_id = null,
         modelo_origen = 'oficina', modelo_identificado_at = now()
    from public.external_equipment_models m
   where ce.company_id = v_co and ce.external_equipment_model_id = m.id
     and (lower(coalesce(m.brand, '') || ' ' || coalesce(m.model, '')) like '%fiord s%');
  get diagnostics v_n = row_count;
  raise notice 'CORSA FIORD S pasados a variante: %', v_n;

  -- 4) Equipos activos cuya gama tiene variantes → falta la variante.
  update public.customer_equipment ce
     set pendiente_identificar = true,
         tipo_equipo = coalesce(ce.tipo_equipo, p.tipo_equipo, pc.tipo_equipo)
    from public.products p
    left join public.product_categories pc on pc.id = p.category_id
   where ce.company_id = v_co and ce.is_active and ce.product_id = p.id
     and p.gama_id is null
     and exists (select 1 from public.products h where h.gama_id = p.id and h.deleted_at is null);
  get diagnostics v_n = row_count;
  raise notice 'Equipos marcados «falta la variante»: %', v_n;

  -- Tipo guardado en los equipos ya identificados (para listados rápidos).
  update public.customer_equipment ce
     set tipo_equipo = coalesce(p.tipo_equipo, g.tipo_equipo, pc.tipo_equipo, gc.tipo_equipo)
    from public.products p
    left join public.products g on g.id = p.gama_id
    left join public.product_categories pc on pc.id = p.category_id
    left join public.product_categories gc on gc.id = g.category_id
   where ce.company_id = v_co and ce.product_id = p.id and ce.tipo_equipo is null;

  -- 5) Un equipo pendiente (sin tipo, decisión 21) por cliente vivo sin ninguno.
  --    «Vivo» = no borrado (verificar con Mario si hay otro criterio de baja).
  insert into public.customer_equipment
    (company_id, customer_id, address_id, is_active, pendiente_identificar, modelo_origen)
  select v_co, c.id,
         (select a.id from public.addresses a
           where a.customer_id = c.id and a.company_id = v_co and a.deleted_at is null
           order by a.is_primary desc, a.created_at limit 1),
         true, true, 'importacion'
    from public.customers c
   where c.company_id = v_co and c.deleted_at is null
     and not exists (select 1 from public.customer_equipment ce where ce.customer_id = c.id);
  get diagnostics v_n = row_count;
  raise notice 'Equipos pendientes creados: %', v_n;

  -- 6) Mantenimientos abiertos sin equipo → al único equipo activo del cliente.
  update public.maintenance_jobs mj
     set customer_equipment_id = x.eq_id
    from (
      select ce.customer_id, min(ce.id::text)::uuid as eq_id
        from public.customer_equipment ce
       where ce.company_id = v_co and ce.is_active
       group by ce.customer_id
      having count(*) = 1
    ) x
   where mj.company_id = v_co and mj.customer_id = x.customer_id
     and mj.customer_equipment_id is null
     and mj.status not in ('completed', 'cancelled');
  get diagnostics v_n = row_count;
  raise notice 'Mantenimientos enlazados a su equipo: %', v_n;

  -- 7) Decisión 22: membrana Golden Eye 800 GDP asignada a Golden Eye.
  insert into public.product_filter_assignments
    (company_id, product_id, filter_id, stage_position, replacement_period_months,
     is_required, quantity_per_change, notes)
  select v_co, '41e45af5-7213-4595-b4db-7471cd4b686a', '56c53a6c-e249-4188-9c46-18182bb772a5',
         2, 36, true, 1, 'Asignada según decisión de Mario 2026-11-12'
   where not exists (
     select 1 from public.product_filter_assignments
      where product_id = '41e45af5-7213-4595-b4db-7471cd4b686a'
        and filter_id = '56c53a6c-e249-4188-9c46-18182bb772a5');
end $$;

-- Comprobaciones (deben salir 0 / lo esperado) antes del COMMIT:
select count(*) as clientes_vivos_sin_equipo
  from public.customers c
 where c.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c' and c.deleted_at is null
   and not exists (select 1 from public.customer_equipment ce where ce.customer_id = c.id);

select count(*) as mantenimientos_abiertos_sin_equipo
  from public.maintenance_jobs
 where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
   and customer_equipment_id is null and status not in ('completed', 'cancelled');

select g.name as gama, count(h.id) as variantes
  from public.products g join public.products h on h.gama_id = g.id
 where g.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
 group by g.name order by g.name;

-- Si todo cuadra:
commit;
-- Si no: rollback;
