-- =============================================================================
-- LIMPIEZA DE DATOS · empresa info@aquaroo.es (mario)
-- =============================================================================
-- BORRA:
--   leads, customers, addresses, bank_accounts, proposals, contracts,
--   contract_payments, contract_signatures, contract_items, contract_photos,
--   contract_documents, installations, installation_*, maintenance_visits,
--   incidents, incident_*, wallet_entries, gocardless_*, expenses, expense_*,
--   email_*, invoices, invoice_*, time_punches, time_absences, events,
--   notifications, documents (excepto los de productos), points_*, savings_*,
--   pruebas_gratuitas, agenda_*, customer_equipment
--
-- MANTIENE (intacto):
--   companies (la empresa misma)
--   user_profiles (el admin Mario y otros usuarios)
--   user_roles, team_assignments, roles_catalog
--   company_modules (qué módulos tiene activos)
--   products + product_categories + product_datasheets
--   warehouses, warehouse_stock (catálogo del almacén)
--   maintenance_plans (planes Lite/Medium/Premium definidos)
--   expense_categories (catálogo gastos)
--   email_templates (plantillas — pero borra envíos reales)
--   fiscal_settings, invoice_series (numeración + datos fiscales)
--   gocardless_settings (config GoCardless de la empresa)
--   expense_settings, mailing_domain, etc.
--
-- USO:
--   1. Abre Supabase SQL editor.
--   2. Pega TODO el script.
--   3. Ejecútalo (no auto-commitea — usa BEGIN/COMMIT).
--   4. Revisa los conteos finales antes de hacer COMMIT.
--   5. Si todo bien → escribe COMMIT;
--      Si te has equivocado → escribe ROLLBACK;
-- =============================================================================

begin;

