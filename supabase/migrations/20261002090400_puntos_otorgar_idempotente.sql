-- =============================================================================
-- 20261002090400_puntos_otorgar_idempotente.sql
--
-- Auditoría 2026-10-01, I43: puntos.
--
-- PROBLEMA
--   1) awardPoints (src/modules/points/award.ts) evitaba duplicados con un
--      SELECT count(*) y después un INSERT, sin bloqueo: dos llamadas a la vez
--      (doble clic, reintento) otorgaban los puntos dos veces. Y no hay índice
--      único en points_ledger.
--   2) La comprobación contaba también los asientos que luego se REVIRTIERON:
--      tras cancelar y reactivar un contrato, los puntos ya no se podían
--      volver a otorgar.
--
-- POR QUÉ NO UN ÍNDICE ÚNICO
--   Un UNIQUE (empresa, usuario, motivo, sujeto) where points > 0 impediría
--   precisamente volver a otorgar tras una reversión (caso 2). En su lugar,
--   una función que serializa con pg_advisory_xact_lock por
--   (empresa, usuario, motivo, sujeto) y aplica la regla:
--     "ya otorgado" = existe un asiento positivo con ese motivo y sujeto
--     POSTERIOR a la última reversión (asiento negativo) de ese sujeto para
--     ese usuario.
--
-- Solo service_role (la llama el admin client desde awardPoints).
-- En producción hay 4 asientos y 0 duplicados (2026-10-02).
--
-- Idempotente (create or replace). No toca datos.
-- =============================================================================

create or replace function public.award_points_once(
  p_company_id uuid,
  p_user_id uuid,
  p_points integer,
  p_reason text,
  p_subject_type text,
  p_subject_id uuid,
  p_contract_id uuid,
  p_installation_id uuid,
  p_metadata jsonb,
  p_period_year integer,
  p_period_month integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ultima_reversion timestamptz;
  v_ya boolean;
begin
  if p_company_id is null or p_user_id is null or p_reason is null then
    raise exception 'award_points_once: empresa, usuario y motivo son obligatorios';
  end if;
  if p_points is null or p_points = 0 then
    return false;
  end if;

  if p_subject_type is not null and p_subject_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_company_id::text || '|' || p_user_id::text || '|' || p_reason || '|' ||
        p_subject_type || '|' || p_subject_id::text,
        0
      )
    );

    select max(awarded_at) into v_ultima_reversion
      from public.points_ledger
     where company_id = p_company_id
       and user_id = p_user_id
       and subject_type = p_subject_type
       and subject_id = p_subject_id
       and points < 0;

    select exists (
      select 1 from public.points_ledger
       where company_id = p_company_id
         and user_id = p_user_id
         and reason = p_reason
         and subject_type = p_subject_type
         and subject_id = p_subject_id
         and points > 0
         and (v_ultima_reversion is null or awarded_at > v_ultima_reversion)
    ) into v_ya;

    if v_ya then
      return false;
    end if;
  end if;

  insert into public.points_ledger (
    company_id, user_id, points, reason, contract_id, installation_id,
    subject_type, subject_id, metadata, period_year, period_month, awarded_at
  ) values (
    p_company_id, p_user_id, p_points, p_reason, p_contract_id, p_installation_id,
    p_subject_type, p_subject_id, coalesce(p_metadata, '{}'::jsonb),
    p_period_year, p_period_month, now()
  );
  return true;
end;
$$;

revoke all on function public.award_points_once(
  uuid, uuid, integer, text, text, uuid, uuid, uuid, jsonb, integer, integer
) from public, anon, authenticated;
grant execute on function public.award_points_once(
  uuid, uuid, integer, text, text, uuid, uuid, uuid, jsonb, integer, integer
) to service_role;
