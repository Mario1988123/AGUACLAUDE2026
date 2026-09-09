-- =============================================================================
-- 20260909090000_rls_tablas_sin_candado.sql
--
-- Tres tablas se crearon SIN `enable row level security`. Una política sin RLS
-- activada no hace absolutamente nada, así que quedaron abiertas a cualquier
-- usuario autenticado de cualquier empresa — y probablemente a `anon`, porque
-- el `revoke ... from anon` global se ejecutó en la migración del 01-05, antes
-- de que estas tablas existieran.
--
--   · invoice_taxes             (07-05) → desglose de IVA de TODAS las facturas
--   · gocardless_webhook_events (09-05) → payloads de domiciliación SEPA
--   · savings_price_scrape_log  (13-05) → scraping de precios
--
-- La más grave es `invoice_taxes`: son datos fiscales, legibles Y modificables
-- entre empresas. En un sistema con VeriFactu, un UPDATE ajeno sobre la cuota
-- de IVA es corrupción de datos con consecuencias tributarias.
--
-- ANTES DE APLICAR, confirmar el estado real del remoto (ya ha habido deriva
-- local↔remoto en este proyecto):
--
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p
--            where p.schemaname='public' and p.tablename=c.relname) as politicas
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public'
--      and c.relname in ('invoice_taxes','gocardless_webhook_events',
--                        'savings_price_scrape_log');
--
-- -----------------------------------------------------------------------------
-- COMPROBADO CONTRA PRODUCCIÓN EL 10-SEP-2026. El párrafo de arriba describe el
-- estado LOCAL. El remoto NO está así, y la diferencia importa:
--
--   · Ninguna tabla de `public` tiene `relrowsecurity = false`. Las tres del
--     título YA tienen RLS activada en producción.
--   · `invoice_taxes` tiene RLS activada y CERO políticas → hoy está en
--     deny-all para `authenticated`. No filtra nada; si acaso, es lo contrario.
--     No rompe nada porque todo el acceso va por `createAdminClient()`
--     (service_role, que salta RLS): api/pdf/invoice-verifactu, verifactu-actions
--     y verifactu-queue. Esta migración le pone la política de tenant que le
--     falta.
--   · `gocardless_webhook_events` y `savings_price_scrape_log` solo tienen su
--     política `_super`. Igual: cerradas, no abiertas.
--   · `whatsapp_sends` — OJO, el punto 4 de abajo parte de una premisa FALSA en
--     producción. Allí `wa_admin_write` NO es `using (true)`: filtra por
--     `company_id = (select company_id from user_profiles where user_id =
--     auth.uid())`. La versión abierta que describe el comentario existe solo en
--     el esquema local. La fuga cross-tenant de WhatsApp NUNCA llegó a estar en
--     producción.
--
-- Conclusión: esta migración sigue mereciendo aplicarse —normaliza las cuatro
-- tablas al mismo patrón y añade las políticas que faltan— pero es una mejora
-- de higiene, NO el cierre de una fuga activa. Todas sus sentencias son
-- idempotentes (`drop policy if exists` + `create`), así que aplicarla sobre el
-- estado actual del remoto es seguro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) invoice_taxes — el scope se hereda de la factura padre.
-- -----------------------------------------------------------------------------
alter table public.invoice_taxes enable row level security;
alter table public.invoice_taxes force  row level security;

drop policy if exists invoice_taxes_super on public.invoice_taxes;
create policy invoice_taxes_super on public.invoice_taxes
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists invoice_taxes_tenant on public.invoice_taxes;
create policy invoice_taxes_tenant on public.invoice_taxes
  for all to authenticated
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_taxes.invoice_id
         and i.company_id = app.current_company_id()
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_taxes.invoice_id
         and i.company_id = app.current_company_id()
    )
  );

revoke all on public.invoice_taxes from anon;

