# PLAN MÁXIMO ESFUERZO — MÓDULO PRODUCTOS (2026-06-03)

> Plan de revisión completa del módulo Productos para Mario, redactado durante la noche del 2026-06-03 mientras dormía. **NADA DE ESTE PLAN ESTÁ AÚN APLICADO AL CÓDIGO.** Es un mapa de propuesta con prioridades, decisiones a confirmar, y migraciones de ejemplo. Léelo, márcame qué entra y por qué fases, y arranco con tu OK.
>
> Reglas activas que respeto en todo el plan:
> - **No sobreescribir nada existente sin pedir OK** (regla primordial).
> - **No salir del módulo Productos sin preguntar** (algunos puntos tocan almacenes/mantenimientos → marcados como ⚠ CROSS).
> - **Migraciones ultra-defensivas, siempre aditivas, nunca DROP**.
> - **Multi-tenant**: todo filtrado por `company_id`.
> - **Lenguaje llano**: explico cada palabra técnica entre paréntesis.

---

## 0. RESUMEN EJECUTIVO

### Qué hay ya (sorpresa: bastante)
- Tablas: `products`, `product_categories` + `_global`, `product_attributes` + `_global` + `_global_categories`, `product_attribute_values`, `product_pricing_plans`, `product_images`, `product_compatibilities`, `external_equipment_models`, `units_catalog` (22 unidades pre-seed), `product_price_history`.
- Atributos por categoría YA tienen unidad de medida (`unit`), tipo de dato (text/number/boolean/enum/dimension/date), toggle de visibilidad y de destaque por producto, y flag `include_in_datasheet`.
- Datasheet PDF YA existe en `/api/pdf/product-datasheet/[id]` con dibujo 3D isométrico, atributos filtrados y datos fiscales de la empresa. El usuario dijo "fatal" en una sesión anterior → hay que **rediseñarlo visualmente**, no rehacerlo de cero.
- Catálogo PDF YA tiene ruta `/api/pdf/catalog` pero está sin terminar (faltan: selector de precios visibles, selector de productos/categorías, branding, índice, etc.).
- Calculadora ya filtra `show_in_calculator=true` estricto. No tocar esa regla.

### Qué falta o está mal
1. **Tags** → no existen. Mencionados como UX clave para el comercial.
2. **Catálogo PDF profesional + selector de precios + URL pública + email Resend** → todo nuevo o incompleto.
3. **Ficha técnica actual** = poco atractiva. Hay que rediseñarla siguiendo el estándar de BWT / Cillit / Pentair / Kinetico.
4. **Onboarding de empresa nueva**: si no hay categorías ⇒ tiene que aparecer aviso "configura primero categorías" en `/productos` (empty state actionable). Hoy no hay nada.
5. **Atributos sugeridos por superadmin**: existe la tabla `product_attributes_global` pero **no hay un seed real serio** con los atributos típicos del sector (caudal, dureza, presión, dosis UV, micraje, etc.). Hay que crear ese seed.
6. **Documentación adjunta al producto** (PDFs de fabricante, manuales, certificados): no existe tabla `product_documents`.
7. **Tab Precios separada + Tab Stock separada + Tab Movimientos** en la ficha → mencionaste estructura nueva.
8. **Cross-module sin FK constraint**: `warehouse_stock.product_id`, `stock_movements.product_id`, `stock_alerts.product_id`, `customer_equipment.product_id`, `maintenance_jobs.product_id` están sin foreign key formal. **Riesgo huérfano garantizado** si un día se borra un producto duro. Hoy se hace soft-delete (`deleted_at`), así que el riesgo está contenido, pero conviene asegurarlo.
9. **`product_images` storage bucket**: hay que confirmar que usa `ensureBucket()` ([[feedback_storage_buckets]]).
10. **Plantillas email de envío de ficha y catálogo**: no existen aún para Resend.

### Filosofía del rediseño
- **Cero pérdida de datos.** Todas las tablas existentes se mantienen. Cero migraciones destructivas. Cero columnas borradas. Solo se añade.
- **Atributos seguirán siendo sugeridos**, no obligatorios. La empresa puede ignorar el seed.
- **Toggle por atributo en cada producto** ⇒ ya existe (`is_visible`). Lo aprovechamos para que la ficha PDF salga sin ese atributo si lo apago, y con él si lo enciendo. Esto es exactamente lo que pediste.
- **PDF dinámico**: cada vez que se pide, se regenera leyendo los flags actuales. Nada cacheado a largo plazo.

---

## 1. ESTADO ACTUAL — RESUMEN DE LA AUDITORÍA

### Modelo de datos (lo que ya está)
| Tabla | Para qué | Estado |
|-------|----------|--------|
| `products` | Cabecera del producto: nombre, kind, categoría, dimensiones, stock min/max, show_in_calculator, soft-delete | ✅ Sólido |
| `product_categories_global` | Catálogo de categorías que ve el superadmin | ✅ Con `accepts_extras` y `extra_role` para calculadora |
| `product_categories` | Categorías de cada empresa, clonables del global | ✅ Con `parent_id` (subcategorías) |
| `product_attributes_global` | Catálogo de atributos sugeridos por superadmin (nombre, unidad, tipo) | 🟡 Tabla existe, **seed pobre** |
| `product_attributes_global_categories` | Relación N:N "qué atributo aplica a qué categoría" | ✅ Existe |
| `product_attributes` | Atributos locales de empresa | ✅ Existe |
| `product_attribute_values` | Valor del atributo para un producto + `is_visible` + `is_featured` | ✅ Justo lo que necesitamos para el toggle |
| `units_catalog` | 22 unidades pre-seed (L/min, bar, kg, ppm, etc.) | ✅ Existe |
| `product_pricing_plans` | Planes de precio: cash, renting, rental, duales particular/empresa, mínimos | ✅ Maduro |
| `product_price_history` | Auditoría de cambios de precio | ✅ Existe |
| `product_images` | Galería de fotos del producto, una principal | ✅ Existe |
| `product_compatibilities` | Recambio ↔ equipo (interno) | ✅ Existe |
| `product_external_compatibilities` | Recambio ↔ marca/modelo externo | ✅ Existe |
| `external_equipment_models` | Catálogo de equipos de la competencia | ✅ Existe |

