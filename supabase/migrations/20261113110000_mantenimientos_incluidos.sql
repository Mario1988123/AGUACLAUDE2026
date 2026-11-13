-- =============================================================================
-- 20261113110000_mantenimientos_incluidos.sql
-- Plan docs/PLAN_MANTENIMIENTOS_INCLUIDOS.md (regla corregida §0.3, 12-11).
--
-- 1. customer_equipment: N = nº de mantenimientos anuales incluidos + origen
--    + precio propio por tarifa (base SIN IVA, céntimos).
-- 2. customers: precio propio del cliente por tarifa (NULL = hereda).
-- 3. company_settings: N por defecto (solo prerrellena) + precio general.
-- 4. maintenance_jobs: estado del pago de la visita y lo que se cobró.
-- 5. wallet_entries.maintenance_job_id (+ índice único: un cobro por visita).
--
-- ADITIVA e IDEMPOTENTE. NO toca datos. NO crea facturas ni cobros.
-- NO APLICADA: la aplica Mario (Management API). El código detecta si falta
-- (mantIncluidoDisponible) y esconde la función.
--
-- Decisiones [decide]:
--  - Sin la columna generada mant_cobro_desde del plan: el estado se calcula
--    en código (src/modules/mant-incluido/logica.ts) y así no dependemos de
--    que Postgres acepte la expresión como inmutable.
--  - La tarifa de la visita es maintenance_jobs.alcance (la crea también la
--    migración 20261113090000 del modelo de equipo; aquí se repite con
--    «if not exists» para que esta funcione sola en cualquier orden).
-- =============================================================================

-- 1. Equipo ------------------------------------------------------------------
alter table public.customer_equipment add column if not exists mant_incluidos_n integer;
alter table public.customer_equipment add column if not exists mant_incluido_origen text;
alter table public.customer_equipment add column if not exists mant_precio_filtros_cents integer;
alter table public.customer_equipment add column if not exists mant_precio_filtros_membrana_cents integer;
alter table public.customer_equipment
  add column if not exists mant_incluido_actualizado_por uuid references auth.users(id) on delete set null;
