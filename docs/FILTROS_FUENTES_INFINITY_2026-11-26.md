# Filtros de las fuentes de INFINITY AQUA: de dónde sale cada uno

Fecha: 2026-11-25. Todo comprobado con SELECT en producción (Management API).
SQL pendiente de aplicar: `supabase/datos/20261126_filtros_fuentes_infinity.sql`
y, después, `supabase/datos/20261126_aviso_lara_filtros_fuentes.sql`.

## Fuentes de las que miramos los datos

1. **Catálogo maestro de Osmofilter**: `catalog_product_compatibilities`, que relaciona cada recambio
   con su equipo (se cargó el 25-11).
2. **Enlace de Infinity al maestro**: `products.catalog_product_id`.
3. **Filtros que Infinity ya tiene**: `product_filters`, 7 filas. Ninguno coincide con los del
   maestro: son de Golden Eye, Beast y Direct basic.
4. **Mantenimientos hechos**: 44 completados. `maintenance_items_replaced` tiene una sola línea,
   y es el propio equipo ECO25, no un filtro. Las notas solo hablan de filtros en 10 trabajos
   **sin equipo** (dicen «sedimentos, carbón granulado y block, posfiltro»), así que no se pueden
   atar a ninguna gama.

## Gamas de fuente sin filtros (25-11)

| Gama | Equipos activos (con variantes) | Enlace al maestro | Resultado |
|---|---|---|---|
| Infinity Basic (FIORD, 525, 425, 725, ESSENTIAL, FIORD BLACK, FUENTE, FUENTE DE PIE, REGULAR) | 161 en la gama + 5 en variantes | **ninguno** | **Pregunta a Lara** |
| Infinity Basic S (Compact) (630, 750 S, COMPACT, FIORD S, S PREMIUM, SOBREMESA) | 21 | FRO1046 «DISPENSADOR BLUE MOUNTAIN» | **Deducido: seguridad alta** |
| Infinity Indic (FIORD PLUS, INDIC, Infinity 1300, INFINITY PLUS) | 13 | FRO1093 «DISPENSADOR INDIC» | **Deducido: seguridad alta** |

La variante «Infinity 1300» está enlazada a «FUENTE 1300» (000006), pero ese equipo del maestro no
tiene compatibilidades. Hereda los filtros de su gama, Indic.

## Asignaciones deducidas

En las dos gamas el enlace al maestro se puso en julio de 2026 (`updated_at` 24-07 y 29-07), antes de
cargar el maestro. Los consumibles salen tal cual de las compatibilidades del maestro, en su orden
(`display_order`).

**Infinity Basic S (Compact) ← FRO1046 DISPENSADOR BLUE MOUNTAIN**

| Etapa | Ref. | Consumible del maestro | Tipo |
|---|---|---|---|
| 1 | FCC-22 | Filtro Encapsulado Carbón Granulado (GAC) 2,5"x10" Espiga 1/4" | gac |
| 2 | FCC-23 | Filtro Encapsulado Carbón Block (CTO) 2,5"x10" Espiga 1/4" | cto |
| 3 | FCS-24 | Filtro Encapsulado Sedimentos (PP) 2,5"x10" Espiga 1/4" | sediment |
| 4 | FP1023 | Postfiltro Carbón Granulado (GAC) 2"x10" Espiga 1/4" Tipo I. Dispensadores | postcarbon |
| 5 | RO4145 | Membrana WIP Encapsulada 100GPD 2,5"x10" 1/4" Espiga | membrane |

**Infinity Indic ← FRO1093 DISPENSADOR INDIC**: los mismos cuatro filtros (FCC-22, FCC-23, FCS-24,
FP1023) y la membrana **RO4171**, 150 GPD.

Hay un indicio a favor: las notas de los 10 mantenimientos sin equipo describen justo ese juego
(sedimentos, carbón granulado, carbón block y posfiltro).

Lo que **no** trae el maestro, y por eso el SQL no lo pone:

- **Periodo de cambio**: se deja en blanco. No se inventa.
- **Cantidad por cambio**: el maestro la trae vacía y se pone 1.

La carga sugerida no usa el periodo de cambio. Las membranas no suman a la carga del día: se llevan
de la reserva.

## Lo que se pregunta a Lara

Para **Infinity Basic**, la gama con más equipos (166), no hay ningún dato. La tarjeta «Necesitamos
tu ayuda» de su dashboard la lista en vivo, con enlace a `/productos/<id>?abrir=filtros`. Si se
aplica antes el SQL de los filtros, es la única que le sale; si no, salen también Basic S e Indic.

La nota de un mantenimiento cerrado de Infinity Basic dice: «No tengo filtros para este equipo».

## Fuera de alcance, pero visto

- **Infinity Zafiro** (22 equipos) y **Zafiro-S** (2): están en la categoría «Fuente», pero su
  `products.tipo_equipo` es `osmosis`, y manda el tipo (regla 0 del plan). No son fuentes: no salen en
  la tarjeta de Lara. Tampoco tienen filtros ni enlace al maestro.
- **Golden Eye** (ósmosis) tiene creado el filtro «Filtro Golden Eye» (RO1134), pero solo tiene
  asignada la membrana. Probablemente le falte esa asignación. No se toca: no es una fuente y solo
  coincide el nombre.
- **ECO25 ÉLITE** (Horeca): en el maestro solo trae piezas, ningún filtro.
