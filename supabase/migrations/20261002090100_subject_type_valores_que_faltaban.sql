-- =============================================================================
-- 20261002090100_subject_type_valores_que_faltaban.sql
--
-- Auditoría 2026-10-01, I3: avisos, eventos y tareas que no se guardaban
-- porque el código usa valores de `app.subject_type` que no existen.
--
-- PROBLEMA
--   El enum en producción solo tiene: lead, customer, proposal, contract,
--   free_trial, installation, maintenance, incident, product, warehouse,
--   wallet_entry, user, company, sales_record, lost_sale, price_approval.
--   El código (y el tipo TS NotificationSubjectType) usa además invoice,
--   loading_request, maintenance_contract, agenda, expense y time_punch. El
--   INSERT falla con 22P02 y como casi nadie mira el `error`, el aviso se
--   pierde en silencio. En producción hay 0 notificaciones invoice.%,
--   time_tracking.%, loading% y expense%.
--   Sitios: cron diario (impagos), cron horario (autocierre de fichajes),
--   cargas de furgoneta, planes de mantenimiento, recordatorio manual de pago,
--   agenda y gastos.
--
-- ARREGLO
--   Ampliar el enum (solo añade valores; no cambia ni borra nada). Es la
--   opción que arregla todos los sitios a la vez, incluidos los de módulos
--   que no se tocan en esta tanda. Columnas que lo usan: notifications,
--   agenda_events, events y documents (subject_type).
--
--   Los `kind: "task"` de agenda_events NO se arreglan aquí: `agenda_event_kind`
--   no se amplía para no romper los mapas de la interfaz de agenda; el código
--   pasa a usar "reminder".
--
-- NOTA: `alter type ... add value` no puede usarse en la misma transacción
-- en la que se añade. Aquí no se usa, así que puede ir en una migración normal.
--
-- Idempotente (if not exists). No toca datos.
-- =============================================================================

alter type app.subject_type add value if not exists 'invoice';
alter type app.subject_type add value if not exists 'loading_request';
alter type app.subject_type add value if not exists 'maintenance_contract';
alter type app.subject_type add value if not exists 'agenda';
alter type app.subject_type add value if not exists 'expense';
alter type app.subject_type add value if not exists 'time_punch';