### Cross-module — dónde se referencia `products.id`
| Tabla | Comportamiento | Riesgo |
|-------|----------------|--------|
| `proposal_items.product_id` | Snapshot: copia `name` y precio a `product_name_snapshot` y `unit_price_*_cents`. Modificar producto NO afecta propuestas vivas. | ✅ Seguro |
| `contract_items.product_id` | Igual que propuesta. | ✅ Seguro |
| `invoice_lines.product_id` | Línea con descripción y precio guardados. Producto fantasma no rompe factura. | ✅ Seguro |
| `customer_equipment.product_id` | NULLABLE; sin FK formal. Si se borra producto → equipment del cliente queda con UUID fantasma. | ⚠ Aviso |
| `maintenance_jobs.product_id` | Snapshot heredado del contrato. | 🟡 Sobrevive sin contexto si se borra producto |
| `warehouse_stock.product_id` | **Sin FK constraint**. Si se borra producto → stock huérfano y KPIs erróneos. | ⚠ Aviso |
| `stock_movements.product_id` | **Sin FK constraint**. Historial cuelga. | ⚠ Aviso |
| `stock_alerts.product_id` | **Sin FK constraint**. Dashboard cuelga. | ⚠ Aviso |
| `purchase_items.product_id` | ON DELETE RESTRICT. Bloquea borrar producto si hay compras. | ✅ Seguro |
| `savings_proposals.product_id` | ON DELETE SET NULL. | ✅ Seguro |

**Conclusión cross-module**: con soft-delete actual (`products.deleted_at`) no hay riesgo, porque el producto técnicamente sigue existiendo en BD. Pero si en algún momento se hiciera un DELETE duro (limpieza superadmin, mantenimiento), habría huérfanos. **Recomiendo añadir FK constraint con `ON DELETE RESTRICT` o `ON DELETE SET NULL`** a las 5 tablas marcadas con ⚠. Es CROSS-module → te pregunto antes de tocar nada.

---

## 2. CAMPOS NUEVOS PROPUESTOS PARA `products`

Todos NULLABLE, todos defensivos, todos aditivos. Ninguno rompe nada.

| Campo nuevo | Tipo | Para qué | Visible a |
|-------------|------|----------|-----------|
| `tags` | text[] (array) | Tags libres por producto. UX: chips multicolor en el listado. Ejemplo: ["promo-junio", "bestseller", "horeca"] | Todos |
| `marketing_claim` | text | Frase corta para destacar en catálogo y ficha técnica. Ejemplo: "Hasta 50% menos consumo de sal". Máx 120 chars. | Todos |
| `youtube_url` | text | Vídeo de producto. Se pinta como chip en ficha. | Todos |
| `qr_target_url` | text | URL custom para el QR del datasheet. Por defecto = URL pública del producto. | Admin |
| `barcode_ean13` | text | Código de barras EAN-13. Para escaneo en almacén. | Todos |
| `country_of_origin` | text(2) | Código ISO 3166-1 (ES, IT, DE, CN). Para catálogo. | Todos |
| `manufacturer_name` | text | Nombre del fabricante. Para descalcificadores BWT, dispensadores Pentair, etc. | Todos |
| `manufacturer_model` | text | Modelo del fabricante. Diferente del `name` comercial. | Todos |
| `warranty_months_general` | integer | Garantía general en meses. | Todos |
| `warranty_months_electronics` | integer | Garantía electrónica. | Todos |
| `warranty_months_body` | integer | Garantía botella/carcasa. | Todos |
| `discontinued_at` | timestamptz | Distinto de `deleted_at` y de `is_active`. Discontinuado = no se vende a nuevos pero sigue dando servicio. | Admin |
| `replaced_by_product_id` | uuid | Si discontinuado, qué producto lo sustituye. | Admin |
| `installation_diagram_url` | text | Esquema de instalación (PNG/SVG) para meter en la ficha y en el catálogo. | Todos |
| `datasheet_color_accent` | text | Color HEX corporativo del producto en el PDF. Hereda de empresa si vacío. | Admin |

### Tabla nueva: `product_tags_catalog`
Catálogo opcional de tags por empresa para autocompletado y coherencia. Empresa puede ignorarlo y escribir tags libres.

```sql
create table public.product_tags_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  color_hex text default '#4880FF',
  display_order int default 0,
  created_at timestamptz default now(),
  unique(company_id, name)
);
```

### Tabla nueva: `product_documents`
Documentos adjuntos al producto (manuales PDF, certificados, fichas de fabricante, etc.).

```sql
create table public.product_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  kind text not null check (kind in (
    'manual_user', 'manual_installer', 'manufacturer_datasheet',
    'certificate', 'warranty_card', 'compliance_doc', 'spare_parts_list', 'other'
  )),
  title text not null,
  storage_path text not null,
  file_size_bytes int,
  mime_type text,
  is_public boolean default false,
  display_order int default 0,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
```

Bucket `product-documents` con `ensureBucket()`.

### Tabla nueva: `product_catalog_emails`
Auditoría: qué catálogo se envió, a quién, con qué productos y precios.

```sql
create table public.product_catalog_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sent_by uuid references auth.users(id),
  recipient_email text not null,
  recipient_name text,
  customer_id uuid references customers(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  category_ids uuid[],
  product_ids uuid[] not null,
  pricing_visibility jsonb,  -- qué precios se mostraron por producto
  public_share_token text,  -- token para URL pública /catalogo-publico/{token}
  pdf_storage_path text,
  sent_at timestamptz default now(),
  opened_at timestamptz,
  resend_email_id text
);
```

### Tabla nueva: `product_public_shares`
URL pública por producto o catálogo. Sin login, hasheada, opcionalmente con caducidad.

```sql
create table public.product_public_shares (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  share_type text not null check (share_type in ('product_datasheet', 'category_catalog', 'custom_catalog')),
  product_ids uuid[],
  category_ids uuid[],
  pricing_visibility jsonb,  -- {"cash_individual": true, "cash_business": false, ...}
  show_company_branding boolean default true,
  share_token text not null unique,
  expires_at timestamptz,
  view_count int default 0,
  last_viewed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create index on product_public_shares(share_token);
create index on product_public_shares(company_id);
```

---

## 3. ATRIBUTOS SUGERIDOS POR CATEGORÍA (SEED DE SUPERADMIN)

Esta es la parte que más estudio competencia hice. Basado en BWT, Cillit, Pentair, Kinetico, Culligan, Hidrowater, Atlas Filtri, Lenntech.

**Filosofía del seed**: superadmin propone, empresa edita. Atributo en seed = solo un nombre y una unidad. La empresa lo activa y rellena. Si no le gusta el nombre, lo renombra. Si quiere otros, los añade.

### CATEGORÍA: Ósmosis inversa doméstica (`osmosis_domestic`)

