# MODULES_MEMORY.md — AGUACLAUDE2026

> **Catálogo de módulos del CRM.** Estado, ruta, dependencias, flujos y notas de configuración. Actualizar al iniciar/terminar cada módulo.

---

## Resumen

| # | Módulo | Estado | Ruta | Ruta config | Depende de | Capa |
|---|---|---|---|---|---|---|
| 0 | Notificaciones (campana) | ⏳ Planeado | `/` (header) | `/configuracion/notificaciones` | Auth, módulos varios | 17 |
| 1 | Dashboard | 🅿️ Aparcado (estructura) | `/dashboard` | – | Casi todo | 19 |
| 2 | Agenda | ⏳ Planeado | `/agenda` | `/configuracion/agenda` | Auth, usuarios | 16 |
| 3 | Leads | ⏳ Planeado | `/leads` | `/configuracion/leads` | Auth, usuarios | 8 |
| 4 | Clientes | ⏳ Planeado | `/clientes` | `/configuracion/clientes` | Leads | 9 |
| 5 | Propuestas | ⏳ Planeado | `/propuestas` | – | Clientes, Productos | 10 |
| 6 | Contratos | ⏳ Planeado | `/contratos` | `/configuracion/contratos` | Propuestas | 11 |
| 7 | Pruebas gratuitas | ⏳ Planeado | `/pruebas-gratuitas` | `/configuracion/pruebas-gratuitas` | Clientes/Leads, Productos | 11 |
| 8 | Ventas perdidas | ⏳ Planeado | `/ventas-perdidas` | – | Leads, Pruebas gratuitas | 11 |
| 9 | Productos | ⏳ Planeado | `/productos` | `/configuracion/productos` | Auth | 7 |
| 10 | Almacenes / furgonetas / carga | ⏳ Planeado | `/almacenes` | `/configuracion/almacenes` | Productos | 12 |
| 11 | Instalaciones | ⏳ Planeado | `/instalaciones` | – | Contratos, Almacenes | 13 |
| 12 | Mantenimientos | ⏳ Planeado | `/mantenimientos` | – | Instalaciones | 14 |
| 13 | Incidencias | ⏳ Planeado | `/incidencias` | – | Múltiples | 15 |
| 14 | Ventas + Objetivos mensuales | ⏳ Planeado | `/ventas` | `/configuracion/objetivos` | Contratos | 18 |
| 15 | Wallet | ⏳ Planeado | `/wallet` | – | Contratos, Instalaciones | 11 |
| 16 | Programa de puntos | 🅿️ Aparcado (BD prep) | `/puntos` | `/configuracion/puntos` | Ventas | – |
| 17 | Fichajes | 🅿️ Aparcado (BD prep) | `/fichajes` | `/configuracion/fichajes` | Usuarios | – |
| 18 | Calculadora ahorro | 🅿️ Aparcado (BD prep) | `/calculadora-ahorro` | `/configuracion/calculadora-ahorro` | Productos | – |
| 19 | Albaranes y facturas | 🅿️ Aparcado (BD prep) | `/facturacion` | `/configuracion/facturacion` | Contratos, Ventas | – |
| – | Configuración | ⏳ Planeado | `/configuracion` | – | Solo admin | 6 |
| – | Superadmin | ⏳ Planeado | `/superadmin/*` | – | Auth | 4 |

Estados: ⏳ planeado · 🚧 en curso · ✅ listo · 🅿️ aparcado · 🔒 bloqueado

---

## Detalle por módulo

> Cada módulo se rellenará al diseñarlo. Ahora solo notas críticas heredadas del prompt maestro.

### 0 — Notificaciones (campana)
- Tipos: incidencias, tareas próximas, instalaciones próximas, cargas pendientes, stock bajo, leads caducados, pagos pendientes, validaciones, contratos pendientes de datos, aprobaciones precio.
- Realtime via Supabase Realtime channel por `user_id`.
- Push web fase posterior, no bloquea arquitectura.

### 1 — Dashboard
- Aparcado pero estructura debe existir.
- KPIs: ventas, contratos, total facturado/vendido, ranking puntos, KPIs por usuario/dpto/mes/año.

