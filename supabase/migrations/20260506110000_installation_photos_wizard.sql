-- =============================================================================
-- 20260506110000_installation_photos_wizard.sql
-- Adapta installation_photos al wizard nuevo:
--  · CHECK de `category` ampliado para aceptar 'equipment','connection',
--    'damage','extra' (los que usa installation-wizard.tsx). Conserva
--    los originales por compatibilidad.
--  · Nuevas columnas opcionales: mime_type (text), size_bytes (bigint).
--    El insert del wizard envía ambos valores; antes daba "column not in
--    schema cache" y se reintentaba sin ellas.
--
-- Idempotente.
-- =============================================================================

do $$
declare
  cons_name text;
begin
  -- Drop CHECK existente sobre category
  for cons_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'installation_photos'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%category%'
  loop
    execute format(
      'alter table public.installation_photos drop constraint %I',
      cons_name
    );
  end loop;

  alter table public.installation_photos
    add constraint installation_photos_category_check
    check (
      category in (
        -- valores originales (mantener compatibilidad)
        'previous_damage',
        'countertop_drilling',
        'equipment_location',
        'network_connection',
        'before',
        'after',
        'other',
        -- valores nuevos del wizard
        'equipment',
        'connection',
        'damage',
        'extra'
      )
    );
end $$;

alter table public.installation_photos
  add column if not exists mime_type text;

alter table public.installation_photos
  add column if not exists size_bytes bigint;
