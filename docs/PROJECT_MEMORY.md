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
| 2026-05-01 | **Multi-rol por usuario PERMITIDO** | Un user = un rol | Casos reales: director comercial que también vende, instalador que también es comercial. `user_roles` M:N, JWT lleva `roles[]`. |
| 2026-05-01 | **Departamentos derivados de roles** | Departamento campo independiente | Si tienes rol `installer` → estás en `tech`. Si tienes `installer` + `sales_rep` → estás en `tech` + `sales`. |
| 2026-05-01 | **Una empresa = UN admin** | Varios admins | Owner pide estricto. Si hace falta delegar, se promueve un director. |
| 2026-05-01 | **Instalador pierde acceso al cliente al completar instalación** | Acceso permanente histórico | Tras completar, queda solo en `installation.installer_user_id` como autoría. Deja de aparecer en su lista activa. |
| 2026-05-01 | **Telemarketer ve resultado venta del lead que entregó** | Ocultar importes | Necesario para calcular comisión. |
| 2026-05-01 | **Director comercial valida liquidaciones Wallet de SU equipo** | Solo admin | Puede haber varios directores; cada uno valida lo suyo. Admin valida todo. |
| 2026-05-01 | **Límite de usuarios por empresa lo fija superadmin** | Sin límite | Campo `max_users` en `companies`, validado al crear users. |
| 2026-05-01 | **UI moderna basada en shadcn/ui blocks + shadcn charts (Recharts)** | Tabler/TailAdmin/templates pago | Free, calidad alta, alineado al stack ya elegido. Ver § 12 |
| 2026-05-01 | **Tremor opcional para bloques avanzados de dashboard** | Solo Recharts | Tremor da KPI cards y composiciones premium ya hechas (open source MIT) |
| 2026-05-01 | **Modo trabajo: todo en código primero, deploy + SQL al final con auditoría** | Aplicar migraciones incrementalmente | Owner prefiere ver el sistema completo antes de tocar BD productiva. Claude valida SQL contra Postgres local con Supabase CLI. |
| 2026-05-01 | **Objetivos mensuales en cascada** (D) | Sin objetivos | Nivel 1 pone meta por dpto → nivel 2 distribuye entre los nivel 3 a su mando. Tabla `monthly_objectives`. |
| 2026-05-01 | **UUID v7 (time-ordered)** vía `gen_random_uuid()` con extensión `pg_uuidv7` si Postgres 17+ lo soporta | UUID v4 random | Mejor performance índice en tablas grandes (events, wallet_entries, stock_movements). |
| 2026-05-01 | **`timestamptz` UTC en BD + conversión a `Europe/Madrid` en frontend** | `timestamp` sin tz | Estándar. Para fechas de negocio puras (firma contrato, fecha instalación) usar `date`. |
| 2026-05-01 | **`addresses` con FK directa a customer/lead** (no polimórfica genérica) | Polimórfica owner_type+owner_id | Owner aclaró: dirección creada en lead → migrada a customer al convertir → instalación referencia una de las direcciones del customer. FK duras posibles. |
| 2026-05-01 | **Categorías de producto: globales + locales en tablas separadas** | Tabla única con company_id nullable | Owner: superadmin solo da categorías/atributos predefinidos para acelerar setup; al cargarlas la empresa las clona y puede editarlas. Trazabilidad con `cloned_from_global_id`. |
| 2026-05-01 | **Soft-delete en críticas (customers, contracts, proposals, products, wallet, invoices), hard en efímeras (notifications viejas, eventos antiguos)** | Soft en todas | Más simple, recuperación legal asegurada. |
| 2026-05-01 | **Storage: bucket único `documents` con carpetas por company_id** | Bucket por empresa | Más simple, RLS por path. |
| 2026-05-01 | **Validaciones DNI/CIF/IBAN en aplicación (zod) + CHECK simples en BD** | Funciones PL/pgSQL pesadas | Más rápido, testeable, fácil iterar. |
| 2026-05-01 | **`audit_log` solo para escrituras en tablas sensibles (contracts, wallet, prices)** | Audit completo de lecturas | MVP: lectura no se audita por performance. |
| 2026-05-01 | **Confirmado: solo España, sin country_code en addresses** | Multi-país | Owner ratifica solo España. Si crece → migración futura. |

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
| 1 — Arquitectura permisos + multi-tenancy | ✅ Cerrada (2026-05-01) | 13/13 preguntas Capa 1 respondidas. Ver ADR 0001 |
| 2 — Modelo de datos | ✅ Cerrado (2026-05-01) | 16 migraciones SQL escritas. Pendiente validación CLI local + aplicar en deploy final |
| 3 — Scaffold Next.js | ✅ Cerrado (2026-05-01) | Next 15 + TS estricto + Tailwind 4 + Supabase SSR + middleware auth + sidebar dinámico + 17 rutas placeholder + login/recovery/restablecer + PWA + ES validations. Build pasa. |
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

