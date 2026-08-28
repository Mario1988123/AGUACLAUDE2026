# Especificación de portado — Módulo de Fichaje / Control Horario

Fuente: `D:\AGUA_CLAUDE2026` (Next.js App Router + Supabase + Vercel + TS). Análisis completo de `src/modules/time-tracking/` (35 ficheros, ~7.550 líneas), rutas `src/app/(tenant)/fichajes/*` y `configuracion/horarios`, migraciones SQL relacionadas y documentación interna.

## A) Resumen del módulo

Sistema de fichaje digital multi-tenant integrado en un ERP+TPV español. Cubre: fichaje entrada/salida/pausas con geolocalización opcional, cuadrantes semanales por empleado, cálculo de saldo de horas (trabajado vs esperado), **autocierre automático** de jornadas olvidadas, flujo de solicitud/corrección de fichajes, ausencias y vacaciones con un motor de reglas del Estatuto de los Trabajadores (permisos parentales tras la reforma RD-ley 9/2025), calendario de festivos nacional/autonómico/local/empresa, "ventanas vacacionales" con aforo máximo, detección de días sin fichar sin justificar (`attendance_gaps`), vigilancia normativa automatizada del BOE, y exportación CSV para inspección de trabajo.

Roles: empleado (autoservicio), "admin amplio" (`company_admin` + `commercial_director` + `technical_director` + `telemarketing_director`) que aprueba y gestiona, y superadmin que salta todo. Todas las escrituras usan `createAdminClient()` (bypassa RLS) con scoping manual por `company_id` en cada función — el aislamiento multi-tenant depende de esta disciplina, no solo de RLS.

## B) Esquema de datos

```sql
-- Núcleo del fichaje
create type app.time_punch_kind as enum ('clock_in','clock_out','break_start','break_end');
create table public.time_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  punch_kind app.time_punch_kind not null,
  punched_at timestamptz not null default now(),
  geo_latitude numeric(9,6), geo_longitude numeric(9,6), accuracy_meters numeric(8,2),
  needs_geo_review boolean not null default false,
  is_manual boolean not null default false, manual_reason text,
  auto_closed boolean not null default false,
  edited_by_admin uuid references auth.users(id), edited_reason text
);
-- índices: (user_id, punched_at desc), (company_id, punched_at desc)

create table public.time_absences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_on date not null, ends_on date not null,
  kind text not null check (kind in ('vacation','sick','personal','training','other',
    'paternity','maternity','marriage','bereavement','lactation',
    'parental_unpaid','parental_paid_8y','parental_unpaid_8y','mudanza','civic_duty')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approved_by uuid references auth.users(id), approved_at timestamptz,
  child_id uuid references employee_children(id) on delete set null,
  notes text, created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.user_work_schedules (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Lun
  starts_at time, ends_at time, break_minutes integer not null default 0,
  expected_hours numeric(5,2), primary key (user_id, day_of_week)
);

create table public.user_vacation_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  year integer not null, days_total integer not null default 22,
  days_taken integer not null default 0, notes text, primary key (user_id, year)
);

create type app.holiday_scope as enum ('national','region','company');
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade, -- NULL = nacional global
  scope app.holiday_scope not null default 'company', region_code text,
  holiday_date date not null, name text not null, is_workable boolean not null default false,
  unique (company_id, holiday_date, region_code)
); -- + índices únicos parciales anti-duplicados (ux_holidays_global / ux_holidays_company)

create table public.time_punch_requests ( -- solicitud de fichaje manual (olvido/corrección)
  id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
  requested_at timestamptz not null, punch_kind text not null,
  reason text, status app.punch_request_status not null default 'pending', -- pending/approved/rejected/cancelled
  reviewed_by uuid, reviewed_at timestamptz, review_notes text,
  resulting_punch_id uuid references time_punches(id) on delete set null
);

create table public.vacation_windows ( -- rangos autorizados para vacaciones >2 días
  id uuid primary key default gen_random_uuid(), company_id uuid not null, year integer not null,
  starts_on date not null, ends_on date not null, label text not null,
  max_concurrent_users integer, created_by uuid, check (ends_on >= starts_on)
);

create table public.user_leave_budgets ( -- techo por usuario+año+tipo
  id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
  year integer not null, kind text not null, unit text not null default 'days'
    check (unit in ('days','hours','weeks','months')),
  budget numeric(10,2) not null default 0, taken numeric(10,2) not null default 0,
  notes text, unique (company_id, user_id, year, kind)
);

create table public.attendance_gaps ( -- día sin fichar sin justificar
  id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
  gap_date date not null, status text not null default 'pending' check (status in ('pending','classified','dismissed')),
  classified_kind text, classified_by uuid, classified_at timestamptz, classified_notes text,
  unique (company_id, user_id, gap_date)
);

create table public.employee_children ( -- solo para validar permisos parentales
  id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
  child_name text, birth_date date not null, sex text check (sex in ('M','F','X')), notes text
);

create table public.legal_notices ( -- avisos BOE detectados por cron mensual, cross-tenant
  id uuid primary key default gen_random_uuid(), boe_id text unique, boe_date date,
  title text not null, url text, keywords_matched text, fetched_at timestamptz not null default now(),
  reviewed_at timestamptz, reviewed_by uuid, dismissed_at timestamptz, dismissed_by uuid, dismissed_reason text
);
```