alter table public.customer_equipment add column if not exists mant_incluido_actualizado_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ce_mant_incluidos_n_chk') then
    alter table public.customer_equipment add constraint ce_mant_incluidos_n_chk
      check (mant_incluidos_n is null or mant_incluidos_n between 0 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_mant_incluido_origen_chk') then
    alter table public.customer_equipment add constraint ce_mant_incluido_origen_chk
      check (mant_incluido_origen is null or mant_incluido_origen in ('venta', 'renting', 'manual', 'importacion'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_mant_precios_chk') then
    alter table public.customer_equipment add constraint ce_mant_precios_chk check (
      (mant_precio_filtros_cents is null or mant_precio_filtros_cents >= 0)
      and (mant_precio_filtros_membrana_cents is null or mant_precio_filtros_membrana_cents >= 0)
    );
  end if;
end $$;

comment on column public.customer_equipment.mant_incluidos_n is
  'Mantenimientos anuales incluidos (= «N años» desde installed_at). La visita anual k (k=1 en el mes 12) es gratis si k <= N. Renting de M meses: N = M/12 - 1. NULL = sin dato.';
comment on column public.customer_equipment.mant_precio_filtros_cents is
  'Precio por visita «solo filtros», base SIN IVA. NULL = hereda del cliente / empresa.';
comment on column public.customer_equipment.mant_precio_filtros_membrana_cents is
  'Precio por visita «filtros + membrana», base SIN IVA. NULL = hereda del cliente / empresa.';

create index if not exists idx_ce_mant_incluidos
  on public.customer_equipment (company_id)
  where is_active and mant_incluidos_n is not null;

-- 2. Cliente -----------------------------------------------------------------
alter table public.customers add column if not exists mant_precio_filtros_cents integer;
alter table public.customers add column if not exists mant_precio_filtros_membrana_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_mant_precios_chk') then
    alter table public.customers add constraint customers_mant_precios_chk check (
      (mant_precio_filtros_cents is null or mant_precio_filtros_cents >= 0)
      and (mant_precio_filtros_membrana_cents is null or mant_precio_filtros_membrana_cents >= 0)
    );
  end if;
end $$;

-- 3. Empresa -----------------------------------------------------------------
alter table public.company_settings add column if not exists mant_incluidos_n_defecto integer;
alter table public.company_settings add column if not exists mant_precio_filtros_cents integer;
alter table public.company_settings add column if not exists mant_precio_filtros_membrana_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cs_mant_incluido_chk') then
    alter table public.company_settings add constraint cs_mant_incluido_chk check (
      (mant_incluidos_n_defecto is null or mant_incluidos_n_defecto between 0 and 30)
      and (mant_precio_filtros_cents is null or mant_precio_filtros_cents >= 0)
      and (mant_precio_filtros_membrana_cents is null or mant_precio_filtros_membrana_cents >= 0)
    );
  end if;
end $$;

-- 4. Visita ------------------------------------------------------------------
alter table public.maintenance_jobs add column if not exists alcance text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_jobs_alcance_chk') then
    alter table public.maintenance_jobs add constraint maintenance_jobs_alcance_chk
      check (alcance is null or alcance in ('solo_filtros', 'filtros_membrana'));
  end if;
end $$;

alter table public.maintenance_jobs add column if not exists pago_estado text not null default 'incluido';
alter table public.maintenance_jobs add column if not exists importe_base_cents integer;     -- sin IVA
alter table public.maintenance_jobs add column if not exists iva_porcentaje numeric(5,2);    -- snapshot
alter table public.maintenance_jobs add column if not exists importe_pendiente_cents integer; -- base sin IVA por cobrar (diferencia de membrana)
-- Lo que marca la oficina («Pagado en oficina»).
alter table public.maintenance_jobs
  add column if not exists pagado_marcado_por uuid references auth.users(id) on delete set null;
alter table public.maintenance_jobs add column if not exists pagado_marcado_at timestamptz;
alter table public.maintenance_jobs add column if not exists pagado_oficina_tarifa text;
alter table public.maintenance_jobs add column if not exists pagado_oficina_cents integer;   -- base sin IVA
alter table public.maintenance_jobs add column if not exists pagado_oficina_metodo app.payment_method;
-- Lo que cobra el técnico en la visita.
alter table public.maintenance_jobs add column if not exists cobrado_metodo app.payment_method;
alter table public.maintenance_jobs add column if not exists cobrado_cents integer;          -- lo que entra en caja, IVA incluido
alter table public.maintenance_jobs
  add column if not exists cobrado_por uuid references auth.users(id) on delete set null;
alter table public.maintenance_jobs add column if not exists cobrado_at timestamptz;
alter table public.maintenance_jobs add column if not exists no_cobrado_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mj_pago_estado_chk') then
    alter table public.maintenance_jobs add constraint mj_pago_estado_chk
      check (pago_estado in ('incluido', 'pendiente', 'pagado_oficina', 'cobrado_tecnico', 'no_cobrado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mj_pagado_oficina_tarifa_chk') then
    alter table public.maintenance_jobs add constraint mj_pagado_oficina_tarifa_chk
      check (pagado_oficina_tarifa is null or pagado_oficina_tarifa in ('solo_filtros', 'filtros_membrana'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mj_importes_cobro_chk') then
    alter table public.maintenance_jobs add constraint mj_importes_cobro_chk check (
      (importe_base_cents is null or importe_base_cents >= 0)
      and (importe_pendiente_cents is null or importe_pendiente_cents >= 0)
      and (pagado_oficina_cents is null or pagado_oficina_cents >= 0)
      and (cobrado_cents is null or cobrado_cents >= 0)
      and (iva_porcentaje is null or (iva_porcentaje >= 0 and iva_porcentaje <= 100))
    );
  end if;
end $$;

comment on column public.maintenance_jobs.pago_estado is
  'incluido | pendiente | pagado_oficina | cobrado_tecnico | no_cobrado. La app deriva «pendiente» de k > N aunque aquí ponga incluido (visitas del cron).';

create index if not exists idx_mj_pago_pendiente
  on public.maintenance_jobs (company_id)
  where pago_estado in ('pendiente', 'no_cobrado');

-- 5. Wallet ------------------------------------------------------------------
alter table public.wallet_entries
  add column if not exists maintenance_job_id uuid references public.maintenance_jobs(id) on delete set null;

create unique index if not exists uq_wallet_maintenance_job
  on public.wallet_entries (maintenance_job_id)
  where maintenance_job_id is not null and status <> 'cancelled';

notify pgrst, 'reload schema';

-- Verificación (después de aplicar):
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('mant_incluidos_n','mant_incluido_origen','mant_precio_filtros_cents',
--                          'mant_precio_filtros_membrana_cents','mant_incluidos_n_defecto',
--                          'pago_estado','importe_pendiente_cents','pagado_oficina_tarifa',
--                          'cobrado_metodo','maintenance_job_id')
--    order by 1, 2;
--   -- 14 filas: customer_equipment 4, customers 2, company_settings 3,
--   -- maintenance_jobs 4, wallet_entries 1.
