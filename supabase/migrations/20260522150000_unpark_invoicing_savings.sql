-- ============================================================================
-- Desaparcar Facturación y Calculadora de ahorro
-- ----------------------------------------------------------------------------
-- El seed inicial (20260501120600) las dejó como `is_parked=true` cuando
-- aún no estaban implementadas. Hoy ambas existen:
--   - savings_calculator: wizard 9 pasos + scrapers + brands manager
--     (migración 20260513100000_savings_calculator.sql)
--   - invoicing: series, generador PDF, Verifactu, cola AEAT
--     (20260503310000_invoicing.sql + 20260507200000_invoicing_verifactu.sql)
--
-- La migración de invoicing ya tenía un UPDATE para desparcar, pero algunas
-- BDs en producción siguen mostrándolas como aparcadas (la 20260513100000
-- nunca actualizó el flag para savings). Esta migración es idempotente y
-- pone ambas como activas por defecto.
-- ============================================================================

update public.modules_catalog
   set is_parked      = false,
       default_active = true
 where key in ('invoicing', 'savings_calculator');

notify pgrst, 'reload schema';
