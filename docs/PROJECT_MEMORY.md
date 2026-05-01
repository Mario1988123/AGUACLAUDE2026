# PROJECT_MEMORY.md — AGUACLAUDE2026

> **Memoria viva del proyecto.** Este archivo es la fuente de verdad para retomar contexto entre conversaciones. Actualizarlo al cerrar cada capa o decisión importante. Si lees esto en una conversación nueva, **léelo entero antes de proponer cambios**.

---

## 1. Identidad

- **Nombre:** AGUACLAUDE2026
- **Tipo:** SaaS multi-tenant
- **Sector:** Empresas de venta, instalación y mantenimiento de equipos de tratamiento de agua (osmosis, descalcificadores, dispensadores, ozonos, recambios)
- **Owner:** Mario Ortigueira (mario.ortigueira@gmail.com / mario.ortigueira@osmofilter.com)
- **Repositorio:** https://github.com/Mario1988123/AGUACLAUDE2026 (privado)
- **Rama única:** `main`
- **Inicio:** 2026-05-01

## 2. Infraestructura

| Servicio | Detalle |
|---|---|
| **GitHub** | `Mario1988123/AGUACLAUDE2026` (privado, owner Mario1988123) |
| **Supabase project** | `AGUACLAUDE2026` ref `pkgvzwunazzkstlfubnq` |
| **Supabase org** | `OSMOFILTER SL` (`fdiiojofnizczijbyawi`) |
| **Supabase región** | `eu-west-3` (París) — mejor latencia desde España |
| **Supabase plan** | Free (límite 2 proyectos por user owner — 1 hueco usado) |
| **Vercel** | Pendiente de `vercel link` con este repo |
| **Dominio producción** | Pendiente |

> Credenciales: en `.env.local` (gitignored). Token de management se rotará al cerrar el setup.

## 3. Stack confirmado

> Propuesto por Claude el 2026-05-01. **Pendiente de confirmación final del owner antes de Capa 3.**

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 App Router + React 19 + TypeScript estricto |
| UI | Tailwind CSS 4 + shadcn/ui |
| Estado servidor | TanStack Query |
| Formularios | react-hook-form + zod |
| BD | Supabase Postgres + RLS obligatoria |
| Auth | Supabase Auth + JWT custom claims (rol + company_id) |
| Storage | Supabase Storage, bucket único con prefijos `/{company_id}/` |
| Realtime | Supabase Realtime (campana, agenda) |
| PWA | Serwist (service worker + manifest) |
| Push | Web Push API + Supabase Edge Functions (fase posterior) |
| PDF | `@react-pdf/renderer` cliente (propuestas, partes simples) + Edge Function con `pdf-lib` (contratos legales) |
| Mapa | Leaflet + OpenStreetMap |
| Email | Resend (fase posterior) |
| WhatsApp | Fase 1: deeplink `wa.me`. Fase 2: WhatsApp Business API |
| Tests | Vitest unit + Playwright e2e (solo críticos) |
| CI | GitHub Actions: typecheck + lint + build + tests |
| Hosting | Vercel + GitHub Actions preview |

## 4. Decisiones arquitectónicas tomadas

| Fecha | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| 2026-05-01 | Single repo Next.js, sin monorepo | Monorepo con Turbo | Alcance no lo justifica; simplifica deploys |
| 2026-05-01 | Bucket Storage único con prefijos `/{company_id}/` | Bucket por empresa | Más fácil RLS, menor coste de gestión |
| 2026-05-01 | App Router (Next.js 15) | Pages Router | RSC reduce JS en cliente, alineado a futuro |
| 2026-05-01 | shadcn/ui (componentes copiados, no dep) | Mantine, Chakra | Sin lock-in, fácil customización táctil |
| 2026-05-01 | Supabase región `eu-west-3` (París) | `eu-central-1` (Frankfurt) | Latencia menor desde España peninsular |
| 2026-05-01 | **Online-only** (sin offline-first) | PWA con IndexedDB + cola sync | Owner confirma red siempre disponible. Ahorra ~30% del esfuerzo. |
| 2026-05-01 | **Propuestas inmutables al editar** | Mutable in place | Al editar, anterior → `superseded`, nueva → `active`. Trazabilidad por `parent_proposal_id`. |
| 2026-05-01 | **Solo español, sin i18n** | next-intl | Reduce complejidad. Si crece a LATAM/PT, se mete después. |
| 2026-05-01 | **Timeline = tabla única `events`** | Tabla por subject (`timeline_lead`, etc.) | Una sola query por ficha; auditoría y notificaciones desde mismo stream. Mitigamos sin-FK con índice + check enum. Patrón Hubspot/Pipedrive. |
| 2026-05-01 | **Roles fijos predefinidos (8)** | Builder de roles a la carta | Owner pide simplicidad. Roles: superadmin, company_admin, technical_director, commercial_director, telemarketing_director, installer, sales_rep, telemarketer. |
| 2026-05-01 | **`free_trials` entidad independiente** | Variante de `contracts` | No es contrato; es albarán de entrega con condiciones de prueba. Aceptación → genera `contract` nuevo. |
| 2026-05-01 | **Facturación = última capa, régimen común** | TicketBAI desde inicio | Empresa no en País Vasco. BD se diseña al final. |

