-- Captación WhatsApp · coexistencia (el mismo número en la app de WhatsApp
-- Business y en la Cloud API a la vez).
--
-- Comprobado en developers.facebook.com el 2026-11-27
-- (embedded-signup/custom-flows/onboarding-business-app-users):
--  · el número no se registra con /register (ya lo está) ni lleva PIN;
--  · contactos e historial se piden con POST /{phone_number_id}/smb_app_data,
--    una sola vez cada uno y dentro de las 24 h siguientes al alta;
--  · la baja no se hace con /deregister: la hace el cliente desde la app.
--
-- Solo añade columnas; no toca datos.

alter table public.captacion_conexiones
  add column if not exists coexistencia boolean not null default false,
  add column if not exists sync_contactos_at timestamptz,
  add column if not exists sync_contactos_request_id text,
  add column if not exists sync_historial_at timestamptz,
  add column if not exists sync_historial_request_id text;

comment on column public.captacion_conexiones.coexistencia is
  'true si el número sigue también en la app de WhatsApp Business (alta por FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING).';
comment on column public.captacion_conexiones.sync_contactos_at is
  'Cuándo se pidió a Meta la sincronización de contactos (smb_app_state_sync). Solo se puede pedir una vez por alta.';
comment on column public.captacion_conexiones.sync_historial_at is
  'Cuándo se pidió a Meta el historial de chats (history). Solo se puede pedir una vez por alta, dentro de las 24 h.';