| Nombre atributo | Unidad | Tipo | Notas |
|-----------------|--------|------|-------|
| Producción permeado | L/día | number | A 25 °C y presión estándar |
| Caudal grifo dispensador | L/min | number | |
| % Rechazo TDS | % | number | 95-99% típico |
| TDS máximo entrada | ppm | number | |
| Presión entrada mín | bar | number | |
| Presión entrada máx | bar | number | |
| Temperatura agua mín | °C | number | |
| Temperatura agua máx | °C | number | |
| pH mín admisible | — | number | |
| pH máx admisible | — | number | |
| Cloro libre máx | ppm | number | |
| Etapas de filtración | — | number | 3, 4, 5, 6, 7 |
| Tamaño membrana | pulgadas | text | 1812 / 2012 |
| Tipo membrana | — | text | TFC poliamida |
| Vida útil prefiltros | meses | number | |
| Vida útil membrana | meses | number | |
| Vida útil postfiltro | meses | number | |
| Capacidad depósito | L | number | |
| Presión aire depósito | psi | number | 7-10 psi |
| Conexión entrada | pulgadas | text | 1/4", 3/8", 1/2" |
| Conexión drenaje | pulgadas | text | |
| Recuperación (permeado/total) | % | number | 25-75% |
| Bomba booster | — | boolean | sí/no |
| Voltaje bomba | V DC | number | |
| Potencia bomba | W | number | |
| Producción permeado (GPD) | GPD | number | Alt. para mercado USA |

### CATEGORÍA: Descalcificador doméstico (`softener_domestic`)

| Nombre atributo | Unidad | Tipo |
|-----------------|--------|------|
| Volumen resina | L | number |
| Capacidad ciclo | °f·m³ | number |
| Caudal nominal | m³/h | number |
| Caudal punta | m³/h | number |
| Pérdida carga nominal | bar | number |
| Consumo sal por regeneración | kg | number |
| Eficiencia sal | g sal/L resina | number |
| Consumo agua regeneración | L | number |
| Capacidad depósito sal | kg | number |
| Presión trabajo mín | bar | number |
| Presión trabajo máx | bar | number |
| Temperatura agua mín | °C | number |
| Temperatura agua máx | °C | number |
| Temperatura ambiente máx | °C | number |
| Dureza máx entrada | °f | number |
| Tensión alimentación | V | number |
| Consumo eléctrico | W | number |
| Cabezal/válvula | — | text | Clack WS1, Fleck 5600 SXT, Logix 255, BWT PRX |
| Tipo regeneración | — | enum | volumétrica / cronométrica / estadística / contracorriente |
| Configuración | — | enum | monobotella / biblock / cabina compacta / dúplex |
| Material botella | — | text | PRFV |
| By-pass integrado | — | boolean | |
| Conectividad WiFi/App | — | boolean | |
| Conexión entrada/salida | pulgadas | text | 3/4", 1", 1 1/2" |

### CATEGORÍA: Descalcificador industrial (`softener_industrial`)

Mismas + columnas mayores (caudal hasta 50 m³/h, capacidad sal 100-400 kg, presión hasta 10 bar).

### CATEGORÍA: Dispensador de agua (`water_dispenser`)

| Nombre atributo | Unidad | Tipo |
|-----------------|--------|------|
| Temperatura frío | °C | number |
| Temperatura caliente | °C | number |
| Producción agua fría | L/h | number |
| Producción agua caliente | L/h | number |
| Capacidad depósito frío | L | number |
| Capacidad depósito caliente | L | number |
| Potencia refrigeración | W | number |
| Potencia calefacción | W | number |
| Refrigerante | — | enum | R134a, R600a, R290 |
| Carga refrigerante | g | number |
| Voltaje | V | number |
| Frecuencia | Hz | number |
| Consumo eléctrico | W | number |
| Sistema carga | — | enum | garrafón superior, garrafón inferior, red, POU |
| Filtros incluidos | — | text | |
| Material interior | — | text | acero inoxidable / plástico FDA |
| Sistema autosanitización | — | enum | ninguna / UV / ozono / térmica |
| Nivel ruido | dB(A) | number |
| Clase energética | — | text | A, B, C |
| Caudal grifo | L/min | number |

### CATEGORÍA: Filtros (`filter_cartridge`)

| Nombre atributo | Unidad | Tipo |
|-----------------|--------|------|
| Tipo medio filtrante | — | enum | melt-blown PP, hilo bobinado, plisado, carbón bloque, carbón granular, UF |
| Micraje nominal | µm | number |
| Micraje absoluto | µm | number |
| Tamaño | pulgadas | enum | 10", 20", Big Blue 10", Big Blue 20" |
| Caudal máximo | L/min | number |
| Capacidad | L | number |
| Pérdida de carga inicial | bar | number |
| Presión máx servicio | bar | number |
| Temperatura máx | °C | number |
| Conexión | pulgadas | text | NPT / BSP |
| Material cuerpo | — | text | PP food grade |
| % Reducción cloro libre | % | number | (carbón) |
| Vida útil | meses | number |

### CATEGORÍA: Esterilizador UV (`uv_sterilizer`)

| Nombre atributo | Unidad | Tipo |
|-----------------|--------|------|
| Dosis UV nominal | mJ/cm² | number |
| Caudal a dosis | L/min | number |
| Potencia lámpara | W | number |
| Vida útil lámpara | horas | number |
| Tipo lámpara | — | enum | baja presión Hg, amalgama, LED UV-C |
| Longitud onda | nm | number | 254 |
| Cámara material | — | text | AISI 304 / 316L |
| Presión máx cámara | bar | number |
| Transmitancia UVT requerida | % | number |
| Conexión | pulgadas | text |
| Sensor intensidad UV | — | boolean |
| Alarma fin vida lámpara | — | boolean |
| Voltaje | V | number |
| Consumo total | W | number |

### CATEGORÍA: Servicio (`service`)
Sin atributos físicos. Solo descripción larga y precio.

### CATEGORÍA: Producto químico / sal / consumible (`consumable`)
| Atributo | Unidad | Tipo |
|----------|--------|------|
| Composición | — | text |
| Formato envase | — | enum | saco 25 kg, pack 4 unidades, bote 1 L |
| Vida útil almacén | meses | number |
| Caducidad | — | boolean |

---

## 4. CERTIFICACIONES — TABLA FIJA POR PRODUCTO

Tabla nueva `product_certifications` (lookup + N:N):

