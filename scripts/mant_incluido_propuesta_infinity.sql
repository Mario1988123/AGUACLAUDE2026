-- =============================================================================
-- scripts/mant_incluido_propuesta_infinity.sql
-- Plan docs/PLAN_MANTENIMIENTOS_INCLUIDOS.md §6 (carga de existentes).
-- SOLO Infinity Aqua (f02d586c-0dc6-49e4-83e5-e0f6e688237c). aquaroo es de pruebas.
--
-- PARTE 1 = SOLO LECTURA. Genera la propuesta de N para que Mario la revise una
-- a una (exportar a CSV). NO interpreta nada por su cuenta: solo propone.
-- PARTE 2 = plantilla de UPDATE por id, COMENTADA. Se rellena con lo que Mario
-- apruebe y se ejecuta con él delante (Management API). Requiere la migración
-- 20261113110000_mantenimientos_incluidos.sql aplicada.
--
-- Reglas (§0.3):
--   «cobrar a partir de AAAA» / «no cobrar hasta AAAA»(*) → N = AAAA − año instalación − 1
--   «incluido hasta AAAA»                                 → N = AAAA − año instalación
--   «COBRAR MANT» sin año                                 → N = 0 (ya pagan)
--   renting con duración conocida M                       → N = M/12 − 1 (no se calcula aquí:
--                                                            los renting importados no tienen
--                                                            contrato con duration_months [no verificado])
--   venta sin nota                                        → NADA (queda «sin dato», decisión 6)
--   alquiler                                              → NADA (incluido mientras esté de alta)
-- (*) «NO COBRAR MANT. HASTA 2030» es ambiguo (¿2030 incluido o ya se cobra?):
--     sale marcado como «revisar» y sin N propuesto.
-- =============================================================================

-- PARTE 1 — Propuesta (solo lectura) ------------------------------------------
with eq as (
  select
    ce.id                as equipo_id,
    ce.customer_id,
    ce.acquisition_type  as modalidad,
    ce.installed_at,
    extract(year from ce.installed_at)::int as anio_inst,
    coalesce(ce.notes, '') as nota_equipo,
    coalesce(c.notes, '')  as nota_cliente,
    coalesce(c.trade_name, c.legal_name, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) as cliente
  from public.customer_equipment ce
  join public.customers c on c.id = ce.customer_id
  where ce.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
    and ce.is_active
    and coalesce(ce.acquisition_type, '') <> 'rental'
),
texto as (
  select eq.*, upper(nota_equipo || ' || ' || nota_cliente) as t from eq
),
lect as (
  select
    texto.*,
    (regexp_match(t, 'A PARTIR DE[^0-9]{0,10}(20[2-4][0-9])'))[1]::int  as anio_cobro,
    (regexp_match(t, 'INCLUIDO[S]? HASTA[^0-9]{0,10}(20[2-4][0-9])'))[1]::int as anio_hasta,
    (regexp_match(t, 'NO COBRAR[^0-9]{0,20}HASTA[^0-9]{0,10}(20[2-4][0-9])'))[1]::int as anio_no_cobrar,
    (regexp_match(t, '(\d+)\s*A[ÑN]OS'))[1]::int as anios,
    t ~ 'COBRAR\s+MANT' as cobrar_mant,
    (regexp_match(t, '(\d{2,3})\s*(€|EUR)'))[1]::int as precio_leido
  from texto
)
select
  equipo_id,
  customer_id,
  cliente,
  modalidad,
  installed_at,
  case
    when anio_no_cobrar is not null then null
    when anio_cobro is not null then anio_cobro - anio_inst - 1
    when anio_hasta is not null then anio_hasta - anio_inst
    when anios is not null then anios
    when cobrar_mant then 0
    else null
  end as n_propuesto,
  case
    when anio_no_cobrar is not null then 'revisar: «no cobrar hasta» es ambiguo'
    -- Dos lecturas que no cuadran (años incluidos vs año de cobro) → revisar.
    when anios is not null and anio_cobro is not null and anios <> anio_cobro - anio_inst - 1
      then 'revisar: años incluidos y año de cobro no cuadran'
    when anio_cobro is not null and anio_cobro - anio_inst - 1 < 0 then 'revisar: N < 0'
    when anio_hasta is not null and anio_hasta - anio_inst < 0 then 'revisar: N < 0'
    when anio_cobro is not null then 'nota «a partir de AAAA»'
    when anio_hasta is not null then 'nota «incluido hasta AAAA»'
    when anios is not null then 'nota «N años»'
    when cobrar_mant then 'nota «COBRAR MANT» → ya paga'
    else 'sin nota → queda sin dato'
  end as motivo,
  precio_leido as precio_leido_eur_revisar,  -- NO se carga solo: «90 /140€» o «90€ filtros // 120€ membrana» se leen a mano
  nota_equipo,
  nota_cliente
from lect
where anio_cobro is not null or anio_hasta is not null or anio_no_cobrar is not null
   or anios is not null or cobrar_mant
   or modalidad = 'cash'
order by motivo, cliente;

-- PARTE 2 — Plantilla de carga (COMENTADA; rellenar SOLO con lo aprobado) ------
-- begin;
-- update public.customer_equipment
--    set mant_incluidos_n = v.n,
--        mant_incluido_origen = 'importacion',
--        mant_precio_filtros_cents = v.precio_filtros_cents,
--        mant_precio_filtros_membrana_cents = v.precio_membrana_cents,
--        mant_incluido_actualizado_at = now()
--   from (values
--     -- ('<equipo_id>'::uuid, 3, null::int, null::int),
--     -- ('<equipo_id>'::uuid, 0, 7500, 12000)
--   ) as v(id, n, precio_filtros_cents, precio_membrana_cents)
--  where customer_equipment.id = v.id
--    and customer_equipment.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';
-- -- Comprobar el nº de filas antes del commit.
-- commit;
