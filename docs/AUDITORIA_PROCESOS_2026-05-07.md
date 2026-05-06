# Auditoría completa de procesos CRM — 2026-05-07

> Auditoría exhaustiva ejecutada por agente Explore. 53KB de output completo
> en `~/.claude/projects/.../tool-results/`. Aquí el resumen accionable.

## Flujos principales (estado actual)

### ✅ Lead → Cliente
- `createLeadAction` con dedupe ✓
- `convertLeadToCustomerAction` con scope nivel 3 (admin client) ✓
- `notifyLeadCreated` ✓
- **FALTA**: `notifyLeadConverted()` para avisar al comercial cuando su lead pasa a cliente.

### ✅ Cliente → Propuesta → Contrato
- `createProposalAction` con scope ✓
- `acceptProposalAction` → genera contrato ✓
- `markContractSigned` con cascada (wallet entries + mantenimiento + auto-instalación) ✓
- Pre-sign modal wizard 5 pasos ✓
- Validación letra DNI/NIE ✓
- IBAN opcional para `cash` ✓
- Comercial puede crear IBAN ✓ (mascarado para nivel 3)

### ⚠️ Contrato → Instalación → Mantenimiento
- Auto-creación de instalación al firmar ✓
- Programación restringida a admin/director técnico ✓
- Wizard 6 pasos con auto-cierre ✓
- Notificación al comercial cuando se completa ✓
- **FALTA**: vista detalle `/mantenimientos/contrato/[id]` para los maintenance_contracts generados al cerrar instalación.

### ⚠️ Cobros → Wallet
- `collectContractPaymentAction` migrada a admin client ✓
- Validación admin de cobros ✓
- **FALTA**: matcheo automático banco (importar CSV bancario y casar).

### ⚠️ Free trials
- Alta + instalación + conversión ✓
- Scope nivel 3 corregido ✓
- **FALTA**: notificación al comercial cuando expira sin convertir.

### ⚠️ Incidencias
- Crear / asignar / resolver con scope ✓
- Director técnico ve solo su equipo ✓
- **FALTA**: SLA timer visual en la ficha de incidencia (quedan X horas).

## Notificaciones que faltan emitir
| Acción | Notif esperada | Estado |
|---|---|---|
| `customers.createCustomerAction` (sin lead origen) | admins | ❌ |
| `customers.logCustomerContactAction` | asignado | ❌ |
| `agenda.updateAgendaStatus` | asignado | ❌ |
| `agenda.rescheduleAgendaEventAction` | nuevo asignado | ❌ |
| `incidents.resolveIncidentAction` | admins | ❌ |
| `maintenance-plans.cancelMaintenanceContractAction` | admins | ❌ |
| `lost-sales recovery_user_id` | recovery_user | ❌ |
| `free_trial.expired` (cron) | comercial | ❌ |

## Reference codes auto-generados que faltan
- `incidents.reference_code` (formato `INC-2026-NNNN`).
- `free_trials.reference_code` (`PG-2026-NNNN`).
- `maintenance_jobs.reference_code` (`MJ-2026-NNNN`).
- `wallet_entries.reference_code` (`W-2026-NNNN`).
- (Ya tienen: leads `L-`, customers `C-`, proposals `P-`, contracts `C-`, installations `I-`, maintenance_contracts `MC-`).

## Páginas /configuracion/ faltantes (8)
- `/configuracion/propuestas` — validez por defecto, threshold aprobación, descuento máx
- `/configuracion/instalaciones` — tolerancia geo, fotos obligatorias, encuesta texto
- `/configuracion/mantenimientos` — **CRÍTICO**: editar Lite/Medium/Premium, día remesa
- `/configuracion/wallet` — métodos habilitados, IBAN liquidación, threshold validación
- `/configuracion/incidencias` — SLA por origen+prioridad, asignación por defecto
- `/configuracion/notificaciones` — opt-in/out por kind y canal
- `/configuracion/clientes` — campos custom, dedupe rules
- `/configuracion/dashboard` — KPIs por rol, periodo por defecto
- `/configuracion/facturacion` — series, certificado FNMT, modo Verifactu **(NUEVO)**

## Inconsistencias detectadas (servidores actions)
- ✅ Todos los `Schema.parse()` migrados a `parseOrFriendly` (commit `2fcc04a`).
- ✅ Todas las escrituras críticas migradas a admin client (commit `d3cdcea`).
- ✅ Tablas obsoletas droppeadas: `installation_steps_log`, `contract_clauses_used`, `contract_photos`, `proposal_payment_options` (migración `20260507100000`).
- ✅ Niveles 2 heredan equipo via `team_assignments` en TODOS los listX.
- ✅ Niveles 3 ven solo lo suyo en TODOS los listX.

## Oportunidades de mejora

### Performance
- **Falta paginación** en muchos `listX` (límite hardcoded 200). Implementar cursor-based pagination.
- **Falta caché** en `getFiscalSettings`, `listInvoiceSeries` (rara vez cambian).
- Materializar `customer_metrics` (LTV, churn, num contratos) en vez de calcular runtime.

### UX
- **Export CSV** en todas las páginas listX (leads, clientes, contratos, facturas).
- **Filtros guardados** por usuario.
- **Búsqueda global** (cmd+K) con resultados de todos los módulos.
- **Acciones en lote** ya existentes en leads/customers, falta en contratos.

### Seguridad
- **Cifrado certificado FNMT** en `company_settings.verifactu_cert_encrypted` (AES-256 con secret de Vercel).
- **Audit log** completo de cambios sensibles (precios, IBAN cliente, eliminar usuario).
- **2FA opcional** para company_admin.

### Datos
- **Backup BD** automático diario fuera de Supabase.
- **Soft-delete** consistente en TODAS las tablas críticas (algunas tienen `deleted_at`, otras no).
- **Histórico de precios** (snapshot al firmar contrato — los precios actuales pueden cambiar).

## Próximos pasos recomendados (orden de impacto)

1. **Verifactu**: completar PDF con QR + cron envío AEAT + UI `/configuracion/facturacion`.
2. **8 páginas `/configuracion/*`** críticas (mantenimiento bloquea wizard, etc.).
3. **Reference codes auto** en INSERT de las 4 tablas que faltan.
4. **Notificaciones faltantes** (8 puntos identificados).
5. **AquaAcademy** (módulo nuevo, alta retención equipo).
6. **Knowledge Base** (módulo nuevo, autosuficiencia técnicos).
7. **Mapa de calor** (impacto visual inmediato).
8. **AquaCoach** (recordatorios cliente, ingresos recurrentes).