-- -----------------------------------------------------------------------------
-- 2) gocardless_webhook_events — solo el servidor escribe aquí.
--    Además de la fuga de lectura, sin RLS se puede envenenar la idempotencia:
--    insertando filas con un `gocardless_event_id` previsible, el webhook
--    legítimo se descarta por "ya procesado" y el cobro nunca se marca.
-- -----------------------------------------------------------------------------
alter table public.gocardless_webhook_events enable row level security;
alter table public.gocardless_webhook_events force  row level security;

drop policy if exists gocardless_events_super on public.gocardless_webhook_events;
create policy gocardless_events_super on public.gocardless_webhook_events
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists gocardless_events_select on public.gocardless_webhook_events;
create policy gocardless_events_select on public.gocardless_webhook_events
  for select to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'));

revoke all on public.gocardless_webhook_events from anon;

-- -----------------------------------------------------------------------------
-- 3) savings_price_scrape_log — sensibilidad baja, misma clase de fallo.
-- -----------------------------------------------------------------------------
alter table public.savings_price_scrape_log enable row level security;
alter table public.savings_price_scrape_log force  row level security;

drop policy if exists savings_scrape_super on public.savings_price_scrape_log;
create policy savings_scrape_super on public.savings_price_scrape_log
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists savings_scrape_select on public.savings_price_scrape_log;
create policy savings_scrape_select on public.savings_price_scrape_log
  for select to authenticated
  using (company_id = app.current_company_id());

revoke all on public.savings_price_scrape_log from anon;

-- -----------------------------------------------------------------------------
-- 4) whatsapp_sends — RLS activada, pero con una política que no filtra nada.
--
--    EN LOCAL, `wa_admin_write` está escrita como `for all using (true) with
--    check (true)`, así que cualquier usuario autenticado de cualquier empresa
--    puede insertar, modificar y borrar filas del historial de WhatsApp de todas
--    las demás. Es distinto de los tres casos de arriba —aquí el candado está
--    puesto, pero abierto— y por eso no lo detecta la consulta de
--    `relrowsecurity`.
--
--    EN PRODUCCIÓN NO (comprobado el 10-sep-2026): allí la misma política sí
--    filtra por `company_id`. Lo que hace este bloque en el remoto es solo
--    partirla en tres —super / select / insert— y quitarle a un usuario normal
--    el UPDATE y el DELETE sobre el historial, que no necesita: el envío real lo
--    hace el servidor con service_role. Ninguna ruta de la app escribe en esta
--    tabla con el cliente de sesión, así que no rompe nada.
--
--    Encontrado al revisar el envío de confirmaciones por WhatsApp del agente
--    de voz, que escribe en esta tabla.
-- -----------------------------------------------------------------------------
drop policy if exists wa_admin_write on public.whatsapp_sends;

drop policy if exists whatsapp_sends_super on public.whatsapp_sends;
create policy whatsapp_sends_super on public.whatsapp_sends
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists whatsapp_sends_select on public.whatsapp_sends;
create policy whatsapp_sends_select on public.whatsapp_sends
  for select to authenticated
  using (company_id = app.current_company_id());

-- El envío real lo hace el servidor con service_role (que salta RLS). Un
-- usuario solo necesita poder registrar lo que él mismo manda desde la UI.
drop policy if exists whatsapp_sends_insert on public.whatsapp_sends;
create policy whatsapp_sends_insert on public.whatsapp_sends
  for insert to authenticated
  with check (company_id = app.current_company_id());

revoke all on public.whatsapp_sends from anon;

notify pgrst, 'reload schema';

-- =============================================================================
-- Después de aplicar, esta consulta debe devolver CERO filas. Si devuelve
-- alguna, es otra tabla a la que también se le olvidó el candado: merece la
-- pena dejarla en el checklist de despliegue, porque este fallo se repite cada
-- vez que se crea una tabla sin copiar el bloque de RLS.
--
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and c.relrowsecurity = false;
-- =============================================================================