```sql
create table public.certifications_catalog (
  key text primary key,
  name_es text not null,
  category text not null check (category in ('eu', 'es', 'usa', 'country_eu', 'iso', 'sector')),
  description text,
  logo_url text
);
```

Seed inicial (las que aparecen en >50% de fichas del sector):
- `ce`: Marcado CE (UE)
- `rohs`: RoHS 2011/65/UE
- `rd_3_2023`: RD 3/2023 España (agua de consumo humano)
- `regl_10_2011`: Reglamento UE 10/2011 (plásticos contacto alimentos)
- `nsf_42`: NSF/ANSI 42 — efectos estéticos
- `nsf_53`: NSF/ANSI 53 — efectos en salud
- `nsf_58`: NSF/ANSI 58 — sistemas ósmosis inversa
- `nsf_55a`: NSF/ANSI 55 clase A (40 mJ/cm² UV)
- `nsf_55b`: NSF/ANSI 55 clase B (16 mJ/cm² UV)
- `nsf_401`: NSF/ANSI 401 — contaminantes emergentes
- `nsf_372`: NSF/ANSI 372 — sin plomo
- `acs_fr`: ACS (Francia)
- `dvgw_de`: DVGW (Alemania)
- `wras_uk`: WRAS (Reino Unido)
- `kiwa_nl`: KIWA (Países Bajos)
- `iso_9001`: ISO 9001
- `iso_14001`: ISO 14001
- `iso_22000`: ISO 22000 / HACCP

Tabla pivot:
```sql
create table public.product_certifications (
  product_id uuid references products(id) on delete cascade,
  certification_key text references certifications_catalog(key) on delete restrict,
  certificate_number text,
  issued_at date,
  valid_until date,
  document_url text,
  primary key (product_id, certification_key)
);
```

En la ficha técnica PDF, las certificaciones se renderizan como **iconos en línea** (estándar del sector).

---

## 5. FICHA TÉCNICA PDF — REDISEÑO

### Decisiones de diseño (basado en BWT/Cillit/Pentair)

- **Formato**: A4 vertical.
- **Páginas**: 1-2 según contenido (mínimo 1, máximo 4 si hay mucho atributo activado).
- **Layout cabecera**: banda superior con color corporativo de la empresa (de `companies.brand_color` o `datasheet_color_accent` del producto), logo arriba a la izquierda (4 cm máx), nombre + modelo + SKU centrado, código de ficha y fecha a la derecha.
- **Tipografía**: Nunito Sans (ya usada en el CRM). Cuerpo 9-10pt, encabezados 12-14pt.
- **Esquema de bloques**:

```
┌──────────────────────────────────────────────┐
│ BANDA SUPERIOR — logo empresa + título + SKU │  ← 25mm
├──────────────────────────────────────────────┤
│ Foto producto    │  Marketing claim          │
│   (cuadrada)     │  Descripción corta        │  ← 80mm
│   90×90mm        │  Aplicaciones (chips)     │
│                  │  Tags                     │
├──────────────────────────────────────────────┤
│ TABLA ESPECIFICACIONES TÉCNICAS              │
│  ┌─────────────────┬────────────┐            │
│  │ Hidráulico      │            │            │
│  │  Caudal nominal │ 1.5 m³/h   │            │
│  │  Presión mín    │ 2.5 bar    │            │
│  │ Rendimiento     │            │            │
│  │  Capacidad ciclo│ 125 °f·m³  │            │
│  │  Eficiencia sal │ 130 g/L    │            │
│  │ Eléctrico       │            │            │
│  │  Tensión        │ 230 V      │            │
│  │ Físico          │            │            │
│  │  Dimensiones    │ 30×60×90mm │            │
│  │  Peso           │ 25 kg      │            │
│  └─────────────────┴────────────┘            │
├──────────────────────────────────────────────┤
│ Esquema cotas (isométrico actual) │ Esq. instal │
├──────────────────────────────────────────────┤
│ MANTENIMIENTO RECOMENDADO                    │
│  • Sustituir prefiltros: cada 12 meses       │
│  • Recargar sal: cada X regeneraciones        │
├──────────────────────────────────────────────┤
│ Iconos certificaciones │ Garantía X meses    │
├──────────────────────────────────────────────┤
│ PIE: datos empresa + web + QR + cód.ficha    │
└──────────────────────────────────────────────┘
```

### Comportamiento ante atributos vacíos / desactivados

Esta es la pieza clave de tu pregunta. Regla compuesta:

1. Si el atributo está en seed pero **`is_visible = false`** en este producto → **se omite del PDF** (no aparece la fila).
2. Si está en seed con `is_visible = true` pero el **valor está vacío** → depende del flag `is_critical` (nuevo, defaults false): si es crítico, se muestra "N/D"; si no, se omite.
3. Si **toda una sección** queda vacía (ej. no hay ningún atributo "Eléctrico" activo y con valor) → **se omite el encabezado de sección**, no se imprime título huérfano.
4. Si se vuelve a activar un atributo apagado y se regenera el PDF → vuelve a aparecer. Es lo que pediste explícitamente.

Esto se controla 100% con `product_attribute_values.is_visible` (ya existe) + un campo nuevo `is_featured` (ya existe) y la prioridad de orden `display_order`.

### Atributos críticos por categoría (nuevo: `product_attributes_global.is_critical`)
Bloqueo blando: si faltan los críticos, el PDF se genera pero **muestra un banner amarillo arriba** "Esta ficha técnica está incompleta — faltan datos clave: caudal nominal, presión mín". El usuario puede decidir publicar o no.

### URL del PDF
- `/api/pdf/product-datasheet/[id]` (existe, se conserva, se rediseña la generación).
- `/api/pdf/product-datasheet/[id]?share=<token>` para acceso público sin login.
- `/datasheet/[token]` (URL pública renderizada en HTML elegante + botón "Descargar PDF").

---

## 6. CATÁLOGO — REDISEÑO COMPLETO

### Caso de uso
Mario o un comercial está en `/productos`. Selecciona:
- Una categoría completa (botón "Generar catálogo de Ósmosis")
- O productos sueltos (checkbox en cada fila + botón "Generar catálogo con selección")

Aparece un **modal de configuración del catálogo**:
1. Título del catálogo (texto libre)
2. Plantilla: A4 vertical / A4 horizontal landscape
3. Para cada producto seleccionado, una fila con toggles:
   - ☑ Mostrar foto
   - ☑ Mostrar descripción
   - ☑ Mostrar atributos destacados (los `is_featured = true`)
   - Selector de precios:
     - ☐ Precio cash particular (con IVA)
     - ☐ Precio cash empresa (base)
     - ☐ Cuota renting 24m
     - ☐ Cuota renting 36m
     - ☐ Cuota renting 48m
     - ☐ Cuota renting 60m
     - ☐ Alquiler mensual
     - ☐ Ninguno (catálogo sin precios)
