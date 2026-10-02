-- =============================================================================
-- C6 (auditoría 01-10-2026): añade 'cancelled' a app.wallet_entry_status.
--
-- El código escribía status = 'cancelled' en wallet_entries al cancelar un
-- cobro o un contrato, pero el valor no existía en el enum: el UPDATE fallaba
-- con 22P02 y, como nadie miraba el error, los cobros de contratos cancelados
-- seguían "pendientes". Los filtros .in('status', ['rejected','cancelled'])
-- (churn, alertas) también reventaban.
--
-- Va en su propio fichero: ALTER TYPE ... ADD VALUE no puede usarse en la misma
-- transacción en la que se añade. Idempotente (IF NOT EXISTS).
-- Hasta que se aplique, el código cae a 'rejected' (src/modules/wallet/cancelar.ts).
-- =============================================================================

alter type app.wallet_entry_status add value if not exists 'cancelled';