- ❌ Copiar código, tablas, esquemas o nombres del ZIP `water_crm` (proyecto abandonado por mala arquitectura).
- ❌ **Inspirarnos en su UX** (era mala según owner). Solo consulta puntual cuando Claude tenga dudas concretas, p.ej. calculadora de ahorro.
- ❌ **Añadir features que aparecen en el ZIP y no están en el prompt maestro** sin preguntar al owner primero.
- ❌ Crear tablas duplicadas para cada módulo (ej. `lead_addresses` + `customer_addresses` — usar `addresses` única).
- ❌ Mezclar datos entre empresas tenant.
- ❌ Dejar tablas sensibles sin RLS.
- ❌ Permitir que nivel 3 modifique precios bajo mínimo sin aprobación.
- ❌ Generar instalación libre que no sea reubicación.
- ❌ Commitear `.env.local` o cualquier secreto.
- ❌ Avanzar de capa sin actualizar este archivo.

## 10.b Reglas explícitas sobre `legacy_reference/water_crm`

Owner aclaró el 2026-05-01:
- El ZIP es un **proyecto abandonado** por problemas de BD y UX.
- **NO analizar la UX completa** — se rehace desde cero.
- **Uso permitido:** consulta puntual cuando Claude tenga dudas sobre lógica de negocio que no quedó clara en el prompt maestro (especialmente **calculadora de ahorro**).
- Si Claude detecta features en el ZIP que no están en el prompt maestro → **PREGUNTAR al owner** si quiere añadirlas, no asumir.
- **Lo único rescatable según owner: algunos elementos UI** — pero ahora se va a hacer **más moderno** con plantillas externas.

---

## 11. Dudas abiertas Capa 1 (multi-tenancy + permisos)

Surgidas al diseñar la matriz de permisos y la arquitectura tenant. **Bloquean cierre de Capa 1.**

| # | Pregunta | Resolución |
|---|---|---|
| 1.1 | Multi-empresa por usuario | ✅ **NO.** Cada empresa tiene su email. |
| 1.2 | Multi-rol por usuario | ✅ **SÍ.** Puede ser nivel 2 y 3 a la vez (director comercial + comercial), o dos niveles 3 (técnico + comercial). `user_roles` M:N. |
| 1.3 | Director comercial ve clientes generados por sus comerciales | ✅ **SÍ.** |
| 1.4 | Director TMK ve leads ya entregados al comercial | ✅ **SÍ pero solo lectura.** |
| 1.5 | Aprobaciones precio: cualquier director del dpto + admin | ✅ Confirmado. Si no hay director, sube a admin. |
| 1.6 | sales_rep solo ve "mínimo sin aprobación", no el absoluto | ✅ Confirmado. |
| 1.7 | Instalador ve TODO durante asignación; al completar pierde acceso | ✅ Quedará solo `installation.installer_user_id` como autoría. La instalación deja de aparecer en su lista activa. Ya no ve más datos del cliente. |
| 1.8 | Telemarketer ve resultado venta del lead que entregó | ✅ **SÍ.** Necesario para comisión. |
| 1.9 | Director comercial valida Wallet de SU equipo | ✅ Confirmado. Admin ve todo. Pueden coexistir varios directores comerciales (cada uno con su equipo). |
| 1.10 | Reasignación solo director dpto + admin | ✅ Confirmado. |
| 1.11 | Configuración empresa solo admin | ✅ Confirmado. |
| 1.12 | Una empresa = UN admin | ✅ **NO multi-admin.** Más estricto que mi propuesta. |
| 1.13 | Departamentos fijos | ✅ Los 3 existen siempre. Si no usas uno, no creas usuarios. Total usuarios limitado por `max_users` que fija superadmin. |

---

## 12. Recursos UI/UX confirmados

> Todos open source, todos compatibles con Next.js + Tailwind + TypeScript ya elegido.

### Componentes y bloques
- **shadcn/ui** — base. https://ui.shadcn.com
- **shadcn/ui blocks** — bloques pre-construidos: dashboard, sidebar, login, settings, etc. https://ui.shadcn.com/blocks
- **Tremor** — bloques específicos de dashboard SaaS (KPI cards, comparativas, tablas con sparklines). MIT. https://tremor.so/components
- **Origin UI** — extensión gratis de shadcn con más variantes (selectores avanzados, inputs ricos). https://originui.com
- **Aceternity UI** — animaciones modernas para landing/onboarding (no para CRM operativo). https://ui.aceternity.com

### Gráficas (decisión: Recharts)
- **shadcn/ui charts** = Recharts envuelto con tokens shadcn. Lo usaremos como base. https://ui.shadcn.com/charts
- Tipos previstos para Dashboard CRM:
  - Comparativas mes vs mes vs año pasado (Bar/Line combo)
  - Funnel comercial (Lead → Cliente → Contrato → Instalación)
  - Stock (Donut por categoría, Bar por almacén)
  - Wallet liquidaciones (Stacked bar por método de pago)
  - KPIs por usuario (Horizontal bar ranking)
  - Tendencia temporal (Area chart con sparklines)

### Iconos
- **Lucide** (default shadcn). Ligero, completo, consistente.

### Plantillas admin completas para inspirar (NO copiar)
- TailAdmin Next.js — https://tailadmin.com
- Tremor Dashboard — https://tremor.so/blocks
- Catalyst by Tailwind Labs (pago, $299) — calidad referencia, mirar capturas

---

> **Recordatorio para Claude en futuras conversaciones:** lee también `DATABASE_MEMORY.md`, `MODULES_MEMORY.md` y `NEXT_STEPS.md` antes de proponer cambios. Si el contexto es largo, pide al owner que copie el contenido de los 4 archivos.
