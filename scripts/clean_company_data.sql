-- =============================================================================
-- LIMPIEZA DE DATOS · empresa info@aquaroo.es (mario)
-- =============================================================================
-- BORRA todos los datos transaccionales de la empresa, MANTIENE:
--   - companies (la empresa)
--   - user_profiles, user_roles, team_assignments, schedules, vacation balances
--   - company_modules, company_settings
--   - products + product_categories + product_attributes + product_images
--   - product_pricing_plans, product_compatibilities
--   - warehouses + warehouse_stock + warehouse_locations (catálogo almacén)
--   - maintenance_plans (planes Lite/Medium/Premium definidos)
--   - expense_categories (catálogo gastos)
--   - email_templates, email_user_settings, email_domains
--   - gocardless_settings, expense_settings
--   - contract_clause_templates, message_templates
--   - invoice_series (numeración + datos fiscales)
--   - holidays, points_rules
--   - external_equipment_models, savings_*
--
-- USO:
--   1. Abre Supabase SQL editor.
--   2. Pega TODO el script.
--   3. Ejecútalo. Verás conteos al final.
--   4. Si todo bien → escribe `COMMIT;` y enter.
--   5. Si algo mal → escribe `ROLLBACK;` y enter.
--
-- IMPLEMENTACIÓN:
--   - Usa to_regclass() para verificar existencia ANTES de cada DELETE.
--   - EXECUTE format() para diferir el parse hasta runtime — así no falla
--     en compile aunque la tabla no exista.
-- =============================================================================

begin;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  t text;
  -- Listas: nombre de tabla (sin schema). Cada bloque = un nivel de FKs.

  -- TABLAS CON company_id DIRECTO (orden FK descendente: hijas primero)
  -- Algunas pueden no existir; to_regclass() las salta.
  l_direct_company text[] := array[
    -- Mailing
    'email_outbox',
    'email_sends',
    'email_subscriptions',
    'email_unsubscribe_tokens',
    'email_consents',
    'email_campaigns',
    'email_automations',         -- después de borrar runs+steps via FK
    'email_lists',
    -- GoCardless
    'gocardless_payments',
    'gocardless_redirect_flows',
    'gocardless_mandates',
    'gocardless_webhook_events',
    -- Verifactu
    'invoice_verifactu_events',
    'invoice_verifactu_records',
    'invoice_aeat_submissions',
    -- Wallet
    'wallet_entries',
    -- Expenses
    'expense_per_diems',
    'expense_mileage',
    'expenses',
    -- Mantenimientos / incidencias
    'maintenance_jobs',
    'maintenance_contracts',
    'incidents',
    -- Time tracking
    'time_punches',
    'time_absences',
    'user_vacation_balances',
    -- Agenda
    'agenda_events',
    -- Comerciales
    'price_approvals',
    'monthly_objectives',
    'points_ledger',
    'sales_records',
    'lost_sales',
    'free_trials',
    -- Almacén
    'loading_requests',
    'stock_movements',
    -- Chat
    'chat_threads',  -- members y messages se borran por FK cascade
    -- Documentos / comms
    'notifications',
    'events',
    'audit_log',
    -- Operación principal (orden importa)
    'contract_payments',
    'installations',  -- después borraremos contracts
    'invoices',
    'contracts',
    'proposals',
    'customer_equipment',
    'customer_bank_accounts',
    'customer_contacts',
    'customer_consents',
    'addresses',
    'customers',
    'leads'
  ];
