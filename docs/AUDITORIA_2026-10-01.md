# Auditoría completa de Hidromanager (AGUACLAUDE2026), 1 de octubre de 2026

**Alcance.** Auditoría de solo lectura del repositorio en `main` (`dbcddc8`, más 4 ficheros sin commitear del arreglo de `zOptionalInt`) y de la base de datos real de producción (`pkgvzwunazzkstlfubnq`). En la base de datos solo se han hecho SELECT, a través de la Management API: esquema, CHECK, enums, políticas, grants, funciones, índices, recuentos, `error_reports` y `cron_runs`. No se han consultado ni copiado datos personales.

**Método.** Seis auditorías en paralelo (Zod/CHECK, IDOR en server actions, superficie pública, dinero y fiscal, idempotencia y zona horaria, integridad y errores de producción) y una revisión propia de crons y RPC. **Antes de incluirlos, he contrastado contra el código y contra producción todos los críticos y casi todos los importantes.** Uno de ellos era un posible falso positivo de RLS como el de la auditoría del 09-09: el del chat. Se comprobó con la clave anónima pública y es real.

**Estado de las comprobaciones automáticas.**
- `npx tsc --noEmit`: **exit 0, sin errores.**
- `npx vitest run`: **17 ficheros, 195 tests, todos en verde** (5,15 s). Solo aparece el stderr esperado del test fail-open de `entry-for-payment.test.ts`.

---

## Resumen ejecutivo

1. **El chat de todas las empresas se puede leer sin iniciar sesión.**
   - Las políticas de producción `chat_messages_company` y `chat_members_self` son `USING (true)` para `{public}`, y `anon` tiene SELECT.
   - Con la clave anónima pública, `GET /rest/v1/chat_messages` devuelve `Content-Range: */8` (los 8 mensajes que existen). Además, `chat_messages` está en la publicación realtime sin filtro.
   - Es la única fuga entre empresas confirmada en la base de datos.
2. **El cron diario nunca termina.**
   - Las 22 ejecuciones desde el 10-09 tienen `ended_at = null`. Vercel lo mata a los 300 s mientras recalcula el churn, cliente a cliente.
   - Todo lo que va detrás no se ha ejecutado nunca: **los recordatorios de impago**, los leads estancados y la limpieza de tech-prep.
3. **Las cuotas mensuales que el cron generó anoche (las 2 primeras de la historia) ya tienen los fallos que se predijeron:**
   - una cuota de 100 € a un particular salió como factura de **100,01 €** con un cobro de 100,00 €;
   - los cobros del wallet se crean **sin `invoice_id`**, así que aparecerán como "pendientes de facturar" (se factura dos veces). La factura del cron se quedará sin pagar y, cuando el cron llegue a esa parte, recibirá avisos de impago.
4. **No se puede emitir una rectificativa.** Las líneas se insertan con cantidad negativa y el CHECK `invoice_lines_quantity_check (quantity > 0)` las rechaza siempre; cada intento quema un número de la serie. Anular una factura emitida no tiene ningún control.
5. **Sigue abierto el doble IVA a particulares** en el botón "Facturar contrato": 1.210 € con IVA incluido se facturan como 1.464,10 €.
6. **Un contrato cancelado o finalizado sigue cobrando.**
   - El código escribe `wallet_entries.status = "cancelled"`, que **no existe en el enum**. El update falla en silencio en la cancelación de contratos, y con error crudo en "Cancelar cobro".
   - La remesa SEPA no filtra por el estado del contrato.
   - Hoy hay un cobro `pending` de un contrato `cancelled`.
7. **Completar una instalación o un mantenimiento no es idempotente.** Un doble envío descuenta el stock dos veces y duplica los equipos del cliente. Sigue abierto desde el 09-09.
8. **El autocierre de fichajes interpreta la hora de fin de turno en UTC.** Al trabajador que olvida fichar la salida se le apuntan **2 h de más** en el registro de jornada (1 h en invierno), que tiene valor legal.
9. **Bastantes funcionalidades fallan en silencio porque el código usa valores que el esquema no admite.**
   - Valores que no existen en los enums: `kind: "preventive"`, `status: "cancelled"`, `moment: "now"`, `subject_type: "invoice"`, `kind: "task"`, `"installed"`.
   - Funciones que solo existen en el esquema `app`: las 4 del agente de voz y las 2 de semillas de productos.
   - Consecuencias: los mantenimientos que se programan al firmar no se crean nunca, los avisos de facturas impagadas no se guardan, la purga RGPD de transcripciones de voz falla cada noche y el agente de voz no podría coger tareas aunque se configurara ElevenLabs.
10. **Borrar una dirección no ha funcionado nunca.** Ninguna de las 2.047 direcciones tiene `deleted_at`, y es el error real recogido en `error_reports` el 11-09.

---

## CRÍTICO

### C1. Chat legible sin login y difundido en tiempo real a todas las empresas
- **Dónde:** políticas de producción de `chat_messages`, `chat_thread_members` y `chat_threads`. En el cliente, `src/modules/chat/chat-shell.tsx:180-185`.
- **Evidencia (producción):**
  ```
  chat_messages        chat_messages_company  SELECT {public}  USING: true
  chat_thread_members  chat_members_self      SELECT {public}  USING: true
  chat_threads         chat_threads_company   SELECT {public}  USING: (company_id = COALESCE(jwt.company_id, company_id))
  grants: anon SELECT y authenticated SELECT en las tres tablas
  supabase_realtime: chat_threads, chat_messages
  GET /rest/v1/chat_messages?select=id  (solo la clave anónima)  -> 206, Content-Range: */8
  GET /rest/v1/chat_threads?select=id                          -> 206, Content-Range: */3
  ```
  En `chat_threads`, el `COALESCE` es verdadero cuando el JWT no lleva `company_id`, que es el caso de una petición anónima.
- **Escenario:** cualquiera con la clave anónima (va dentro del JavaScript de la web) descarga todos los mensajes de todas las empresas: texto, `meta` con nombre y teléfono de los clientes compartidos como tarjeta y rutas de adjuntos. Además, cualquier usuario autenticado de cualquier empresa recibe por websocket los mensajes nuevos de las demás, porque la suscripción del cliente no lleva filtro. Hoy son 8 mensajes de una empresa; el daño crece con el uso.
- **Arreglo:**
  - `revoke select on chat_messages, chat_threads, chat_thread_members from anon;`
  - Políticas para `authenticated`:
    - `chat_threads`: `company_id = app.current_company_id()`, sin COALESCE.
    - `chat_thread_members`: `exists(thread de mi empresa)`.
    - `chat_messages`: `exists(select 1 from chat_thread_members m join chat_threads t … where m.user_id = auth.uid() and t.company_id = app.current_company_id())`.
  - En el cliente, añadir `filter: thread_id=in.(…)` o usar un canal broadcast por empresa.
- **Estado:** **CONFIRMADO** (consulta anónima real, solo recuento).

### C2. El cron diario muere a los 300 s: nunca envía recordatorios de impago
- **Dónde:** `src/app/api/cron/daily/route.ts:12` (`maxDuration = 300`) y el bucle de churn en `:1736-1815`, que va **antes** de los leads estancados (`:1818`), los recordatorios de impago (`:1873-2185`), la limpieza de tech-prep (`:2188`) y `tracker.finish` (`:2269`).
- **Evidencia (producción, `cron_runs`):**
  ```
  daily  n=22  ended_at null en las 22  summary {}   (desde 2026-09-10; la última, 2026-10-01 22:00:38)
  customers.updated_at entre 22:01 y 22:05:37 del 30-09: 219+357+363+366+221 filas  -> corte en 22:00:38 + 300 s
  invoice_reminders_sent: 0 filas
  ```
  El bucle hace unas 5 consultas secuenciales por cliente sobre 1.857 clientes.
- **Escenario:** una factura vence y el cliente no recibe nunca ningún recordatorio (niveles 1-3 ni vía legal). Cada cliente nuevo adelanta el punto de corte. Hoy la facturación mensual (`:1327`) va antes del churn y sí se ejecutó anoche, pero con más volumen también acabará cortada.
- **Agravante:** existe un segundo cálculo de churn (`:1083-1106`) que llama a `recomputeChurnScoreAction`, y esta empieza con `requireSession()`. En un cron no hay sesión.
- **Arreglo:**
  - Sacar el churn a un cron propio, o mejor a una única consulta SQL por conjuntos (un `UPDATE … FROM (agregados)`).
  - Mientras tanto, moverlo al final del cron con un límite de tiempo.
  - Borrar el bloque `:1083-1106`.
  - A medio plazo, trocear `daily` (2.275 líneas) en crons independientes.