4. Branding: ☑ Logo empresa, ☑ Datos contacto, ☑ Numeración página
5. Caducidad URL pública (opcional): 7 días / 30 días / sin caducidad

Botones del modal:
- **Generar PDF** → descarga
- **Crear URL pública** → genera token, abre URL en pestaña nueva
- **Enviar por email** → abre sub-modal con destinatario (autocompleta de clientes + leads), asunto editable y mensaje editable. Envía vía Resend con PDF adjunto. Registra en `product_catalog_emails`.

### Plantilla del catálogo (PDF)
- **Portada**: nombre del catálogo, logo, foto de portada (configurable), índice si >5 productos.
- **Una página por producto** (vertical) o **2 productos por página** (horizontal compacto).
- Por producto: foto, nombre, modelo, descripción corta, tabla de atributos `is_featured`, precios seleccionados, badge "Catálogo XX/2026".
- **Contraportada**: datos completos empresa, mapa con sede, política de garantías, redes sociales.

### URL pública (web)
- Ruta: `/catalogo/{token}` (sin login).
- Render HTML responsivo, mobile-first.
- Cards de productos con foto, precio, botón "Solicitar información" → crea **lead automático** en el CRM con `source='public_catalog'`.
- Botón "Descargar PDF" → genera el mismo PDF.
- Métrica: incrementa `view_count`.

### Email Resend
- Plantilla nueva en `email_templates` con key `product_catalog_share`. Variables: `{{customer_name}}`, `{{catalog_name}}`, `{{share_url}}`, `{{company_name}}`.
- Otra plantilla `product_datasheet_share` para envío de ficha técnica única.
- Mensaje por defecto editable: "Hola {{customer_name}}, te envío adjunta la ficha técnica que solicitaste y un enlace para consultarla online. Saludos, {{user_name}} ({{company_name}})".

---

## 7. AVISO "CONFIGURA PRIMERO CATEGORÍAS" PARA EMPRESA NUEVA

### En `/productos` (listado)
Si `count(product_categories where company_id = ?) === 0`:
- Mostrar **empty state** grande, no la tabla vacía actual.
- Título: "Antes de crear productos, configura tus categorías"
- Subtítulo: "Las categorías organizan tu catálogo y determinan qué atributos técnicos tendrá cada producto (caudal, dureza, presión...). Los importamos de un catálogo estándar del sector."
- Botón principal: "Importar categorías estándar del agua" → ejecuta clonación masiva de `product_categories_global` (con confirm modal listando: Ósmosis, Descalcificador, Dispensador, Filtros, UV, Servicio, Consumibles, etc.).
- Botón secundario: "Crear categoría a medida" → modal de creación libre.
- Link tertiary: "Ver guía de configuración del catálogo" → futuro tutorial.

### En `/productos/nuevo`
Si no hay categorías → redirige a `/productos` con flash message.

### En el sidebar
Sin cambios. La regla [[feedback_module_gating]] sigue aplicando — sidebar muestra Productos si el módulo está activo, independientemente de si hay categorías o no.

### Notificación campana
**No.** El usuario fue claro: "nunca va a pasar [aviso de campos nuevos], porque desde superadmin solo sugerimos esos atributos pero ellos pueden editar y crear nuevos". Por tanto no añadimos lógica de "aviso producto desactualizado". El seed se sugiere al crear producto y se acabó.

---

## 8. NUEVA UI DE LA FICHA DEL PRODUCTO `/productos/[id]`

### Tabs propuestas (todas dentro del módulo Productos, sin cambiar de ruta)

1. **Resumen** — datos básicos editables, marketing claim, tags, imagen principal, vídeo YouTube.
2. **Atributos técnicos** — lista de atributos sugeridos por la categoría con toggle `is_visible` + valor + unidad + `is_featured` + `is_critical`. Botón "Añadir atributo personalizado".
3. **Precios** — todos los planes (cash particular, cash empresa, renting 24/36/48/60m, alquiler). Histórico de cambios.
4. **Imágenes** — galería ordenable, marcar principal, alt-text por foto.
5. **Documentos** — adjuntos PDF/DOCX/PNG categorizados (manual, certificado, ficha fabricante, etc.).
6. **Stock** — vista de stock por almacén, mín/máx, lead-time, sparkline 90 días, botón "Recalcular CMP". (Lectura desde almacenes, ya existe.)
7. **Movimientos** — últimos 200 movimientos del producto (entradas compra, salidas instalación, transferencias, devoluciones). (Lectura desde almacenes.)
8. **Compatibilidades** — recambios compatibles con este equipo (o equipos compatibles con este recambio), internos y externos.
9. **Ventas 90d** — qué contratos lo incluyeron, qué clientes lo tienen instalado (lectura cross-module, ya existe parcial).
10. **Ficha técnica** — preview del PDF, botón "Regenerar", botón "Crear URL pública", botón "Enviar por email".

Toggle global de la ficha: **"Solo mostrar atributos rellenados"** para limpiar la vista al editar.

### Reordenar arrastrando
- Imágenes: drag-drop para ordenar.
- Atributos: drag-drop para reordenar dentro de su sección.
- Documentos: drag-drop.

---

## 9. ALERTAS INTELIGENTES — AMPLIACIÓN

Hoy hay alertas de almacén (stock bajo, sin rotación). Añadir:

| Nueva alerta | Disparador | Severidad |
|--------------|------------|-----------|
| Producto sin precio cash | `product_pricing_plans` no tiene cash activo | Warning |
| Producto con margen <20% | precio_cash < cost × 1.2 | Warning |
| Producto activo sin foto principal | `main_image_url IS NULL` | Info |
| Producto activo sin ficha técnica completable | <5 atributos críticos rellenados | Info |
| Producto sin categoría | `category_id IS NULL` | Warning |
| Producto sin tags | `tags IS NULL OR array_length=0` | Info (apagable) |
| Producto discontinuado con stock | `discontinued_at IS NOT NULL` y stock > 0 | Info |
| Producto discontinuado con contratos activos | `discontinued_at IS NOT NULL` y hay contracts | Critical |
| Producto sin documentación | no hay `product_documents` | Info |
| Catálogo no enviado a clientes hace 90 días | empresa sin `product_catalog_emails` recientes | Info |

