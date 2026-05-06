-- =============================================================================
-- 20260506100000_installation_signatures_wizard.sql
-- Adapta installation_signatures al wizard nuevo:
--  · CHECK de `context` ampliado para aceptar 'initial_state' y 'final'
--    (los que usa installation-wizard.tsx) además de los originales
--    ('previous_damage','countertop_drilling','work_report').
--  · CHECK de `signer_role` ampliado para aceptar 'representative'.
--  · Nueva columna `signature_data_url` (data URL del canvas) y
--    `signature_image_path` pasa a nullable con default '' para que el
--    insert del wizard funcione sin tener que subir a Storage primero.
--
-- Idempotente: cada ALTER comprueba si la operación ya está aplicada.
-- =============================================================================

do $$
declare
  cons_name text;
begin
  -- Drop CHECK existente sobre context (sea cual sea su nombre)
  for cons_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'installation_signatures'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%context%'
  loop
    execute format(
      'alter table public.installation_signatures drop constraint %I',
      cons_name
    );
  end loop;

  -- Recrear CHECK ampliado (acepta valores originales + los del wizard)
  alter table public.installation_signatures
    add constraint installation_signatures_context_check
    check (
      context is null
      or context in (
        'previous_damage',
        'countertop_drilling',
        'work_report',
        'initial_state',
        'final'
      )
    );
end $$;

do $$
declare
  cons_name text;
begin
  -- Drop CHECK existente sobre signer_role
  for cons_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'installation_signatures'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%signer_role%'
  loop
    execute format(
      'alter table public.installation_signatures drop constraint %I',
      cons_name
    );
  end loop;

  alter table public.installation_signatures
    add constraint installation_signatures_signer_role_check
    check (
      signer_role in ('customer','installer','witness','representative')
    );
end $$;

-- Columna signature_data_url (data URL del canvas, nullable)
alter table public.installation_signatures
  add column if not exists signature_data_url text;

-- signature_image_path pasa a nullable con default '' (antes NOT NULL)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'installation_signatures'
      and column_name = 'signature_image_path'
      and is_nullable = 'NO'
  ) then
    alter table public.installation_signatures
      alter column signature_image_path drop not null;
    alter table public.installation_signatures
      alter column signature_image_path set default '';
  end if;
end $$;
