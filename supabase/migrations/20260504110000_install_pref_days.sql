-- Añade preferencia de día de semana / día del mes para la instalación.
alter table public.contracts
  add column if not exists preferred_install_days_of_week int[]  -- 1=lunes ... 7=domingo
    check (preferred_install_days_of_week is null
           or (array_length(preferred_install_days_of_week, 1) > 0
               and preferred_install_days_of_week <@ array[1,2,3,4,5,6,7]::int[])),
  add column if not exists preferred_install_day_of_month int
    check (preferred_install_day_of_month is null
           or preferred_install_day_of_month between 1 and 31);

comment on column public.contracts.preferred_install_days_of_week is
  'Días de la semana preferidos (1=lunes, 7=domingo). Multi-selección.';
comment on column public.contracts.preferred_install_day_of_month is
  'Día concreto del mes preferido (1–31).';