begin
  -- =========================================================================
  -- 1) Resolver company_id
  -- =========================================================================
  select id into v_user_id from auth.users where email = 'info@aquaroo.es' limit 1;
  if v_user_id is null then
    raise exception 'Usuario info@aquaroo.es no encontrado';
  end if;
  select company_id into v_company_id from public.user_profiles where user_id = v_user_id limit 1;
  if v_company_id is null then
    raise exception 'company_id no resoluble para info@aquaroo.es';
  end if;
  raise notice 'Limpiando company_id = %', v_company_id;

  -- =========================================================================
  -- 2) Tablas con FK indirecta (hay que borrar ANTES que su padre)
  -- =========================================================================

  -- email_automation_runs y email_automation_steps van vía email_automations
  if to_regclass('public.email_automation_runs') is not null
     and to_regclass('public.email_automations') is not null then
    execute 'delete from public.email_automation_runs where automation_id in (select id from public.email_automations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.email_automation_steps') is not null
     and to_regclass('public.email_automations') is not null then
    execute 'delete from public.email_automation_steps where automation_id in (select id from public.email_automations where company_id = $1)' using v_company_id;
  end if;

  -- invoice_lines / invoice_payments / invoice_taxes vía invoices
  if to_regclass('public.invoice_lines') is not null and to_regclass('public.invoices') is not null then
    execute 'delete from public.invoice_lines where invoice_id in (select id from public.invoices where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.invoice_payments') is not null and to_regclass('public.invoices') is not null then
    execute 'delete from public.invoice_payments where invoice_id in (select id from public.invoices where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.invoice_taxes') is not null and to_regclass('public.invoices') is not null then
    execute 'delete from public.invoice_taxes where invoice_id in (select id from public.invoices where company_id = $1)' using v_company_id;
  end if;

  -- Para evitar restricción de invoices.rectifies_invoice_id (RESTRICT)
  if to_regclass('public.invoices') is not null then
    begin
      execute 'update public.invoices set rectifies_invoice_id = null where company_id = $1 and rectifies_invoice_id is not null' using v_company_id;
    exception when undefined_column then null; end;
  end if;
  if to_regclass('public.contracts') is not null then
    begin
      execute 'update public.contracts set rectifies_invoice_id = null where company_id = $1 and rectifies_invoice_id is not null' using v_company_id;
    exception when undefined_column then null; end;
  end if;

  -- contract dependencies (cascade en general, pero hacemos explícito)
  if to_regclass('public.contract_signatures') is not null and to_regclass('public.contracts') is not null then
    execute 'delete from public.contract_signatures where contract_id in (select id from public.contracts where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.contract_photos') is not null and to_regclass('public.contracts') is not null then
    execute 'delete from public.contract_photos where contract_id in (select id from public.contracts where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.contract_items') is not null and to_regclass('public.contracts') is not null then
    execute 'delete from public.contract_items where contract_id in (select id from public.contracts where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.contract_clauses_used') is not null and to_regclass('public.contracts') is not null then
    execute 'delete from public.contract_clauses_used where contract_id in (select id from public.contracts where company_id = $1)' using v_company_id;
  end if;

  -- installation dependencies
  if to_regclass('public.installation_signatures') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_signatures where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.installation_photos') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_photos where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.installation_items') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_items where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.installation_pauses') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_pauses where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.installation_incidents') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_incidents where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.installation_steps_log') is not null and to_regclass('public.installations') is not null then
    execute 'delete from public.installation_steps_log where installation_id in (select id from public.installations where company_id = $1)' using v_company_id;
  end if;

  -- proposal dependencies
  if to_regclass('public.proposal_items') is not null and to_regclass('public.proposals') is not null then
    execute 'delete from public.proposal_items where proposal_id in (select id from public.proposals where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.proposal_payment_options') is not null and to_regclass('public.proposals') is not null then
    execute 'delete from public.proposal_payment_options where proposal_id in (select id from public.proposals where company_id = $1)' using v_company_id;
  end if;

  -- maintenance items replaced
  if to_regclass('public.maintenance_items_replaced') is not null and to_regclass('public.maintenance_jobs') is not null then
    execute 'delete from public.maintenance_items_replaced where maintenance_job_id in (select id from public.maintenance_jobs where company_id = $1)' using v_company_id;
  end if;

  -- loading request items
  if to_regclass('public.loading_request_items') is not null and to_regclass('public.loading_requests') is not null then
    execute 'delete from public.loading_request_items where loading_request_id in (select id from public.loading_requests where company_id = $1)' using v_company_id;
  end if;

  -- free trial items
  if to_regclass('public.free_trial_items') is not null and to_regclass('public.free_trials') is not null then
    execute 'delete from public.free_trial_items where free_trial_id in (select id from public.free_trials where company_id = $1)' using v_company_id;
  end if;

  -- lead contacts
  if to_regclass('public.lead_contacts') is not null and to_regclass('public.leads') is not null then
    execute 'delete from public.lead_contacts where lead_id in (select id from public.leads where company_id = $1)' using v_company_id;
  end if;

  -- chat: thread_members y messages via threads (cascade probable, explícito)
  if to_regclass('public.chat_messages') is not null and to_regclass('public.chat_threads') is not null then
    execute 'delete from public.chat_messages where thread_id in (select id from public.chat_threads where company_id = $1)' using v_company_id;
  end if;
  if to_regclass('public.chat_thread_members') is not null and to_regclass('public.chat_threads') is not null then
    execute 'delete from public.chat_thread_members where thread_id in (select id from public.chat_threads where company_id = $1)' using v_company_id;
  end if;

  -- =========================================================================
  -- 3) Tablas con company_id directo
  -- =========================================================================
  foreach t in array l_direct_company loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where company_id = $1', t) using v_company_id;
    end if;
  end loop;

  -- =========================================================================
  -- 4) Documentos: solo borrar los que NO sean del catálogo de productos
  -- =========================================================================
  if to_regclass('public.documents') is not null then
    -- Borra todo doc de la empresa salvo los enlazados a un product que también
    -- pertenezca a esta empresa (los productos los conservamos)
    begin
      execute '
        delete from public.documents
        where company_id = $1
          and (product_id is null
               or product_id not in (select id from public.products where company_id = $1))
      ' using v_company_id;
    exception when undefined_column then
      -- documents sin columna product_id → borrar todo de la empresa
      execute 'delete from public.documents where company_id = $1' using v_company_id;
    end;
  end if;

  raise notice 'LIMPIEZA COMPLETADA para company_id = %', v_company_id;
