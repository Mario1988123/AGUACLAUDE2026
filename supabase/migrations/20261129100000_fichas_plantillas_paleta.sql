-- =============================================================================
-- 20261129100000_fichas_plantillas_paleta.sql
-- Fichas técnicas nuevas (docs/DISENO_FICHAS_Y_PRODUCTOS.md §C.4).
--
--   1. company_settings.datasheet_template admite también 'tarifa',
--      'escaparate' y 'placa'. El default sigue siendo 'standard'.
--   2. company_settings.datasheet_palette (jsonb): paleta de las plantillas
--      nuevas con los colores YA RESUELTOS, para que un cambio futuro de la
--      fórmula no cambie la ficha de nadie:
--        { "propuesta": "marca_sola" | "contrapunto" | "sobria" | "manual",
--          "base": "#rrggbb", "primario": "#rrggbb", "acento": "#rrggbb" }
--      NULL = se deriva de companies.primary_color al pintar.
--   3. company_settings.datasheet_opciones (jsonb): datos del pie y qué se
--      enseña. NULL = valores por defecto.
--        { "telefono": "...", "correo": "...", "web": "...",
--          "mostrar_recambios": true, "mostrar_ventajas": true }
--
-- ADITIVA E IDEMPOTENTE: no actualiza ninguna fila. Infinity y aquaroo siguen
-- en su plantilla ('standard') hasta que la cambien ellas (o Mario).
-- Los generadores antiguos (standard, iagua) no leen las columnas nuevas.
-- El código funciona sin esta migración (usa la plantilla predeterminada y no
-- deja guardar las nuevas).
-- =============================================================================

-- 1) Plantillas nuevas: el CHECK pasa a ser un superconjunto del anterior.
alter table public.company_settings
  drop constraint if exists company_settings_datasheet_template_check;
alter table public.company_settings
  add constraint company_settings_datasheet_template_check
  check (datasheet_template in ('standard', 'iagua', 'tarifa', 'escaparate', 'placa'));

-- 2) Paleta propia de las fichas.
alter table public.company_settings
  add column if not exists datasheet_palette jsonb;

alter table public.company_settings
  drop constraint if exists company_settings_datasheet_palette_check;
alter table public.company_settings
  add constraint company_settings_datasheet_palette_check check (
    datasheet_palette is null or (
      jsonb_typeof(datasheet_palette) = 'object'
      and coalesce(datasheet_palette->>'primario', '') ~* '^#[0-9a-f]{6}$'
      and coalesce(datasheet_palette->>'acento', '') ~* '^#[0-9a-f]{6}$'
    )
  );

-- 3) Opciones de la ficha.
alter table public.company_settings
  add column if not exists datasheet_opciones jsonb;

alter table public.company_settings
  drop constraint if exists company_settings_datasheet_opciones_check;
alter table public.company_settings
  add constraint company_settings_datasheet_opciones_check check (
    datasheet_opciones is null or jsonb_typeof(datasheet_opciones) = 'object'
  );

comment on column public.company_settings.datasheet_palette is
  'Paleta de las fichas técnicas nuevas (tarifa, escaparate, placa): {propuesta, base, primario, acento} ya resueltos. NULL = se deriva de companies.primary_color.';
comment on column public.company_settings.datasheet_opciones is
  'Opciones de la ficha técnica nueva: {telefono, correo, web, mostrar_recambios, mostrar_ventajas}. NULL = por defecto (fiscales y todo visible).';
