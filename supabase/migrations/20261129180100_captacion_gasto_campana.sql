-- =============================================================================
-- Captación · fase 7: coste acumulado de una campaña (para su embudo). SUMA de
-- filas de captacion_envios, como el gasto del mes. Solo aditiva.
-- =============================================================================
create or replace function public.captacion_gasto_campana(p_company_id uuid, p_campana_id uuid, p_desde timestamptz default null)
returns table (confirmado_milicentimos bigint, en_vuelo integer, cobrados integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(e.coste_milicentimos), 0)::bigint,
         (count(*) filter (where e.coste_milicentimos is null and e.estado in ('enviado', 'entregado', 'leido')))::integer,
         (count(*) filter (where e.coste_milicentimos > 0))::integer
    from public.captacion_envios e
   where e.company_id = p_company_id
     and e.campana_id = p_campana_id
     and e.enviado_at is not null
     and (p_desde is null or e.enviado_at >= p_desde);
$$;

revoke all on function public.captacion_gasto_campana(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.captacion_gasto_campana(uuid, uuid, timestamptz) to service_role;
