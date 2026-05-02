# Auditoría AGUA_CLAUDE2026 · 2026-05-03 (sesión nocturna autónoma)

## ✅ Capas implementadas en esta sesión nocturna

### Productividad técnico/comercial (tablet-first)
- **Página `/mi-dia`**: instalaciones + mantenimientos + agenda asignados al usuario hoy en una sola pantalla, con hora prominente, status badge y botón directo a Google Maps si hay geo.
- **BottomNav móvil** (5 botones grandes: Inicio / Mi día / Instal. / Leads / Avisos) con badge dinámico de avisos no leídos.
- **Padding responsive** del main: `p-3` móvil → `p-8` desktop.

### CRM operativo (admin/director)
- **Filtro "Mi cartera" vs "Todos"** en `/leads` y `/clientes` (toggle visual con tabs). Nivel 3 forzado a su cartera.
- **Bulk reassign leads**: tabla con checkboxes + toolbar sticky para reasignar/desasignar lote.
- **Reasignar lead individual** desde la ficha (botón en panel "Estado").
- **Importar leads desde CSV** con preview, dedupe automático (phone/email/tax_id) y reporte detallado de filas insertadas/duplicadas/erroneas.
- **Editor de cláusulas inline** en ficha contrato (override por contrato sin tocar templates globales): añadir, eliminar, reordenar.
- **Plantillas de mensaje** WhatsApp/Email en ficha lead/cliente (6 plantillas con variables: nombre/empresa/comercial/ref/fecha; copy + abrir WhatsApp + abrir email).

### Filtros y vistas
- **/wallet** filtros: método + estado + rango fechas.
- **/notificaciones** filtros: tabs "Todas" / "Sin leer (N)" + botón marcar leída individual.
- **/instalaciones** filtros: instalador + estado.
- **/productos** filtros: tipo + categoría + buscar nombre/ref + solo activos.
- **/contratos** filtros: estado + plan.
- **/propuestas** filtros: estado.
- **/mantenimientos** filtros: estado + período (próximas/este mes/anteriores).
- **/agenda** filtros: usuario + tipo.

### Refinos UX
- **Cabeceras** muestran "Asignado a {comercial}" en ficha lead y cliente.
- **Avatar dropdown** en header con perfil + logout.
- **Búsqueda global ⌘K** en leads/customers/contracts/proposals/installations.
- **Loading skeletons** en /leads /clientes /contratos /instalaciones /dashboard.

### PDF mejorado
- Tabla **Plan de pagos** del contrato muestra ahora 4 columnas: concepto / momento / método / importe (antes duplicaba importe).

### Calidad
- **Build production = 0 warnings 0 errors** (limpiados type imports + vars no usadas).

## 🔍 Auditoría — sin avisos visibles en producción

| Verificación | Estado |
|---|---|
| `npm run build` Compiled successfully | ✅ |
| Warnings ESLint en build | ✅ 0 |
| RLS en todas las tablas tenant | ✅ heredada |
| Migraciones nuevas pendientes de aplicar en Supabase | ⚠ ver lista abajo |
| Tablas duplicadas / explosión esquema | ✅ ~75 tablas (vs >200 anterior) |
| Componentes con scroll largo en formularios | ✅ wizards en lead/cliente |
| Console.log en producción | ✅ ninguno |
| Botones que duplican acción | ✅ limpiados (status-actions) |

### Migraciones SQL a aplicar manualmente en Supabase

Ejecutar en orden (panel SQL Editor):
1. `20260502120000_contract_service_start_date.sql`
2. `20260502130000_contract_clauses.sql`
3. `20260502140000_user_onboarding_flag.sql`
4. `20260503120000_company_settings_contact.sql`

Tras aplicarlas, ejecutar para sembrar cláusulas por defecto (una vez por empresa):
```sql
select app.seed_default_clauses('<company_id>');
```
(O directamente al entrar admin a `/configuracion/contratos` se hace solo).

## 💡 Propuestas de mejora futuras

### Aparcadas confirmadas
- ✅ **Onboarding tour** (Driver.js, anotado en memoria)
- ✅ **Rutas IA optimización** mantenimientos/visitas (anotado en memoria)
- ✅ **PDF contrato definitivo** (placeholder DashStack actual, se sustituirá cuando llegue plantilla legal)

### Nuevas propuestas
1. **Programa de puntos / comisiones** vinculado al ranking del dashboard
2. **Email transaccional** vía Resend (envío automático: propuesta enviada, instalación confirmada, agradecimiento)
3. **WhatsApp Business API** templates pre-aprobados (más allá de mailto/wa.me actuales)
4. **Realtime Supabase channels** sustituyendo polling 30s en notif bell
5. **PWA install** + offline básico (técnicos en zonas con poca cobertura)
6. **App móvil nativa** Capacitor wrapper sobre la PWA
7. **Cobranza automática SEPA** generación XML para domiciliaciones masivas
8. **Histórico precios** versioning de pricing_plans (auditar cambios)
9. **Multi-empresa real** dashboard superadmin para ver todas las empresas
10. **API pública** webhooks para integraciones externas (Zapier, Make, etc.)
11. **Tabla auditoría completa** (audit_log con before/after) — actualmente solo events polimórfico
12. **Búsqueda global con resultados completos** (página /buscar?q= con paginación)
13. **Importar customers + contracts** (no solo leads)
14. **Plantillas mensaje editables** por admin desde /configuracion/plantillas
15. **Bulk reassign customers** (mismo patrón que leads)
16. **Recurring tasks** (mantenimientos preventivos auto-programados que no requieran contrato)
17. **Soporte multi-idioma** (i18n catalán/euskera/gallego para empresas regionales) — opcional
18. **2FA superadmin** (TOTP) — opcional
19. **Logs descargables admin** (auditoría 90 días en CSV)
20. **Stripe billing** SaaS subscription para cobrar a empresas que usan el CRM

## 📐 Responsive / UX por rol (verificado)

- **Tablet (técnicos/comerciales en campo)**: tap targets 56px, cards rounded-2xl, capture="environment", GPS hardware. BottomNav permanente.
- **Móvil**: BottomNav + sidebar mobile con backdrop. Padding compactado.
- **PC (admin/telemarketing)**: layout grid 4 cols, tabla densa, hover states, ⌘K shortcut, BottomNav oculto.

## 📊 Tablas BD totales

~75 tablas (sin explosión). Patrón de snapshots jsonb para datos congelables (customer_snapshot, clauses_snapshot, payload en events). 1 tabla nueva añadida en sesión completa (contract_clause_templates), todo lo demás reutilizando schema existente.

## 🧠 Memoria persistente verificada

- `MEMORY.md` actualizada con índice
- `project_aparcado.md` incluye onboarding + rutas IA
- `feedback_ux_forms.md` patrón wizard tablet-first
- `feedback_build.md` regla build verde antes de commit

---

Sesión nocturna autónoma completada. Build verde, 16 commits desplegados, 0 warnings, todas las migraciones documentadas. Mario puede revisar al despertar.
