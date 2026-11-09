-- =============================================================================
-- 20261110090000_traspaso_equipo_completo.sql
-- Traspaso COMPLETO de un equipo instalado a otro cliente de la misma empresa
-- usuaria ("nos equivocamos de ficha: se arrastra todo").
--
-- 1) sepa_mandates: deja de haber un único mandato por contrato. El mandato
--    del cliente de origen se revoca (status 'cancelled', con fecha, autor y
--    motivo; NO se borra) y el cliente destino firma el suyo para el mismo
--    contrato. Solo puede haber UN mandato vivo (draft/active) por contrato.
--
-- 2) public.traspasar_equipo_a_cliente(): hace TODO el traspaso en una sola
--    transacción (o todo o nada). La llama el servidor con el cliente admin
--    (service_role) desde `transferEquipmentAction`, que antes ha validado
--    sesión, permisos y empresa y ha copiado la dirección.
--
--    Mueve al destino: los equipos, sus contratos de alquiler/renting/venta
--    (customer_id), sus instalaciones, TODOS sus mantenimientos y contratos de
--    mantenimiento, sus incidencias y los apuntes de monedero PENDIENTES y
--    SIN factura de esos contratos. Revoca los mandatos SEPA vivos de esos
--    contratos, anota el traspaso en internal_notes del contrato y escribe
--    los eventos de timeline (origen, destino y cada contrato).
--
--    NO toca: facturas (ni sus apuntes de monedero: lo facturado sigue siendo
--    del cliente que lo recibió), customer_snapshot ni firmas/PDF del
--    contrato (registro histórico de quién firmó), propuestas, comisiones ni
--    puntos.
--
-- Idempotente. NO APLICADA: la aplica Mario. Hasta entonces el botón de
-- traspaso devuelve "falta aplicar la migración".
-- =============================================================================

-- 1) Un mandato vivo por contrato (los revocados conviven con el nuevo) -------
do $$
declare
  v_con text;
begin
  for v_con in
    select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.sepa_mandates'::regclass
       and c.contype = 'u'
       and array_length(c.conkey, 1) = 1
       and a.attname = 'contract_id'
  loop
    execute format('alter table public.sepa_mandates drop constraint %I', v_con);
  end loop;
end $$;

create unique index if not exists sepa_mandates_un_vivo_por_contrato
  on public.sepa_mandates (contract_id)
  where status in ('draft', 'active');

create index if not exists idx_sm_contract on public.sepa_mandates (contract_id);

comment on index public.sepa_mandates_un_vivo_por_contrato is
  'Un solo mandato vivo (draft/active) por contrato. Los cancelados (p. ej. del titular anterior tras un traspaso) se conservan como histórico.';

