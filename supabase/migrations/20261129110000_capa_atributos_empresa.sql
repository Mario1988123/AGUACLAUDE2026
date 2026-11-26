-- Capa de la EMPRESA sobre las características importadas del catálogo maestro
-- (2026-11-26). SIN APLICAR: la aplica Mario con scripts/aplicar-migracion.sh.
--
-- La importación ya copia los valores del maestro a la empresa
-- (product_attribute_values), así que la capa es la propia copia: la empresa
-- puede ocultar (is_visible), ordenar (display_order), editar el valor y añadir
-- los suyos sin tocar el maestro. Lo único que falta es saber DE DÓNDE viene
-- cada valor, para que «Aplicar actualización» pueda refrescar los heredados
-- sin pisar los que la empresa ha cambiado:
--
--   origen = 'maestro'  copiado del maestro y sin tocar → una actualización
--                       puede poner el valor nuevo;
--   origen = 'editado'  copiado del maestro y cambiado por la empresa → no se toca;
--   origen = 'propio'   añadido por la empresa → no se toca;
--   origen = NULL       valor anterior a esta marca → no se toca (como hasta hoy).
--
-- Aditiva: una columna que admite NULL, sin valor por defecto y SIN rellenar
-- filas existentes. Ninguna fila de INFINITY AQUA cambia. El código funciona con
-- y sin esta columna (la detecta antes de leerla o escribirla).

alter table public.product_attribute_values
  add column if not exists origen text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_attribute_values_origen_check'
      and conrelid = 'public.product_attribute_values'::regclass
  ) then
    alter table public.product_attribute_values
      add constraint product_attribute_values_origen_check
      check (origen is null or origen in ('maestro', 'editado', 'propio'));
  end if;
end $$;

comment on column public.product_attribute_values.origen is
  'De dónde viene el valor: maestro (copiado, sin tocar), editado (copiado y cambiado por la empresa), propio (añadido por la empresa). NULL = anterior a la marca: no lo toca ninguna actualización.';
