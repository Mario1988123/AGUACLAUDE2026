-- =============================================================================
-- 20260621100000_tech_prep_notes.sql
-- Fase nueva tras firmar contrato: el comercial deja INSTRUCCIONES PARA EL
-- TÉCNICO (notas + fotos/vídeos del sitio de la futura instalación).
--   · installations.tech_prep_notes: notas libres del comercial (distinto de
--     `notes`, que son las notas FINALES del técnico al cerrar).
--   · installation_photos.category: se amplía con 'tech_prep' (fotos/vídeos que
--     adjunta el comercial). Reutiliza mime_type/size_bytes ya existentes.
-- Idempotente.
-- =============================================================================

alter table public.installations
  add column if not exists tech_prep_notes text;

comment on column public.installations.tech_prep_notes is
  'Instrucciones del comercial para el técnico (material necesario, contexto del sitio). Distinto de notes (finales).';

do $$
declare
  cons_name text;
begin
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
        'previous_damage',
        'countertop_drilling',
        'equipment_location',
        'network_connection',
        'before',
        'after',
        'other',
        'equipment',
        'connection',
        'damage',
        'extra',
        -- nuevo: media del comercial para el técnico (pre-instalación)
        'tech_prep'
      )
    );
end $$;

notify pgrst, 'reload schema';
