-- =============================================================================
-- Wallet ↔ Invoice link
-- =============================================================================
-- Permite saber qué cobros del wallet ya están facturados al cliente
-- (con factura emitida) y cuáles están pendientes de facturar. Útil para
-- el flujo "el comercial cobra → admin tiene que facturar".
-- =============================================================================

alter table public.wallet_entries
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists idx_we_invoice on public.wallet_entries(invoice_id) where invoice_id is not null;
create index if not exists idx_we_pending_invoice on public.wallet_entries(company_id, status) where invoice_id is null;
