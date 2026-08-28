-- =============================================================================
-- 20260828110000_gen_reference_code_lockdown.sql
--
-- Cierra una fuga de información entre empresas (auditoría 2026-08-28).
--
-- PROBLEMA
--   public.gen_reference_code(p_company_id uuid, p_table text, p_prefix text)
--   se convirtió en SECURITY DEFINER en 20260702100000 (correcto: necesita
--   saltarse la RLS para calcular el correlativo real, incluidas filas de
--   otros usuarios y soft-borradas). Pero nunca se le revocó el privilegio
--   EXECUTE que Postgres concede a PUBLIC por defecto al crear una función.
--   Resultado: cualquier usuario autenticado podía llamarla vía
--   /rest/v1/rpc/gen_reference_code con el company_id de OTRA empresa y
--   obtener su siguiente correlativo → deduce cuántas incidencias / pruebas
--   gratuitas lleva ese año un competidor alojado en el mismo SaaS.
--   Es la misma clase de fallo que C1 (20260712100000) y el agujero fiscal de
--   allocate_next_invoice_number (20260713100000). Solo lectura y sin
--   contenido de datos, por eso severidad baja — pero es cross-tenant.
--
-- POR QUÉ NO BASTA CON REVOCAR
--   La llama el trigger public.fill_reference_code_on_insert(), que es
--   SECURITY INVOKER: se ejecuta como el usuario que hace el INSERT, así que
--   revocar EXECUTE a `authenticated` rompería el alta de free_trials e
--   incidents (verificado en el remoto: son los 2 triggers que la usan;
--   maintenance_jobs y wallet_entries no llegaron a tener el trigger).
--
-- ARREGLO (en este orden)
--   1) fill_reference_code_on_insert pasa a SECURITY DEFINER. Se ejecuta como
--      su dueño (postgres), que sí tiene EXECUTE sobre gen_reference_code.
--      Es seguro: la función no consulta tablas ni acepta entrada del usuario
--      más allá de NEW y tg_argv; solo rellena NEW.reference_code. Y no
--      amplía visibilidad, porque gen_reference_code YA era security definer.
--   2) Recién entonces se revoca gen_reference_code de public/anon/
--      authenticated.
--
-- Idempotente. No toca datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) El trigger pasa a security definer (mismo cuerpo, + search_path fijo)
-- -----------------------------------------------------------------------------
create or replace function public.fill_reference_code_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_prefix text;
begin
  if new.reference_code is not null then
    return new;
  end if;
  if tg_argv[0] is null then
    return new;
  end if;
  v_prefix := tg_argv[0];
  new.reference_code := public.gen_reference_code(
    new.company_id, tg_table_name, v_prefix
  );
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Y ahora sí: gen_reference_code deja de ser llamable por los usuarios.
--    La app nunca la invoca por RPC (no hay ni un `rpc("gen_reference_code")`
--    en src/); solo la usa el trigger de arriba y los backfills puntuales.
-- -----------------------------------------------------------------------------
revoke all on function public.gen_reference_code(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.gen_reference_code(uuid, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3) Higiene: las otras dos funciones security definer de `public` alcanzables
--    por authenticated son funciones de TRIGGER (returns trigger). PostgREST no
--    las expone y Postgres rechaza llamarlas fuera de un trigger, así que el
--    riesgo es nulo; se revocan igualmente por defensa en profundidad.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