## 5. Reglas de negocio invariantes

- Una **instalación** nunca es libre, salvo de tipo `reubicación`.
- Toda instalación normal exige: lead → cliente → propuesta aceptada o venta directa → **contrato firmado** → instalación.
- También puede venir de prueba gratuita.
- El stock para una instalación se descuenta **siempre de furgoneta**, nunca de almacén principal directamente.
- Antes de instalar debe haberse hecho **carga a furgoneta**.
- El instalador puede iniciar el parte ±1h respecto a la hora agendada; fuera de margen genera **incidencia**.
- Si el instalador inicia parte a más de 300 m de la dirección registrada, genera **incidencia**.
- Los datos de una empresa **nunca** pueden mezclarse con otra empresa (RLS estricta).
- Toda tabla de tenant lleva `company_id` salvo tablas explícitamente globales (catálogo del superadmin).
- **Nivel 3 nunca modifica precios bajo mínimo**; requiere aprobación de nivel 2 o 1.

## 6. Modelo de permisos (resumen)

Tres dimensiones: `module × action × scope`, con overrides por **campo sensible**.

- **Modules**: `leads`, `customers`, `proposals`, `contracts`, `installations`, `maintenance`, `incidents`, `products`, `warehouses`, `agenda`, `wallet`, `sales`, `dashboard`, `notifications`, `settings`, ... (lista cerrada)
- **Actions**: `view`, `create`, `update`, `delete`, `approve`, `assign`, `export`
- **Scopes**: `all_company` | `department` | `assigned_team` | `own`
- **Field restrictions**: ej. `cost`, `margin`, `iban`, `price_min` — algunos roles no los ven

**Roles base (semilla):**
- `superadmin` — global
- `company_admin` — `all_company` en todo
- `technical_director` — `department=tech`
- `commercial_director` — `department=sales`
- `telemarketing_director` — `department=tmk`
- `installer` — `own` (instalaciones asignadas), sin precios
- `sales_rep` — `own` + leads asignados
- `telemarketer` — `own` (leads creados por sí)

**Implementación prevista:** custom JWT claims al login con `{company_id, role_keys[], scope_overrides}` para que las RLS no necesiten joins extra.

## 7. Estado de avance por capa

| Capa | Estado | Notas |
|---|---|---|
| 0 — Análisis | ✅ Hecho (2026-05-01) | Documentado aquí + 4 archivos memoria |
| 1 — Arquitectura permisos + multi-tenancy | 🚧 En curso (2026-05-01) | Diseñado modelo; esperando respuestas a dudas Capa 1 (§ 11) |
| 2 — Modelo de datos | ⏳ Pendiente | |
| 3 — Scaffold Next.js | ⏳ Pendiente | |
| 4 — Superadmin | ⏳ Pendiente | |
| 5 — Tenant base | ⏳ Pendiente | |
| 6 — Configuración por módulo | ⏳ Pendiente | |
| 7 — Productos | ⏳ Pendiente | |
| 8 — Leads | ⏳ Pendiente | |
| 9 — Clientes | ⏳ Pendiente | |
| 10 — Propuestas | ⏳ Pendiente | |
| 11 — Contratos + Wallet | ⏳ Pendiente | |
| 12 — Almacenes + carga | ⏳ Pendiente | |
| 13 — Instalaciones | ⏳ Pendiente | |
| 14 — Mantenimientos | ⏳ Pendiente | |
| 15 — Incidencias | ⏳ Pendiente | |
| 16 — Agenda integrada | ⏳ Pendiente | |
| 17 — Notificaciones + Realtime | ⏳ Pendiente | |
| 18 — Ventas + KPIs | ⏳ Pendiente | |
| 19 — Dashboard | ⏳ Pendiente | |
| Aparcado | Puntos, Fichajes, Calculadora ahorro, Albaranes/Facturas | Solo BD prevista |

