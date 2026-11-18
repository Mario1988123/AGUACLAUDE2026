-- 20261118100000_pruebas_disponibilidad.sql
--
-- Disponibilidad del cliente para instalarle la prueba gratuita.
-- Formato (lo valida la app con zod, ver src/modules/free-trials/disponibilidad.ts):
--   { "modo": "semanal", "franjas": [ { "dias": [1,3], "desde": "10:00", "hasta": "12:00" }, ... ] }
--   { "modo": "fechas",  "franjas": [ { "fecha": "2026-11-24", "desde": "10:00", "hasta": "12:00" }, ... ] }
-- dias: 1 = lunes … 7 = domingo. Es informativa: no bloquea fechas.
--
-- Solo añade una columna nula: no toca datos ni políticas (ft_update ya cubre
-- quién puede cambiarla).

alter table public.free_trials
  add column if not exists disponibilidad jsonb;

alter table public.free_trials
  drop constraint if exists free_trials_disponibilidad_forma;
alter table public.free_trials
  add constraint free_trials_disponibilidad_forma check (
    disponibilidad is null
    or (
      jsonb_typeof(disponibilidad) = 'object'
      and disponibilidad->>'modo' in ('semanal', 'fechas')
      and jsonb_typeof(disponibilidad->'franjas') = 'array'
    )
  );

comment on column public.free_trials.disponibilidad is
  'Días y franjas en que el cliente puede recibir la instalación: modo semanal (días fijos) o fechas (días concretos). Informativo.';

notify pgrst, 'reload schema';
