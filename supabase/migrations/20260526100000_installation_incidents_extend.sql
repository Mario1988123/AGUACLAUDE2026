-- =============================================================================
-- Ampliar `installation_incidents` para que cubra stock insuficiente y permita
-- resolución con auditoría (quién lo resolvió).
-- =============================================================================
--
-- Cambios:
-- 1. CHECK constraint de `kind` añade el valor 'stock_shortage' — es el caso
--    más común en campo (no hay equipo en almacén) y antes el técnico tenía
--    que elegir entre opciones genéricas (missing_material/wrong_equipment).
--    El cron pre-flight ahora también inserta filas con este kind.
-- 2. Nueva columna `resolved_by` (auth.users) para registrar el admin /
--    director técnico que cierra la incidencia.
-- =============================================================================

-- Drop + recreate del CHECK para incluir el nuevo valor. Es la única forma
-- portable (Postgres no permite "add value to check constraint").
alter table public.installation_incidents
  drop constraint if exists installation_incidents_kind_check;

alter table public.installation_incidents
  add constraint installation_incidents_kind_check
    check (kind in (
      'stock_shortage',
      'missing_material',
      'wrong_equipment',
      'broken_equipment',
      'customer_issue',
      'other'
    ));

alter table public.installation_incidents
  add column if not exists resolved_by uuid references auth.users(id);

comment on column public.installation_incidents.kind is
  'Categoría de la incidencia. stock_shortage: no hay equipo en almacén. '
  'missing_material: faltan piezas auxiliares. wrong_equipment: producto '
  'cargado distinto al del contrato. broken_equipment: rotura/defecto. '
  'customer_issue: problema con el cliente (no abre, niega instalación...). '
  'other: cualquier otra cosa.';

comment on column public.installation_incidents.resolved_by is
  'Usuario (admin o director técnico) que marcó la incidencia como resuelta.';

notify pgrst, 'reload schema';