## 8. Dudas abiertas (críticas para BD)

> Numeradas para que se puedan responder en orden. **Las marcadas 🔴 bloquean la Capa 1/2.**

| # | Pregunta | Estado | Bloquea |
|---|---|---|---|
| 1 | Offline-first sí o no | ✅ NO. Online-only | – |
| 2 | Versionado de propuestas/contratos al editar | ✅ Inmutable. Editar = nueva versión, anterior `superseded` | – |
| 3 | Datos bancarios cifrados en BD (pgcrypto) y visibilidad por rol | Abierta | Capa 2 |
| 4 | Firma cliente: PNG+timestamp suficiente o eIDAS | Abierta | Capa 2 |
| 5 | Numeración fiscal: TicketBAI vs Verifactu | ✅ Régimen común (Verifactu si aplica). Última capa | – |
| 6 | Multi-país futuro (España solo o LATAM/PT) | ✅ Solo España (relacionada con #7) | – |
| 7 | i18n desde el inicio o solo español | ✅ Solo español, sin i18n | – |
| 8 | Polimorfismo timeline: tabla única `events` vs tabla por subject | ✅ Tabla única `events` | – |
| 9 | 🔴 Multi-empresa por usuario (franquicias) sí o no | Abierta | Capa 1 |
| 10 | Comisiones TMK: % global o por contrato | Abierta | Capa 11 |
| 11 | Permisos: roles fijos o admin define roles a la carta | ✅ Roles fijos predefinidos (8) | – |
| 12 | Furgoneta: 1 instalador fijo o compartida | Abierta | Capa 12 |
| 13 | Mantenimientos a equipos de competencia (recambios compatibles) confirmar | Abierta | Capa 14 |
| 14 | Reubicación: cliente registrado obligatorio o cliente puntual | Abierta | Capa 13 |
| 15 | Renting: catálogo financieras global o por empresa | Abierta | Capa 7 |
| 16 | Categorías globales: empresa puede modificar o solo activar/desactivar | Abierta | Capa 7 |
| 17 | Pruebas gratuitas: contrato en pruebas o entidad separada | ✅ Entidad independiente `free_trials` | – |
| 18 | Storage: bucket único con prefijos vs bucket por empresa | ✅ Único + prefijos | – |
| 19 | Soft-delete (`deleted_at`) en todas las tablas o algunas físico | Abierta | Capa 2 |
| 20 | Auditoría: log de "quién vio" datos sensibles o solo "quién modificó" | Abierta | Capa 2 |
| **21** | 🔴 **NUEVAS dudas de Capa 1 — ver § 11 abajo** | | |

## 9. Cosas pendientes inmediatas

- Responder dudas Capa 1 (§ 11) para cerrar matriz de permisos.
- Vercel `link` al repo y inyectar env vars de Supabase (cuando empiece Capa 3).

## 10. Cosas que NO debemos hacer

- ❌ Copiar código del ZIP de referencia (solo UX/visual).
- ❌ Crear tablas duplicadas para cada módulo (ej. `lead_addresses` + `customer_addresses` — usar `addresses` única).
- ❌ Mezclar datos entre empresas tenant.
- ❌ Dejar tablas sensibles sin RLS.
- ❌ Permitir que nivel 3 modifique precios bajo mínimo sin aprobación.
- ❌ Generar instalación libre que no sea reubicación.
- ❌ Commitear `.env.local` o cualquier secreto.
- ❌ Avanzar de capa sin actualizar este archivo.

---

## 11. Dudas abiertas Capa 1 (multi-tenancy + permisos)

Surgidas al diseñar la matriz de permisos y la arquitectura tenant. **Bloquean cierre de Capa 1.**

| # | Pregunta | Mi recomendación |
|---|---|---|
| 1.1 | **Multi-empresa por usuario.** ¿Un mismo email puede pertenecer a varias empresas tenant (caso franquicias o consultoras)? Si sí, el JWT necesita un `active_company_id` que se cambia con un selector. | NO en MVP. Email = 1 empresa. Más simple. |
| 1.2 | **Departamentos.** ¿Un nivel 3 puede pertenecer a más de un departamento (ej. comercial que también hace TMK)? ¿Un director puede dirigir más de un departamento? | NO. Un usuario = un rol = un departamento. |
| 1.3 | **Director comercial vs leads asignados a comercial.** Cuando el comercial mueve un lead a "convertido a cliente", ¿el director comercial sigue viendo el cliente como "suyo" (y los datos comerciales asociados) o ya pasa al `all_company`? | El director comercial **sí ve** todos los clientes generados por sus comerciales (alcance `department=sales`). |
| 1.4 | **Director TMK y leads ya entregados.** Cuando TMK crea un lead y lo asigna a un comercial, ¿el director TMK sigue viéndolo después o solo lo ven el comercial y el director comercial? | Director TMK **sí ve** el lead (y su evolución) pero solo lectura — no edita. |
| 1.5 | **Aprobaciones de precio.** Si un comercial pide aprobar precio < mínimo, ¿basta con cualquier nivel 2 (commercial_director) o también puede aprobar el `company_admin` directamente? ¿Y si no hay director, sube automático a admin? | Cualquier nivel 2 del departamento O el admin pueden aprobar. Si no hay director, sube a admin. |
| 1.6 | **Precios visibles a comerciales.** ¿`sales_rep` ve `price_min`? ¿O solo PVP y mínimo autorizado para él (oculto el "mínimo absoluto" que requiere aprobación nivel 1)? | Ve PVP + "mínimo sin aprobación". El "mínimo absoluto" lo ven solo nivel 1 y 2. |
| 1.7 | **Instalador y datos cliente.** ¿El instalador ve teléfono y dirección del cliente (sí, los necesita) pero NO ve email? ¿Ve precio del contrato? ¿Importes a cobrar (sí, los cobra)? | Ve nombre, teléfono, dirección, importes a cobrar. NO ve precio total contrato, NO ve email/datos bancarios. |
| 1.8 | **Telemarketer y datos sensibles.** ¿Ve teléfono y dirección del lead (obvio sí)? ¿Ve resultado de la propuesta del comercial al que entregó el lead? | Ve teléfono, dirección, estado del lead. NO ve importe de propuesta. |
| 1.9 | **Wallet entre comerciales.** Cuando hay varios comerciales en una empresa, ¿cada uno solo ve su Wallet, o el director comercial ve la Wallet de todo su equipo agregada? | Cada comercial ve solo lo suyo. Director comercial ve agregada de su equipo. Admin ve todo. |
| 1.10 | **Cambio de asignación.** ¿Quién puede reasignar un lead/cliente/instalación a otro usuario? | Director del departamento + admin. Nivel 3 NO reasigna. |
| 1.11 | **Configuración de empresa.** ¿Solo admin? ¿O directores pueden configurar SU módulo (ej. director técnico configura `/configuracion/almacenes`)? | Solo admin. Más seguro. Si pides cambiar después, fácil. |
| 1.12 | **Dirección de empresa.** ¿La empresa tenant tiene UN admin o puede tener varios? | **Sí varios.** En empresas grandes hace falta delegar. |
| 1.13 | **Departamentos custom.** ¿Toda empresa tiene los 3 departamentos fijos (tech/sales/tmk) o el admin puede activar/desactivar (ej. una empresa sin telemarketing)? | Los 3 existen siempre. Si una empresa no tiene TMK, simplemente no crea usuarios `telemarketing_director` ni `telemarketer`. |

---

> **Recordatorio para Claude en futuras conversaciones:** lee también `DATABASE_MEMORY.md`, `MODULES_MEMORY.md` y `NEXT_STEPS.md` antes de proponer cambios. Si el contexto es largo, pide al owner que copie el contenido de los 4 archivos.
