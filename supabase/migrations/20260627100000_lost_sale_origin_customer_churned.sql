-- =============================================================================
-- Flujo "Borrar cliente" (decisión 2026-06-16) — PARTE 1 de 2: valor de enum
-- =============================================================================
-- Añade el origen 'customer_churned' al enum de ventas perdidas, para poder
-- mandar a "venta perdida" a un cliente que deja la relación comercial
-- (caso vendido que rechaza mantenimiento, o alquiler/renting retirado).
--
-- IMPORTANTE: el nuevo valor del enum va SOLO en esta migración. Postgres no
-- permite usar un valor de enum recién creado dentro de la MISMA transacción
-- (índices, inserts, checks). Las columnas que lo usan van en la migración
-- siguiente (20260627200000). Ver regla feedback_enum_index_postgres.
-- =============================================================================

alter type app.lost_sale_origin add value if not exists 'customer_churned';