- **Estado:** **CONFIRMADO** con datos de producción. Ya se señaló el 09-09 y sigue abierto.

### C3. Cuota mensual: el wallet se crea sin factura asociada y el desglose del IVA no cuadra
- **Dónde:**
  - `src/app/api/cron/daily/route.ts:1471-1480`: el `wallet_entries` se inserta sin `invoice_id`.
  - `src/modules/wallet/actions.ts:990-1005`: `listPendingInvoiceWalletEntries` filtra `.is("invoice_id", null)`.
  - `src/modules/wallet/actions.ts:444-613`: `validateWalletEntryAction` no toca `invoices` ni `invoice_payments`.
  - `src/modules/invoices/create-core.ts:318-333`: `splitMonthlyFee`.
- **Evidencia (producción, las 2 cuotas del cron de anoche, solo importes):**
  ```
  empresa:    monthly 10000 -> factura base 10000 + IVA 2100 = 12100 ; contract_payment 12100
  particular: monthly 10000 -> factura base 8265 + IVA 1736 = 10001 ; contract_payment 10000   <- 1 céntimo de descuadre
  wallet_entries de ambos contratos creados anoche con invoice_id NULL: 1 y 1
  ```
- **Escenario:**
  1. El cliente paga los 100 € por SEPA y el administrador valida el cobro en el wallet.
  2. El cobro aparece en "pendientes de facturar". Al pulsar "Facturar", se crea una **segunda factura** del mismo mes.
  3. La factura del cron, una vez emitida, sigue `issued` sin ningún pago (y aunque lo tuviera, faltaría 1 céntimo).
  4. Cuando se arregle C2, ese cliente recibirá **avisos de impago** a los 7, 14 y 30 días.
  - El webhook de GoCardless (`api/gocardless/webhook/route.ts:194-202`) tiene el mismo hueco: actualiza el wallet y el `contract_payment`, pero nunca la factura.
- **Por qué no cuadra el IVA:** el bucle de `splitMonthlyFee` busca una base `b` tal que `b + round(0,21·b) = T`, y esa base no existe para todos los importes. Según el cálculo del subagente, falla en 3.454 de los 19.901 importes entre 1 € y 200 €; por ejemplo, 29,99 -> 29,98, 35,00 -> 34,99 y 100,00 -> 100,01. Después `createInvoiceCore` vuelve a calcular el IVA a partir de la base.
- **Arreglo:**
  - El cron debe guardar `invoice_id` en el wallet.
  - Al validar un cobro del wallet (y en el webhook `confirmed`/`paid_out`), crear el `invoice_payment` y marcar la factura como `paid`.
  - En las líneas con IVA incluido, guardar `tax_cents = total − base` en vez de recalcularlo (o un flag `price_includes_vat` en la línea que respete `calcLineTotals`).
  - Añadir un índice único `(contract_id, billing_period)` en `invoices` y `contract_payments`.
- **Estado:** **CONFIRMADO** (código y datos de anoche).

### C4. Las rectificativas no se pueden crear y anular una factura emitida no tiene control
- **Dónde:** `src/modules/invoices/actions.ts:559-579` (`createCreditNoteAction`), frente al CHECK de producción `invoice_lines_quantity_check CHECK (quantity > 0)`. También `create-core.ts:269-294`, `actions.ts:433-456` (`cancelInvoiceAction`) y `:545-556` (`deleteOrRectifyInvoiceAction`).
- **Evidencia:**
  ```ts
  quantity: -Math.abs(l.quantity),
  ```
  `createInvoiceCore` numera la cabecera, falla al insertar las líneas, borra la factura y lanza el error.
- **Escenario:**
  - El administrador pulsa "Crear rectificativa" (`invoice-actions.tsx:145`) o "Borrar" sobre una factura que no es el último borrador. Recibe un error crudo de Postgres y **se quema un número de la serie** en cada intento.
  - Hoy no hay ninguna forma de rectificar: `invoice_payments` tiene además `CHECK amount_cents > 0`.
  - A la vez, `cancelInvoiceAction` deja pasar a `cancelled` una factura `issued`/`overdue` sin comprobar el estado ni generar la anulación de VeriFactu (la interfaz la ofrece en `invoice-actions.tsx:150`).
  - Además, `create-core.ts:246` pone `invoice_type = "F1"` a todo, también a las rectificativas, y `getInvoice` no lee `financier_id`, así que la rectificativa de una factura a financiera fallaría igualmente.
- **Arreglo:**
  - Rectificativa con cantidades positivas y `kind='credit_note'`, con el signo aplicado al presentarla (o permitir `quantity <> 0` y redondear por magnitud: `sign*round(abs)`, porque `Math.round(-262.5) = -262` frente a 263).
  - `invoice_type` R1-R5 (ver pregunta de negocio).
  - Pasar `financier_id`.
  - En `cancelInvoiceAction`, exigir `status='draft'` o derivar a la rectificativa.
- **Estado:** **CONFIRMADO** (el CHECK se ha leído en producción).

### C5. Doble IVA a particulares en "Facturar contrato"
- **Dónde:** `src/modules/invoices/actions.ts:691-722` (`createInvoiceFromContractAction`).
- **Evidencia:** `unit_price_cents: it.unit_price_cash_cents ?? 0, … tax_rate_percent: fiscal.invoice_default_iva`.
  - `pickPrice` (`pick-price.ts:64-72`) devuelve el precio con IVA incluido al particular.
  - Ese precio llega a `proposal_items.unit_price_cash_cents` (`proposals/actions.ts:530`) y a `contract_items.unit_price_cents` (`contracts/actions.ts:532`).
  - En ningún punto se guarda si el precio incluye IVA.
- **Escenario (particular):** una ósmosis de 1.210 € con IVA incluido se factura como base 1.210 + IVA 254,10 = **1.464,10 €**, cuando lo correcto es 1.000 + 210. Si es una empresa sin precio de empresa configurado, el *fallback* de `pick-price.ts:55-62` produce lo mismo.
- **Otros fallos del mismo botón:**
  - Cada clic genera otra factura: no hay comprobación de factura previa.
  - En un alquiler factura la cuota de `contract_items` (por ejemplo, 30 €) como si fuera el importe del contrato.
  - El PDF de contrato y el de propuesta ponen "IVA incluido" también a empresas (`contracts/pdf-generator.ts:1354,1360` y `proposals/pdf-generator.ts:184`).
- **Arreglo:** guardar `prices_include_vat` en la propuesta y en el contrato al firmar, y desglosar con la misma regla que la cuota. Comprobar si ya hay factura. Limitar el botón a `plan_type='cash'`.
- **Estado:** **CONFIRMADO.** Sigue abierto desde el 09-09: en el cron de cuotas está cerrado, aquí no.

### C6. Un contrato cancelado o finalizado sigue cobrando; la fianza no se puede devolver
- **Dónde:**
  - `src/modules/contracts/actions.ts:1662-1683` (`cancelContractAction`).
  - `src/modules/wallet/actions.ts:786` (`cancelWalletEntryAction`).
  - `src/modules/contracts/finalize-rental-actions.ts:110-127`.
  - `src/modules/sepa/sepa-xml.ts:132-140`.
- **Evidencia (producción):**
  ```
  enum wallet_entry_status = pending,collected,pending_settlement,settled,validated,rejected   (no hay "cancelled")
  contract_payments_amount_cents_check CHECK (amount_cents >= 0)
  wallet_entries_amount_cents_check   CHECK (amount_cents >= 0)
  ```
  ```ts
  // wallet/actions.ts:786
  status: "cancelled",
  // finalize-rental-actions.ts:117
  amount_cents: -returnCents,
  ```
