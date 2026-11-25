-- =============================================================================
-- 20261126100000_catalogo_maestro_fase2.sql
-- Segunda parte del catálogo MAESTRO de Osmofilter (plan
-- docs/PLAN_CATALOGO_MAESTRO.md, §A.2 adaptada a las respuestas de Mario, §H).
-- La primera parte es 20261125100000_catalogo_maestro_osmofilter.sql (gamas,
-- tipo de foto, ventajas, recambios y categorías nuevas): no se repite aquí.
--
--   1. Grupo de la característica (físicas, eléctricas, técnicas, extra) en los
--      atributos globales y en los de cada empresa.
--   2. Datos del proveedor en el producto maestro: modelo corto, familia,
--      catálogos, descatalogado, origen de la carga y marca de «cambios sin
--      publicar».
--   3. Fotos del maestro: miniatura, etiqueta y tamaño; ruta única.
--   4. Documentos del maestro: idioma y apartado de la ficha; ruta única.
--      Mario quiere TODOS los PDF, cada uno en su apartado (§H.3): el enum
--      product_document_kind no tiene «comercial», así que el apartado va en
--      una columna de texto y el enum no se toca.
--   5. Recambios de la empresa (product_compatibilities): cantidad y orden,
--      igual que en el maestro.
--
-- ADITIVA E IDEMPOTENTE: solo añade columnas que admiten null o llevan valor por
-- defecto, restricciones check sobre esas columnas nuevas e índices. No cambia
-- ni borra nada existente. No toca catalog_products.version, así que NO salta
-- ningún aviso a las empresas.
-- =============================================================================

-- 1) Grupo de la característica --------------------------------------------------
alter table public.product_attributes_global
  add column if not exists grupo text;
alter table public.product_attributes
  add column if not exists grupo text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_attributes_global_grupo_check') then
    alter table public.product_attributes_global
      add constraint product_attributes_global_grupo_check
      check (grupo is null or grupo in ('fisicas','electricas','tecnicas','extra'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_attributes_grupo_check') then
    alter table public.product_attributes
      add constraint product_attributes_grupo_check
      check (grupo is null or grupo in ('fisicas','electricas','tecnicas','extra'));
  end if;
end $$;

comment on column public.product_attributes_global.grupo is
  'Bloque de la ficha: fisicas | electricas | tecnicas | extra. Null se pinta en «Técnicas».';
comment on column public.product_attributes.grupo is
  'Copiado del global al clonar. Null = atributo anterior o hecho a mano (se pinta en «Técnicas»).';

-- 2) Datos del proveedor en el producto maestro ----------------------------------
alter table public.catalog_products
  add column if not exists modelo text;
alter table public.catalog_products
  add column if not exists familia_proveedor text;
alter table public.catalog_products
  add column if not exists catalogos_proveedor text[];
alter table public.catalog_products
  add column if not exists descatalogado boolean not null default false;
alter table public.catalog_products
  add column if not exists origen_carga text;
alter table public.catalog_products
  add column if not exists cambios_sin_publicar boolean not null default false;

create index if not exists idx_catalog_products_familia_proveedor
  on public.catalog_products (familia_proveedor) where familia_proveedor is not null;

comment on column public.catalog_products.modelo is
  'Nombre corto del modelo tal como lo da el fabricante («BLUE MOUNTAIN»). Al importar va a products.manufacturer_model.';
comment on column public.catalog_products.familia_proveedor is
  'Familia tal cual la da el proveedor («Dispensadores - Equipos», «Membranas»...). Filtro y trazabilidad.';
comment on column public.catalog_products.catalogos_proveedor is
  'Catálogos del proveedor en los que aparece (General, Especialista, Venta Directa, Horeca, Fuentes).';
comment on column public.catalog_products.descatalogado is
  'El proveedor lo vende «hasta fin de existencias».';
comment on column public.catalog_products.origen_carga is
  'Qué carga creó o completó la fila (p. ej. osmofilter-2026-11-25). Null = hecho a mano en el superadmin.';
comment on column public.catalog_products.cambios_sin_publicar is
  'Hay ediciones guardadas que aún no se han publicado a las empresas (no se sube version hasta publicar).';

-- 3) Fotos del maestro -------------------------------------------------------------
alter table public.catalog_product_photos
  add column if not exists thumb_path text;
alter table public.catalog_product_photos
  add column if not exists etiqueta text;
alter table public.catalog_product_photos
  add column if not exists width_px integer;
alter table public.catalog_product_photos
  add column if not exists height_px integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_product_photos_medidas_check') then
    alter table public.catalog_product_photos
      add constraint catalog_product_photos_medidas_check
      check ((width_px is null or width_px > 0) and (height_px is null or height_px > 0));
  end if;
end $$;

-- Idempotencia de la carga: una fila por fichero. Comprobado antes de escribir
-- esta migración: no hay storage_path repetidos (2026-11-25).
create unique index if not exists uniq_catalog_product_photos_storage_path
  on public.catalog_product_photos (storage_path);

comment on column public.catalog_product_photos.thumb_path is
  'Miniatura de 400 px en el mismo bucket (catalog-global). Para listas.';
comment on column public.catalog_product_photos.etiqueta is
  'Rótulo de la foto: «Ambiente 1», «Proyección X», «Sin carátula», «Detalle 2».';

-- 4) Documentos del maestro --------------------------------------------------------
alter table public.catalog_product_documents
  add column if not exists idioma text;
alter table public.catalog_product_documents
  add column if not exists apartado text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_product_documents_apartado_check') then
    alter table public.catalog_product_documents
      add constraint catalog_product_documents_apartado_check
      check (apartado is null or apartado in
        ('ficha_tecnica','manual','certificado','comercial','guia','otro'));
  end if;
end $$;

-- Idempotencia de la carga. Un mismo PDF (manual común, certificado de gama) se
-- sube una sola vez y lo comparten varios productos, así que la ruta se repite
-- entre productos pero no dentro del mismo producto.
create unique index if not exists uniq_catalog_product_documents_producto_ruta
  on public.catalog_product_documents (catalog_product_id, storage_path);

comment on column public.catalog_product_documents.idioma is
  'Idiomas del documento tal como los da el proveedor: ES, EN, ES_EN, ES_EN_FR_IT...';
comment on column public.catalog_product_documents.apartado is
  'Apartado de la ficha: ficha_tecnica | manual | certificado | comercial (dípticos, trípticos, flyers, fichas comerciales) | guia | otro. Null = documento anterior.';

-- 5) Recambios de la empresa: cantidad y orden --------------------------------------
alter table public.product_compatibilities
  add column if not exists cantidad integer;
alter table public.product_compatibilities
  add column if not exists display_order integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_compatibilities_cantidad_check') then
    alter table public.product_compatibilities
      add constraint product_compatibilities_cantidad_check
      check (cantidad is null or cantidad > 0);
  end if;
end $$;

comment on column public.product_compatibilities.cantidad is
  'Unidades del recambio que lleva el equipo, si se conocen.';

notify pgrst, 'reload schema';
