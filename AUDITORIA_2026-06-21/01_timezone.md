# Auditoría de zona horaria (Europe/Madrid) — 2026-06-21

Proyecto: AGUA_CLAUDE2026 (Next.js 15 + Supabase, multi-tenant CRM, UI español).
Servidor (Vercel) corre en **UTC**. Negocio opera en **Europe/Madrid** (UTC+1 invierno / UTC+2 verano).
Auditoría **READ-ONLY**: no se ha modificado ningún archivo fuente.

## Contrato del helper `src/shared/lib/format-date.ts`

Helpers disponibles (TODOS correctos, hay que usarlos):

- `formatDateES(value)` → "DD-MM-AAAA" en Madrid (display fecha).
- `formatDateTimeES(value)` → "DD-MM-AAAA HH:mm" en Madrid (display fecha+hora).
- `madridParts(value)` → `{year,month,day,hour,minute,isoDow}` (hora de pared Madrid).
- `madridHour`, `madridMinutesOfDay`, `madridIsoDow` (0=Lun..6=Dom), `madridJsDay` (0=Dom..6=Sáb), `madridDateKey` ("YYYY-MM-DD" en Madrid).
- `madridDayRangeUtc(value)` → `{start,end}` (rango UTC que cubre el día natural Madrid; para filtros gte/lte sobre timestamptz).
- `madridLocalToUtcISO(local)` → convierte hora de pared (de un `<input type="datetime-local">`) a instante UTC ISO. **Idempotente**: si el string ya trae `Z` o `+hh:mm` lo respeta tal cual (esto importa, ver hallazgo #6).

## Dato clave de severidad: horario de los crons (`vercel.json`)

- `daily` → `0 22 * * *` = **22:00 UTC** = **00:00 Madrid (verano CEST) / 23:00 Madrid (invierno CET)**.
  → El cron diario se ejecuta JUSTO en el cambio de día Madrid. Es el peor momento posible para los patrones "hoy/día 1/ayer" calculados en UTC: la fecha UTC y la fecha Madrid difieren con altísima probabilidad. Esto **eleva a CRIT** los patrones `new Date().toISOString().slice(0,10)` y `getDate()===1`/`===25` dentro de `daily/route.ts`.
- `boe-check` `0 8 1 * *`, `purchase-suggestions` `0 6 * * *`, `gmaps-budget-alert` `0 7 * * *`, `maintenance-reminders` `0 9 * * *` (estos a horas en que UTC y Madrid coinciden de día, menor riesgo de cruce de fecha, pero el texto hora-de-día en emails sí está mal).

## Recuento por severidad

| Severidad | Nº |
|-----------|----|
| CRIT  | 9  |
| ALTO  | 13 |
| MEDIO | 18 |
| BAJO  | 9  |
| **Total** | **49** |

---

## PATRÓN SISTÉMICO (lo más importante)

Hay **DOS** patrones repetidos en todo el código que conviene arreglar de golpe con el helper que YA existe (`format-date.ts`):

### Patrón A — Display de timestamps SIN zona Madrid (~30 sitios)
`new Date(x).toLocaleString/toLocaleDateString/toLocaleTimeString("es-ES")` **sin** `{ timeZone: "Europe/Madrid" }`.
En SSR (Vercel UTC) muestra hora UTC (1-2 h antes); en cliente muestra la del navegador → incoherente. Solo 3 ficheros lo hacen bien hoy (`instalaciones/[id]/page.tsx`, `instalaciones/page.tsx` con const `TZ`, `installations/incident-row.tsx`).
**Arreglo único:** sustituir por `formatDateTimeES(x)` (fecha+hora) o `formatDateES(x)` (solo fecha), o añadir `{ timeZone: "Europe/Madrid" }`. ADITIVO (no cambia datos, solo presentación). Helper ya disponible: `@/shared/lib/format-date`.

### Patrón B — "Hoy / ahora / día 1" calculado en UTC en el SERVIDOR (~25 sitios)
`new Date().toISOString().slice(0,10)`, `new Date(now.getFullYear(), now.getMonth(), now.getDate(), ...)` + `.toISOString()`, `getDate()===1`, `getHours()`, `getDay()` usados como hora de pared Madrid.
Falla alrededor de medianoche y **con seguridad en el cron diario (22:00 UTC)**.
**Arreglo único:** usar `madridDateKey(new Date())` para claves de día, `madridDayRangeUtc(...)` para rangos gte/lte, `madridParts(new Date()).day/hour/isoDow` para decisiones de pared. MODIFICA comportamiento (corrige qué se procesa y cuándo). Helper ya disponible.

> Recomendación: crear, además, un par de helpers de conveniencia en el MISMO `format-date.ts` (ADITIVO): `madridTodayKey()` (= `madridDateKey(new Date())`) y `madridDayOfMonth()` (= `madridParts(new Date()).day`) para que el reemplazo masivo sea trivial y uniforme. Y un componente/`<time>` o función única de render para Patrón A.

---

## HALLAZGOS POR SEVERIDAD

### CRIT

**[CRIT] `src/app/api/cron/daily/route.ts:264`** (y reusos `1163`, `1202`, `1337`, `1590`)
Problema: `new Date().toISOString().slice(0,10)` como "hoy en Madrid" para activar contratos / caducar pruebas / facturar. Causa: el cron arranca a las 22:00 UTC = 00:00 Madrid → la fecha UTC suele ser el día anterior/siguiente al de Madrid. Arreglo: `madridDateKey(new Date())`. Riesgo: medio. MODIFICA (cambia qué filas entran cada día).

**[CRIT] `src/app/api/cron/daily/route.ts:1309`**
Problema: `if (today.getDate() === 1)` (scraper mensual) usa día UTC; a las 22:00 UTC nunca coincide con el día 1 de Madrid. Causa: `getDate()` en UTC. Arreglo: `if (madridParts(new Date()).day === 1)`. Riesgo: medio. MODIFICA.

**[CRIT] `src/app/api/cron/daily/route.ts:1334`** (y `1505` `getDate()===25`)
Problema: generación de mensualidades de alquiler/renting condicionada a `today.getDate()===1` / `===25` en UTC → se dispara el día equivocado en Madrid (justo el cron de las 22:00). Causa: día UTC. Arreglo: `madridParts(new Date()).day`. Riesgo: medio-alto (afecta facturación recurrente). MODIFICA.

**[CRIT] `src/app/api/cron/daily/route.ts:73-76, 103-104`**
Problema: "ayer" para fichajes se calcula en UTC y luego se construye el rango concatenando `"T00:00:00"`/`"T23:59:59"` (interpretado como UTC). El día Madrid de ayer queda desplazado ±1-2 h. Arreglo: `madridDayRangeUtc(yesterday)` para start/end. Riesgo: medio. MODIFICA.

**[CRIT] `src/app/api/cron/maintenance-reminders/route.ts:232`**
Problema: `scheduled.toLocaleTimeString("es-ES", {...})` SIN tz → el email "tu mantenimiento es a las HH:MM" sale en UTC (1-2 h antes). Causa: falta `timeZone`. Arreglo: añadir `timeZone:"Europe/Madrid"` o `formatDateTimeES`. Riesgo: bajo. MODIFICA (texto que ve el cliente).

**[CRIT] `src/modules/installations/confirmation-send-actions.ts:142`**
Problema: `appointment_time` del email de confirmación de instalación con `toLocaleTimeString` sin tz → cliente recibe hora equivocada. Arreglo: `timeZone:"Europe/Madrid"`. Riesgo: bajo. MODIFICA.

**[CRIT] `src/app/api/cron/daily/route.ts:442` y `:587`**
Problema: hora de la notificación "instalación/mantenimiento mañana a las HH:MM" con `toLocaleTimeString` sin tz → instalador/admin ven hora UTC. Arreglo: `timeZone:"Europe/Madrid"`. Riesgo: bajo. MODIFICA.

**[CRIT] `src/app/(tenant)/agenda/page.tsx:65-119, 142`** (Server Component, SSR UTC)
Problema: `startOfWeek(now)`, `new Date(now.getFullYear(),now.getMonth(),now.getDate(),...)` y `listAgendaMonth(now.getFullYear(), now.getMonth())` usan componentes UTC del `now` del servidor; tras ~22:00-23:00 Madrid el `now` UTC ya es el día siguiente → "esta semana / hoy / este mes" se calculan mal y la agenda muestra/consulta el rango equivocado. Esto es parte del "falla según el momento". Arreglo: derivar año/mes/día de `madridParts(new Date())` y construir rangos con `madridDayRangeUtc`. Riesgo: medio. MODIFICA.

**[CRIT] `src/modules/customers/delete-flow-actions.ts:144-147, 160`**
Problema: en el alta de baja de cliente (churn), `scheduled_at`, `uninstalled_at` y `completed_at` provienen de `<input type="datetime-local">` (hora de pared Madrid, ver `delete-customer-button.tsx:429-431, 147-149`) y se guardan **crudos** sin `madridLocalToUtcISO` → la retirada queda agendada/registrada 1-2 h adelantada. Causa: falta conversión (el resto de writers de cliente sí la hacen). Arreglo: envolver con `madridLocalToUtcISO(...)` antes de pasarlos a `createUninstallAction`/`completeUninstallNowAction`. Riesgo: bajo. MODIFICA (corrige instante guardado). NOTA: `completeUninstallNowAction` (uninstall-actions.ts:582) y `createUninstallFromAgendaAction` (uninstall-actions.ts:318) reenvían `scheduled_at`/`completed_at` SIN convertir; conviene normalizar en el punto de entrada (delete-flow-actions) para no tocar dos sitios.

---

### ALTO

**[ALTO] `src/modules/free-trials/actions.ts:130-131`**
Problema: validación "no fecha pasada" usa `minToday.setHours(0,0,0,0)` = medianoche UTC del servidor; compara contra una fecha de pared Madrid → cerca de medianoche rechaza fechas válidas de hoy (o acepta de más). Arreglo: comparar contra `madridDayRangeUtc(new Date()).start`. Riesgo: bajo. MODIFICA.

**[ALTO] `src/modules/agenda/week-view.tsx:198-206`** (client) + `draggable-list.tsx` drag
Problema: el drag-and-drop construye `new Date(day.getFullYear(),...,hour,...).toISOString()` con la zona del NAVEGADOR y lo envía con `Z`; como `madridLocalToUtcISO` es idempotente ante strings con zona, lo respeta tal cual. En navegador NO-Madrid se guarda el instante equivocado, mientras que el diálogo datetime-local (mismo evento) sí va por Madrid. **Este es el mecanismo de "falla según quién/dónde guarda".** Arreglo: que el drag envíe hora de pared sin zona ("YYYY-MM-DDTHH:mm") para que `madridLocalToUtcISO` la interprete como Madrid. Riesgo: medio. MODIFICA.

**[ALTO] `src/app/api/cron/daily/route.ts:1266`**
Problema: `new Date().getHours()` (hora UTC) para decidir el corte de "instalación olvidada"; el cron a 22:00 UTC ve hora UTC, no Madrid. Arreglo: `madridHour(new Date())`. Riesgo: bajo. MODIFICA.

**[ALTO] `src/app/api/cron/daily/route.ts:420-425` y `:573-579`**
Problema: rango "mañana" (`tomorrow.setHours(0,0,0,0)`/`23:59:59` en UTC) para instalaciones y mantenimientos del día siguiente → pierde/incluye de más trabajos cerca de medianoche Madrid. Arreglo: `madridDayRangeUtc(tomorrow)`. Riesgo: medio. MODIFICA.

**[ALTO] `src/modules/installations/wizard-actions.ts:141, 147`**
Problema: mensajes de error al iniciar el parte muestran `i.scheduled_at` con `toLocaleString` sin tz (hora UTC) → confunde al instalador sobre la ventana de 24 h. Arreglo: `timeZone:"Europe/Madrid"` / `formatDateTimeES`. Riesgo: bajo. MODIFICA (texto).

**[ALTO] `src/app/api/cron/maintenance-reminders/route.ts:~555` (WhatsApp)**
Problema: fecha del recordatorio WhatsApp con `toLocaleDateString` sin tz → puede decir "mañana 20 de junio" en vez de 21. Arreglo: `timeZone:"Europe/Madrid"`. Riesgo: bajo. MODIFICA (texto cliente).

**[ALTO] `src/modules/agenda/week-view.tsx:286, 465`**
Problema: hora de evento (`starts_at`) con `toLocaleString`/`toLocaleTimeString` sin tz en vista semana y alerta fuera-de-horario → hora UTC en SSR. Arreglo: `formatDateTimeES`/`timeZone`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/modules/agenda/calendar.tsx:242`** y **`move-event-dialog.tsx:208, 215`** y **`draggable-list.tsx:198`**
Problema: hora de cita (`starts_at`/`ends_at`) con `toLocaleTimeString` sin tz. Arreglo: `timeZone:"Europe/Madrid"`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/modules/maintenance/upcoming-card.tsx:61`** y **`installations/upcoming-card.tsx:51`**
Problema: hora de la próxima cita (tarjetas dashboard / Mi día) con `toLocaleString/toLocaleTimeString` sin tz. Arreglo: `timeZone`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/modules/installations/calendar-view.tsx:153`**
Problema: hora del trabajo en el calendario sin tz. Arreglo: `timeZone`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/modules/time-tracking/autoclose-correction-card.tsx:92`** y **`time-clock-widget.tsx:172, 204`**
Problema: hora de fichaje / inicio de jornada-descanso sin tz (un fichaje real es muy sensible a la hora). Arreglo: `timeZone`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/app/(tenant)/mi-dia/page.tsx:294`** y **`mantenimientos/[id]/page.tsx:117, 141, 147`** y **`mantenimientos/page.tsx:307, 377`**
Problema: hora de cita/parte (`scheduled_at`,`started_at`,`completed_at`) con `toLocaleTimeString/toLocaleString` sin tz. Arreglo: `formatDateTimeES`/`timeZone`. Riesgo: bajo. MODIFICA (display).

**[ALTO] `src/app/m/[token]/page.tsx:36-42`** y **`src/app/i/[token]/page.tsx:34-40`** (páginas públicas de confirmación cliente)
Problema: la cita que ve el CLIENTE (`toLocaleDateString`+`toLocaleTimeString` sin tz). Arreglo: `timeZone:"Europe/Madrid"`. Riesgo: bajo. MODIFICA (texto cliente).

---

### MEDIO

**[MEDIO] `src/modules/scheduling/availability.ts:53, 172-177, 186-187, 287, 308`**
Problema: `isoDate()` (getFullYear/Month/Date server-local) y `today.setHours(0,0,0,0)` generan claves de día en UTC que se comparan contra `holiday_date` (date Madrid) y construyen la ventana de slots ofrecibles → en SSR UTC, día corrido cerca de medianoche y festivos potencialmente desalineados. (El bucketing mañana/tarde SÍ usa `madridHour`, correcto.) Arreglo: usar `madridDateKey` para claves y `madridParts`/`madridDayRangeUtc` para el rango. Riesgo: medio. MODIFICA.

**[MEDIO] `src/app/api/cron/gmaps-budget-alert/route.ts:32, 66-76`**
Problema: `today=...slice(0,10)` y `monthStart/dayStart` con `new Date(y,m,d).toISOString()` en UTC para el tope de gasto del mes/día → límites del periodo desplazados 1 día en frontera de mes. Arreglo: `madridDateKey` + `madridDayRangeUtc`. Riesgo: bajo. MODIFICA.

**[MEDIO] `src/modules/customers/equipment-actions.ts:405, 458`**
Problema: `completed_at`/`scheduled_at` de mantenimientos históricos/próximos vía `new Date(input.next_maintenance_at).toISOString()` (trata la fecha de pared como UTC). Si el input lleva hora puede desfasar; si es solo fecha el día puede correrse cerca de medianoche. Arreglo: `madridLocalToUtcISO(input...)`. Riesgo: bajo. MODIFICA.

**[MEDIO] `src/app/(tenant)/dashboard/page.tsx:116, 272-282`**, **`mantenimientos/page.tsx:54-55, 119, 132`**, **`contratos/page.tsx:139`**, **`instalaciones/page.tsx:294`**, **`contracts/smart-alerts.tsx:112`**, **`points/my-commissions-card.tsx:167`**, **`wallet/actions.ts:148,263,272`**, **`dashboard/evolution-actions.ts:30-63`**, **`points/*` rankings**, **`objetivos/page.tsx:35`**, **`ventas/page.tsx:32`**, **`rrss/page.tsx:74`**
Problema: rangos/etiquetas de "mes actual" y agrupaciones por mes con `new Date(now.getFullYear(), now.getMonth(), 1).toISOString()` y `getMonth()` en UTC. En frontera de mes (último día tras 22:00-23:00 Madrid) cae en el mes equivocado. Arreglo: derivar año/mes de `madridParts(new Date())` y rango con `madridDayRangeUtc`/equivalente mensual. Riesgo: bajo-medio. MODIFICA. (Impacto principalmente 1-2 días al mes; agrupar en un solo barrido.)

**[MEDIO] `src/app/(tenant)/fichajes/page.tsx:54-104, 166-167`** y **`fichajes/admin/page.tsx:51-52`** y **`fichajes/admin/historico/page.tsx:52-55`**
Problema: semana/mes/rango de fichajes y display con componentes server-local (UTC) + `toLocaleDateString/Time` sin tz. Sensible porque es control horario. Arreglo: `madridParts`/`madridDayRangeUtc` para los rangos y `formatDateES/TimeES` para el display. Riesgo: medio. MODIFICA.

**[MEDIO] Display `toLocaleString` sin tz de logs/created_at:** `app/(tenant)/auditoria/page.tsx:211`, `eventos/page.tsx:199`, `notificaciones/page.tsx:294`, `superadmin/audit/page.tsx:119`, `superadmin/errores/page.tsx:131,279,283`, `error-reports/superadmin-card.tsx:110`, `mail/[id]/page.tsx:87,93`, `mailing/[id]/page.tsx:31`, `mailing/page.tsx:40`, `almacenes/conteo/[id]/page.tsx:81`, `comisiones/[id]/page.tsx:126`, `api/comisiones/[id]/export/route.ts:182`, `warehouses/warehouse-detail-tabs.tsx:1033,1194`, `incidencias/[id]/page.tsx:91,143`, `facturas/[id]/page.tsx:308,339`.
Problema: fecha+hora de auditoría/log/registro en UTC en SSR. Arreglo: `formatDateTimeES`. Riesgo: bajo. ADITIVO/MODIFICA (display).

**[MEDIO] `src/modules/incidents/sla-pill.tsx:34`, `email-from-cron.ts:123`, `actions.ts:233`**
Problema: deadline SLA con `toLocaleString` sin tz (tooltip técnico + texto de email). Arreglo: `formatDateTimeES`/`timeZone`. Riesgo: bajo. MODIFICA.

**[MEDIO] `src/modules/time-tracking/actions.ts:715` y `punch-requests-actions.ts:81`**
Problema: hora del fichaje en el cuerpo de la notificación/push con `toLocaleString` sin tz. Arreglo: `formatDateTimeES`. Riesgo: bajo. MODIFICA (texto).

**[MEDIO] `src/modules/warehouses/auto-loading.ts:32-37`**
Problema: "mañana" con `tomorrow.setDate(+1)` + `dayStart.setHours(0,0,0,0)` + `.toISOString().slice(0,10)` en UTC para la carga de furgonetas del día siguiente. Arreglo: `madridDayRangeUtc(tomorrow)` / `madridDateKey`. Riesgo: bajo. MODIFICA.

---

### BAJO

**[BAJO] `src/app/api/cron/boe-check/route.ts:146-150`**
Problema: `boeDate.toISOString().slice(0,10)` — si el feed BOE viniera sin zona, día en UTC. Arreglo defensivo: `madridDateKey(boeDate)`. Riesgo: bajo. ADITIVO.

**[BAJO] Display SOLO fecha (`toLocaleDateString` sin tz):** `agenda/calendar.tsx:125`, `agenda/week-view.tsx:228-229`, `agenda/draggable-list.tsx:139`, `chat/chat-shell.tsx:63-65,449`, `facturas/page.tsx:336,471,474,211,255`, `contratos/page.tsx:252,360`, `contratos/[id]/page.tsx:288,331,333`, `gastos/page.tsx:199,240`, `gastos/[id]/page.tsx:118,162`, `pruebas-gratuitas/page.tsx:64` y `[id]/page.tsx:35`, `ventas/page.tsx:128`, `ventas-perdidas/page.tsx:231,284`, `wallet/page.tsx:461,529`, `proposals/proposals-card.tsx:129`, `rrss/posts/page.tsx:125`, `maintenance-plans/contracts-table.tsx:88`, `routes/suggestions-client.tsx:165`, `gocardless/customer-mandates-panel.tsx:142`, `time-tracking/*-manager.tsx` (vacation/children/holidays).
Problema: fecha-solo sin tz; impacto solo cerca de medianoche / para timestamptz con hora. Arreglo: `formatDateES`. Riesgo: muy bajo. ADITIVO (display).

**[BAJO] `src/modules/customers/import-mapping.ts:168`**
Problema: parseo de fechas del CSV de importación con `.toISOString().slice(0,10)`. Datos históricos solo-fecha; aceptable, vigilar si entra hora. Riesgo: muy bajo. ADITIVO.

**[BAJO] Inputs de fecha-solo en formularios de gastos/per-diem/mileage/invoices** (`expenses/*.tsx`, `invoices/actions.ts:479,491`, `maintenance-plans/actions.ts`, `sepa/sepa-xml.ts`): usan `new Date().toISOString().slice(0,10)` como default de un `type="date"`. Para fechas-solo es tolerable, pero el default "hoy" puede ser el día UTC, no Madrid, tras medianoche. Arreglo: `madridDateKey(new Date())`. Riesgo: muy bajo. MODIFICA (default).

---

## Apéndice: writers de `datetime-local` que SÍ están correctos (referencia / no tocar)

- `src/modules/agenda/actions.ts:1177, 1221, 1321` — usan `madridLocalToUtcISO`. ✔
- `src/modules/free-trials/actions.ts:124-126` — `madridLocalToUtcISO`. ✔ (salvo validación línea 130-131, ver ALTO)
- `src/modules/installations/installation-wizard.tsx` (+ wizard-actions) — `madridLocalToUtcISO`. ✔
- `src/modules/customers/create-maintenance-button.tsx:57` — `madridLocalToUtcISO` en cliente. ✔
- `src/modules/customers/relocate-actions.ts:125`, `uninstall-actions.ts:196` — `madridLocalToUtcISO`. ✔
- Display correcto (con tz): `instalaciones/[id]/page.tsx`, `instalaciones/page.tsx` (const TZ), `installations/incident-row.tsx`, `free-trials/actions-panel.tsx:109`. ✔
- Lógica `is_outside_hours` de agenda (`computeIsOutsideHours`) — totalmente Madrid-aware (`madridIsoDow/JsDay/Hour/MinutesOfDay`). ✔
