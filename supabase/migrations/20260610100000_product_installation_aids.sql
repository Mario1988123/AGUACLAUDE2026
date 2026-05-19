-- ============================================================================
-- Productos — ayudas a la instalación
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-19:
--   El instalador, al estar en casa del cliente, necesita acceso rápido a:
--     · Manual del equipo (PDF) — subido al producto por el admin.
--     · Notas/sugerencias de instalación — texto libre con avisos del admin
--       (p. ej. "Cerrar llave general antes de purgar"). Se muestran como
--       modal al iniciar el parte.
-- ============================================================================

alter table public.products
  add column if not exists installation_manual_url text,
  add column if not exists installation_notes text;

comment on column public.products.installation_manual_url is
  'URL pública del manual de instalación en PDF. Lo sube el admin desde /configuracion/productos o desde la ficha del producto. Se muestra al instalador en el wizard.';
comment on column public.products.installation_notes is
  'Notas/sugerencias de instalación que el instalador verá como modal al iniciar el parte. Texto libre. Permite avisos críticos sobre montaje, herramientas o pasos especiales.';

notify pgrst, 'reload schema';