### 2 — Agenda
- Filtros: día/semana/mes, usuario, departamento (según permisos), tipo.
- Eventos integrados desde otros módulos.
- Aviso si tarea fuera de horario comercial (admin configura horario).
- Vista visual con columna por miembro del equipo.

### 3 — Leads
- Lead = empresa o particular (campos distintos).
- Direcciones múltiples por lead.
- Estados: nuevo → contactado → propuesta creada → propuesta enviada → prueba gratuita propuesta → convertido a cliente | venta perdida | caducado.
- Caducidad: si supera N días sin acción (configurable), pasa a no asignado y nivel 2 puede reasignar.
- Origen TMK marca la comisión para reparto posterior.

### 4 — Clientes
- Conversión desde lead, directa, desde venta directa, desde prueba gratuita aceptada.
- 3 tabs creación: datos cliente / direcciones (con geo) / datos bancarios.
- Timeline completo en ficha.
- Para instalar: contrato firmado obligatorio salvo reubicación o prueba gratuita.

### 5 — Propuestas
- Asociadas a cliente o lead convertido.
- Multi-condición (contado, renting, alquiler) en una misma propuesta.
- PDF con portada, página comercial, ficha técnica y condiciones.
- Acciones: crear, editar, enviar email/WhatsApp, marcar aceptada (genera contrato/cliente).

### 6 — Contratos
- Absorbe datos de cliente + propuesta + productos + forma de pago + mantenimientos.
- Datos provisionales permitidos (DNI/CIF/IBAN genéricos) → estado "pendiente de datos".
- Validaciones: DNI con letra, CIF, IBAN con dígitos control.
- Flujo de 15 pasos (revisar prompt maestro completo).
- Cláusulas + variables autorellenables configurables en `/configuracion/contratos`.

### 7 — Pruebas gratuitas
- Stock descontado como "en prueba".
- Aceptación → conversión a cliente/contrato sin reinstalar (salvo necesidad).
- Rechazo → desinstalar + producto vuelve a stock como `used` + venta perdida.

### 8 — Ventas perdidas
- Origen: leads no convertidos, pruebas rechazadas/desinstaladas.
- Solo TMK puede recuperar (no comerciales) — confirmar duda #11.

### 9 — Productos
- Categorías y atributos: globales (superadmin) precargables + propios de empresa.
- Atributos: toggle por producto, hasta 5 destacados con icono.
- Dimensiones obligatorias → generan dibujo 3D dimensional para ficha técnica.
- Tabs: básicos / precios / stock / atributos / imágenes / recambios / documentos.
- Precios: contado, renting (con coeficiente financiera), alquiler. Mínimos por nivel.

### 10 — Almacenes / furgonetas / carga
- Tipos: almacén principal, secundario, furgoneta.
- Ubicaciones internas tipo `4A2`.
- Carga sugerida (mañana, semana, manual).
- Solicitud → preparación → confirmación. Movimiento entre almacenes.

### 11 — Instalaciones
- Nunca libre salvo reubicación.
- Parte de trabajo táctil con geo, cronómetro, daños previos, encimera, fotos obligatorias, firma cliente, cobros pendientes.
- Pausa multi-día permitida.
- Incidencia genera reasignación; si cambia modelo → nuevo contrato/anexo.
- PDF parte enviado al cliente.

