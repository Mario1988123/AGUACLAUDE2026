-- =============================================================================
-- 20261002110000_fk_misma_empresa.sql
-- Auditoría 2026-10-01, hallazgo I15: FKs de otra empresa en altas.
--
-- Varias altas reciben del navegador ids de cliente, lead, dirección,
-- contrato, instalación, equipo o almacén y los insertan sin comprobar que
-- son de la misma empresa. Como luego se leen con el admin client y JOIN,
-- acaban devolviendo datos personales ajenos (PDF de prueba gratuita con el
-- DNI de otro cliente, IBAN ajeno en iban_snapshot, stock entregado a un
-- almacén de otra empresa…).
--
-- En vez de parchear cada acción (varias están en módulos que se están
-- tocando en paralelo), se pone la regla en la base: un trigger BEFORE
-- INSERT/UPDATE que exige que cada FK señalada apunte a una fila con el
-- MISMO company_id que la fila que se escribe. Cubre también cualquier
-- código futuro.
--
-- Solo se aplica a FKs hacia tablas 100 % de empresa (customers, leads,
-- addresses, contracts, installations, customer_equipment, warehouses).
-- NO a products, maintenance_plans, expense_categories ni
-- savings_water_brands, que pueden tener filas globales (company_id null).
--
-- Comprobado en producción el 2026-10-02: 0 filas existentes incumplen la
-- regla en todas las parejas de abajo, así que no rompe datos actuales.
--
-- En UPDATE solo se comprueba una FK si cambia ella o el company_id, para no
-- bloquear ediciones de otras columnas.
--
-- Idempotente.
-- =============================================================================

create or replace function app.exigir_fk_misma_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par    text;
  v_col    text;
  v_tabla  text;
  v_valor  uuid;
  v_ok     boolean;
  v_nuevo  jsonb := to_jsonb(NEW);
  v_viejo  jsonb;
begin
  -- Filas sin empresa (no debería haberlas en estas tablas): no se comprueba.
  if NEW.company_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    v_viejo := to_jsonb(OLD);
  end if;

  -- Cada argumento del trigger es 'columna:tabla_referenciada'.
  foreach v_par in array TG_ARGV loop
    v_col   := split_part(v_par, ':', 1);
    v_tabla := split_part(v_par, ':', 2);
    v_valor := nullif(v_nuevo ->> v_col, '')::uuid;
    continue when v_valor is null;

    if TG_OP = 'UPDATE'
       and (v_viejo ->> v_col) is not distinct from (v_nuevo ->> v_col)
       and (v_viejo ->> 'company_id') is not distinct from (v_nuevo ->> 'company_id') then
      continue;
    end if;

    execute format(
      'select exists (select 1 from public.%I where id = $1 and company_id = $2)',
      v_tabla
    ) into v_ok using v_valor, NEW.company_id;

    if not v_ok then
      raise exception using
        errcode = '23503',
        message = format('El registro relacionado (%s) no existe o es de otra empresa', v_col);
    end if;
  end loop;

  return NEW;
end;
$$;

comment on function app.exigir_fk_misma_empresa() is
  'I15 auditoría 2026-10-01: trigger que exige que las FKs indicadas (args columna:tabla) apunten a filas de la misma empresa.';

revoke all on function app.exigir_fk_misma_empresa() from public, anon, authenticated;

-- ── Triggers ────────────────────────────────────────────────────────────────

drop trigger if exists trg_fk_misma_empresa on public.addresses;
create trigger trg_fk_misma_empresa
  before insert or update on public.addresses
  for each row execute function app.exigir_fk_misma_empresa(
    'customer_id:customers', 'lead_id:leads');

drop trigger if exists trg_fk_misma_empresa on public.free_trials;
create trigger trg_fk_misma_empresa
  before insert or update on public.free_trials
  for each row execute function app.exigir_fk_misma_empresa(
    'customer_id:customers', 'lead_id:leads', 'installation_address_id:addresses');

drop trigger if exists trg_fk_misma_empresa on public.maintenance_contracts;
create trigger trg_fk_misma_empresa
  before insert or update on public.maintenance_contracts
  for each row execute function app.exigir_fk_misma_empresa(
    'customer_id:customers', 'customer_equipment_id:customer_equipment',
    'source_contract_id:contracts', 'source_installation_id:installations');

drop trigger if exists trg_fk_misma_empresa on public.expenses;
create trigger trg_fk_misma_empresa
  before insert or update on public.expenses
  for each row execute function app.exigir_fk_misma_empresa(
    'customer_id:customers', 'contract_id:contracts', 'installation_id:installations');

drop trigger if exists trg_fk_misma_empresa on public.savings_proposals;
create trigger trg_fk_misma_empresa
  before insert or update on public.savings_proposals
  for each row execute function app.exigir_fk_misma_empresa(
    'customer_id:customers', 'lead_id:leads');

drop trigger if exists trg_fk_misma_empresa on public.loading_requests;
create trigger trg_fk_misma_empresa
  before insert or update on public.loading_requests
  for each row execute function app.exigir_fk_misma_empresa(
    'source_warehouse_id:warehouses', 'destination_warehouse_id:warehouses');

-- Comprobación tras aplicar:
--   select tgrelid::regclass, tgname from pg_trigger where tgname = 'trg_fk_misma_empresa';
