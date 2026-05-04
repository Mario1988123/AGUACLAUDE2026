-- Sustituye preferred_install_day_of_month (un solo número) por
-- preferred_install_dates (array de fechas concretas). El usuario quería
-- abrir un calendario y marcar uno o varios días.
alter table public.contracts
  add column if not exists preferred_install_dates date[];

comment on column public.contracts.preferred_install_dates is
  'Fechas concretas preferidas por el cliente para la instalación. Carácter informativo, ayuda al técnico al agendar.';
