# Auditoría AGUA_CLAUDE2026 · 2026-05-03

## ✅ Capas implementadas en esta sesión

### Validaciones globales
- DNI/NIE/CIF live con letra esperada (TaxIdInput) en lead + cliente
- IBAN live con cálculo de DC esperado (IbanInput) en cuentas bancarias
- Dedupe live tax_id/email/teléfono cruzado entre TODOS los leads/customers de la empresa (admin client)
- Bloqueo server-side en createLead/createCustomer

### Geolocalización
- MapPicker (Leaflet + OSM, sin deps npm) con chincheta arrastrable
- Reverse geocoding Nominatim al usar GPS o arrastrar pin → autorelleno calle/CP/población/provincia
- Forward geocoding "Buscar por dirección"
- Aviso UX de PC vs móvil (GPS hardware vs IP/WiFi)

### Máquina de estados leads
- bumpLeadStatus(): solo sube, nunca baja
- logLeadContactAction(): llamar/wsp/email → contacted + agenda_event + timeline
- ConvertLeadButton + accept proposal → cliente + mueve direcciones
- Wizard 3 pasos crear lead (datos / origen+notas / dirección)
- "lost" → desaparece de /leads y aparece en /ventas-perdidas (backfill incluido)

### Wizard cliente
- 2 pasos: identidad+contacto / notas
- Direccion y banco se añaden en la ficha (con mapa)

### Contratos
- Migración: deposit_cents, clauses_snapshot jsonb, pending_fields text[], service_start_date
- contract_clause_templates por tipo (cash/rental/renting) + RPC seed_default_clauses
- service_start_date (instalado hoy, arranca otro día) + cron diario activa al llegar fecha
- Mantenimientos auto-anclados a service_start_date
- Quick-collect inline en pagos (botón "Cobrar" por fila)
- Filtros lista por estado + tipo
- Status actions limpiado: solo "Marcar firmado", el resto auto

### Propuestas
- ProposalsCard reutilizable en lead + customer (Enviar / Aceptar y convertir)
- markProposalAccepted refactor: lead → cliente + redirect + supersede otras
- listProposalsByCustomer + listProposalsByLead
- Filtros lista por estado

### PDF DashStack (estilo del ejemplo del usuario)
- shared/lib/pdf/dashstack.ts: header teal + watermark bubble + cards 2-party + tiles + callouts + section titles + tabla productos + bloque firmas + footer
- contract-pdf-generator usa snapshot de cláusulas (inmutable)
- proposal-pdf-generator con mismo estilo + watermark ACEPTADA/ENVIADA/BORRADOR
- CRUD cláusulas en /configuracion/contratos agrupado por tipo

### Notificaciones automáticas
- notifier.ts: notifyByRoles + 5 wrappers (lead/contract/installation/wallet/incident)
- Cron diario: leads caducados, instalaciones+mantenimientos mañana, stock bajo, contratos service_start_date llegada

### Stock
- Auto-decrement al completar instalación (outbound_install)
- Auto-decrement al completar mantenimiento con recambios (outbound_maintenance)
- Loading requests: transfer entre almacenes con stock movements

### Pruebas gratuitas
- Flujo completo: install (decrement outbound_trial) → reject → return (re-stock 'used' en main)

### Dashboard por nivel
- Nivel 1: ve todo + filtros dpto + comercial
- Nivel 2: ve su dpto + sus nivel 3 + filtro
- Nivel 3: solo lo suyo + global empresa
- KPI cabecera contextual (mi venta / equipo / empresa)
- ObjectivesCard individual + departamento con barras progreso
- RankingCard top 20 con highlight "(tú)"
- Card próximas instalaciones + mantenimientos (7 días)
- Card incidencias críticas abiertas (border destructive)

### Auditoría / búsqueda / UX
- /auditoria con filtros subject_type + kind (admin/directores)
- GlobalSearchTrigger header con ⌘K + dialog con autofocus + debounce 250ms
- Avatar header con dropdown (perfil + logout)
- Loading skeletons en /leads /clientes /contratos /instalaciones /dashboard
- Toast notifications globales (sonner)

