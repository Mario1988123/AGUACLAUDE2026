-- ============================================================================
-- VeriFactu a través de Verifacti: activación por empresa, estado AEAT del
-- envío e idempotencia en base de datos.
--
-- Contexto: el envío DIRECTO a la AEAT sigue bloqueado (VERIFACTU_HABILITADO
-- = false). La vía Verifacti es independiente y se activa empresa a empresa
-- desde Configuración → Facturación cuando la API key del NIF ha superado la
-- prueba de conexión.
--
-- Idempotente: se puede ejecutar varias veces. NO toca datos existentes
-- (a 02-10-2026 external_invoicing_submissions está vacía y las 4 empresas
-- tienen external_invoicing_provider = 'none').
-- ============================================================================

-- 1. Interruptor por empresa. Por defecto apagado: guardar una API key no
--    envía nada hasta que el admin lo active expresamente.
alter table public.company_settings
  add column if not exists external_invoicing_activo boolean not null default false;

comment on column public.company_settings.external_invoicing_activo is
  'Si true y el proveedor es verifacti, las facturas se registran en VeriFactu vía Verifacti al emitirse.';

-- 2. Datos del registro de VeriFactu en cada envío.
alter table public.external_invoicing_submissions
  add column if not exists operacion text not null default 'alta',
  add column if not exists idempotency_key text,
  add column if not exists estado_aeat text,
  add column if not exists huella text,
  add column if not exists qr_url text,
  add column if not exists codigo_error_aeat text,
  add column if not exists mensaje_error_aeat text,
  add column if not exists estado_consultado_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_invoicing_submissions_operacion_check'
      and conrelid = 'public.external_invoicing_submissions'::regclass
  ) then
    alter table public.external_invoicing_submissions
      add constraint external_invoicing_submissions_operacion_check
      check (operacion in ('alta', 'anulacion'));
  end if;
end $$;

comment on column public.external_invoicing_submissions.operacion is
  'alta = POST /verifactu/create; anulacion = POST /verifactu/cancel.';
comment on column public.external_invoicing_submissions.estado_aeat is
  'Estado del registro según Verifacti: Pendiente, Correcto, Aceptado con errores, Incorrecto, Duplicado, Anulado, Factura inexistente, No registrado, Error servidor AEAT.';
comment on column public.external_invoicing_submissions.external_id is
  'Para Verifacti: uuid del registro (GET /verifactu/status?uuid=).';

-- 3. Idempotencia en BD: como mucho UN envío vivo (enviándose o aceptado por
--    Verifacti) por factura y operación. Un doble clic o dos procesos a la
--    vez chocan aquí (23505) en vez de mandar dos registros a la AEAT.
--    Un envío 'failed' no cuenta, así que se puede reintentar.
create unique index if not exists uq_ext_inv_subs_vivo
  on public.external_invoicing_submissions (invoice_id, operacion)
  where invoice_id is not null
    and provider = 'verifacti'
    and status in ('sending', 'sent');

-- 4. Para el cron que consulta los estados pendientes.
create index if not exists idx_ext_inv_subs_estado_pendiente
  on public.external_invoicing_submissions (company_id, created_at)
  where provider = 'verifacti'
    and status = 'sent'
    and (estado_aeat is null or estado_aeat in ('Pendiente', 'Error servidor AEAT'));
