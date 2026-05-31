-- ============================================================================
-- Hardening RLS — Hidromanager (2026-05-31)  ·  V3 (final)
-- ----------------------------------------------------------------------------
-- V1 fallaba con "column company_id does not exist" porque asumí que
-- chat_messages, chat_thread_members, cron_runs e invoice_reminders_sent
-- tenían company_id. NO la tienen — derivan tenant por relación.
--
-- V3 (esta) además sustituye las subqueries a user_profiles por las
-- funciones helper STABLE ya existentes en el proyecto:
--   · app.current_company_id() → uuid (lee company_id del JWT, cacheada)
--   · app.is_superadmin()      → boolean (lee del JWT, cacheada)
--
-- Es seguro re-aplicarla aunque la V1 fallida o V2 dejaran policies parciales:
-- los `drop policy if exists` al inicio limpian todo.
-- ============================================================================

-- ───────────────────────── 1) CHAT THREADS ──────────────────────────────────
-- chat_threads SÍ tiene company_id. Sustituir coalesce(claim, company_id)
-- (vulnerable: era siempre cierto si claim viene null) por filtro estricto.
drop policy if exists chat_threads_company on public.chat_threads;
drop policy if exists "Tenant read chat_threads" on public.chat_threads;
drop policy if exists chat_threads_select on public.chat_threads;
drop policy if exists chat_threads_all on public.chat_threads;
drop policy if exists chat_threads_tenant_select on public.chat_threads;
drop policy if exists chat_threads_tenant_modify on public.chat_threads;

create policy chat_threads_tenant_select on public.chat_threads
  for select to authenticated
  using ( company_id = app.current_company_id() );

create policy chat_threads_tenant_modify on public.chat_threads
  for all to authenticated
  using ( company_id = app.current_company_id() )
  with check ( company_id = app.current_company_id() );

-- ───────────────────────── 2) CHAT MESSAGES ─────────────────────────────────
-- chat_messages NO tiene company_id. Tenant vía thread_id → chat_threads.
drop policy if exists chat_messages_company on public.chat_messages;
drop policy if exists "Tenant read chat_messages" on public.chat_messages;
drop policy if exists "Tenant write chat_messages" on public.chat_messages;
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_all on public.chat_messages;
drop policy if exists chat_messages_tenant_select on public.chat_messages;
drop policy if exists chat_messages_tenant_modify on public.chat_messages;

create policy chat_messages_tenant_select on public.chat_messages
  for select to authenticated
  using (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  );

create policy chat_messages_tenant_modify on public.chat_messages
  for all to authenticated
  using (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  )
  with check (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  );

-- ───────────────────────── 3) CHAT THREAD MEMBERS ───────────────────────────
drop policy if exists chat_members_self on public.chat_thread_members;
drop policy if exists "Tenant read chat_thread_members" on public.chat_thread_members;
drop policy if exists "Tenant write chat_thread_members" on public.chat_thread_members;
drop policy if exists chat_thread_members_select on public.chat_thread_members;
drop policy if exists chat_thread_members_all on public.chat_thread_members;
drop policy if exists chat_thread_members_tenant_select on public.chat_thread_members;
drop policy if exists chat_thread_members_tenant_modify on public.chat_thread_members;

create policy chat_thread_members_tenant_select on public.chat_thread_members
  for select to authenticated
  using (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  );

create policy chat_thread_members_tenant_modify on public.chat_thread_members
  for all to authenticated
  using (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  )
  with check (
    thread_id in (
      select id from public.chat_threads
      where company_id = app.current_company_id()
    )
  );

-- ─────────────────── 4) COMISIONES / PUNTOS ─────────────────────────────────
-- Tenían `for all using(true) with check(true)` → cualquiera escribe.
drop policy if exists points_cycles_company_select on public.points_cycles;
drop policy if exists points_cycles_admin_write on public.points_cycles;
drop policy if exists "Tenant read points_cycles" on public.points_cycles;
drop policy if exists "Tenant write points_cycles" on public.points_cycles;
drop policy if exists points_cycles_all on public.points_cycles;
drop policy if exists points_cycles_tenant_select on public.points_cycles;
drop policy if exists points_cycles_tenant_modify on public.points_cycles;

