-- ============================================================================
-- Alquileres: pausa + prórroga
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-18:
--   Necesitamos pausar un alquiler (cliente se va de viaje, equipo se queda
--   instalado pero deja de pagar cuota; si la pausa supera 1 mes, generamos
--   mantenimiento preventivo). Y poder prorrogar el contrato N meses sin
--   crear uno nuevo.
--
-- Decisiones:
--   - paused_at timestamptz: si NOT NULL, el contrato está pausado. El cron
--     mensual de facturación NO genera cuota mientras paused_at IS NOT NULL.
--   - pause_reason text: motivo opcional anotado por el admin.
--   - duration_months_original integer: snapshot del valor original. Cada
--     prórroga incrementa duration_months pero guardamos el original para
--     diferenciar "lo que firmó el cliente" de "lo que tiene hoy".
--   - No tocamos el enum status — pausa es un flag ortogonal.
-- ============================================================================

alter table public.contracts
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text,
  add column if not exists duration_months_original integer;

comment on column public.contracts.paused_at is
  'Si NOT NULL, el contrato está pausado. El cron de facturación mensual no genera cuota mientras esté pausado. Si la pausa supera 30 días se programa mantenimiento preventivo.';
comment on column public.contracts.pause_reason is
  'Motivo de la pausa anotado por el admin (visible en timeline).';
comment on column public.contracts.duration_months_original is
  'Duración original al firmar. Permite diferenciar el contrato firmado del prorrogado.';

create index if not exists idx_contracts_paused
  on public.contracts(company_id, paused_at)
  where paused_at is not null and deleted_at is null;

notify pgrst, 'reload schema';