### Recovery / Wallet
- LostSaleRowActions: asignar comercial recuperación + reabrir lead + marcar recuperada
- Quick-collect contracts → wallet pending_settlement/collected
- Validate/reject inline en /wallet

### Fichas
- Lead: contactos trackeables + propuestas card + direcciones + timeline + banner sin dirección + convert
- Cliente: contactos + propuestas + contratos + instalaciones + equipos + bancarios + timeline
- Contrato: items + payments con quick-collect + cláusulas + service_start_date visible
- Instalación: parte trabajo táctil + fotos + firmas + timeline + service_start_date al completar
- Mantenimiento: start + complete con recambios y stock decrement
- Incidencia: assign + resolve + links a installation/maintenance

### Filtros listas
- /leads: status + q
- /clientes: q
- /contratos: status + plan
- /propuestas: status
- /mantenimientos: status + período
- /agenda: usuario + tipo
- /ventas-perdidas: backfill auto

### Configuración
- Cláusulas contrato CRUD (cash/rental/renting + auto-seed)
- Empresa: contact_phone, contact_email, fiscal_address, postal_code, city, province → aparecen en PDFs
- Horario comercial + tolerancias geo/tiempo + color brand
- Usuarios: lista + invitar + editar roles inline + suspender/reactivar
- Productos / leads / pruebas-gratuitas / objetivos (ya existían)

### CSV exports
- 6 entidades: leads, customers, contracts, payments, installations, wallet
- Filename con fecha, formato Excel ES (BOM UTF-8, decimal coma)

### Onboarding (placeholder)
- Migración user_profiles.has_seen_onboarding (preparado para Driver.js futuro)

## 🔍 Auditoría — sin avisos en producción

- ✅ `npm run build` → "Compiled successfully" sin errores
- ✅ Sin tablas redundantes (snapshots jsonb vs tablas separadas para datos congelables)
- ✅ Notificaciones fail-soft (try/catch interno) — nunca tumban flujos
- ✅ RLS heredada en addresses, propuestas, contratos
- ✅ Sin botones duplicados (status-actions limpiado)
- ✅ Wizards en lugar de scroll largo (tablet-first)
- ✅ Loading skeletons en listas pesadas
- ⚠ Migraciones BD que aplicar manualmente en Supabase (3 nuevas):
  - 20260502120000_contract_service_start_date.sql
  - 20260502130000_contract_clauses.sql
  - 20260502140000_user_onboarding_flag.sql
  - 20260503120000_company_settings_contact.sql

## 💡 Mejoras propuestas (siguientes capas)

1. **Rutas IA optimización** (aparcado en memoria)
2. **Onboarding tour** Driver.js (aparcado)
3. **Email Resend integration** — pendiente API key
4. **WhatsApp Business API** (Phase 2)
5. **Realtime notifications** Supabase channels (vs polling 30s actual)
6. **Programa de puntos** ranking → recompensas
7. **App móvil nativa** PWA install + offline básico
8. **Firma electrónica avanzada** (DocuSign-like) si legal lo requiere
9. **Inventario por unidad** (serial número tracking individual) si crece
10. **Plantillas WhatsApp** templates pre-aprobados para campañas
11. **Cobranza automática SEPA** generación XML para domiciliaciones
12. **Histórico de precios** versioning de pricing_plans
13. **Multi-empresa real** dashboard superadmin para ver todas las empresas
14. **API pública** webhooks para integraciones externas

## 📐 Responsive / UX por rol

- **Tablet (técnicos/comerciales en campo)**: tap targets 56px, cards rounded-2xl, capture="environment" para fotos, GPS hardware
- **Móvil (comerciales esporádico)**: sidebar mobile colapsable con backdrop, search ⌘K también accesible vía botón
- **PC (admin/telemarketing)**: layout grid 4 cols, tabla densa, hover states, keyboard shortcuts

## 📊 Tablas BD totales

Sin explosión: aproximadamente 75 tablas (vs 200+ del CRM anterior). Patrón snapshots jsonb para datos congelables (customer_snapshot en contratos, clauses_snapshot, payload en events).

---

Generado automáticamente al completar la sesión. Próximo wakeup: 01:10 hora local.
