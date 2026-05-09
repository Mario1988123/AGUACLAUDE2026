-- =============================================================================
-- Refresca el schema cache de PostgREST tras las migraciones de la suite
-- "almacenes inteligente" (Fases A-G).
--
-- Síntoma típico: "Could not find the table 'public.purchases' in the schema
-- cache" o equivalente con stock_reservations / warehouse_stock_thresholds /
-- stock_alerts. PostgREST mantiene su propio caché del esquema y no se
-- entera de las DDL hasta que recibe este NOTIFY.
--
-- Esta migración es idempotente: ejecutar el NOTIFY no tiene efectos
-- secundarios, solo dispara el recargado.
-- =============================================================================

notify pgrst, 'reload schema';