### 12 — Mantenimientos
- Derivados de contratos.
- Recambios sustituidos en parte → solo esos descuentan stock.
- Mantenimientos de equipos no nuestros si recambios compatibles (confirmar duda #13).

### 13 — Incidencias
- Orígenes múltiples: instalación fuera plazo, instalador, avería, geo fuera rango, cambio modelo, falta stock.
- Asignación, prioridad, agenda, carga recambio.

### 14 — Ventas + Objetivos mensuales
- Acumula por contratos y equipos (10 contratos × 2 equipos = 20 ventas).
- Cálculo: contado, alquiler total, renting (lo que paga la financiera).
- Por usuario / departamento / mes / año.
- **Objetivos mensuales (decisión D):** cascada en 2 niveles
  - Nivel 1 (`company_admin`) define objetivo mensual por departamento (tech/sales/tmk).
  - Nivel 2 (director del dpto) distribuye ese objetivo entre los nivel 3 a su mando.
  - Tabla `monthly_objectives (id, company_id, period_year, period_month, scope_type [department|user], scope_ref [department_kind|user_id], parent_objective_id, target_amount_cents, target_units, set_by_user_id, created_at)`.
  - Dashboard muestra cumplimiento % en tiempo real.

### 15 — Wallet
- Cobros nivel 3 → liquidación con nivel 1/2.
- Formas: efectivo, tarjeta, bizum, transferencia.
- Estados: pendiente, cobrado, pendiente liquidar, liquidado, validado, rechazado.
- Objetivo: cada nivel 3 a 0 tras liquidar.

### 16 — Programa de puntos (aparcado)
- Configuración por producto/tipo de venta + reparto TMK.
- BD prevista, no UI todavía.

### 17 — Fichajes (aparcado)
- BD mínima prevista.

### 18 — Calculadora ahorro (aparcado)
- BD prevista. Configuración en `/configuracion/calculadora-ahorro`.
- ⚠️ **TODO al llegar a este módulo:** revisar `legacy_reference/water_crm/WATER_CRM_PERFECTO-main/` (buscar componentes con "ahorro" / "saving" / "calculator") para comparar lógica del ZIP con prompt maestro. Owner pidió expresamente que se preguntara antes de implementar. Plugin para integrar en web cliente queda para fase final junto al plugin WordPress.

### 19 — Albaranes y facturas (aparcado)
- Normativa española (Verifactu / TicketBAI según comunidad — duda #5).
- Numeración por empresa, series, IVA, datos fiscales.

### Recordar al 100% (Fase 2 después del prompt maestro)
- **Chat interno entre usuarios** (decisión A) — owner quiere añadir cuando todo lo demás funcione.
- **Campañas de email masivas** (decisión B).
- **Notas de voz adjuntas a eventos** (decisión G) — quizás dentro del módulo de comunicaciones.
- **Plugin WordPress + plugin calculadora de ahorro embebida** (decisión I) — para que las empresas integren en sus webs.

### Configuración
- Replica del sidebar pero con vistas de configuración por módulo.
- Solo admin.

### Superadmin
- Crear/editar empresas, módulos activos, usuarios máx., almacenamiento máx., coste mensual, reset contraseñas, catálogo global productos.

---

## Eventos timeline esperados (catálogo provisional)

> Diseñar en Capa 2 según resolución de duda #8.

- `lead.created`, `lead.contacted`, `lead.status_changed`, `lead.assigned`, `lead.expired`
- `customer.created`, `customer.updated`, `customer.bank_data_added`
- `proposal.created`, `proposal.sent`, `proposal.accepted`, `proposal.rejected`
- `contract.created`, `contract.signed`, `contract.amended`
- `installation.scheduled`, `installation.started`, `installation.paused`, `installation.completed`, `installation.incident_created`
- `maintenance.scheduled`, `maintenance.completed`
- `incident.created`, `incident.resolved`
- `wallet.payment_recorded`, `wallet.settlement_validated`
- `email.sent`, `whatsapp.sent`, `call.logged`

---

## Notificaciones generadas (catálogo provisional)

| Origen | Notificación | Destinatario |
|---|---|---|
| Stock bajo | "Stock de X bajo mínimo" | Director técnico, admin |
| Lead próximo a caducar | "Lead Y caduca en 24h" | Comercial asignado |
| Instalación próxima | "Instalación mañana 10h" | Instalador |
| Carga pendiente | "Furgoneta X pendiente de carga" | Director técnico, almacén |
| Pago pendiente | "Cliente Z con pago de 150€ pendiente" | Admin |
| Aprobación precio | "Comercial X pide aprobación 1200€ < mínimo 1300€" | Director comercial |
| Incidencia creada | "Nueva incidencia en instalación X" | Director técnico |
| Contrato pendiente datos | "Contrato Y con DNI provisional" | Admin |