-- 2) Traspaso atómico ---------------------------------------------------------
create or replace function public.traspasar_equipo_a_cliente(
  p_company_id       uuid,
  p_origen_id        uuid,
  p_destino_id       uuid,
  p_equipment_ids    uuid[],
  p_contract_ids     uuid[],
  p_old_address_id   uuid,
  p_new_address_id   uuid,
  p_detach_root_id   uuid,
  p_detach_children  uuid[],
  p_motivo           text,
  p_actor_user_id    uuid,
  p_payload          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipos       int := 0;
  v_contratos     int := 0;
  v_instalaciones int := 0;
  v_items         int := 0;
  v_trabajos      int := 0;
  v_mant          int := 0;
  v_incidencias   int := 0;
  v_monedero      int := 0;
  v_mandatos      int := 0;
  v_n             int;
  v_contract_ids  uuid[] := coalesce(p_contract_ids, '{}');
  v_inst_ids      uuid[];
  v_nota          text;
  v_payload       jsonb;
  v_cid           uuid;
begin
  if p_company_id is null or p_origen_id is null or p_destino_id is null then
    raise exception 'TRASPASO: faltan datos';
  end if;
  if p_origen_id = p_destino_id then
    raise exception 'TRASPASO: el destino es el mismo cliente';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'TRASPASO: el motivo es obligatorio';
  end if;
  if coalesce(array_length(p_equipment_ids, 1), 0) = 0 then
    raise exception 'TRASPASO: no hay equipos que traspasar';
  end if;

  -- Destino de la misma empresa y vivo.
  perform 1 from public.customers
   where id = p_destino_id and company_id = p_company_id and deleted_at is null;
  if not found then
    raise exception 'TRASPASO: el cliente destino no es de tu empresa o está borrado';
  end if;

  -- Bloqueo + comprobación: todos los equipos son de la empresa y del origen.
  select count(*) into v_n from (
    select id from public.customer_equipment
     where id = any (p_equipment_ids)
       and company_id = p_company_id
       and customer_id = p_origen_id
     for update
  ) e;
  if v_n <> array_length(p_equipment_ids, 1) then
    raise exception 'TRASPASO: algún equipo ya no es del cliente de origen (¿lo ha cambiado alguien?)';
  end if;

  -- Ídem con los contratos.
  if array_length(v_contract_ids, 1) > 0 then
    select count(*) into v_n from (
      select id from public.contracts
       where id = any (v_contract_ids)
         and company_id = p_company_id
         and customer_id = p_origen_id
         and deleted_at is null
       for update
    ) c;
    if v_n <> array_length(v_contract_ids, 1) then
      raise exception 'TRASPASO: algún contrato ya no es del cliente de origen (¿lo ha cambiado alguien?)';
    end if;
  end if;

  -- La dirección nueva tiene que ser del destino.
  if p_new_address_id is not null then
    perform 1 from public.addresses
     where id = p_new_address_id and company_id = p_company_id and customer_id = p_destino_id;
    if not found then
      raise exception 'TRASPASO: la dirección de destino no es del cliente destino';
    end if;
  end if;

  -- Instalaciones afectadas: las de los equipos y las de los contratos.
  select coalesce(array_agg(distinct i.id), '{}') into v_inst_ids
    from public.installations i
   where i.company_id = p_company_id
     and (
       i.id in (select installation_id from public.customer_equipment
                 where id = any (p_equipment_ids) and installation_id is not null)
       or i.contract_id = any (v_contract_ids)
     );

  -- Equipos.
  update public.customer_equipment
     set customer_id = p_destino_id,
         address_id = case
           when address_id is null or address_id = p_old_address_id then p_new_address_id
           else address_id end
   where id = any (p_equipment_ids) and company_id = p_company_id;
  get diagnostics v_equipos = row_count;

  if p_detach_root_id is not null then
    update public.customer_equipment set parent_equipment_id = null
     where id = p_detach_root_id and company_id = p_company_id;
  end if;
  if coalesce(array_length(p_detach_children, 1), 0) > 0 then
    update public.customer_equipment set parent_equipment_id = null
     where id = any (p_detach_children) and company_id = p_company_id;
  end if;

  -- Contratos (el snapshot y las firmas no se tocan: son de quien firmó).
  v_nota := format(
    '[%s] Traspasado de cliente (%s → %s). Motivo: %s. El PDF y las firmas son del titular original; las facturas ya emitidas siguen a su nombre.',
    to_char((now() at time zone 'Europe/Madrid')::date, 'DD/MM/YYYY'),
    coalesce(p_payload ->> 'from_customer_name', p_origen_id::text),
    coalesce(p_payload ->> 'to_customer_name', p_destino_id::text),
    btrim(p_motivo)
  );
  if array_length(v_contract_ids, 1) > 0 then
    update public.contracts
       set customer_id = p_destino_id,
           internal_notes = case
             when coalesce(internal_notes, '') = '' then v_nota
             else internal_notes || E'\n' || v_nota end
     where id = any (v_contract_ids) and company_id = p_company_id;
    get diagnostics v_contratos = row_count;

    update public.contract_items
       set installation_address_id = p_new_address_id
     where contract_id = any (v_contract_ids)
       and company_id = p_company_id
       and p_old_address_id is not null
       and installation_address_id = p_old_address_id;
    get diagnostics v_items = row_count;
  end if;

  -- Instalaciones.
  if array_length(v_inst_ids, 1) > 0 then
    update public.installations
       set customer_id = p_destino_id,
           address_id = case
             when address_id = p_old_address_id and p_new_address_id is not null then p_new_address_id
             else address_id end
     where id = any (v_inst_ids) and company_id = p_company_id;
    get diagnostics v_instalaciones = row_count;
  end if;

  -- Mantenimientos (todos: pendientes e historial).
  update public.maintenance_jobs
     set customer_id = p_destino_id,
         address_id = case
           when address_id is null or address_id = p_old_address_id then p_new_address_id
           else address_id end
   where company_id = p_company_id
     and customer_id = p_origen_id
     and (customer_equipment_id = any (p_equipment_ids) or contract_id = any (v_contract_ids));
  get diagnostics v_trabajos = row_count;

  -- Contratos de mantenimiento (todos).
  update public.maintenance_contracts
     set customer_id = p_destino_id
   where company_id = p_company_id
     and customer_id = p_origen_id
     and (customer_equipment_id = any (p_equipment_ids) or source_contract_id = any (v_contract_ids));
  get diagnostics v_mant = row_count;

  -- Incidencias (todas).
  update public.incidents
     set customer_id = p_destino_id,
         address_id = case
           when address_id is null or address_id = p_old_address_id then p_new_address_id
           else address_id end
   where company_id = p_company_id
     and customer_id = p_origen_id
     and customer_equipment_id = any (p_equipment_ids);
  get diagnostics v_incidencias = row_count;

  -- Monedero: solo lo pendiente y SIN factura. Lo facturado es del que
  -- recibió la factura y se queda con él.
  if array_length(v_contract_ids, 1) > 0 then
    update public.wallet_entries
       set customer_id = p_destino_id
     where company_id = p_company_id
       and contract_id = any (v_contract_ids)
       and status = 'pending'
       and invoice_id is null
       and (customer_id = p_origen_id or customer_id is null);
    get diagnostics v_monedero = row_count;

    -- Mandatos SEPA vivos del origen: se revocan, no se borran.
    update public.sepa_mandates
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = p_actor_user_id,
           cancellation_reason = left('Traspaso del contrato a otro cliente: ' || btrim(p_motivo), 500)
     where company_id = p_company_id
       and contract_id = any (v_contract_ids)
       and status in ('draft', 'active');
    get diagnostics v_mandatos = row_count;
  end if;

  -- Timeline: origen, destino y cada contrato.
  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'motivo', btrim(p_motivo),
    'equipment_ids', to_jsonb(p_equipment_ids),
    'contract_ids', to_jsonb(v_contract_ids),
    'equipment_moved', v_equipos,
    'contracts_moved', v_contratos,
    'installations_moved', v_instalaciones,
    'jobs_moved', v_trabajos,
    'maintenance_contracts_moved', v_mant,
    'incidents_moved', v_incidencias,
    'wallet_moved', v_monedero,
    'sepa_mandates_revoked', v_mandatos
  );
  insert into public.events (company_id, subject_type, subject_id, kind, payload, actor_user_id)
  values
    (p_company_id, 'customer', p_origen_id, 'equipment.transferred_out', v_payload, p_actor_user_id),
    (p_company_id, 'customer', p_destino_id, 'equipment.transferred_in', v_payload, p_actor_user_id);
  foreach v_cid in array v_contract_ids loop
    insert into public.events (company_id, subject_type, subject_id, kind, payload, actor_user_id)
    values (p_company_id, 'contract', v_cid, 'contract.transferred', v_payload, p_actor_user_id);
  end loop;

  return jsonb_build_object(
    'equipment_moved', v_equipos,
    'contracts_moved', v_contratos,
    'contract_items_moved', v_items,
    'installations_moved', v_instalaciones,
    'jobs_moved', v_trabajos,
    'maintenance_contracts_moved', v_mant,
    'incidents_moved', v_incidencias,
    'wallet_moved', v_monedero,
    'sepa_mandates_revoked', v_mandatos
  );
end;
$$;

revoke all on function public.traspasar_equipo_a_cliente(
  uuid, uuid, uuid, uuid[], uuid[], uuid, uuid, uuid, uuid[], text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.traspasar_equipo_a_cliente(
  uuid, uuid, uuid, uuid[], uuid[], uuid, uuid, uuid, uuid[], text, uuid, jsonb
) to service_role;

notify pgrst, 'reload schema';