- **Escenario:**
  - **Cancelar un contrato:** el update de sus wallets a `"cancelled"` falla con 22P02 y se ignora. Tampoco se tocan los `contract_payments` pendientes, y la remesa SEPA no filtra por estado del contrato, así que **se le sigue domiciliando** al cliente. Hoy hay 1 cobro `pending` de un contrato `cancelled`.
  - **"Cancelar cobro" en el wallet:** el usuario ve `invalid input value for enum app.wallet_entry_status: "cancelled"`.
  - **Finalizar un alquiler devolviendo una fianza de 150 €:** el insert negativo choca con el CHECK, solo se registra en `console.error` y el contrato pasa a `completed` sin constancia de la devolución.
  - Los filtros `.in("status", ["rejected","cancelled"])` de `customers/churn-score.ts:72`, `wallet/smart-alerts.tsx:136` y `customers/smart-alerts.tsx:197` revientan con el mismo 22P02, así que "pagos fallidos" siempre sale 0.
- **Arreglo:**
  - Usar `rejected` (más `rejected_reason`) o añadir `cancelled` al enum mediante una migración.
  - Al cancelar o finalizar, cancelar los `contract_payments` pendientes.
  - En la remesa, filtrar `contracts.status in ('active','signed')`.
  - Registrar la devolución de la fianza como movimiento de salida con importe positivo.
  - Comprobar `error` en las tres escrituras.
- **Estado:** **CONFIRMADO** (enum y CHECK leídos en producción, y recuento del cobro vivo).

### C7. Completar instalación o mantenimiento con doble envío: stock descontado dos veces y equipos duplicados
- **Dónde:** `src/modules/installations/actions.ts:1548-1558` y `src/modules/maintenance/actions.ts:613-622`.
- **Evidencia:**
  ```ts
  await admin.from("installations").update({ status: "completed", completed_at: nowIso, … }).eq("id", parsed.id);
  ```
  No hay condición sobre el estado previo, y el resultado ni siquiera se comprueba. Después se llama a `decrementStockForInstallation` (`:1711`) y se hace el insert en `customer_equipment` (`:1792`). El comentario de `wizard-actions.ts:800` ("idempotente") es falso.
- **Escenario:** el técnico pulsa "Finalizar" con mala cobertura y vuelve a pulsar. El stock de la furgoneta baja dos veces, aparecen dos equipos en la ficha del cliente y salen mantenimientos fantasma. En el mantenimiento se duplican los recambios, el stock y los puntos.
- **Arreglo:** compare-and-set:
  ```ts
  .update(...).eq("id", id).neq("status", "completed").select("id")
  ```
  Si no devuelve ninguna fila, salir sin efectos secundarios. Mejor aún, una RPC transaccional.
- **Estado:** **CONFIRMADO** en el código. Sigue abierto desde el 09-09. En producción no se ha visto todavía ningún caso.

### C8. El autocierre de fichajes apunta 2 h de más en el registro de jornada
- **Dónde:** la función de producción `app.autoclose_stale_punches()`.
- **Evidencia (`pg_get_functiondef` en producción):**
  ```sql
  and day_of_week = ((extract(isodow from punch.punched_at)::int - 1) % 7);
  shift_end_iso := (punch.punched_at::date + sched.ends_at)::timestamptz;   -- BD en UTC
  ```
- **Escenario:** el horario acaba a las 17:00 y el trabajador olvida fichar la salida. El fichaje se cierra a las 17:00 **UTC**, que son las 19:00 en Madrid, y constan 2 horas de trabajo que no se hicieron (1 h a partir del 25-oct). El registro horario es exigible por la Inspección de Trabajo.
- **Agravante:** la notificación al trabajador no sale nunca (`api/cron/hourly/route.ts:42-48`). Busca `punched_at >= now-1h`, pero la función solo cierra cuando `now >= fin + 2h`, así que no encuentra nada. Y aunque lo encontrara, el `subject_type` que usa no existe en el enum (ver I3).
- **Arreglo:**
  ```sql
  ((punch.punched_at at time zone 'Europe/Madrid')::date + sched.ends_at) at time zone 'Europe/Madrid'
  ```
  Calcular también `isodow` y `::date` en hora de Madrid. En la notificación, filtrar por `created_at` o hacer que la RPC devuelva los ids cerrados.
- **Estado:** **CONFIRMADO.** Hoy hay 0 fichajes autocerrados.

---

## IMPORTANTE

### Integridad: valores fuera de enum y funciones inexistentes (fallos silenciosos)

**I1. Los mantenimientos que se programan al firmar no se crean nunca**
- **Dónde:** `src/modules/contracts/maintenance-scheduler.ts:102`, con `kind: "preventive"`. El enum de producción `maintenance_kind` solo admite `contracted, one_off, warranty`.
- **Cuándo pasa:** se llama al firmar (`contracts/actions.ts:1003`, `post-sign.ts:134`). El insert de `:111` no comprueba el error y la función devuelve `rows.length` como si hubiera creado las visitas. Además **encola correos de recordatorio de visitas que no existen**: hay 2 `maintenance_reminder` en `email_outbox`, los dos `failed`, y 0 trabajos con esa nota.
- **Mismos fallos en el cron:**
  - `cron/daily/route.ts:1642` usa `kind: "preventive"` y avisa a los administradores de una revisión "agendada" que no existe.
  - `cron/daily/route.ts:717` filtra `.in("status", ["signed","active","installed"])`, y `installed` no está en `contract_status`. La consulta da error 22P02, así que `ensureMaintenanceWindow` no se ejecuta nunca desde el cron. El otro camino (`auto-schedule.ts`, que el cron llama al activar un contrato) sí ha creado 53 visitas.
- **Arreglo:** usar `"contracted"`, quitar `"installed"` y comprobar `error`.
- **Estado:** CONFIRMADO.

**I2. Las RPC del agente de voz y de semillas de productos solo existen en el esquema `app`, que PostgREST no expone**
- **Dónde:**
  - `api/cron/voice-retention/route.ts:47` (`voice_purge_transcripts`)
  - `api/cron/voice-calls/route.ts:55,101` (`voice_release_stale_tasks`, `voice_claim_tasks`)
  - `api/voice-agent/inbound/route.ts:76` (`voice_company_for_inbound`)
  - `modules/products/seed-actions.ts:40,73` (`import_global_water_categories`, `import_standard_service_lines`)
- **Evidencia:** `db_schema = "public,graphql_public"`. Las seis funciones existen solo en `app.*`, no hay wrapper en `public`, y en el código no aparece ningún `.schema("app")`. En `cron_runs`: `voice-retention ok=false 21/21`, con `{"section":"purge","message":"[object Object]"}`.
- **Escenario:**
  - La purga RGPD de transcripciones no se ha ejecutado nunca.
  - Cuando se configure ElevenLabs, el cron `voice-calls` no podrá coger ninguna tarea: el error se ignora y `claimed` queda `[]`, así que el agente "funciona" pero no llama. Las llamadas entrantes tampoco sabrán de qué empresa son.
  - El botón "Importar líneas de servicio estándar" del estado vacío de productos (`empty-state.tsx:50`) devuelve un error.
- **Arreglo:** crear wrappers `public.*` solo para `service_role`, como se hizo con los `seed_*` el 28-08, y comprobar `error` en las llamadas. Corregir también `telemetry.ts:41` para que un `PostgrestError` no se registre como "[object Object]".
- **Estado:** CONFIRMADO. Hay que añadirlo al pendiente del agente de voz: **no basta con la cuenta de ElevenLabs**.

**I3. Avisos y tareas que no se guardan por `subject_type` o `kind` fuera del enum**
- **Enums en producción:**
  - `subject_type` no incluye `invoice`, `loading_request`, `maintenance_contract`, `agenda`, `expense` ni `time_punch`.
  - `agenda_event_kind` no incluye `task`.
- **Sitios afectados:**
  - Facturas impagadas: `cron/daily/route.ts:1950` (aviso de vía legal) y `:2159` (aviso de recordatorio).
  - Tarea "Llamar — factura impagada": `cron/daily/route.ts:2003-2009`, con `kind:"task"` y `subject_type:"invoice"`.
  - Recordatorio manual de pago: `invoices/payment-reminder-actions.ts:33,66`. La lectura falla y el nivel calculado es siempre "first".
  - Aviso de autocierre de fichaje: `cron/hourly/route.ts:64`.
  - Cargas de furgoneta: `time-tracking/actions.ts:136`, `warehouses/auto-loading.ts:193` y `loading-request-actions.ts:187,206`.
  - `maintenance-plans/actions.ts:189,365`.
  - Tarea "reactivar mantenimiento": `maintenance/actions.ts:848`, con `kind:"task"`.
  - `agenda/actions.ts:1613` y `expenses/actions.ts:597`.
