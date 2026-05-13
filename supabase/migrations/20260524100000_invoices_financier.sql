-- ============================================================================
-- Fase 6 facturación a financiera
-- ----------------------------------------------------------------------------
-- La factura del renting se emite a la financiera, no al cliente:
--   - invoices.customer_id pasa a ser opcional (NULLABLE)
--   - invoices.financier_id nuevo (FK a financiers, opcional)
--   - el destinatario fiscal se serializa igualmente en
--     customer_fiscal_snapshot (renombrar sería romper Verifactu)
--
-- Una factura siempre debe tener al menos uno: customer_id O financier_id.
-- ============================================================================

alter table public.invoices
  alter column customer_id drop not null;

alter table public.invoices
  add column if not exists financier_id uuid references public.financiers(id) on delete set null;

create index if not exists idx_inv_financier on public.invoices(company_id, financier_id)
  where financier_id is not null;

-- Constraint: al menos uno de los dos destinatarios.
do $$ begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.invoices'::regclass
       and conname = 'invoices_recipient_required'
  ) then
    alter table public.invoices
      add constraint invoices_recipient_required check (
        customer_id is not null or financier_id is not null
      );
  end if;
end $$;

comment on column public.invoices.financier_id is
  'Si la factura va a una financiera (renting/financiación) en lugar de a un cliente final.';

notify pgrst, 'reload schema';