**RLS**: patrón triple en casi todas las tablas — `*_super` (`app.is_superadmin()`), `*_select_tenant` (`company_id = app.current_company_id()`), `*_admin_manage` (mismo scope + `app.has_role('company_admin')` o el listado de 4 roles admin/director). `time_punches` añade `time_punches_user_insert` (el propio usuario inserta solo `is_manual=false`) y `time_punches_user_select` (propio o admin). `time_punch_requests`, `employee_children` y `user_leave_budgets` añaden políticas `_self_*` para autoservicio. `holidays` y `legal_notices` son de **lectura cross-tenant** (`company_id IS NULL` o `using (true)`).

**Función clave**: `app.autoclose_stale_punches()` (SQL, `security definer`) — evolucionó en 3 migraciones (`20260503320000` → `20260504140000` → `20260525110000`). Versión final: cierra `clock_in` sin `clock_out` cuando han pasado ≥2h desde el **fin exacto del turno** (`user_work_schedules.ends_at`; sin horario, `clock_in + 8h` con margen de 10h), insertando un `clock_out` a la **hora exacta de fin de jornada** (no fin+2h) para que el saldo del día quede en 0. Bloqueada para `authenticated`/`anon` desde `20260713100000_revoke_public_rpc.sql` (solo `service_role`) tras detectarse que el wrapper `public.*` nunca había llegado a producción — el autocierre vía cron llevaba fallando en silencio hasta esa fecha.

## C) Reglas de negocio