- **Evidencia:** en producción hay 0 notificaciones `invoice.%`, `time_tracking.%`, `loading%` y `expense%`.
- **Arreglo:** usar valores válidos (por ejemplo, `subject_type: "customer"` con el id de la factura en el payload) o ampliar el enum. Comprobar `error`.
- **Estado:** CONFIRMADO.

**I4. `markWalletAsCollectedAction` escribe `moment: "now"`, que no existe en `payment_moment`**
- **Dónde:** `src/modules/wallet/actions.ts:731`.
- **Escenario:** falla el update completo del `contract_payment` y el error no se comprueba. El pago queda `pending` aunque el cobro esté `collected`, hasta que lo corrige `reconcile-payments.ts:177` (como mucho 24 h).
- **Arreglo:** quitar `moment`.
- **Estado:** CONFIRMADO.

**I5. Desinstalar una prueba gratuita: la comprobación de duplicados nunca funciona**
- **Dónde:** `src/modules/free-trials/uninstall-actions.ts:81`. Filtra `.in("status", [... "agendada" ...])`, y ese valor no existe en `installation_status`.
- **Escenario:** la consulta falla, `existing` queda en null y se pueden crear órdenes de desinstalación duplicadas.
- **Estado:** CONFIRMADO.

### Errores reales en producción (`error_reports`, últimos 60 días: 15 informes, 48 ocurrencias)

**I6. No se puede borrar ninguna dirección**
- **Dónde:** `src/modules/addresses/actions.ts:191-201`. Es el error "new row violates row-level security policy for table addresses", registrado 2 veces el 11-09 en `/clientes/[id]` y `/leads/[id]`.
- **Evidencia:** el borrado suave hace `update({deleted_at})` con el cliente RLS. La política `addresses_select_inherit` exige `deleted_at IS NULL`, y en Postgres un UPDATE con WHERE exige que la fila nueva siga siendo visible por la política de SELECT. Hay **0 de 2.047** direcciones con `deleted_at`.
- **Mismo fallo, en silencio:**
  - `contracts/actions.ts:928-931`: el borrado suave del lead de origen al firmar en persona falla. Hay 4 leads vivos cuyo cliente tiene contrato `signed`/`active`.
  - `customers/merge-actions.ts:165-172`: la fusión de clientes no borra el duplicado.
- **Arreglo:** usar el admin client con `.eq("company_id", session.company_id)`, o una RPC `security definer`. Añadir `revalidatePath`.
- **Estado:** CONFIRMADO.

**I7. Las server actions que lanzan una excepción pierden el mensaje en producción**
- **Dónde:** `createCustomerAction` (`customers/actions.ts:633,636,699`) y `createProductAction` (`products/actions.ts:500-535`).
- **Escenario:** es el "Algo ha fallado en el servidor" registrado 2 veces en `/clientes/nuevo`. Next oculta en producción el mensaje de un `throw`, así que el texto amable de `parseOrFriendly` (por ejemplo, un teléfono con formato inválido) nunca llega al usuario.
- **Afecta al arreglo de hoy:** el mensaje nuevo de `zOptionalInt` en productos tampoco llegará; el usuario verá el genérico.
- **Arreglo:** devolver `{ok:false, error}` en las validaciones y en los errores de BD, usando `toActionError`.
- **Estado:** CONFIRMADO en el código. Cuál de los tres `throw` causó los 2 informes está SIN VERIFICAR, porque el informe no incluye el digest.

**I8. El arreglo de las medidas de producto está incompleto: falta la edición**
- **Dónde:** `src/modules/products/edit-form.tsx:77-80`, que envía `form.dim_d ? Number(form.dim_d) : null`. `updateProductAction` (`products/actions.ts:657-726`) no valida nada en el servidor.
- **Escenario:**
  - Con "0", salta el mismo `products_dim_depth_mm_check`.
  - Con "12.5", sale "invalid input syntax for type integer".
  - El diff del alta es correcto para el campo vacío.
- **Arreglo:** un schema parcial que reutilice `zOptionalInt(1)` en `updateProductAction`, y `min=1 step=1` en los inputs.
- **Estado:** CONFIRMADO.

**Resto de mensajes:**
- "No hemos podido localizar la dirección" (24 veces): es Google Maps sin facturación (pendiente conocido). Bloquea el alta del lead si hay calle y CP; se puede salir con la chincheta de Leaflet/OSM o con el GPS.
- "Email no válido" al editar un cliente: el email tecleado era realmente inválido. Hoy 0 de 1.745 emails de clientes incumplen el regex. Mejora menor: hacer `.trim().toLowerCase()` antes de `.email()` y unificar con el regex más laxo de `pre-sign-modal.tsx:826`.
- Duplicados, falta de GPS y permisos denegados: no son fallos.

### Seguridad multiempresa e IDOR

En todos estos casos hace falta conocer el UUID de un recurso de otra empresa. No se puede adivinar, pero los UUID se filtran: por URLs, por PDFs y por el chat de C1.

**I10. `upsertAddressAction` permite quedarse con direcciones de otra empresa**
- **Dónde:** `src/modules/addresses/actions.ts:170-173`.
- **Evidencia:** `admin.from("addresses").update(payload).eq("id", parsed.id)`, y el payload lleva `company_id: session.company_id`. Con el UUID de una dirección de A, un usuario de B la sobrescribe y la traslada a B.
- **Estado:** CONFIRMADO.

**I11. El borrado RGPD enmascara el IBAN de clientes de otra empresa**
- **Dónde:** `src/modules/customers/rgpd-actions.ts:204-223`.
- **Evidencia:** el update de `customers` sí filtra por empresa, pero la acción no comprueba que haya afectado a alguna fila y sigue adelante. Las cuentas bancarias se enmascaran filtrando solo por `customer_id`.
- **Nota:** los buckets que intenta vaciar después (`dni-photos`, `customer-documents`, `id-card-photos`, `free-trial-docs`) **no existen en producción**, así que esa parte no hace nada.
- **Arreglo:** select previo del cliente con `company_id` y abortar si no existe.
- **Estado:** CONFIRMADO.

**I12. Plantillas de mensaje y series de facturación sin filtro de empresa**
- **Plantillas:** `messaging/actions.ts:119,130`. Sigue abierto desde el 09-09.
- **Series:** `invoices/verifactu-actions.ts:138-142` hace `update(payload).eq("id", input.id)` con el `company_id` de la sesión dentro del payload. Un administrador de A puede quedarse con la serie de B y romper su numeración. Si quien lo hace es un superadmin sin empresa, la serie queda con `company_id = null`.
- **Arreglo:** `.eq("company_id", session.company_id)` y comprobar que se ha actualizado 1 fila.
- **Estado:** CONFIRMADO.

**I13. `updateCustomerAction` y `updateLeadAction` aceptan cualquier columna**
- **Dónde:** `customers/actions.ts:883-893` y `leads/actions.ts:750-759`.
- **Evidencia:** copian el input entero a un update con el admin client, sin lista blanca de campos y sin comprobar el rol.
- **Escenario:** cualquier empleado puede reasignarse clientes (`assigned_user_id`), tocar `deleted_at` o `status`, o cambiar `company_id`.
- **Arreglo:** lista blanca de campos y alcance por rol.
- **Estado:** CONFIRMADO.

**I14. `testSmtpAction` sigue entregando contraseñas SMTP guardadas a un host que elige el usuario**
- **Dónde:** `mailing/actions.ts:188-245`.
- **Qué ya está arreglado:** ya no cruza empresas.
- **Qué sigue abierto:** descifra la contraseña guardada y se conecta a `input.smtp_host`. Un `company_admin` puede capturar en su propio servidor la contraseña del correo personal de un empleado.
- **Arreglo:** si no llega una contraseña nueva, usar el host, el puerto y el usuario guardados.
- **Estado:** CONFIRMADO. Corregido solo en parte desde el 09-09.

