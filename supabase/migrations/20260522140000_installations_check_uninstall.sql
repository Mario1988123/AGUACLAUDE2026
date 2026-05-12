-- ============================================================================
-- Permitir kind='uninstall' en installations
-- ----------------------------------------------------------------------------
-- El check constraint original (migración 20260501121600) solo permitía:
--   kind='normal'      → exige contract_id
--   kind='free_trial'  → exige free_trial_id
--   kind='relocation'  → libre
--
-- Cuando se añadió kind='uninstall' (migración 20260516110000) NO se actualizó
-- el check, así que cualquier INSERT con kind='uninstall' peta con:
--   "new row for relation 'installations' violates check constraint
--    'installations_check'"
--
-- Esta migración:
--  - Reemplaza el check para incluir 'uninstall' (libre, puede llevar
--    customer_id, free_trial_id o ninguno — depende del origen).
--  - Recarga el schema PostgREST.
-- ============================================================================

-- 1) Localizar y borrar el check anterior (nombre auto-generado).
--    Buscamos el constraint que mencione 'free_trial' (lo identifica).
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.installations'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%free_trial%'
  loop
    execute format('alter table public.installations drop constraint %I', c.conname);
  end loop;
end $$;

-- 2) Crear el check correcto incluyendo 'uninstall'.
alter table public.installations
  add constraint installations_kind_origin_check check (
    (kind = 'normal'      and contract_id   is not null)
    or (kind = 'free_trial'  and free_trial_id is not null)
    or (kind = 'relocation')
    or (kind = 'uninstall')
  );

notify pgrst, 'reload schema';