1. **Inferencia de tipo de fichaje**: `punchAction` (botón simple) infiere `clock_in`/`clock_out` según el último fichaje del día. `punchKindAction` (widget/página completa) recibe el tipo explícito y valida coherencia de jornada: 1 `clock_in` + descansos + 1 `clock_out` por día; no reabrir tras cerrar, no cerrar dos veces, no iniciar pausa sin entrada ni con jornada cerrada. Mensajes de error literales y específicos por caso.
2. **Geolocalización opcional, no bloqueante**: si falta lat/lng, se marca `needs_geo_review=true` y se crea un `incidents` automático. El fichaje se registra igualmente.
3. **Ventana de turno informativa, no bloqueante**: `getMyClockExtended` calcula si se ficha fuera de -30min/+2h del turno y muestra `reason` como aviso ámbar, sin impedir fichar (permite horas extra o llegadas tempranas).
4. **Bloqueo real por ausencia aprobada**: si hay `time_absences status=approved` cuyo rango cubre hoy, `canPunch=false` con mensaje según tipo de ausencia.
5. **Cálculo de saldo** (`getMyHourBalance`): empareja `clock_in`→`clock_out` sumando minutos y resta `break_start`→`break_end`; lo esperado por día sale de `user_work_schedules.expected_hours` o de `(ends_at-starts_at)-break_minutes`; festivo o ausencia aprobada → esperado 0.
6. **Autocierre no penaliza**: decisión explícita 2026-05-15 documentada en migración — cierra exactamente a la hora de fin de turno (saldo 0), no a fin+2h.
7. **Corrección post-autocierre**: el empleado propone la hora real vía `time_punch_requests` (componente `AutocloseCorrectionCard`); el admin la valida insertando un `time_punches` manual.
8. **Edición/borrado admin de fichajes**: `editPunchAction` exige motivo ≥3 caracteres, marca `is_manual`/`edited_by_admin`/`edited_reason`. `adminDeletePunchAction` hace **borrado físico** pero registra el evento previo en tabla `events` (kind `time_tracking.punch_deleted`) antes de eliminar.
9. **Solicitudes de fichaje**: el empleado pide, admin aprueba (inserta `time_punches is_manual=true`) o rechaza; solo el propio empleado cancela su solicitud pendiente.
10. **Vacaciones — regla de ventanas**: ≤2 días laborables siempre permitido; >2 días exige encajar dentro de una `vacation_windows` completa definida por la empresa, respetando `max_concurrent_users` si existe (cuenta ausencias aprobadas solapadas, excluyendo al propio solicitante).
11. **Saldo de vacaciones idempotente**: `approveAbsenceAction` solo suma/resta `days_taken` cuando cambia el booleano "está aprobada" (evita doble descuento en cambios de estado repetidos).
12. **Maternidad/paternidad**: exige `child_id`; valida fin ≤12 meses del nacimiento, inicio ≥nacimiento, y tope de **17 semanas** en 12 meses (suma `ceil(días/7)` de ausencias previas del mismo hijo+tipo).
13. **Permiso parental hasta 8 años** (`parental_paid_8y`/`parental_unpaid_8y`): exige que el hijo más joven del empleado tenga <8 años en la fecha de inicio.
14. **Presupuestos legales por defecto 2026** (`DEFAULT_BUDGETS_2026`): vacaciones 22 días, maternidad/paternidad 17 semanas, matrimonio 15 días, fallecimiento 5 días, lactancia 9 meses, parental pagado 2 semanas, parental no pagado 6 semanas — con cita expresa a RD-ley 9/2025 y Art. 48.4/48 bis ET.
15. **Clasificación de huecos** (`attendance_gaps`): admin decide entre crear una ausencia retroactiva aprobada o descartar (`dismissed`) el día sin fichar.
16. **Festivos jerárquicos**: nacional (`company_id IS NULL`) > autonómico > local/empresa; `getUsersWithoutPunchTodayAction` excluye festivos, ausentes y usuarios sin horario ese día de la semana.
17. **"Quién está" en tiempo real**: clasifica cada usuario en `working`/`on_break`/`absences`/`out` combinando último fichaje del día y ausencias aprobadas de hoy.
18. **Recordatorios de turno**: avisos a 30/15/5 min antes de inicio/fin de turno y al superar el fin sin fichar salida; deduplicados en `sessionStorage` por día+ventana.
19. **Anti cross-tenant sistemático**: cada acción que recibe `user_id`/`id` desde el navegador verifica pertenencia a `company_id` de la sesión antes de leer o escribir, incluso usando el cliente admin (que salta RLS).

## D) UI y flujos de usuario

- **`TimeClockWidget`** (header global): 3 estados (parado/trabajando/en pausa) con cronómetro en vivo, poll cada 60s, captura GPS con `navigator.geolocation` (timeout 8s, `enableHighAccuracy`) y diálogo de confirmación si no hay GPS antes de fichar sin ubicación.
- **`/fichajes/fichar`** (`PunchPageClient`): pantalla dedicada con avatar, mapa `MapPicker` (Leaflet) donde el usuario puede corregir manualmente el pin si el GPS falla, resumen de horas de hoy.
- **`/fichajes`**: dashboard del empleado — saldo de hoy destacado, vista semanal navegable con badges de ausencia y aviso si trabajó >130% de lo esperado, KPIs de mes/año, gestor de hijos, barras de consumo de presupuestos de permisos, listado de ausencias y solicitudes propias, botones "Solicitar fichaje" / "Solicitar ausencia" / calendario modal de vacaciones.
- **`/fichajes/equipo`**: tablero "Quién está" con 4 secciones (Trabajando/Descansos/Ausencias/Fuera), visible a todo el equipo sin rol admin.
- **`/fichajes/admin`** (solo admin/director): fichajes de hoy con badges GPS/autocerrado/manual, sin-fichar-hoy, huecos por clasificar, solicitudes pendientes de fichaje y ausencia con botones aprobar/rechazar, crear fichaje/ausencia manual, botón "Cerrar olvidos" (dispara `autoclose_stale_punches`), enlace a exportar CSV.
- **`/fichajes/admin/historico`**: filtros (fechas, usuario, tipo, solo-sin-GPS, solo-manual, solo-autocerrado) vía `<form method="GET">`, tabla/cards con acciones editar/eliminar por fila (modal con motivo obligatorio), enlace de exportación con los mismos filtros en la URL.
- **`/fichajes/admin/leyes`**: tabla de referencia legal (permisos y bases legales), avisos BOE pendientes con botones revisar/descartar, alerta si la revisión anual está vencida.
- **`/configuracion/horarios`**: horario comercial de empresa, editor de cuadrante semanal por usuario (`ScheduleEditor`, borra-y-reinserta), tabla de saldos de vacaciones editable inline (`VacationsTable`). Solo `company_admin`/superadmin.
- **`ShiftReminders`**: componente invisible montado una vez en el layout.

