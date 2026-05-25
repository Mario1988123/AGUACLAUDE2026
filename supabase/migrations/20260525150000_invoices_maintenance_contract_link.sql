-- =============================================================================
-- 20260525150000_invoices_maintenance_contract_link.sql
-- Permite distinguir las facturas que vienen de la REMESA mensual de
-- maintenance_contracts. Antes solo había invoices.contract_id (al
-- contrato origen de venta), pero las remesas mensuales se generan
-- por maintenance_contract y eran indistinguibles de una factura
-- normal en /facturas.
--
-- Añadimos:
--  · maintenance_contract_id FK nullable → identifica la fuente
--  · billing_period text (formato "YYYY-MM") → en qué mes se cobró
-- =============================================================================

alter table public.invoices
  add column if not exists maintenance_contract_id uuid
    references public.maintenance_contracts(id) on delete set null,
  add column if not exists billing_period text;

comment on column public.invoices.maintenance_contract_id is
  'Si la factura viene de la remesa mensual de un contrato de mantenimiento, este campo apunta a maintenance_contracts.id. Permite filtrar /facturas?remesa=true y mostrar el badge "Remesa".';
comment on column public.invoices.billing_period is
  'Periodo de facturación cuando aplica (formato YYYY-MM). Solo se rellena en facturas de remesa mensual.';

create index if not exists idx_invoices_remesa
  on public.invoices (company_id, billing_period desc)
  where maintenance_contract_id is not null;

notify pgrst, 'reload schema';