-- 1) Resolver el company_id por email del usuario admin
do $$
declare
  v_company_id uuid;
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'info@aquaroo.es' limit 1;
  if v_user_id is null then
    raise exception 'Usuario info@aquaroo.es no encontrado';
  end if;
  select company_id into v_company_id from public.user_profiles where user_id = v_user_id limit 1;
  if v_company_id is null then
    raise exception 'No se ha podido resolver company_id para info@aquaroo.es';
  end if;
  raise notice 'Limpiando company_id = %', v_company_id;

  -- ===========================================================================
  -- 2) BORRAR datos transaccionales (orden importa por FKs)
  -- ===========================================================================

  -- Mailing
  perform 1 from information_schema.tables where table_schema='public' and table_name='email_sends';
  if found then
    delete from public.email_sends where company_id = v_company_id;
    delete from public.email_unsubscribe_tokens where company_id = v_company_id;
    delete from public.email_consents where company_id = v_company_id;
    delete from public.email_subscriptions where company_id = v_company_id;
    delete from public.email_lists where company_id = v_company_id;
    delete from public.email_automation_runs where company_id = v_company_id;
    delete from public.email_automation_steps where automation_id in (
      select id from public.email_automations where company_id = v_company_id
    );
    delete from public.email_automations where company_id = v_company_id;
    delete from public.email_campaigns where company_id = v_company_id;
  end if;

  -- GoCardless
  perform 1 from information_schema.tables where table_schema='public' and table_name='gocardless_payments';
  if found then
    delete from public.gocardless_payments where company_id = v_company_id;
    delete from public.gocardless_redirect_flows where company_id = v_company_id;
    delete from public.gocardless_mandates where company_id = v_company_id;
    delete from public.gocardless_webhook_events where company_id = v_company_id;
  end if;

  -- Expenses
  perform 1 from information_schema.tables where table_schema='public' and table_name='expenses';
  if found then
    delete from public.expenses where company_id = v_company_id;
    delete from public.expense_per_diems where company_id = v_company_id;
    delete from public.expense_mileage where company_id = v_company_id;
  end if;

  -- Invoices (Verifactu)
  perform 1 from information_schema.tables where table_schema='public' and table_name='invoices';
  if found then
    delete from public.invoice_lines where invoice_id in (
      select id from public.invoices where company_id = v_company_id
    );
    delete from public.invoice_payments where invoice_id in (
      select id from public.invoices where company_id = v_company_id
    );
    delete from public.invoices where company_id = v_company_id;
  end if;

  -- Wallet
  delete from public.wallet_entries where company_id = v_company_id;

  -- Mantenimientos / incidencias / instalaciones
  perform 1 from information_schema.tables where table_schema='public' and table_name='maintenance_visits';
  if found then
    delete from public.maintenance_visits where company_id = v_company_id;
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='incidents';
  if found then
    delete from public.incident_attachments where incident_id in (
      select id from public.incidents where company_id = v_company_id
    );
    delete from public.incident_messages where incident_id in (
      select id from public.incidents where company_id = v_company_id
    );
    delete from public.incidents where company_id = v_company_id;
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='installation_signatures';
  if found then
    delete from public.installation_signatures where installation_id in (
      select id from public.installations where company_id = v_company_id
    );
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='installation_photos';
  if found then
    delete from public.installation_photos where installation_id in (
      select id from public.installations where company_id = v_company_id
    );
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='installation_items';
  if found then
    delete from public.installation_items where installation_id in (
      select id from public.installations where company_id = v_company_id
    );
  end if;
  delete from public.installations where company_id = v_company_id;

  -- Customer equipment
  perform 1 from information_schema.tables where table_schema='public' and table_name='customer_equipment';
  if found then
    delete from public.customer_equipment where company_id = v_company_id;
  end if;

  -- Contratos
  perform 1 from information_schema.tables where table_schema='public' and table_name='contract_signatures';
  if found then
    delete from public.contract_signatures where contract_id in (
      select id from public.contracts where company_id = v_company_id
    );
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='contract_photos';
  if found then
    delete from public.contract_photos where contract_id in (
      select id from public.contracts where company_id = v_company_id
    );
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='contract_documents';
  if found then
    delete from public.contract_documents where contract_id in (
      select id from public.contracts where company_id = v_company_id
    );
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='contract_items';
  if found then
    delete from public.contract_items where contract_id in (
      select id from public.contracts where company_id = v_company_id
    );
  end if;
  delete from public.contract_payments where company_id = v_company_id;
  delete from public.contracts where company_id = v_company_id;

  -- Propuestas
  perform 1 from information_schema.tables where table_schema='public' and table_name='proposal_items';
  if found then
    delete from public.proposal_items where proposal_id in (
      select id from public.proposals where company_id = v_company_id
    );
  end if;
  delete from public.proposals where company_id = v_company_id;

  -- Pruebas gratuitas
  perform 1 from information_schema.tables where table_schema='public' and table_name='free_trials';
  if found then
    delete from public.free_trials where company_id = v_company_id;
  end if;

  -- Direcciones + bancos
  perform 1 from information_schema.tables where table_schema='public' and table_name='customer_bank_accounts';
  if found then
    delete from public.customer_bank_accounts where company_id = v_company_id;
  end if;
  delete from public.addresses where company_id = v_company_id;

  -- Clientes
  delete from public.customers where company_id = v_company_id;

  -- Leads
  delete from public.leads where company_id = v_company_id;

  -- Agenda
  perform 1 from information_schema.tables where table_schema='public' and table_name='agenda_events';
  if found then
    delete from public.agenda_events where company_id = v_company_id;
  end if;

  -- Time tracking
  perform 1 from information_schema.tables where table_schema='public' and table_name='time_punches';
  if found then
    delete from public.time_punches where company_id = v_company_id;
    delete from public.time_absences where company_id = v_company_id;
  end if;

  -- Notifications + events + documents
  delete from public.notifications where company_id = v_company_id;
  delete from public.events where company_id = v_company_id;
  perform 1 from information_schema.tables where table_schema='public' and table_name='documents';
  if found then
    -- Borra documentos de la empresa salvo los enlazados a productos del catálogo
    delete from public.documents
    where company_id = v_company_id
      and (product_id is null or product_id not in (
        select id from public.products where company_id = v_company_id
      ));
  end if;

  -- Points / objectives (si los usas)
  perform 1 from information_schema.tables where table_schema='public' and table_name='points_ledger';
  if found then
    delete from public.points_ledger where company_id = v_company_id;
  end if;
  perform 1 from information_schema.tables where table_schema='public' and table_name='sales_objectives';
  if found then
    delete from public.sales_objectives where company_id = v_company_id;
  end if;

  raise notice 'LIMPIEZA COMPLETADA para company_id = %', v_company_id;
end $$;

-- ============================================================================
-- 3) Comprobaciones — revisa estos números antes de COMMIT
-- ============================================================================
select 'leads' as tabla, count(*) from public.leads where company_id = (
  select company_id from public.user_profiles where user_id = (
    select id from auth.users where email = 'info@aquaroo.es'
  )
)
union all select 'customers', count(*) from public.customers where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'contracts', count(*) from public.contracts where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'proposals', count(*) from public.proposals where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'wallet_entries', count(*) from public.wallet_entries where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'invoices', count(*) from public.invoices where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'expenses', count(*) from public.expenses where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'products (DEBE QUEDAR)', count(*) from public.products where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
)
union all select 'user_profiles (DEBE QUEDAR)', count(*) from public.user_profiles where company_id = (
  select company_id from public.user_profiles where user_id = (select id from auth.users where email = 'info@aquaroo.es')
);

-- ============================================================================
-- ATENCIÓN: si los números son los esperados, ejecuta:
--   COMMIT;
-- Si algo está mal:
--   ROLLBACK;
-- ============================================================================
