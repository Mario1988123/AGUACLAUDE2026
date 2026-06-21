-- =============================================================================
-- 20260702300000_chat_voice_messages.sql
-- Notas de voz en el chat interno (solo audio, sin transcripción de momento).
--
-- Añade a chat_messages el path del audio (en el bucket privado `chat-audio`)
-- y su duración. Un mensaje de voz lleva body='' y audio_path no nulo.
--
-- Los GRUPOS no necesitan cambios de esquema: ya se modelan con
-- chat_threads.kind='team' + chat_thread_members (varios miembros).
--
-- Idempotente, aditivo.
-- =============================================================================

alter table public.chat_messages
  add column if not exists audio_path text;
alter table public.chat_messages
  add column if not exists audio_duration_ms integer;

notify pgrst, 'reload schema';