## E) Informes y exportaciones

Única exportación: **CSV** en `/api/export/[entity]/route.ts` (caso `"time-records"`) — una fila por fichaje de los **últimos 4 años** (comentario explícito citando RD 8/2019), columnas: ID, Empleado, ID Empleado, Tipo, Fecha y hora ISO, Latitud, Longitud, Sin GPS, Manual, Motivo manual, Autocerrado, Editado por, Motivo edición. Acceso restringido a `company_admin`/superadmin (no a directores). **Defecto detectado**: el endpoint ignora por completo los filtros de fecha/usuario/tipo que la página `historico` construye en la URL — siempre vuelca los 4 años completos sin filtrar. El resto de "informes" son vistas agregadas en pantalla (saldo semanal/mensual/anual, % de presupuestos de permisos, saldos de vacaciones) sin exportación propia.

## F) Cumplimiento legal (España, RD-ley 8/2019)

- ✅ Registro diario de jornada (entrada/salida/pausas) con marca de tiempo.
- ✅ Conservación 4 años (documentado y aplicado en la query de exportación).
- ✅ Acceso del trabajador a su propio registro (`/fichajes`).
- ⚠️ Accesible a Inspección de Trabajo solo de forma **indirecta**: CSV manual descargado por el admin; no hay portal ni API de consulta directa para ITSS.
- ❌ **Sin inmutabilidad/integridad reforzada**: `adminDeletePunchAction` hace `DELETE` físico (con log en `events`, pero sin hash encadenado, firma digital ni bloqueo de periodo cerrado). `editPunchAction` sobreescribe `punched_at` directamente. Esto no cumple el estándar deseable de "registro fiable e inalterable" que persiguen muchas guías de inspección, aunque el RD-ley no exige técnicamente blockchain.
- ❌ Sin firma del trabajador sobre su registro (mensual o por fichaje).
- ❌ Sin acceso de solo lectura para representación legal de los trabajadores (RLPT).
- La geolocalización es opcional y no bloqueante — coherente con el RD-ley (no exige geolocalización), pero sin justificación explícita capturada cuando el empleado la rechaza repetidamente.

## G) Qué copiar tal cual / qué mejorar

**Copiar tal cual**: el patrón de resultado `{ok,error}` devuelto (no lanzado) para sobrevivir la redacción de mensajes de Server Actions en producción; la validación de secuencia de jornada con mensajes claros; el motor de ventanas vacacionales con aforo; los presupuestos de permisos con defaults legales documentados y citados; el snapshot "Quién está"; los recordatorios de turno deduplicados en `sessionStorage`; el patrón RLS triple (`super`/`select_tenant`/`admin_manage`) combinado con políticas de autoservicio; el autocierre que fija la hora exacta de fin de turno para no distorsionar el saldo.

**Mejorar al portar**: (1) sustituir el `DELETE`/`UPDATE` directo sobre fichajes por un modelo append-only con eventos de corrección y bloqueo de periodos cerrados, para reforzar integridad; (2) corregir el bug de exportación CSV que ignora los filtros de la URL; (3) añadir firma/hash de integridad y, si aplica, acceso de solo lectura para inspección/representación legal; (4) unificar los dos sistemas de saldo de vacaciones (`user_vacation_balances` vs `user_leave_budgets kind=vacation`), hoy actualizados de forma independiente según el flujo de aprobación usado, con riesgo real de desincronización; (5) desacoplar el widget de fichaje del header global (auditoría interna detectó import circular `shared/components/header.tsx` ↔ `time-tracking`); (6) sustituir los reintentos defensivos por columnas ausentes de caché de esquema por una disciplina de despliegue de migraciones atómica junto al código.