Panel `🧠 Alertas inteligentes` arriba en `/productos` (patrón ya replicado en otros módulos).

---

## 10. CROSS-MODULE (⚠ PREGUNTAR ANTES DE TOCAR)

Estos puntos tocan otros módulos. Los menciono para que decidas si entran en este sprint o se aplazan:

### A. Añadir FK constraints a tablas de almacén
```sql
-- ⚠ CROSS warehouse
alter table warehouse_stock
  add constraint fk_warehouse_stock_product
  foreign key (product_id) references products(id) on delete restrict;

alter table stock_movements
  add constraint fk_stock_movements_product
  foreign key (product_id) references products(id) on delete set null;

alter table stock_alerts
  add constraint fk_stock_alerts_product
  foreign key (product_id) references products(id) on delete cascade;
```
Riesgo: si alguna fila ya está huérfana, la migración fallará. Antes de aplicar → reporte previo de huérfanos.

### B. Añadir FK constraint a customer_equipment
```sql
-- ⚠ CROSS customers
alter table customer_equipment
  add constraint fk_customer_equipment_product
  foreign key (product_id) references products(id) on delete set null;
```

### C. Añadir FK constraint a maintenance_jobs
```sql
-- ⚠ CROSS maintenance
alter table maintenance_jobs
  add constraint fk_maintenance_jobs_product
  foreign key (product_id) references products(id) on delete set null;
```

### D. Mejora `customer_equipment` con histórico de producto
Cuando un producto se discontinue o renombre, el equipment del cliente debería poder consultarlo. Hoy el snapshot solo se guarda en contracts/proposals. ¿Replicar `product_name_snapshot` en `customer_equipment`?

### E. Lead automático desde catálogo público
Cuando alguien rellena el form de "Solicitar información" en `/catalogo/{token}`, crear un lead en `leads` con `source='public_catalog'` y `notes` con qué producto le interesó. Tocar módulo Leads.

### F. Plantillas email nuevas en `email_templates`
Tocar módulo Mailing (añadir dos plantillas seed).

**Te recomiendo**: A, B, C, F entran. D y E son extensiones futuras → quedan en aparcado.

---

## 11. MIGRACIONES PROPUESTAS — TODAS ADITIVAS

Numeración secuencial siguiendo el patrón actual `YYYYMMDDhhmmss_descripcion.sql`:

1. `20260604100000_products_new_columns.sql` — columnas nuevas a `products` (tags, marketing_claim, youtube_url, qr_target_url, barcode_ean13, country_of_origin, manufacturer_*, warranty_*, discontinued_at, replaced_by_product_id, installation_diagram_url, datasheet_color_accent).
2. `20260604100100_product_tags_catalog.sql` — tabla nueva.
3. `20260604100200_product_documents.sql` — tabla nueva + bucket.
4. `20260604100300_product_catalog_emails.sql` — tabla nueva.
5. `20260604100400_product_public_shares.sql` — tabla nueva.
6. `20260604100500_certifications_catalog.sql` — catálogo + seed inicial.
7. `20260604100600_product_certifications.sql` — pivot N:N.
8. `20260604100700_product_attributes_is_critical.sql` — añadir flag `is_critical` a `product_attributes_global` y `product_attributes`.
9. `20260604100800_product_attributes_global_seed.sql` — seed exhaustivo de atributos del sector agua (los de la sección 3 de este plan).
10. `20260604100900_email_templates_product_seed.sql` — plantillas `product_datasheet_share` y `product_catalog_share` con valores por defecto.
11. ⚠ `20260604101000_fk_warehouse_to_products.sql` — añadir FK constraints (sección 10 A, B, C).

---

## 12. PLAN DE EJECUCIÓN EN 5 FASES

Cada fase es commiteable independientemente. Puedo parar entre fases y esperar tu OK para la siguiente.

### FASE 1 — Schema y seed (sin UI)
- Migraciones 1 a 10 (sin FK constraints).
- Aplicación segura: todo NULLABLE, ningún dato existente se ve afectado.
- Seed superadmin: ejecutable manualmente desde `/superadmin/seed-water-industry` (botón nuevo).
- Sin cambios de UI todavía.

### FASE 2 — UI Productos: empty state, tags, atributos sugeridos
- Empty state cuando no hay categorías.
- Banner "Importar categorías estándar" en `/productos`.
- Tags multicolor en listado y filtro por tag.
- Atributos sugeridos auto-pre-cargan toggles en el formulario de creación/edición.
- Toggle `is_critical` editable por admin en `/configuracion/productos`.

### FASE 3 — Ficha técnica PDF rediseñada
- Rediseño visual del datasheet existente siguiendo plantilla sección 5.
- Toggle `is_visible` por atributo se respeta.
- Banner "ficha incompleta" si faltan críticos.
- Botón "Crear URL pública" → URL `/datasheet/{token}` + render HTML.
- Botón "Enviar por email" → modal con destinatario + Resend + adjunto PDF.

### FASE 4 — Catálogo profesional
- Selector múltiple en `/productos` (checkboxes + botón "Generar catálogo con selección").
- Botón "Generar catálogo de [categoría]" en cada cabecera de categoría.
- Modal de configuración (productos, precios, branding, caducidad).
- Generación PDF nueva en `/api/pdf/catalog/[token]`.
- URL pública `/catalogo/{token}` HTML + descargable.
- Auditoría en `product_catalog_emails`.

### FASE 5 — Documentos, certificaciones, alertas
- Tab Documentos con upload + categoría.
- Tab Certificaciones con catálogo predefinido + seleccionables.
- Iconos de certificaciones en la ficha técnica.
- Alertas inteligentes nuevas (sección 9).
- FK constraints cross-module (con tu OK previo).

---

## 13. DECISIONES YA TOMADAS DE TU RESPUESTA

- ✅ **Atributos**: seed sugerido por superadmin, empresa edita y añade. No hay aviso de "campo nuevo" porque solo se sugiere.
- ✅ **Ficha técnica**: investigada competencia (BWT, Cillit, Pentair, Kinetico, Culligan, Hidrowater, Atlas Filtri, Lenntech). Plantilla en sección 5 de este plan.
- ✅ **Catálogo + email + URL pública**: combinado todo. Selector de qué precios mostrar por producto. URL pública compartible + descarga PDF + envío por Resend.

---

## 14. PREGUNTAS QUE TE QUEDAN POR DECIDIR

