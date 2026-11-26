# Plan: Horeca + ósmosis/UF en la misma instalación y «Gas» dentro de Horeca

Estado: PROPUESTO el 2026-11-25. **Nada aplicado.** Falta que Mario responda las preguntas del final.

## Hallazgos [verificados en código y con SELECT en producción]

- Los packs son de un nivel: padre e hijo mediante `parent_item_id` (en proposal_items, contract_items e installation_items) y `customer_equipment.parent_equipment_id`. Las propuestas, los contratos y las instalaciones ya admiten varios principales independientes. Lo que falta es un vínculo entre dos principales.
- Ser principal o accesorio lo decide la **posición en el pack**, no `products.kind`. Lo que de verdad pesa es `tipo_equipo`, cuyo CHECK solo admite fuente u osmosis en tres tablas.
- Sitios que suponen UN solo principal:
  - `maintenance/auto-schedule.ts:164` cuelga las visitas del primer principal **del cliente**, no del contrato. Es un fallo latente: 18 clientes de Infinity tienen 2 o más principales.
  - `contracts/actions.ts:573` usa una sola periodicidad por contrato.
  - La baja en cascada está en `customers/equipment-actions.ts:679`.
  - El traspaso arrastra los hijos.
- En Infinity:
  - El ECO25 ÉLITE (HO1128) es un accesorio de la categoría Gas, sin `tipo_equipo`. Tiene 2 equipos de cliente, los dos como hijos:
    - el cliente a66b86f7 lo tiene colgado de una Golden Eye;
    - el cliente 0717b73c lo tiene colgado de un COMPACT y probablemente es un error, porque debía ser un grifo.
  - EN0901 está en 3 equipos de cliente (1 como principal).
  - No tiene ninguna fila en `product_extra_targets`.
  - Ninguna línea de contrato, instalación ni propuesta tiene `parent_item_id`.
- En el maestro hay 24 Horeca en `horeca`/equipment. El gas ya está como rasgo de variante, salvo en HO1128, que sigue en Gas/accessory.

## Opción recomendada: A, el rol «complemento» dentro del pack

- `pack_role` ('extra' | 'complemento'; null = como hoy) en los tres tipos de líneas y en `customer_equipment`.
- `product_extra_targets.relacion` y `product_categories_global.complementa_keys` (horeca ↔ osmosis*, filters).
- Sirve en las dos direcciones: el complemento cuelga del primer equipo que se elige.
- Infinity no cambia: todos sus datos se quedan en null, que equivale a «extra».

Descartadas:
- B, conjunto entre iguales: más trabajo para el mismo resultado.
- C, ósmosis como extra tal cual: rompe el mantenimiento.
- Un `kind` nuevo.

Común: relajar el CHECK de `tipo_equipo` para admitir 'horeca' (y quizá 'ultrafiltracion').

## Fases

- **F0.** Huella de Infinity como línea base.
- **F1.** Solo en el maestro y en las categorías globales:
  - HO1128 pasa a horeca/equipment sin subir la versión.
  - La global Gas se desactiva y pasa a tener `parent_key = horeca`. NO se borra, porque un SET NULL desengancharía la categoría Gas de Infinity.
  - Se siembran las reglas de complemento.
- **F2.** Migración aditiva.
- **F3.** Código:
  - propuesta, contrato, instalación y alta documental con complementos;
  - mantenimiento por equipo y periodicidad por línea;
  - arreglar `auto-schedule.ts:164`;
  - baja en cascada y retirada;
  - etiqueta en la ficha.
- **F4.** Propuestas a Infinity con antes y después, aplicadas solo si las acepta:
  - el ECO25 pasa a Horeca/equipment;
  - el pack de a66b86f7 queda como complemento;
  - se revisa 0717b73c;
  - se archivan las categorías vacías.
- **F5.** Empresas nuevas y prueba a 390 px.

## Preguntas para Mario

1. ¿El Horeca tiene mantenimiento propio (higienización, CO₂) con precio propio, o solo se mantiene la ósmosis/UF?
2. ¿La UF es un tipo propio o se trata como ósmosis?
3. Si se retira o se da de baja el Horeca, ¿se va también la ósmosis/UF? ¿Y en un traspaso?
4. ¿El complemento lleva su propia cuota o va incluido en el precio del Horeca?
5. ¿El complemento suma puntos y comisión? Hoy suma todo, incluso un grifo.
6. ¿«Con gas» basta como variante dentro de cada gama Horeca? ¿Se desactiva la categoría global Gas?
7. Infinity: ¿el ECO25 de a66b86f7 pasa a complemento de su Golden Eye? ¿El de 0717b73c es un error?
8. Compatibilidad: ¿cualquier Horeca con cualquier ósmosis/UF (por categoría) o una lista por modelo?

## Respuestas de Mario (2026-11-25)

1. El Horeca NO tiene mantenimiento propio (solo revisión visual, sin filtros). Solo se mantiene la ósmosis/UF.
   → El Horeca no genera visitas ni precio de mantenimiento; las visitas van a la ósmosis/UF del pack.
2. La UF se trata como ósmosis (tiene sus filtros) → `tipo_equipo = osmosis`; no hace falta tipo nuevo para la UF.
3. Va todo en pack: se retira y se traspasa junto. Si una parte falla, se puede SUSTITUIR solo esa parte.
4. La ósmosis/UF va INCLUIDA en el precio del Horeca (sin cuota propia).
5. Sí suma puntos y comisión.
6. El gas sale en los ATRIBUTOS de cada equipo («Agua con gas» sí/no; ya cargado en el maestro, p. ej. HO1065=sí,
   HO1064=no) y tiene que estar en la DESCRIPCIÓN. Hoy la descripción de los «G» no lo dice → corregir en el maestro.
7. ECO25 + Golden Eye y COMPACT + ECO25 son los dos válidos: siguen el patrón Horeca + ósmosis → complemento.
8. Sí: cualquier Horeca con cualquier ósmosis/UF (por categoría).
