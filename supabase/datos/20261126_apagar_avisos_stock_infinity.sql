-- =============================================================================
-- Apagar los avisos de stock de INFINITY AQUA (Mario 2026-11-26)
-- =============================================================================
-- «Estamos usando la app sin ver el stock. Vamos poco a poco con Infinity:
-- ahora es mucho ruido.»
--
-- 1) Apaga el interruptor «Avisos de stock» de Configuración → Notificaciones:
--    company_settings.extra.avisos_desactivados += los tres kinds de stock.
-- 2) Marca como LEÍDOS (no borra) los avisos de stock pendientes de Infinity.
--
-- Idempotente: se puede pasar dos veces sin efecto extra. NO aplicado.
-- Recuento previo (2026-11-26, solo SELECT): 2043 «stock.low» y
-- 6 «warehouse.purchase_suggestion» sin leer; 0 «installation.stock_shortage».
-- =============================================================================

begin;

-- 1) Ajuste. Si no hubiera fila de company_settings, se crea con los valores
--    por defecto de la tabla.
insert into public.company_settings as cs (company_id, extra)
values (
  'f02d586c-0dc6-49e4-83e5-e0f6e688237c',
  '{"avisos_desactivados": ["installation.stock_shortage", "stock.low", "warehouse.purchase_suggestion"]}'::jsonb
)
on conflict (company_id) do update
set extra = jsonb_set(
  coalesce(cs.extra, '{}'::jsonb),
  '{avisos_desactivados}',
  (
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
    from (
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(cs.extra -> 'avisos_desactivados') = 'array'
            then cs.extra -> 'avisos_desactivados'
          else '[]'::jsonb
        end
      ) as k
      union
      select unnest(array['installation.stock_shortage', 'stock.low', 'warehouse.purchase_suggestion'])
    ) t
  ),
  true
);

-- 2) Avisos de stock pendientes → leídos.
update public.notifications
set read_at = now()
where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
  and kind in ('stock.low', 'installation.stock_shortage', 'warehouse.purchase_suggestion')
  and read_at is null;

-- Comprobación (debe salir la lista con los tres kinds y 0 pendientes).
select extra -> 'avisos_desactivados' as avisos_desactivados
from public.company_settings
where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';

select count(*) as avisos_stock_sin_leer
from public.notifications
where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
  and kind in ('stock.low', 'installation.stock_shortage', 'warehouse.purchase_suggestion')
  and read_at is null;

commit;