1. **Categorías sugeridas**: te he propuesto 8 (Ósmosis doméstica, Ósmosis industrial, Descalcificador doméstico, Descalcificador industrial, Dispensador, Filtros, UV, Servicio, Consumible). ¿Añado más, quito alguna, las renombras?
2. **Discontinuado vs activo**: introduzco `discontinued_at` distinto de `is_active`. Discontinuado = no se vende más pero sigue en mantenimiento. ¿OK?
3. **FK constraints cross-module** (sección 10): ¿entra en este sprint (Fase 5) o las aplazamos a una sesión específica de hardening?
4. **URL pública del datasheet/catálogo**: ¿con caducidad por defecto (sugiero 90 días) o sin caducidad? ¿Toggle por share?
5. **Lead automático desde catálogo público**: ¿implementar o aparcar?
6. **Sistema de versionado de ficha técnica**: ¿guardamos cada generación del PDF en Storage para histórico, o se regenera siempre?
7. **Banner "ficha incompleta"**: ¿bloqueamos generación si faltan críticos o solo avisamos?
8. **Branding del PDF**: el color de la banda superior, ¿usa el `brand_color` de la empresa (campo nuevo en `companies`?) o el del producto (`datasheet_color_accent`)?
9. **Catálogo por email — Resend**: ¿adjunto PDF (puede pesar mucho si son 50 productos), URL pública en el cuerpo, o ambos?

---

## 15. LO QUE EXPLÍCITAMENTE NO TOCO

- La regla `show_in_calculator` estricta — no se rompe ([[feedback_calc_strict_filter]]).
- `cost_cents` editable a mano — no se permite, sigue siendo CMP desde compras ([[feedback_product_cost]]).
- Migraciones destructivas: ninguna.
- Renombrar columnas existentes: ninguno.
- Borrar tablas: ninguno.
- Snapshots de proposal_items/contract_items/invoice_lines: se mantienen tal cual, son la garantía de que cambiar producto no rompe ventas pasadas.

---

## 16. PRÓXIMO PASO

Cuando despiertes, lee el plan y dime una de estas tres:

A. **"Sí a todo, arranca por Fase 1"** → migraciones + seed sin tocar UI.
B. **"OK con cambios: [tus comentarios]"** → ajusto y arranco.
C. **"Para, replantéate X"** → revisamos juntos.

Sin tu OK no toco una línea de código de la aplicación.

— Claude, 2026-06-03, madrugada.

---

## 17. DECISIONES CERRADAS DEL USUARIO — 2026-06-04 mañana

Mario respondió a las 9 preguntas + 3 dudas finales. Estas son las decisiones que sustituyen / amplían lo redactado arriba:

### 17.1 Categorías finales del seed superadmin

Sustituye sección 3:
- **Ósmosis** (padre) con 3 subcategorías:
  - Ósmosis 5 etapas
  - Ósmosis compacta
  - Ósmosis de flujo directo
- Descalcificadores
- Dispensadores
- Horeca
- Ozono
- Filtros (categoría comercial; ojo: los filtros como entidad técnica viven en su propia tabla — ver 17.4)
- Servicio

**Atributos de las subcategorías de ósmosis**: heredan los del padre "Ósmosis" + 2-3 específicos por subtipo. Ejemplo: compacta tiene atributos de depósito y dimensiones reducidas; flujo directo NO tiene depósito (caudal directo a grifo) pero sí caudal-pico l/min mayor; 5 etapas hereda todo y añade etapa de remineralización.

### 17.2 Categoría "Servicio" — seed inicial

Líneas precargadas (todas editables y se pueden añadir más):
- **Hora de trabajo técnico** — para facturar horas de instalación/reparación.
- **Desplazamiento por km** — precio por km.
- **Mantenimiento de ósmosis (cuota plana)** — para cuando se cobra fijo sin contar horas.
- **Mantenimiento de descalcificador (cuota plana)** — idem.
- (El usuario podrá crear más, ej. "Análisis de agua", "Visita técnica fija", etc.)

### 17.3 Módulo `/presupuestos` — APARCADO formal

🅿️ **Aparcado para implementar después del módulo Productos.**

- Solo lo ve **admin**.
- Hace presupuestos a mano (líneas de productos del catálogo + líneas de servicio) sin pasar por `/propuestas`.
- Si el presupuesto se acepta → pasa directamente a factura.
- Se hará cuando Claude tenga ya el contexto completo del módulo Productos terminado.

Memoria: añadir a `project_aparcado.md` cuando ejecutemos el plan.

### 17.4 Filtros y recambios — tabla nueva `product_filters` (NO son productos)

Decisión clave: los filtros viven en una tabla nueva separada, con campos mínimos. NO heredan de `products`. Pesta-ña dedicada `/productos/filtros` (admin) o `/recambios` dentro del módulo.

```sql
create table public.product_filters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  internal_reference text,                    -- SKU del filtro
  manufacturer_name text,
  manufacturer_model text,
  filter_type text check (filter_type in (
    'sediment','gac','cto','membrane','postcarbon','remineralizer',
    'softener_resin','uv_lamp','other'
  )),
  micron_rating int,                          -- µm
  lifespan_months int,                        -- vida útil estimada
  cost_cents int,                             -- CMP desde compras (igual que productos)
  sale_price_cents int,                       -- precio de venta al cliente
  main_image_url text,
  notes text,
  is_active boolean default true,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
```

**Asignación a productos-equipo** — tabla N:N:
```sql
create table public.product_filter_assignments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,    -- el equipo
  filter_id uuid not null references product_filters(id) on delete restrict,
  position int default 0,                     -- orden en el equipo (etapa 1, 2, 3...)
  replacement_period_months int,              -- cada cuánto se cambia (puede sobreescribir lifespan)
  is_required boolean default true,
  notes text,
  created_at timestamptz default now(),
  unique(product_id, filter_id)
);
```

**Compatibilidades entre filtros** (si no hay stock de A, vale B):
```sql
create table public.product_filter_compatibilities (
  filter_a_id uuid references product_filters(id) on delete cascade,
  filter_b_id uuid references product_filters(id) on delete cascade,
  notes text,
  primary key (filter_a_id, filter_b_id),
  check (filter_a_id <> filter_b_id)
);
```

**Stock predictivo de filtros**:
- Cuando se firma un contrato con mantenimiento, los filtros asignados al equipo se "agendan" como demanda futura.
- Cron mensual lee todos los mantenimientos próximos 90 días → cuenta filtros que se necesitarán → compara con stock actual → genera alerta predictiva en `/almacenes` y en `/productos/filtros` ("vas a necesitar 30 unidades del filtro X en 60 días, hoy tienes 12").
- Si hay compatibilidad declarada, suma stock de filtros compatibles a la hora de calcular.