**I15. FKs de otra empresa en altas, que luego devuelven datos personales por JOIN del admin client**
- **Sitios:**
  - `free-trials/actions.ts:143-149`, junto con `pdf-generator.ts:802-846`: el PDF sale con el DNI, el teléfono y la dirección de un cliente ajeno.
  - `maintenance-plans/actions.ts:132-176`: el IBAN ajeno se copia a `iban_snapshot`.
  - `expenses/actions.ts:381-383,419` y `savings/actions.ts:836-850,198`.
  - `warehouses/loading-request-actions.ts:36-46,127-140`: puede entregar stock a un almacén de otra empresa. Además, entregar no comprueba el rol.
  - `invoices/create-core.ts:183-197`: la dirección del cliente no se filtra por empresa.
  - `gocardless/actions.ts:390-494`: los ids de `contract_payment` y de factura no se validan, y la acción no comprueba el rol. Cualquier técnico puede lanzar adeudos.
- **Arreglo:** validar cada FK que llegue del navegador con `.eq("company_id")` antes del insert. Valorar un trigger `same_company` en las FKs críticas.
- **Estado:** CONFIRMADO, según la revisión del subagente. He contrastado en persona el patrón en direcciones y en RGPD.

**I16. Las comisiones de toda la plantilla son visibles y exportables por cualquier usuario**
- **Dónde:** `points/cycles-actions.ts:145-173` y `api/comisiones/[id]/export/route.ts:27-34`. Solo comprueban la sesión, y el admin client se salta la RLS `points_ledger_user_select`.
- **Impacto hoy:** nulo, porque `points_cycles` tiene 0 filas.
- **Estado:** CONFIRMADO (ver pregunta de negocio 9).

**I17. Chat: `markChatThreadRead` mete al usuario en cualquier hilo**
- **Dónde:** `chat/actions.ts:368-383`. Hace un upsert de la membresía sin comprobar nada.
- **Escenario:** un compañero que conozca el id de un hilo privado se añade a él y lee la conversación.
- **Otros fallos del chat:** `createTeamThreadAction` y `getOrCreateDirectThreadAction` insertan `user_id` sin validar (`:617-623`, `:681-684`). `updateUserRoles` (`tenant/users/actions.ts:394-454`) sigue sin comprobar la empresa del usuario destino. No escala privilegios, porque el hook del token filtra por la empresa del perfil, pero ese usuario aparece en el directorio y en las notificaciones de otra empresa.
- **Estado:** CONFIRMADO.

**I18. Fichajes: avisos del BOE globales y huecos de asistencia de otras empresas**
- **Avisos del BOE:** `time-tracking/legal-notices-actions.ts:72,95`. `legal_notices` no tiene `company_id`, así que un director que descarta un aviso lo quita para las 4 empresas.
- **Huecos de asistencia:** `attendance-gaps-actions.ts:92-111`. La rama "dismissed" actualiza por id sin `company_id`.
- **Estado:** CONFIRMADO.

### Superficie pública

**I19. Catálogo, ficha técnica y PDF de la firma remota llevan al login**
- **Dónde:** `src/shared/lib/supabase/middleware.ts:64-80`. `PUBLIC_PATHS` no incluye `/catalogo/`, `/datasheet/`, `/api/pdf/catalog-v2/` ni `/api/pdf/contract/public/`.
- **Evidencia (producción, comprobada por mí):**
  ```
  GET https://crm.hidromanager.es/datasheet/000…  -> 307 /login?next=%2Fdatasheet%2F…
  GET https://crm.hidromanager.es/catalogo/000…   -> 307 /login?next=%2Fcatalogo%2F…
  ```
- **Escenario:** el cliente recibe la ficha técnica por correo y le sale el login del CRM. En la firma remota, "Ver PDF" no funciona por dos motivos: el middleware lo manda al login y, si pasara, `generateContractPdf` (`contracts/pdf-generator.ts:1164`) llama a `requireSession()` y daría 500. El cliente firma sin ver el contrato.
- **Arreglo:** añadir las cuatro rutas (todas validan un token de 24 bytes con caducidad). Crear un `generateContractPdfForCompany(contractId, companyId)` sin sesión. Apuntar el PDF de la ficha técnica a una ruta por token.
- **Estado:** CONFIRMADO.

**I20. Open redirects**
- **`/api/track/click/[id]`** (`route.ts:21,61`): comprobado en producción por el subagente, `?u=<base64 de https://example.com>` devuelve un 302 a `example.com`, y redirige aunque el id no exista. Sigue abierto desde el 09-09.
- **`/api/gocardless/callback`** (`route.ts:17-33`): acepta `return_path=//evil.com` y refleja `e.message`. Sigue abierto desde el 09-09.
- **Arreglo:** un HMAC del destino en los enlaces de tracking, y aceptar `return_path` solo si cumple `^/[^/\\]`.
- **Estado:** CONFIRMADO.

**I21. La firma remota no comprueba el estado del contrato**
- **Dónde:** `contracts/remote-sign-actions.ts:371-374` y `499-508`.
- **Escenario:** se manda el enlace (vale 14 días) y el contrato se cancela o se firma en persona. Si el cliente firma después, el contrato vuelve a `signed`/`pending_data` y se relanzan los efectos posteriores a la firma. Nunca se escribe `cancelled_at` en `contract_remote_signatures`.
- **Arreglo:** un update condicional sobre los estados firmables y cancelar las firmas remotas vivas al firmar o cancelar el contrato.
- **Estado:** CONFIRMADO.

### Dinero e idempotencia

**I22. Marcar una factura como cobrada: lee, suma y escribe sin bloqueo ni validaciones**
- **Dónde:** `invoices/actions.ts:368-431`.
- **Escenario:**
  - Un doble clic, o dos pestañas, crean dos cobros validados.
  - No comprueba el estado: se puede "cobrar" una factura `cancelled` o en borrador.
  - El importe no tiene tope: un cobro de 200 € sobre 50 € pendientes se acepta.
  - Los errores de `invoice_payments` se ignoran.
- **Arreglo:** una RPC con `SELECT … FOR UPDATE` que compruebe el estado y que `amt <= pendiente`.
- **Estado:** CONFIRMADO. Sigue abierto desde el 09-09.

**I23. Remesa SEPA**
- **Fecha de cobro:** `sepa-xml.ts:279` pone `ReqdColltnDt` = hoy en UTC, que además es una fecha pasada si se genera entre las 00:00 y las 02:00. Los bancos exigen D+1 hábil o más.
- **Fecha de mandato:** `:264` inventa la fecha de firma del mandato cuando falta.
- **Remesa duplicable:** `:103-110` y `:359-387`. El XML se entrega antes de bloquear los pagos, el update no lleva `.is("sepa_batch_id", null)`, no hay índice único de batch `open` y no se comprueba el error del insert.
- **IBAN:** se toma de la cuenta principal del cliente, no del `debtor_iban` del mandato (`:176-194`).
- **Remesas enviadas:** `cancelSepaBatchAction:461-464` libera los pagos de una remesa ya `sent`.
- **Estado:** CONFIRMADO. Todo sigue abierto desde el 09-09. Hoy hay 0 remesas.

**I24. GoCardless**
- **Clave de idempotencia aleatoria:** `client.ts:261` usa `crypto.randomUUID()`, así que un doble clic en "Cobrar" crea dos cargos reales. Tampoco se comprueba si la factura ya tiene un pago vivo.
- **Reintentos sin fin:** `retry.ts:118-131` crea el reintento con `retry_count: 0`, así que `MAX_PAYMENT_RETRIES` no limita nada.
- **Webhook:** si `processEvent` falla, responde 200 y el reintento de GoCardless choca con el índice único y se descarta. `retryFailedWebhookEvents` no reprocesa nada (`retry.ts:204-222`). No hay máquina de estados: un `confirmed` que llega tarde hace retroceder un `paid_out`.
- **Arreglo:** una clave determinista; `retry_count + 1`; responder 500 si falla el proceso; no permitir retrocesos de estado.
- **Estado:** CONFIRMADO. Hay 4 pagos y 0 webhooks recibidos.

**I25. Numeración `max()+1` sin bloqueo en propuestas, contratos, instalaciones, mantenimientos, ahorro y `gen_reference_code`**
- **Dónde:** `proposals/actions.ts:428-449`, `contracts/actions.ts:374-392` y `post-sign.ts:167`, `installations/actions.ts:699-715`, y la función `public.gen_reference_code` (`order by reference_code desc limit 1`, sin lock).
- **Evidencia:** en producción no hay índice único de `reference_code` en `proposals`, `contracts`, `installations`, `maintenance_contracts` ni `savings_proposals`.
- **Escenario:** dos comerciales en el mismo segundo obtienen el mismo `P-2026-0003`. Al pasar de 9999, el orden de texto repite el 10000.
- **Arreglo:** contadores con `UPDATE … RETURNING`, índices únicos, orden numérico y año calculado en Madrid.
- **Estado:** CONFIRMADO. Hoy hay 0 duplicados.