create policy points_cycles_tenant_select on public.points_cycles
  for select to authenticated
  using ( company_id = app.current_company_id() );

create policy points_cycles_tenant_modify on public.points_cycles
  for all to authenticated
  using ( company_id = app.current_company_id() )
  with check ( company_id = app.current_company_id() );

drop policy if exists pca_company_select on public.points_cycle_adjustments;
drop policy if exists pca_admin_write on public.points_cycle_adjustments;
drop policy if exists "Tenant read points_cycle_adjustments" on public.points_cycle_adjustments;
drop policy if exists "Tenant write points_cycle_adjustments" on public.points_cycle_adjustments;
drop policy if exists points_cycle_adjustments_all on public.points_cycle_adjustments;
drop policy if exists points_cycle_adjustments_tenant_select on public.points_cycle_adjustments;
drop policy if exists points_cycle_adjustments_tenant_modify on public.points_cycle_adjustments;

create policy points_cycle_adjustments_tenant_select on public.points_cycle_adjustments
  for select to authenticated
  using ( company_id = app.current_company_id() );

create policy points_cycle_adjustments_tenant_modify on public.points_cycle_adjustments
  for all to authenticated
  using ( company_id = app.current_company_id() )
  with check ( company_id = app.current_company_id() );

-- ─────────────────── 5) customer_consents (PII / RGPD) ──────────────────────
-- SÍ tiene company_id. Estaba SIN RLS.
alter table if exists public.customer_consents enable row level security;
drop policy if exists customer_consents_tenant on public.customer_consents;
create policy customer_consents_tenant on public.customer_consents
  for all to authenticated
  using ( company_id = app.current_company_id() )
  with check ( company_id = app.current_company_id() );

-- ─────────────────── 6) user_module_overrides ───────────────────────────────
-- SÍ tiene company_id. Estaba SIN RLS.
alter table if exists public.user_module_overrides enable row level security;
drop policy if exists user_module_overrides_tenant on public.user_module_overrides;
create policy user_module_overrides_tenant on public.user_module_overrides
  for all to authenticated
  using ( company_id = app.current_company_id() )
  with check ( company_id = app.current_company_id() );

-- ─────────────────── 7) cron_runs (telemetría global) ───────────────────────
-- NO tiene company_id. Solo superadmin lee; service_role escribe.
alter table if exists public.cron_runs enable row level security;
drop policy if exists cron_runs_admin_select on public.cron_runs;
create policy cron_runs_admin_select on public.cron_runs
  for select to authenticated
  using ( app.is_superadmin() );

-- ─────────────────── 8) invoice_reminders_sent ──────────────────────────────
-- NO tiene company_id. Tenant vía invoice_id → invoices.company_id.
alter table if exists public.invoice_reminders_sent enable row level security;
drop policy if exists invoice_reminders_sent_tenant on public.invoice_reminders_sent;
create policy invoice_reminders_sent_tenant on public.invoice_reminders_sent
  for all to authenticated
  using (
    invoice_id in (
      select id from public.invoices
      where company_id = app.current_company_id()
    )
  )
  with check (
    invoice_id in (
      select id from public.invoices
      where company_id = app.current_company_id()
    )
  );

-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';

-- ============================================================================
-- FIN. Verificación rápida tras aplicar:
--
--   select schemaname, tablename, policyname
--     from pg_policies
--    where tablename in
--      ('chat_messages','chat_threads','chat_thread_members',
--       'points_cycles','points_cycle_adjustments',
--       'customer_consents','user_module_overrides','cron_runs',
--       'invoice_reminders_sent')
--    order by tablename, policyname;
--
-- Test cross-tenant: con un usuario de otra empresa, ningún `select` directo
-- vía PostgREST debe devolver filas de empresas ajenas en estas tablas.
-- ============================================================================
