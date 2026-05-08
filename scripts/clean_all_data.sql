-- =============================================================================
-- LIMPIEZA TOTAL · todas las empresas
-- =============================================================================
-- BORRA todos los datos transaccionales de TODAS las empresas. MANTIENE:
--   ✅ companies (estructura)
--   ✅ user_profiles, user_roles, team_assignments, schedules, vacation balances
--   ✅ company_modules, company_settings
--   ✅ products + product_categories + product_attributes + product_images
--   ✅ product_pricing_plans, product_compatibilities, product_external_compatibilities
--   ✅ warehouses + warehouse_stock + warehouse_locations
--   ✅ maintenance_plans (planes Lite/Medium/Premium)
--   ✅ expense_categories (catálogo gastos)
--   ✅ email_templates, email_user_settings, email_domains
--   ✅ gocardless_settings, expense_settings
--   ✅ contract_clause_templates, message_templates
--   ✅ invoice_series (numeración + datos fiscales)
--   ✅ holidays, points_rules
--   ✅ modules_catalog, permissions_catalog, roles_catalog, units_catalog
--   ✅ superadmins, role_permissions
--   ✅ savings_*, external_equipment_models
--   ✅ product_attributes_global*, product_categories_global
--
-- USO:
--   1. (RECOMENDADO) HAZ BACKUP antes — Supabase Dashboard → Database →
--      Backups → "Take a manual backup". Tarda 1 min.
--   2. Pega TODO el script en SQL Editor y ejecuta.
--   3. Comprueba conteos al final.
--
-- NO usa BEGIN/COMMIT — autocommit puro. Persiste sin necesidad de
-- COMMIT manual.
-- =============================================================================

do $$
declare
  t text;
  -- Tablas a borrar entera (sin WHERE) — orden FK descendente
  l_truncate_all text[] := array[
    -- Mailing
    'email_outbox',
    'email_sends',
    'email_subscriptions',
    'email_unsubscribe_tokens',
    'email_consents',
    'email_campaigns',
    'email_automation_runs',
    'email_automation_steps',
    'email_automations',
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
    -- Invoices children
    'invoice_taxes',
    'invoice_payments',
    'invoice_lines',
    -- Wallet (después de invoices porque invoice_id es SET NULL no bloquea)
    'wallet_entries',
    -- Expenses
    'expense_per_diems',
    'expense_mileage',
    'expenses',
    -- Mantenimientos
    'maintenance_items_replaced',
    'maintenance_jobs',
    'maintenance_contracts',
    -- Incidencias
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
    'free_trial_items',
    'free_trials',
    -- Almacén (movements y requests, NO warehouses ni stock)
    'loading_request_items',
    'loading_requests',
    'stock_movements',
    -- Chat
    'chat_messages',
    'chat_thread_members',
    'chat_threads',
    -- Documentos / comms
    'notifications',
    'events',
    'audit_log',
    -- Installations + dependientes
    'installation_steps_log',
    'installation_incidents',
    'installation_pauses',
    'installation_items',
    'installation_photos',
    'installation_signatures',
    'installations',
    -- Invoices (después de wallet/gocardless que la referencian con SET NULL)
    'invoices',
    -- Contracts + dependientes
    'contract_signatures',
    'contract_photos',
    'contract_items',
    'contract_clauses_used',
    'contract_payments',
    'contracts',
    -- Proposals
    'proposal_payment_options',
    'proposal_items',
    'proposals',
    -- Customers + dependientes
    'customer_equipment',
    'customer_bank_accounts',
    'customer_contacts',
    'customer_consents',
    'addresses',
    'customers',
    -- Leads
    'lead_contacts',
    'leads'
  ];
begin
  raise notice 'LIMPIEZA TOTAL — borrando datos de todas las empresas';

  -- Pre-pasos: nulificar FKs RESTRICT que bloquearían borrado de invoices
  if to_regclass('public.invoices') is not null then
    begin
      execute 'update public.invoices set rectifies_invoice_id = null where rectifies_invoice_id is not null';
    exception when undefined_column then null; end;
  end if;
  if to_regclass('public.contracts') is not null then
    begin
      execute 'update public.contracts set rectifies_invoice_id = null where rectifies_invoice_id is not null';
    exception when undefined_column then null; end;
  end if;

  -- Borrar todas las tablas listadas (ignorando las que no existan)
  foreach t in array l_truncate_all loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
      raise notice '  ✓ borrado: %', t;
    end if;
  end loop;

  -- Documentos: solo los que NO sean del catálogo de productos
  if to_regclass('public.documents') is not null then
    begin
      execute '
        delete from public.documents
        where product_id is null
           or product_id not in (select id from public.products)
      ';
    exception when undefined_column then
      execute 'delete from public.documents';
    end;
    raise notice '  ✓ borrado: documents (manteniendo los de productos)';
  end if;

  raise notice 'LIMPIEZA TOTAL COMPLETADA';
end $$;

-- =============================================================================
-- Conteos finales — todo a 0 excepto productos/usuarios/almacenes
-- =============================================================================
select 'leads (0)' as tabla, count(*) from public.leads
union all select 'customers (0)', count(*) from public.customers
union all select 'contracts (0)', count(*) from public.contracts
union all select 'proposals (0)', count(*) from public.proposals
union all select 'wallet_entries (0)', count(*) from public.wallet_entries
union all select 'invoices (0)', count(*) from public.invoices
union all select 'expenses (0)', count(*) from public.expenses
union all select 'installations (0)', count(*) from public.installations
union all select 'incidents (0)', count(*) from public.incidents
union all select 'agenda_events (0)', count(*) from public.agenda_events
union all select 'addresses (0)', count(*) from public.addresses
union all select 'PRODUCTS (debe quedar)', count(*) from public.products
union all select 'PRODUCT_CATEGORIES (debe quedar)', count(*) from public.product_categories
union all select 'USERS profiles (debe quedar)', count(*) from public.user_profiles
union all select 'USER_ROLES (debe quedar)', count(*) from public.user_roles
union all select 'WAREHOUSES (debe quedar)', count(*) from public.warehouses
union all select 'WAREHOUSE_STOCK (debe quedar)', count(*) from public.warehouse_stock
union all select 'COMPANIES (debe quedar)', count(*) from public.companies;