**UI**:
- En `/productos/[id]` (un equipo), nueva pestaña **"Filtros y recambios que lleva"** con tabla editable (drag para ordenar etapa, selector "elegir existente o crear nuevo", periodicidad de cambio).
- En `/productos/filtros` (admin), listado con stock, compatibilidades, equipos donde se usa, próxima demanda esperada.
- En la ficha del cliente o del equipo instalado, ver qué filtros toca cambiar y cuándo (a partir de `customer_equipment` + `product_filter_assignments`).

### 17.5 Aviso de atributos críticos faltantes en ficha técnica

- **Solo lo ve nivel 1 (admin).** Nivel 2 y 3 no.
- **No bloquea** la generación del PDF.
- Botón "Visto" para descartarlo. Una vez descartado, no vuelve a salir para ese producto a ese usuario.
- Tabla pequeña nueva `product_alerts_dismissed (user_id, product_id, alert_key, dismissed_at)`.

### 17.6 Permisos del módulo Productos — REGLA FIJA

Mario me recordó esta regla, que voy a fijar en memoria para no fallarla más:

- **Nivel 1 (admin)**: crea, edita, soft-delete, ve coste, ve márgenes, edita atributos, sube documentos, gestiona filtros y catálogo de tags.
- **Nivel 2 (directores: técnico / comercial / telemarketing)**: solo **lectura completa**. Ven precios públicos (cash, renting, alquiler), fotos, atributos, documentos. **El director comercial sigue viendo el coste** (regla previa).
- **Nivel 3 (sales_rep, telemarketer, installer)**: solo **lectura**. Ven precios públicos, fotos, atributos. **NO ven el coste.** No ven márgenes.
- Botones de "Crear producto", "Editar", "Eliminar", "Importar CSV", "Bulk actions" → ocultos a nivel 2 y 3.
- Toggle `show_in_calculator` → solo admin.
- Toggle `is_visible` por atributo → solo admin.
- Server actions del módulo → guardas (guards = controles) que validan rol antes de hacer escritura.

### 17.7 URL pública

- Caducidad por defecto **60 días** (no 90).
- Toggle "Sin caducidad" disponible al crearla.

### 17.8 Lead automático desde catálogo público

- **NO**. El catálogo público SIEMPRE se manda a un lead que ya existe en el CRM.
- En `/leads/[id]` se añade un botón "Enviar catálogo" que abre el flujo de selección de categorías/productos.

### 17.9 Versionado del PDF

- **No guardamos histórico.** Cada generación es fresca y se descarga / sirve directo.

### 17.10 Email del catálogo Resend

- **Catálogo completo** (varios productos / categoría entera): solo **URL pública** en el cuerpo del email. Sin PDF adjunto.
- **Ficha técnica suelta de un producto**: PDF adjunto + URL pública en el cuerpo (esta parte la mantengo del plan original).

### 17.11 Color del PDF

- **Hereda del color corporativo de la empresa** (`companies.brand_color`, campo nuevo si no existe).
- El campo `datasheet_color_accent` por producto se MANTIENE como opción de override, pero por defecto vacío.

### 17.12 FK constraints cross-module

- **SÍ entran** en este sprint (Fase 5 sigue siendo el momento).
- Explicación llana: hoy si alguien borrase un producto de la base de datos, las tablas de almacén y mantenimiento se quedarían con un fantasma (un identificador que no apunta a nada). La FK (foreign key, "llave que une dos tablas") es una norma que dice "no se puede borrar el producto mientras esté en uso" o "si se borra, deja el hueco vacío automáticamente". Lo aplico en 5 sitios: stock, movimientos, alertas, equipos del cliente, mantenimientos.

---

## 18. FASES ACTUALIZADAS CON DECISIONES 17

Las 5 fases se ajustan así:

**FASE 1** — Schema + seed
- Tablas nuevas: `product_tags_catalog`, `product_documents`, `product_catalog_emails`, `product_public_shares`, `certifications_catalog` (+ seed), `product_certifications`, `product_filters`, `product_filter_assignments`, `product_filter_compatibilities`, `product_alerts_dismissed`.
- Columnas nuevas en `products`: las de sección 2.
- Columna nueva en `companies`: `brand_color`.
- Columnas nuevas en `product_attributes_global` y `product_attributes`: `is_critical`.
- Seed superadmin con las categorías finales (17.1) + subcategorías ósmosis + atributos heredados.
- Seed servicios (17.2).

**FASE 2** — UI Productos básica
- Empty state si no hay categorías.
- Botón "Importar categorías estándar del agua" en `/productos`.
- Tags multicolor en listado y filtro por tag.
- Atributos sugeridos auto-precargados al crear/editar producto.
- **Aplicar permisos sección 17.6** (botones ocultos a nivel 2-3, server-side guards).

**FASE 3** — Ficha técnica PDF rediseñada
- Diseño visual nuevo siguiendo sección 5.
- Color heredado de `companies.brand_color`.
- Toggle `is_visible` por atributo respetado.
- Aviso de atributos críticos faltantes (solo nivel 1, con "Visto").
- Botón "Crear URL pública" (60 días por defecto) + render HTML en `/datasheet/{token}`.
- Botón "Enviar por email" con PDF adjunto + URL.

**FASE 4** — Catálogo
- Selector múltiple + botón "Generar catálogo".
- Modal de configuración con selector de precios.
- PDF generado en backend.
- URL pública `/catalogo/{token}` (60 días).
- Email solo con URL (sin PDF adjunto).
- Botón "Enviar catálogo" en ficha de lead.

**FASE 5** — Filtros y recambios + Documentos + Certificaciones + Alertas + FK
- Tabla `product_filters` + UI `/productos/filtros` (admin).
- Pestaña "Filtros que lleva" en ficha del equipo con drag-drop y crear-al-vuelo.
- Compatibilidades entre filtros.
- Stock predictivo de filtros vinculado a mantenimientos.
- Tab Documentos + tab Certificaciones.
- Alertas inteligentes nuevas (sección 9).
- FK constraints (con reporte previo de huérfanos).

**FASE 6 (futura, fuera de este sprint)** — Módulo `/presupuestos` aparcado (17.3).

---

## 19. ESTADO

Plan cerrado con todas tus decisiones del 2026-06-04. **Listo para arrancar Fase 1 con tu OK.** Dime cuándo empiezo o si quieres revisar algo más antes.