**I26. Firmar un contrato o generarlo desde una propuesta no tiene guarda de estado**
- **Firmar:** `contracts/actions.ts:898-902` actualiza sin filtrar por estado y luego inserta `sales_records` sin comprobar (`:1317-1319`). Volver a firmar un contrato `active` lo devuelve a `signed` y duplica las ventas en objetivos y comisiones.
- **Generar desde propuesta:** `:205-215` comprueba el duplicado con el cliente RLS, y con alcance `own` no ve los contratos de otros comerciales.
- **Contrato a medias:** `createContractFromProposal` no comprueba los errores al insertar `contract_items` (`:535-538`) ni `contract_payments` (`:668-679`), así que puede quedar un contrato sin líneas ni plan de pagos.
- **Estado:** CONFIRMADO.

**I27. Propuestas**
- **Aceptar o enviar sin aprobación:** `markProposalSent` y `markProposalAccepted` (`proposals/actions.ts:897-918,939-965`) no comprueban el estado ni el rol. Se puede aceptar una propuesta `pending_approval` saltándose la aprobación.
- **Precios del navegador:** el servidor recalcula el total con los precios que manda el navegador (`:376-417`) y no aplica `absolute_min_cents`.
- **Estado:** CONFIRMADO. Si la interfaz oculta el botón está SIN VERIFICAR.

**I28. "Generar cuotas" (botón de /facturas) contradice al cron**
- **Dónde:** `invoices/actions.ts:824-907`.
- **Qué hace mal:**
  - Desglosa siempre el IVA, también a empresas: 100 € de base salen como 82,64 + 17,36.
  - Filtra `status='signed'`, mientras que un alquiler instalado está `active`.
  - No pone `billing_period`.
  - Su idempotencia es "cualquier factura de ese mes".
  - En modo VeriFactu llama a `createMonthlyV2InvoiceAction`, que inserta sin `kind`, `number`, `fiscal_year` ni `full_reference` (NOT NULL), así que falla.
- **Arreglo:** que llame a `createContractMonthlyInvoice`, igual que el cron.
- **Estado:** CONFIRMADO.

**I29. Renting con financiera: el cron también factura y domicilia la cuota al cliente**
- **Dónde:** `cron/daily/route.ts:1346-1353` (no mira `financier_id`) e `invoices/actions.ts:839-843`.
- **Impacto hoy:** ninguno, porque los 3 renting están en `draft`/`pending`.
- **Estado:** CONFIRMADO en el código. Depende de la pregunta de negocio 2.

**I30. El tipo de cliente se lee al facturar, no al firmar**
- **Dónde:** `create-core.ts:356-367`.
- **Escenario:** desde el commit 68fac0c se puede convertir un particular en empresa. Un particular con una cuota de 50 € IVA incluido que se convierte pasa a facturarse a 60,50 €.
- **Estado:** CONFIRMADO.

**I31. VeriFactu: hay que rediseñarlo antes de activarlo (hoy está dormido: las 4 empresas están en `verifactu_mode = no_envio`)**
- **Doble numeración:** `issueInvoiceV2Action` (`verifactu-actions.ts:669-682`) vuelve a numerar un borrador que ya tiene número.
- **Rollback inválido:** `:787-797` pone `number: null`, y la columna es NOT NULL.
- **Estados fuera del enum:** `verifactu-queue.ts:197,241` escribe `accepted_aeat` y `rejected_aeat`, que no están en `invoice_status`.
- **Choque con el trigger:** la cola hace UPDATE de `invoice_verifactu_records`, contra el trigger de inmutabilidad.
- **Envío duplicado:** la cola no hace un *claim* atómico, así que `daily` y `verifactu-send` pueden enviar dos veces el mismo registro.
- **Datos del registro:** `<Desglose>` sale vacío, porque `createInvoiceCore` no escribe `invoice_taxes`. `RegistroAnterior` se calcula como `number - 1`. Las fechas van en UTC (`verifactu.ts:118-123`).
- **Huella, XML y QR incoherentes:** usan formatos distintos (`A/7` frente a `A-7`, fecha con milisegundos y "Z").
- **Test inútil:** `verifactu.test.ts` copia la implementación, así que no prueba nada.
- **Dos botones de emisión:** la interfaz muestra a la vez el "Emitir" clásico y el V2.
- **Estado:**
  - CONFIRMADO: todo lo anterior, salvo el formato exacto que exige AEAT.
  - SIN VERIFICAR: el formato de AEAT, porque no tenía la especificación a mano.

**I32. `allocate_next_invoice_number` reinicia el año en UTC, pero `fiscal_year` se calcula en hora de Madrid**
- **Evidencia (función en producción):** `v_year := extract(year from now())`, mientras que `create-core.ts:101` usa `madridDateKey`.
- **Escenario:** una factura emitida el 1-ene-2027 a las 00:30 en Madrid sale como `F-2027-00348`. A partir de la 01:00 se numera `F-2027-00001`. Cuando el contador vuelva a 348, la emisión chocará con el índice único.
- **Arreglo:** `now() at time zone 'Europe/Madrid'`.
- **Estado:** CONFIRMADO.

### Fechas y zona horaria

El servidor y la base de datos funcionan en UTC. El cron `daily` corre a las 22:00 UTC: son las 00:00 del día siguiente en Madrid en verano y las 23:00 del mismo día en invierno. **El cambio de hora es el 25-oct-2026.**

**I33. "Instalaciones, mantenimientos y carga de furgoneta para mañana" calcula "mañana" en UTC**
- **Dónde:** `cron/daily/route.ts:422-434,576-582` y `warehouses/auto-loading.ts:31-37`.
- **Escenario (verano, hasta el 24-oct):** el 2-oct a las 00:00 en Madrid, el técnico recibe "Instalación mañana" de una instalación que es **ese mismo día**. La orden de carga se genera para el mismo día, sin margen. Además, la ventana va de 02:00 a 01:59 en hora de Madrid.
- **Arreglo:** `madridDateKey` y `madridDayRangeUtc` (ya existen).
- **Estado:** CONFIRMADO.

**I34. Recordatorio de víspera de mantenimiento: con una ventana de 2 h y un cron diario, casi nadie lo recibe**
- **Dónde:** `api/cron/maintenance-reminders/route.ts:85-92`. Busca visitas entre `now+23h` y `now+25h`, y el cron corre una vez a las 09:00 UTC.
- **Escenario:** solo reciben aviso las visitas de 10:00 a 12:00 (hora de Madrid en verano). Una visita a las 16:00 no lo recibe nunca.
- **Arreglo:** usar el día natural de mañana en Madrid.
- **Estado:** CONFIRMADO.

**I35. Mantenimientos: desbordamiento de `setMonth` y visitas teóricas que se recrean**
- **`setMonth`:** `maintenance/auto-schedule.ts:97-98,220-227` y `cron/daily/route.ts:1243-1244`. Un servicio que empieza el 31-ene con periodicidad mensual cae el 3-mar. Sigue abierto desde el 09-09.
- **Visitas recreadas:** `ensureMaintenanceWindow` (`:107-127`) deduplica por `scheduled_at` ±2 días. Una visita que el cliente mueve del 10 al 20 se recrea el día 10.
- **Estado:** CONFIRMADO. Que haya duplicados ya en producción está SIN VERIFICAR.

**I36. El mes de ventas, puntos, comisiones y el panel "este mes" se calcula en UTC**
- **Dónde:** `contracts/actions.ts:1290-1291`, `points/award.ts:91-92,141-142`, `points/cycles-utils.ts:22-52`, `dashboard/page.tsx:116` y `sales/dashboard-actions.ts:365`.
- **Escenario:** un contrato firmado el 1-oct a las 01:30 en Madrid cuenta para septiembre.
- **Estado:** CONFIRMADO.

### Rendimiento y listados truncados

