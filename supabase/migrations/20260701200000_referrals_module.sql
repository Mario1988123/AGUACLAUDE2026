-- =============================================================================
-- 20260701200000_referrals_module.sql
-- Módulo /referidos (2026-06-19).
--
-- Un cliente que ya tiene equipos con nosotros nos da nombres + teléfonos de
-- amigos que podrían querer productos. Esos amigos entran como LEADS nuevos
-- asociados al cliente que los recomendó (leads.referred_by_customer_id).
-- El origin del lead se marca como 'referral' (ya existe en el enum lead_origin).
--
-- Módulo OPCIONAL activable por empresa (default activado).
-- =============================================================================

-- 1) Vínculo lead → cliente recomendador
alter table public.leads
  add column if not exists referred_by_customer_id uuid
    references public.customers(id) on delete set null;

comment on column public.leads.referred_by_customer_id is
  'Cliente (con equipos) que recomendó a esta persona. NULL = no es un referido. El origin del lead se marca como referral.';

create index if not exists idx_leads_referred_by
  on public.leads(company_id, referred_by_customer_id)
  where deleted_at is null and referred_by_customer_id is not null;

-- 2) Registro del módulo en el catálogo (opt-in, activado por defecto)
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order)
values (
  'referrals',
  'Referidos',
  'Capta amigos recomendados por tus clientes con equipos. Registra nombre y teléfono y entran como leads nuevos asociados al cliente que los recomendó, listos para contactar y vender.',
  'users-round',
  true,            -- activado por defecto
  false,           -- no es core
  false,
  55               -- justo después de Clientes en el grupo Comercial
)
on conflict (key) do update set
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  icon = excluded.icon,
  is_parked = excluded.is_parked,
  sort_order = excluded.sort_order;

-- 3) Backfill: el sidebar solo muestra módulos no-core que tienen fila ACTIVA
-- en company_modules (no mira default_active). Para que las empresas EXISTENTES
-- vean /referidos por defecto, sembramos una fila activa donde no exista.
insert into public.company_modules (company_id, module_key, is_active)
select c.id, 'referrals', true
from public.companies c
where not exists (
  select 1 from public.company_modules cm
  where cm.company_id = c.id and cm.module_key = 'referrals'
);

notify pgrst, 'reload schema';
