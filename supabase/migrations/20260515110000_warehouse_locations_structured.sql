-- =============================================================================
-- Almacenes inteligente — Fase B
-- Ubicaciones físicas estructuradas (estantería + altura + hueco)
-- =============================================================================
-- La tabla warehouse_locations ya existía con (warehouse_id, code, description).
-- Añadimos campos estructurados shelf/level/slot. El `code` se mantiene como
-- caché compacto (ej. "22C" = estantería 2 / altura 2 / hueco C) y se rellena
-- automáticamente desde la app al crear/editar.
-- =============================================================================

alter table public.warehouse_locations
  add column if not exists shelf  text,
  add column if not exists "level" text,
  add column if not exists slot   text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Trigger updated_at
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_wloc_updated'
  ) then
    create trigger trg_wloc_updated
      before update on public.warehouse_locations
      for each row execute function app.set_updated_at();
  end if;
end $$;

create index if not exists idx_wloc_shelf on public.warehouse_locations(warehouse_id, shelf, "level", slot);

comment on column public.warehouse_locations.shelf is 'Estantería (texto libre, normalmente número o letra: "1", "A", etc.)';
comment on column public.warehouse_locations."level" is 'Altura dentro de la estantería';
comment on column public.warehouse_locations.slot is 'Hueco/posición horizontal';
comment on column public.warehouse_locations.code is 'Código compuesto compacto generado por la app (ej. "22C"). Se mantiene para facilitar búsquedas y mostrar en etiquetas.';