**I37. Las exportaciones CSV siguen cortadas a 1.000 filas, y ya afecta**
- **Dónde:** `api/export/[entity]/route.ts:114,159,198,224,248,287,342,411`.
- **Escenario:** la empresa mayor tiene **1.009 clientes**. El CSV entrega 1.000 sin avisar. El registro horario va por el mismo camino.
- **Arreglo:** `fetchAllRows`.
- **Estado:** CONFIRMADO. Sigue abierto desde el 09-09.

**I38. `requireSession()` sigue sin `cache()`**
- **Dónde:** `src/shared/lib/auth/session.ts:59`.
- **Evidencia:** en `src` no hay ningún `cache(`. Cada llamada hace 4 viajes a Supabase, y `/clientes/[id]` encadena unos 25 `await` con una sesión por helper.
- **Estado:** CONFIRMADO. Sigue abierto desde el 09-09, y sigue siendo el arreglo con mejor relación entre esfuerzo y beneficio.

### Otros importantes

**I39. Factura manual con la cantidad vacía o en 0**
- **Dónde:** `invoices/new-invoice-form.tsx:150`, con `Number("") = 0`.
- **Escenario:** se quema un número de la serie y aparece el error crudo `invoice_lines_quantity_check`.
- **Sin validar:** `discount_percent` no tiene CHECK ni validación, así que un 150 % da un total negativo.
- **Arreglo:** validar en `createInvoiceCore` **antes** de numerar.
- **Estado:** CONFIRMADO.

**I40. Alta de producto con mínimo autorizado mayor que el total: el producto queda sin precio y sin aviso**
- **Dónde:** `products/actions.ts:542`. El insert del plan cash no comprueba el error, y salta `product_pricing_plans_check`/`check1`.
- **Estado:** CONFIRMADO.

**I41. `MoneyInput` multiplica por 100 si se escribe el decimal con punto**
- **Dónde:** `shared/components/money-input.tsx:85`:
  ```ts
  clean.replace(/\./g, "").replace(",", ".")
  ```
- **Escenario:** "49.90" se convierte en 4.990,00 €. Afecta a las líneas de propuesta, la fianza, los planes de mantenimiento y las pruebas gratuitas.
- **Estado:** CONFIRMADO.

**I42. Stock: sitios que siguen con leer-sumar-escribir como camino principal**
- **Sitios:**
  - Consumo FIFO de lotes: `stock-decrement.ts:100-118`.
  - `inventory-actions.ts:77,139`.
  - `purchase-actions.ts:174,404`.
  - `stock-count-actions.ts:169`.
  - `loading-request-actions.ts:89-169`: un doble clic hace un doble traspaso.
  - `import-actions.ts:156`.
  - `uninstall-actions.ts:509-555`.
- **Agravante:** el índice único de `warehouse_stock` no protege cuando `location_id` es NULL.
- **Estado:** CONFIRMADO.

**I43. Puntos**
- **No se pueden volver a otorgar:** después de una reversión, `award.ts:58-68` y `sales-bundle.ts:54-65` cuentan el asiento revertido.
- **Alquileres como venta con descuento:** comparan la cuota mensual con el mínimo del plan *cash*, así que todo alquiler puntúa como venta con descuento (`sales-bundle.ts:128-150`). Por ejemplo, 7 puntos en lugar de 10.
- **Sin índice único:** `points_ledger` no lo tiene.
- **Estado:** CONFIRMADO.

---

## MENOR

**Integridad y datos**
- **Cobros de 0 €.** `sepa-xml` incluye cobros de 0 € (el CHECK permite `>= 0`). PLAUSIBLE.
- **Doble factura desde un cobro.** `createInvoiceFromWalletAction` (`wallet/actions.ts:864-944`) crea dos facturas con un doble clic.
- **Fianza retenida contada dos veces como ingreso** (`finalize-rental-actions.ts:154-173`). PLAUSIBLE.
- **Rollback que deja hueco.** El rollback de la cuota del cron borra una factura ya numerada (`daily:1447-1484`) y deja un hueco en la serie.
- **Aviso de vía legal duplicado.** Se envía dos veces (`daily:1941`, `daysOverdue === 45 || 46`).
- **`email_sends` sin `from_email`.** Le falta ese campo, que es NOT NULL (`daily:2123`, `incidents/email-from-cron.ts:169`), así que el registro del envío nunca se guarda.
- **Edición de una financiera.** Pone a null los `fiscal_*` y `logo_url` (`financiers/actions.ts:159`). Latente.
- **Errores tragados en ajustes.** `updateCompanySettingsAction`, `updateFreeTrialsConfig` y `updateLeadsConfigAction` no comprueban `error`: el usuario ve "guardado" aunque falle.
- **Tolerancia GPS vacía.** Se guarda como 0 y da un error crudo (`company_settings_installation_geo_tolerance_m_check`). `config/installations/actions.ts:16` hace `.update(input)` sin schema.
- **Descuento de plan de mantenimiento fuera de 0-100.** Da error crudo (`plans-editor.tsx:198`, `config-actions.ts:51`).
- **Ausencias.** Una baja con la fecha de fin anterior a la de inicio da error crudo (`absences-actions.ts:162`).
- **Lote sin fecha.** `lots-tab.tsx:71` lanza un RangeError en el cliente si se borra la fecha.
- **Alta de cliente desde un lead.** El update del lead y el traslado de direcciones ignoran el error (`customers/actions.ts:718-735`).
- **Alta de usuario.** Si falla el insert de `user_roles`, el usuario queda sin roles (`tenant/users/actions.ts:227-238`).
- **Doble opt-in de mailing.** No envía el correo de confirmación (TODO en `mailing/actions.ts:1008-1026`). Además, el upsert devuelve a `pending_confirmation` a quien ya había confirmado.
- **Cuota de mantenimiento.** El IVA del 21 % está escrito en el código (`maintenance-plans/actions.ts:262-322`) y la idempotencia por descripción puede duplicar.

**Seguridad (defensa en profundidad)**
- **Helpers sin sesión en ficheros `"use server"`.** Afecta a `awardPoints`, `notify`, `decrementStock`, `runPostSignSideEffects`, `ensure*ConfirmationToken`, etc. Hoy ningún componente cliente los importa. Hay que moverlos a módulos `server-only`. PLAUSIBLE.
- **Open redirect tras el login.** `/login?next=` no valida el destino (`login/page.tsx:23,43`). PLAUSIBLE.
- **Firma remota.**
  - El email del firmante se envía a la vista, así que la comprobación de email es decorativa.
  - La IP no se guarda nunca (`client_ip: null`).
  - El límite de intentos está en memoria.
- **`/baja`.** Da de baja con un simple GET, así que los escáneres de enlaces del correo pueden darla por accidente.
- **`/i/[token]`.** Reprograma instalaciones aunque estén completadas o canceladas (`installations/public-confirmation-actions.ts:364-376`). La hora `T10:00:00` se interpreta en UTC.
- **Subidas.** El MIME lo decide el cliente y ningún bucket tiene `allowed_mime_types` ni `file_size_limit`.
- **Buckets que no existen.**
  - `photo-actions.ts` usa el bucket `documents`, así que `/api/storage/sign` es una ruta muerta.
  - `avatar-actions.ts:29` sube a `avatars`, así que la subida de avatar probablemente falla. PLAUSIBLE.
- **Webhooks y seguimiento.**
  - Resend no deduplica por `svix-id`.
  - La firma de voz admite cabecera sin `t=`.
  - `/api/track/open` es inflable.
- **Cabeceras.** No hay Content-Security-Policy.
- **Secretos cifrados.** `company_settings_read_tenant` deja leer a cualquier empleado las columnas `*_encrypted` y `fiscal_iban`. Grants por columna SIN VERIFICAR.
- **Remesas por PostgREST.** `sepa_batches_company` es ALL para cualquier rol de la empresa, aunque el código usa el admin client y `ensureAdmin`.
- **Roles.** Hay unas 70 variantes de `ensure*` hechas a mano; ninguna usa `app.can()`. Acciones sensibles que solo comprueban la sesión: `deleteAgendaTaskSafeAction`, `setProductBarcodeAction`, `cancelMandateAction` y `deliverLoadingRequestAction`.
- **Superadmin sin empresa.** Los `ensure*` que lo dejan pasar sin empresa permiten escrituras con `company_id = null`.
- **`getMyHourBalance(from, to, userId?)`** acepta cualquier `userId` de la empresa.
- **Funciones `app.*` ejecutables por `anon` y `authenticated`.** Afecta a `autoclose_stale_punches` y `promote_lead_to_customer`, que son `security definer`. Hoy **no son alcanzables** porque PostgREST solo expone `public`. Conviene revocarlas por higiene.

