-- =============================================================================
-- 20260702100000_gen_reference_code_security_definer.sql
-- FIX: "duplicate key value violates unique constraint uniq_free_trials_ref"
--      (y el mismo riesgo latente en incidents, maintenance_jobs, wallet_entries)
--
-- CAUSA RAÍZ
--   gen_reference_code() generaba el código secuencial (PG-YYYY-NNNN, etc.)
--   leyendo "el código más alto que existe y +1". Pero la función era
--   SECURITY INVOKER, así que el SELECT interno quedaba filtrado por las
--   políticas RLS del usuario que crea la fila:
--     · Un comercial de nivel 3 (scope 'own') solo "ve" SUS pruebas → calcula
--       un número ya usado por otro usuario → choca con el índice único.
--     · Filas borradas (soft-delete): el índice único las sigue contando, pero
--       el SELECT no las veía (las políticas exigen deleted_at is null) → el
--       número se reutilizaba → mismo choque.
--
-- ARREGLO
--   Redefinir la función como SECURITY DEFINER (se ejecuta con permisos del
--   dueño = postgres, que salta RLS) + search_path fijo (buena práctica de
--   seguridad). Así lee TODAS las filas de la empresa (de cualquier usuario y
--   también las borradas) y calcula el máximo real. El cuerpo es idéntico al
--   original salvo esas dos líneas. Sigue filtrando por p_company_id, así que
--   NO hay fuga entre empresas.
--
--   Esta función la comparten 4 tablas (free_trials, incidents,
--   maintenance_jobs, wallet_entries): un solo cambio las arregla todas.
--
-- Idempotente. No toca datos.
-- =============================================================================

create or replace function public.gen_reference_code(
  p_company_id uuid,
  p_table text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_year_prefix text;
  v_last_code text;
  v_next_num integer;
begin
  v_year := extract(year from now())::int;
  v_year_prefix := p_prefix || '-' || v_year || '-';

  execute format(
    'select reference_code from public.%I
     where company_id = $1 and reference_code like $2
     order by reference_code desc
     limit 1',
    p_table
  )
  into v_last_code
  using p_company_id, v_year_prefix || '%';

  v_next_num := 1;
  if v_last_code is not null then
    v_next_num := coalesce(
      (regexp_match(v_last_code, '(\d+)$'))[1]::int + 1,
      1
    );
  end if;

  return v_year_prefix || lpad(v_next_num::text, 4, '0');
end $$;

notify pgrst, 'reload schema';
