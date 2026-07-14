# PLAN — Conversión de cliente particular a autónomo / empresa

> Estado: IMPLEMENTADO el 2026-07-14 (decisiones owner: solo admin; autónomo→empresa incluido;
> SEPA = aviso; DNI anterior en notes + evento). Typecheck y tests en verde.

## Objetivo

Que un cliente **particular** (`party_kind='individual'`) pueda pasar a:

1. **Autónomo** — persona física con actividad económica. Se trata como empresa
   (precio base + IVA, financieras de autónomo) pero conserva su nombre y su DNI/NIE.
2. **Empresa (cambio de titular)** — el titular actual pasa a ser la **persona de
   contacto**; se añaden **razón social** y **CIF** nuevos.

## Estado actual verificado (2026-07-14)

### El modelo de datos YA soporta ambos estados destino — NO hay migración

- `customers`: `party_kind` (`individual|company`, verificado en remoto), `is_autonomo`,
  `legal_name`, `trade_name`, `first_name`, `last_name`, `tax_id` — **todas las columnas
  existen en el remoto** (comprobado vía Management API, pese a la deriva local↔remoto
  conocida).
- Convención vigente para **empresa**: `first_name`/`last_name` de la fila del cliente
  SON la persona de contacto (así lo renderiza `edit-data-button.tsx:119` "Persona
  contacto" y lo deriva `actions.ts:332` `contact_name`). La tabla `customer_contacts`
  existe en BD pero **no se usa en ningún sitio del código** → NO usarla.
- Convención vigente para **autónomo** (`create-form.tsx:82-88`): `party_kind='company'`,
  `is_autonomo=true`, `legal_name = first_name + ' ' + last_name` (para que los listados
  que muestran `trade_name || legal_name` funcionen), `trade_name=''`, `tax_id` = DNI/NIE.
  La conversión debe imitar exactamente esto.

### Hoy NO se puede convertir

- `updateCustomerAction` (`customers/actions.ts:708`) no acepta `party_kind` en el patch.
- El diálogo de edición renderiza campos según un `party_kind` fijo.

### Efectos aguas abajo de cambiar los datos fiscales (verificado, favorable)

| Área | Comportamiento verificado | Efecto de la conversión |
|---|---|---|
| Facturas emitidas / Verifactu | Snapshot inmutable al emitir (`customer_fiscal_snapshot` siempre, `customer_snapshot` V2; `invoices/actions.ts:473,487`) | **No cambian** (correcto legal/AEAT) |
| Cuotas recurrentes | `generateMonthlyRecurringInvoicesAction` → `createInvoiceAction` lee el **cliente vivo** al emitir (`invoices/actions.ts:423-437`) | Las próximas cuotas salen **a nombre de la nueva razón social/CIF automáticamente** |
| Contratos firmados | `customer_snapshot` congelado al crear (`contracts/actions.ts:395`, `free-trials/actions.ts:857`) | No cambian; el PDF firmado conserva el titular original |
| Mandatos SEPA | `sepa_mandates` guarda snapshot del deudor (`debtor_name/tax_id/iban`) | El mandato queda a nombre del titular **anterior** → domiciliar a la nueva empresa exige **nuevo mandato** (norma SEPA); no se cancela solo |
| Precios duales | `proposals/pick-price.ts` elige `*_individual` vs `*_business` por `party_kind`/`is_autonomo` | Propuestas **futuras** pasan a precio empresa (base + IVA). Contratos existentes mantienen su `monthly_cents` pactado |
| Propuestas abiertas | Guardan precios calculados al crearlas | Conservan precio de particular → avisar por si procede regenerar |
| Financieras (renting) | Filtran por `is_autonomo` | Automático tras conversión |
| Wallet / puntos / equipos / mantenimientos | Cuelgan de `customer_id` | Continuidad automática (mismo cliente) |
| Timeline | Tabla `events` ya usada (`customer.updated`) | Sitio natural para auditar la conversión y conservar el DNI del titular anterior |

## Diseño

### Alcance

- **Incluido**: particular → autónomo, particular → empresa, y (casi gratis, recomendado)
  autónomo → empresa (mismo formulario "empresa", guard ampliado).
- **Excluido**: caminos inversos (empresa → particular), novación formal de contratos
  (solo aviso), cancelación automática de mandatos SEPA.

### 1. Schema (`customers/schemas.ts`)

`customerConvertSchema`:

```ts
{
  mode: z.enum(["autonomo", "empresa"]),
  // Solo mode="empresa":
  legal_name: string,          // obligatorio si empresa
  tax_id: string,              // CIF, obligatorio si empresa (aviso formato NO bloqueante, política actual)
  trade_name: string optional,
  contact_first_name / contact_last_name: optional (default: titular actual),
  // Solo mode="autonomo":
  trade_name: string optional  // nombre comercial opcional
}
```

`.refine`: si `mode='empresa'` → `legal_name` y `tax_id` obligatorios.

### 2. Server actions (`customers/actions.ts` o `customers/convert-actions.ts` nuevo)

**`checkConversionImpactsAction(customerId)`** — pre-chequeo de solo lectura para
pintar los avisos del diálogo. Devuelve:

- nº de contratos `rental/renting` firmados activos,
- nº de mandatos SEPA activos (`sepa_mandates.status='active'` vía contratos del cliente),
- nº de propuestas abiertas (estado no cerrado),
- datos actuales del cliente (nombre, DNI) para prellenar.

**`convertCustomerToCompanyAction(customerId, input)`** — acción DEDICADA (no ensanchar
`updateCustomerAction`: transición one-way, validación y auditoría propias):

1. `requireSession` + `ensureAdmin` (decisión: solo admin convierte — gate abajo).
2. Cargar cliente con admin client **filtrando `company_id`** (regla multi-tenant),
   exigir `deleted_at is null` y:
   - `mode='autonomo'` → exigir `party_kind='individual'`;
   - `mode='empresa'` → exigir `party_kind='individual'` **o** (`company` + `is_autonomo`).
3. Validar input con `customerConvertSchema`.
4. **Dedupe del CIF nuevo** (mismo patrón que `updateCustomerAction:779-794`, saltando
   DNI comodín con `isPlaceholderTaxId`).
5. **UPDATE de una sola fila y una sola sentencia** (atómico, sin RPC):
   - `autonomo`: `party_kind='company'`, `is_autonomo=true`,
     `legal_name = \`${first_name} ${last_name}\``, `trade_name = input.trade_name || null`,
     `tax_id` se conserva (DNI/NIE).
   - `empresa`: `party_kind='company'`, `is_autonomo=false`, `legal_name`, `trade_name || null`,
     `tax_id = CIF nuevo`, `first_name/last_name = persona de contacto`
     (default: el titular actual — no tocar si no se edita).
   - Con `.eq("company_id", session.company_id)` y `.select("id")` + check de fila
     afectada (patrón existente).
6. **Auditoría**: insert en `events` con `kind='customer.converted'` y
   `payload = { mode, before: {party_kind, is_autonomo, legal_name, first_name, last_name, tax_id}, after: {...} }`
   → el titular y DNI anteriores quedan en el timeline, no se pierden al sobreescribir.
   Opcional: además, línea en `notes` ("Convertido de particular (Nombre, DNI X) el AAAA-MM-DD").
7. `revalidatePath(\`/clientes/${customerId}\`)` (+ `/clientes`).

Wrapper `convertCustomerSafeAction` con result-pattern `{ok, error}` (patrón
`updateCustomerSafeAction`).

### 3. UI (`customers/convert-to-company-button.tsx` nuevo)

- Botón "Convertir en empresa" en la ficha `/clientes/[id]` junto a
  `EditCustomerDataButton` (`app/(tenant)/clientes/[id]/page.tsx:399`).
  Visible solo si `party_kind='individual'` (o autónomo, para el paso a empresa).
- Diálogo en 2 pasos:
  1. **Elegir modo** (radio): "Autónomo — misma persona, tributa con actividad económica"
     / "Empresa — nueva titularidad con razón social y CIF".
  2. **Formulario + avisos**:
     - Autónomo: resumen (conserva nombre y DNI) + nombre comercial opcional.
     - Empresa: razón social*, CIF* (con `TaxIdInput`, aviso visual no bloqueante),
       nombre comercial, persona de contacto prellenada con el titular actual (editable).
     - Panel de avisos según `checkConversionImpactsAction`:
       - contratos activos → "las próximas cuotas se emitirán a la nueva titularidad;
         contrato firmado y facturas emitidas no cambian; valora la novación del contrato";
       - mandato SEPA activo → "está a nombre del titular anterior: hay que firmar un
         mandato nuevo para domiciliar a la empresa";
       - propuestas abiertas → "conservan precios de particular; regenerar si procede";
       - siempre → "a partir de ahora se aplican precios de empresa (base + IVA)".
  3. Confirmación con resumen antes/después.
- Tras convertir: `router.refresh()` — la ficha y el diálogo "Editar" pasan solos al
  layout de empresa (renderizan por `party_kind` de la fila).

### 4. Qué NO se toca (verificado que no hace falta)

- Ninguna migración de BD (columnas y enum ya existen en el remoto).
- Facturas emitidas, cadena Verifactu, contratos firmados, mandatos existentes.
- `customer_contacts` (tabla muerta).
- Wallet, puntos, equipos, mantenimientos, agenda.
- `updateCustomerAction` (sigue sin aceptar `party_kind` — la conversión es la única puerta).

## Decisiones a confirmar por el owner (gate antes de implementar)

1. **¿Solo admin puede convertir?** Recomendado: sí (`ensureAdmin`), es un cambio fiscal.
2. **¿Incluir autónomo → empresa?** Recomendado: sí (gratis con el guard ampliado).
3. **SEPA activo: ¿aviso o bloqueo?** Recomendado: aviso (no bloquear la conversión).
4. **¿Registrar el DNI anterior también en `notes`** además del evento? Recomendado: sí
   (visible sin abrir el timeline).

## Ficheros a tocar (estimación)

| Fichero | Cambio |
|---|---|
| `src/modules/customers/schemas.ts` | + `customerConvertSchema` |
| `src/modules/customers/actions.ts` (o `convert-actions.ts` nuevo) | + `checkConversionImpactsAction`, `convertCustomerToCompanyAction`, safe wrapper |
| `src/modules/customers/convert-to-company-button.tsx` | nuevo (diálogo 2 pasos) |
| `src/app/(tenant)/clientes/[id]/page.tsx` | import + render del botón |

Sin migraciones. Validación: `npm run typecheck` + tests existentes + prueba manual
(particular con contrato activo → empresa → comprobar cuota siguiente y avisos).