**Fechas**
- **Facturas del "día 1" con fecha del día 2.** En verano salen con fecha 2 (confirmado en las cuotas de anoche: `issue_date 2026-10-02`). Dentro del mismo mes no cambia nada.
- **"Ayer" en UTC** en las incidencias de horario y en la activación de contratos: un día de desfase en verano.
- **Caducidad de pruebas gratuitas** con un día de retraso.
- **Server components que muestran horas en UTC** (2 h menos en verano): `maintenance/upcoming-card.tsx:61`, `installations/upcoming-card.tsx:51` y `mantenimientos/[id]/page.tsx:233,279,285`.
- **El filtro `|date` de las plantillas de correo** no lleva `timeZone`.
- **Avisos de turno** en `time-tracking/actions.ts:296-297`, con la hora del turno tomada como UTC.

**Rendimiento y calidad**
- **KPIs sobre las primeras 1.000 filas.** `dashboard/page.tsx:195-212` y `wallet/actions.ts:155-159,242-247` (hoy es latente).
- **`.in()` sin trocear con listas largas** (HTTP 414 por encima de unos 200 ids): `contracts/rentals-actions.ts:129`, `contracts/actions.ts:78`, `ventas-perdidas/page.tsx:150,162` y `pruebas-gratuitas/page.tsx:105,112`.
- **`import * as Icons from "lucide-react"`** sigue en 8 ficheros (`sidebar.tsx:6`, `bottom-nav.tsx:6`…).
- **Errores sin `toActionError`.** Quedan 84 `return {error: e instanceof Error ? …}` que no pasan por él (los peores, `installations/wizard-actions.ts` con 10) y 18 con el literal `"Error"`. El texto crudo de Postgres sigue llegando al usuario.
- **Código muerto con el doble IVA.** `createInvoiceFromContractV2Action` (`verifactu-actions.ts:248-450`) no tiene llamadores y contiene la contradicción de IVA. Hay que borrarlo.
- **Telemetría a medias.** Ni `hourly` ni `verifactu-send` ni los otros crons escriben en `cron_runs`, así que no hay telemetría para saber si fallan.
- **Lógica de dinero sin tests:** `calcLineTotals`, `splitMonthlyFee` (que habría detectado C3), `pickPrice`, `createCreditNoteAction`, el XML SEPA, la cuota del cron, el reintento de GoCardless, `awardPoints` y el XML y encadenamiento de VeriFactu.

---

## Comprobado y correcto

- **Facturación:**
  - Se trabaja en céntimos enteros; el IVA se redondea por línea y la suma de líneas da el total.
  - `createInvoiceCore` filtra por empresa, numera con `FOR UPDATE` y fecha en hora de Madrid.
  - `markInvoiceIssuedAction` hace compare-and-set y `deleteOrRectifyInvoiceAction` decrementa `next_number` con compare-and-set.
  - La cuota del cron distingue particular de empresa (salvo el redondeo de C3) y se generó una sola vez por contrato.
- **Funciones RPC:** ninguna función `public` con `security definer` es ejecutable por `anon` ni `authenticated`. `allocate_next_invoice_number`, `gen_reference_code`, `seed_*` y las RPC de stock son solo de `service_role`.
- **RLS:** ninguna tabla de `public` tiene la RLS desactivada. Las 4 tablas sin políticas (`cron_runs`, `customer_consents`, `invoice_reminders_sent`, `user_module_overrides`) solo se usan con el admin client y filtradas por empresa.
- **Storage:** `storage.objects` tiene la RLS activa y 0 políticas, y todos los accesos revisados validan la empresa. Los buckets privados no se cruzan entre empresas.
- **Crons:** los 9 empiezan por `verifyCronAuth`, que exige el secreto, cierra en falso y compara con `timingSafeEqual`.
- **Webhooks:**
  - GoCardless verifica el HMAC del cuerpo crudo y deduplica por `event_id`.
  - Resend verifica la firma Svix.
  - Voz usa HMAC.
- **Secretos:** ningún `NEXT_PUBLIC_*` es secreto y no hay secretos en ficheros versionados.
- **Tokens públicos:** son de 24 bytes o más, caducan y los de un solo uso se consumen de forma atómica.
- **PDFs:** los PDFs por id filtran por empresa.
- **Exportación:** el control de rol y el registro RGPD son correctos (falla el truncado, ver I37).
- **Tablas y elementos que ya funcionan:**
  - `/clientes` ya pagina con `fetchAllRows`.
  - El cron `voice-calls` corre bien: 192 ejecuciones, todas `ok`, aunque no coge tareas (ver I2).
  - El arreglo de `zOptionalInt` en el alta de producto es correcto.
- **Hallazgos anteriores que siguen cerrados:** stock atómico en los 4 sitios migrados, guarda contra el doble cobro del wallet, `pending_cents`, crons que ya pasan el middleware, `gen_reference_code` revocada, y `madridDateKey` ya en uso en create-core, agenda, my-day, scheduling, voz y reubicación.

---

## Preguntas de negocio

1. **Precio del mantenimiento.** El `monthly_cents` de los planes de mantenimiento, ¿es base imponible o lleva el IVA incluido para el particular? Hoy siempre se le suma el 21 %.
2. **Renting con financiera.** ¿Quién cobra la cuota al cliente: la financiera o la empresa? Bloquea I29.
3. **Rectificativas.** ¿Son R1 o R4? ¿Por sustitución o por diferencias? Bloquea C4.
4. **Alquiler que empieza a mitad de mes.** ¿Se prorratea el primer mes o se factura completo? ¿Y el mes de la baja?
5. **Puntos por pack y alquiler.** En un pack, ¿puntúa solo el equipo principal o también los extras? En alquiler, ¿el "descuento" se mide contra el plan de alquiler?
6. **Instalación y mantenimiento no incluidos en la propuesta.** ¿Se facturan aparte? Hoy no se facturan nunca.
7. **Precio mínimo autorizado.** `min_authorized_cents`, ¿es base o IVA incluido? ¿Hace falta uno por tipo de cliente?
8. **Fianza retenida.** ¿Es un ingreso aparte o es la misma fianza, que cambia de concepto?
9. **Visibilidad de comisiones.** ¿Puede cualquier empleado ver las comisiones de toda la plantilla?
10. **Plazo SEPA.** ¿Qué plazo exige vuestro banco (D+1, D+2)? Sigue abierta desde el 09-09.
11. **Particular que pasa a empresa con contratos vivos.** ¿Mantiene el precio firmado con IVA incluido?
12. **Contratos cancelados.** ¿Se anulan todas las visitas futuras, o se respetan las ya pagadas? Sigue abierta desde el 09-09.

## No verificado

- **Formato exacto de la huella VeriFactu** (`FechaHoraHusoGenRegistro`, `&` final, campos de anulación): no tenía la especificación de AEAT. Las incoherencias internas sí están confirmadas.
- **Si Vercel entrega el mismo cron dos veces:** no he revisado los logs de Vercel. Todos los fallos que dependen de eso son PLAUSIBLES.
- **Si los crons `hourly`, `verifactu-send`, `boe-check`, `purchase-suggestions`, `gmaps-budget-alert` y `maintenance-reminders` fallan:** no escriben en `cron_runs`, así que no hay forma de saberlo sin los logs de Vercel.
- **Si la interfaz oculta "Aceptar" en propuestas `pending_approval`** y si el asistente de instalación permite volver a pulsar "Finalizar".
- **Qué excepción concreta produjo los 2 "Algo ha fallado en el servidor"** en `/clientes/nuevo`: el informe no trae digest.
- **El manifiesto de server actions del build:** decide si los helpers `"use server"` sin sesión son explotables o solo defensa en profundidad.
- **Grants por columna de `company_settings`.**
- **Si `iban_snapshot` se muestra en la interfaz.**
- **Si ya existen mantenimientos duplicados por I35.**
- **Si `scheduleMaintenanceForContract` y `reserveStockForContractAction` duplican al volver a firmar.**
- **Revisión una a una** de los 167 `.single()` y de los `await` que no comprueban el error en contratos (53), almacenes (50) e instalaciones (35): solo se han priorizado los caminos de dinero.