end $$;

-- =============================================================================
-- 5) Conteos finales — revisa antes de COMMIT
-- =============================================================================
with co as (
  select company_id from public.user_profiles
  where user_id = (select id from auth.users where email = 'info@aquaroo.es')
  limit 1
)
select 'leads (debería ser 0)' as tabla, count(*) from public.leads, co where leads.company_id = co.company_id
union all select 'customers (0)', count(*) from public.customers, co where customers.company_id = co.company_id
union all select 'contracts (0)', count(*) from public.contracts, co where contracts.company_id = co.company_id
union all select 'proposals (0)', count(*) from public.proposals, co where proposals.company_id = co.company_id
union all select 'wallet_entries (0)', count(*) from public.wallet_entries, co where wallet_entries.company_id = co.company_id
union all select 'invoices (0)', count(*) from public.invoices, co where invoices.company_id = co.company_id
union all select 'expenses (0)', count(*) from public.expenses, co where expenses.company_id = co.company_id
union all select 'installations (0)', count(*) from public.installations, co where installations.company_id = co.company_id
union all select 'incidents (0)', count(*) from public.incidents, co where incidents.company_id = co.company_id
union all select 'PRODUCTS (debe quedar)', count(*) from public.products, co where products.company_id = co.company_id
union all select 'USERS (debe quedar)', count(*) from public.user_profiles, co where user_profiles.company_id = co.company_id
union all select 'WAREHOUSES (debe quedar)', count(*) from public.warehouses, co where warehouses.company_id = co.company_id;

-- =============================================================================
-- ✅ Si los conteos son los esperados:   COMMIT;
-- ❌ Si algo está mal:                   ROLLBACK;
-- =============================================================================
