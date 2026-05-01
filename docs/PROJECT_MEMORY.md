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
| 1 — Arquitectura permisos + multi-tenancy | 🔒 Bloqueada | Esperando respuestas a dudas abiertas |
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
| 1 | 🔴 Offline-first sí o no (instalador puede operar sin red y sincronizar) | Abierta | Capa 1 |
| 2 | 🔴 Versionado de propuestas/contratos al editar | Abierta | Capa 2 |
| 3 | Datos bancarios cifrados en BD (pgcrypto) y visibilidad por rol | Abierta | Capa 2 |
| 4 | Firma cliente: PNG+timestamp suficiente o eIDAS | Abierta | Capa 2 |
| 5 | 🔴 Numeración fiscal: TicketBAI vs Verifactu | Abierta | Aparcado pero modelo BD |
| 6 | Multi-país futuro (España solo o LATAM/PT) | Abierta | Capa 2 |
| 7 | 🔴 i18n desde el inicio o solo español | Abierta | Capa 3 |
| 8 | 🔴 Polimorfismo timeline: tabla única `events` vs tabla por subject | Abierta | Capa 2 |
| 9 | Multi-empresa por usuario (franquicias) sí o no | Abierta | Capa 1 |
| 10 | Comisiones TMK: % global o por contrato | Abierta | Capa 11 |
| 11 | 🔴 Permisos: roles fijos o admin define roles a la carta | Abierta | Capa 1 |
| 12 | Furgoneta: 1 instalador fijo o compartida | Abierta | Capa 12 |
| 13 | Mantenimientos a equipos de competencia (recambios compatibles) confirmar | Abierta | Capa 14 |
| 14 | Reubicación: cliente registrado obligatorio o cliente puntual | Abierta | Capa 13 |
| 15 | Renting: catálogo financieras global o por empresa | Abierta | Capa 7 |
| 16 | Categorías globales: empresa puede modificar o solo activar/desactivar | Abierta | Capa 7 |
| 17 | 🔴 Pruebas gratuitas: contrato en pruebas o entidad separada | Abierta | Capa 2 |
| 18 | Storage: bucket único con prefijos vs bucket por empresa | ✅ Resuelta (único + prefijos) | – |
| 19 | Soft-delete (`deleted_at`) en todas las tablas o algunas físico | Abierta | Capa 2 |
| 20 | Auditoría: log de "quién vio" datos sensibles o solo "quién modificó" | Abierta | Capa 2 |

## 9. Cosas pendientes inmediatas

- Recibir respuestas a dudas críticas (mínimo 1, 2, 5, 7, 8, 11, 17).
- Recibir confirmación stack (sección 3).
- Vercel `link` al repo y inyectar env vars de Supabase.
- Definir contenido inicial de los otros 3 archivos memoria (DATABASE/MODULES/NEXT_STEPS — ya creados con esqueleto).

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

> **Recordatorio para Claude en futuras conversaciones:** lee también `DATABASE_MEMORY.md`, `MODULES_MEMORY.md` y `NEXT_STEPS.md` antes de proponer cambios. Si el contexto es largo, pide al owner que copie el contenido de los 4 archivos.
