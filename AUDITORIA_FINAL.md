# Auditoría AGUA_CLAUDE2026 · final

## Estado: 100% capas operativas cerradas

Build: ✅ Compiled successfully · 0 warnings · 0 errors

## SQLs a aplicar en Supabase (orden)

```
1. 20260502120000_contract_service_start_date.sql
2. 20260502130000_contract_clauses.sql            ← si falló, ejecutar el 6 abajo
3. 20260502140000_user_onboarding_flag.sql
4. 20260503120000_company_settings_contact.sql
5. 20260503130000_message_templates.sql
6. 20260503140000_fix_contract_clauses.sql        ← FIX para el error plan_type
7. 20260503150000_contract_assigned_user.sql
```

Si ejecutaste el #2 y dio error "column plan_type does not exist", ejecuta el #6 — es idempotente y deja la tabla correcta.

## UI DashStack aplicada (capturas Figma)

- ✅ Sidebar blanco con texto oscuro, item activo azul (`--sidebar` rediseñado)
- ✅ KPI cards con icono circular `rounded-full` h-14 w-14
- ✅ Header con avatar redondo + nombre + rol + chevron (estilo "Moni Roy / Admin")
- ✅ StatusPill component (paleta DashStack pastel) en TODAS las listas:
  - /leads · /contratos · /propuestas · /instalaciones · /mantenimientos · /wallet · /incidencias
- ✅ Calendar agenda con paleta pastel DashStack (lila, verde, naranja, etc.)

## Capas operativas 100% cerradas en sesiones recientes

### Estructura/admin
- `/superadmin` con métricas cross-tenant + filtros status
- `/superadmin/catalogo` global (categorías + atributos + modelos externos)
- `/configuracion/modulos` toggle on/off por empresa
- `/configuracion/agenda` (horarios + tolerancias + tipos)
- `/configuracion/almacenes` redirect a /almacenes
- `/configuracion/plantillas` CRUD plantillas WhatsApp/Email editables
- `/configuracion/usuarios` con avatares + edit roles + suspender/reactivar
- `/configuracion/contratos` cláusulas por tipo (cash/rental/renting)

### Operativa
- /leads bulk reassign + import CSV + filtros mi cartera + reassign individual
- /clientes bulk reassign + import CSV + filtro mi cartera + cards completas
- /contratos filtros + reassign comercial + clausulas snapshot inline + notas inline + quick collect pagos
- /propuestas filtros + accept→cliente
- /instalaciones calendario por día + filtros instalador/estado + reasignar instalador
- /mantenimientos ficha completa + recambios + filtros estado/período
- /pruebas-gratuitas flujo completo install/reject/return restock
- /agenda drag-drop escritorio + botón móvil + tabs calendario/listado + filtros
- /almacenes stock summary + loading requests
- /wallet filtros completos + quick collect inline
- /incidencias ficha + assign/resolve
- /productos wizard 2 pasos + filtros completos
- /ventas-perdidas recovery flow (asignar/reabrir/marcar)
- /ventas achievement vs objetivos + ranking
- /mi-dia técnicos/comerciales tablet
- /buscar paginada + ⌘K rápido
- /auditoria global con filtros
- /notificaciones filtros + marcar leída individual

### Cross-cutting
- Validaciones live DNI/NIE/CIF (TaxIdInput) + IBAN (IbanInput) + dedupe
- Geolocalización con mapa Leaflet + reverse geocoding
- PDF DashStack contrato + propuesta con watermark estado
- Cron diario: leads caducados + reminders + activación service_start_date + stock bajo
- Notificaciones automáticas (5 wrappers)
- Stock auto-decrement en instalación y mantenimiento
- Auto-mantenimientos al activar contrato
- CSV exports (6 entidades)
- Wizards multi-paso (lead, cliente, producto)
- Bottom nav móvil + avatar dropdown + búsqueda ⌘K
- Loading skeletons

## Pendiente (necesita decisión externa o API)

- Email transaccional Resend (necesita API key)
- WhatsApp Business API (necesita aprobación Meta)
- Stripe billing SaaS (necesita cuenta)
- Cobranza SEPA XML (formato bancario específico)
- PWA install + offline (mejora opcional)
- 2FA superadmin (TOTP)

## Aparcado en memoria

- Onboarding tour Driver.js
- Rutas IA optimización mantenimientos/visitas
- PDF contrato definitivo (esperando plantilla legal real del cliente)

---

Listo para probar. Aplica las migraciones SQL pendientes en Supabase y todo el resto está desplegado en Vercel.
