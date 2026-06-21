-- =============================================================================
-- 20260702400000_chat_attachments.sql
-- Adjuntos en el chat: imágenes/archivos + compartir contacto + ubicación.
--
--   · attachment_path/name/mime → archivo subido al bucket privado `chat-files`
--     (imagen o documento). Imagen → se previsualiza; otro → enlace de descarga.
--   · meta (jsonb) → datos estructurados de mensajes especiales:
--       contacto:  { "type":"contact",  "subject_type":"customer|lead",
--                    "subject_id":"...", "name":"..." }
--       ubicación: { "type":"location", "lat":..., "lng":... }
--
-- Un mensaje de adjunto/contacto/ubicación lleva body=''.
-- Idempotente, aditivo.
-- =============================================================================

alter table public.chat_messages
  add column if not exists attachment_path text;
alter table public.chat_messages
  add column if not exists attachment_name text;
alter table public.chat_messages
  add column if not exists attachment_mime text;
alter table public.chat_messages
  add column if not exists meta jsonb;

notify pgrst, 'reload schema';
