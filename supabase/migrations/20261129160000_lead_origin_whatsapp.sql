-- =============================================================================
-- Captación por WhatsApp (fase 3): origen de lead «whatsapp».
--
-- Decisión 4 de Mario: el lead se crea con el primer «Sí» y con origen propio,
-- para poder medir el canal aparte. Va en una migración sola: un valor nuevo
-- de un enum no se puede usar en la misma transacción que lo añade.
-- =============================================================================

alter type app.lead_origin add value if not exists 'whatsapp';
