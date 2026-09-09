# Superauditoría Hidromanager — 9 de septiembre de 2026

Cuatro auditorías independientes y en paralelo: **seguridad multi-tenant**, **dinero y
corrección**, **rendimiento y datos**, **arquitectura y mantenibilidad**. Ninguna
modificó código.

**Estado del proyecto medido, no opinado:** 63.505 LOC en 942 ficheros, 45 módulos,
206 migraciones, 194 tablas. `npm run typecheck` en verde, `npm run lint` con 0 errores
y 51 warnings, **147 tests en verde** (123 previos + 24 nuevos de este trabajo).

Lo primero, para que no se pierda entre lo demás: **el código es, en general,
defensivo de verdad**. La inmensa mayoría de los ~700 usos del cliente admin sí filtra
por `company_id`, los webhooks verifican firma, los crons exigen `CRON_SECRET`
fail-closed, los tokens públicos son de 192 bits con caducidad, no hay secretos en el
repositorio ni en el bundle, y `/superadmin` está protegido sin una sola excepción.
Los fallos están concentrados, no repartidos.

---

## Lo que arreglaría esta semana

### 1. ~~Tres tablas sin RLS~~ — ✅ **DESCARTADO: era deriva local, no producción**

> **Comprobado contra el remoto el 10-sep-2026 (`pg_class` / `pg_policies`). Este
> hallazgo NO se sostiene.** Se deja escrito, en vez de borrarlo, porque el error
> que lo produjo se puede repetir: se auditó el esquema **local**, que lleva meses
> divergiendo del de producción, y se dio por hecho que eran el mismo.
>
> Lo que hay de verdad en producción:
>
> - `select relname from pg_class ... where relrowsecurity = false` devuelve
>   **cero filas**. No hay ni una tabla de `public` sin RLS.
> - Las tres tablas del título ya la tienen activada.
> - `invoice_taxes` tiene RLS **y ninguna política**, o sea deny-all para
>   `authenticated`. Es lo contrario de una fuga. No rompe nada porque todo su
>   acceso va por `createAdminClient()` (service_role, que salta RLS).
> - `whatsapp_sends`: la política `wa_admin_write` **sí filtra** por
>   `company_id = (select company_id from user_profiles where user_id = auth.uid())`.
>   La versión `using (true)` que describía el parche existe solo en local.
>
> El parche `20260909090000_rls_tablas_sin_candado.sql` sigue mereciendo aplicarse
> —le pone a `invoice_taxes` la política de tenant que le falta y normaliza las
> cuatro tablas al mismo patrón— pero como **higiene, no como urgencia**. Su
> cabecera ya está corregida con todo esto.

**Lección para la próxima auditoría:** en este proyecto, un hallazgo de esquema no
vale nada hasta consultarlo contra el remoto. Y no sirve mirar
`supabase_migrations.schema_migrations`: tiene **dos filas** (`20260501120000` y
`20260828100000`) frente a las decenas de ficheros del repo. Hay que ir a
`pg_tables` / `pg_policies` / `information_schema.columns`.

### 2. La facturación mensual de alquiler nunca ha creado una factura ⚠️ **CRÍTICO**

`src/app/api/cron/daily/route.ts:1408` inserta usando `pending_cents`, **una columna
que no existe**: no aparece en ninguna migración, y en TypeScript es un campo derivado
que se calcula en memoria. Confirmado por dos auditorías independientes.

PostgREST responde `PGRST204`, el `catch` lo cuenta como error y sigue. Resultado:
**cada cuota mensual de cada contrato de alquiler activo queda sin facturar y sin
remesar**. Con 100 contratos a 45 €/mes son 4.500 €/mes que no se cobran.

Y no hay red: el botón manual filtra `status = 'signed'` mientras el cron filtra
`status = 'active'` — conjuntos disjuntos, así que un contrato ya instalado tampoco se
puede facturar a mano.

El mismo fallo mata los **recordatorios de impago** (`:1876`, `.gt("pending_cents", 0)`,
y ahí ni siquiera se desestructura el `error`): los cuatro niveles de aviso —7, 14, 30
y 45 días— no se han enviado nunca.

> ### ✅ VERIFICADO CONTRA PRODUCCIÓN EL 10-SEP-2026 — confirmado, y es peor
>
> `information_schema.columns` para `public.invoices` (57 columnas) **no contiene
> `pending_cents`**. Hay `total_cents`, `paid_amount_cents`, `subtotal_cents`,
> `tax_cents`… pero no `pending_cents`. El hallazgo es real.
>
> Y al listar las columnas aparece un segundo motivo de fallo que la auditoría no
> había visto: el insert de `route.ts:1408` **tampoco rellena cuatro columnas
> `NOT NULL` sin valor por defecto**:
>
> | Columna | Nulable | Default |
> |---|---|---|
> | `series_id` | NO | — |
> | `number` | NO | — |
> | `fiscal_year` | NO | — |
> | `full_reference` | NO | — |
>
> O sea: aunque se quitara `pending_cents`, el insert seguiría fallando con una
> violación de `NOT NULL`. **Esta facturación no es que se rompiera: no ha podido
> funcionar nunca.** El arreglo no es borrar un campo, es hacer que la cuota mensual
> pase por el mismo camino de numeración que usa la facturación manual (serie,
> número, ejercicio y referencia se asignan ahí), no por un `insert` a pelo.
>
> Lo mismo vale para los recordatorios de impago de `:1878`: seleccionan
> `pending_cents` de una tabla que no lo tiene, así que el `select` devuelve error y
> la lista sale vacía. Los cuatro niveles de aviso no se han enviado nunca.
>
> Pendiente de decidir contigo: si `pendiente = total_cents - paid_amount_cents`
> basta como columna generada, o si hace falta materializarla.

### 3. Doble IVA en las facturas a particulares ⚠️ **CRÍTICO**

`pick-price.ts` devuelve para un particular el precio **con IVA incluido**
(`needs_iva: false`), pero **ese flag nunca se persiste**. Al facturar
(`invoices/actions.ts:914`) se le suma otro 21 %.

Una ósmosis firmada a 1.210 € IVA incluido se factura a **1.464,10 €**. El cliente paga
1.210, la factura queda con 254,10 € pendientes, pasa a `overdue` y le llegan
reclamaciones de impago habiendo pagado completo. Para empresas, el error va en sentido
contrario: se factura un 21 % de menos.

El código se contradice consigo mismo: en `verifactu-actions.ts`, una rama suma IVA
(`:381`) y la otra lo extrae (`:410`), **en la misma función**.

> **Pregunta que bloquea el arreglo:** ¿el precio de catálogo para particulares es IVA
> incluido y para empresas base imponible, como documenta `pick-price.ts:29-38`? Y
> ¿se han emitido ya facturas reales por ese botón? Si sí, hay que estimar cuántas y
> rectificarlas.

### 4. `testSmtpAction` filtra contraseñas de correo de empleados 🔴 **CRÍTICO**

`src/modules/mailing/actions.ts:188-242`. Si mandas `smtp_password: "********"`, el
servidor **descifra la contraseña SMTP guardada** del usuario que indiques… y se conecta
al `smtp_host` que tú elijas. Con `secure:false`, nodemailer manda `AUTH LOGIN` en claro
contra el servidor del atacante.

Un `company_admin` puede así capturar la contraseña personal de correo de cualquier
empleado. Variante SSRF: `smtp_host: "169.254.169.254"` convierte la respuesta en un
escáner de puertos de la red interna.

**Arreglo:** si la contraseña viene guardada, leer **también** host/puerto/usuario de
la BD e ignorar los del input.

### 5. `requireSession()` sin `cache()` — 2 líneas, 300-900 ms por página

`src/shared/lib/auth/session.ts:59`. Hace 4 viajes a Supabase (Auth ×2 + 2 SELECT) y
**no está memoizada**, con **729 call-sites**. `/clientes/[id]` la llama ~25 veces:
unos 100 round-trips solo para autenticar.

```ts
import { cache } from "react";
export const requireSession = cache(async function requireSession() { /* igual */ });
```

No hay ningún otro cambio en el proyecto con esta relación esfuerzo/beneficio.

---

## Lo demás, por bloques

### Seguridad

| | Hallazgo | Dónde |
|---|---|---|
| ALTO | `message_templates`: `update`/`delete` con admin client **sin `.eq("company_id")`**. Un admin puede desactivar la plantilla de otra empresa y, peor, el upsert incluye `company_id` en el payload → **se la queda** | `messaging/actions.ts:119,130` |
| MEDIO | Open redirect en `/api/track/click/[id]`: ruta pública, redirige a cualquier URL desde tu dominio. Phishing con tu propia marca | `track/click/[id]/route.ts:61` |
| MEDIO | Open redirect en el callback de GoCardless vía `return_path`, y refleja `e.message` en la query | `gocardless/callback/route.ts:29,33` |
| MEDIO | `updateUserRoles` no comprueba que el usuario destino sea de tu empresa | `tenant/users/actions.ts:393` |
| MEDIO | `app.autoclose_stale_punches()` con `grant execute to authenticated`, sin `search_path` y **sin filtro de empresa**: cierra los fichajes de toda la plantilla de todas las empresas | `20260525110000:72` |
| MEDIO | Chat: inserta `user_id` arbitrarios sin validar la empresa (la lectura sí está protegida) | `chat/actions.ts:595,633` |
| BAJO | Bug funcional: `/api/pdf/contract/public/[token]` llama a `generateContractPdf`, que hace `requireSession()` → **el flujo de firma remota devuelve 500** | `pdf/contract/public/[token]/route.ts:52` |

**Verificar en el dashboard:** si el esquema `app` está expuesto en PostgREST
(sube el riesgo del fichaje a ALTO), si el bucket `documents` es público (fotos de
instalación y firmas), y las tres consultas SQL del fichero de migración del punto 1.

### Dinero y corrección

| | Hallazgo | Dónde |
|---|---|---|
| CRÍTICO | `completeInstallation` / `completeMaintenance` no comprueban el estado previo: doble clic = **doble descuento de stock + equipos duplicados** → mantenimientos fantasma | `installations/actions.ts:1518`, `maintenance/actions.ts:585` |
| CRÍTICO | Contrato cancelado sigue generando **cobros SEPA** y visitas: la cancelación no toca `contract_payments` ni `maintenance_jobs`, y la remesa no filtra por estado | `contracts/actions.ts:1656`, `sepa/sepa-xml.ts:132` |
| CRÍTICO | Rectificativa registrada en VeriFactu como `TipoFactura = F1` (debería ser R1-R5) | `invoices/actions.ts:487` |
| ALTO | Doble clic en "Emitir": el rollback del perdedor deja la factura en borrador **pero ya registrada en la cadena VeriFactu** → misma factura en AEAT con dos números, y huecos en la serie | `verifactu-actions.ts:659,775` |
| ALTO | Doble cobro contable al marcar factura pagada (read-modify-write sin bloqueo, esquivando la guarda anti-duplicados) | `invoices/actions.ts:591` |
| ALTO | Remesa SEPA duplicable: el XML se entrega antes de bloquear los pagos, y la persistencia es fail-soft | `sepa/sepa-xml.ts:132,339` |
| ALTO | `ReqdColltnDt` = hoy (el banco rechaza el fichero entero) y fecha de mandato inventada si falta | `sepa/sepa-xml.ts:259,244` |
| ALTO | Consumo de lotes FIFO fuera de la RPC atómica: *lost update* clásico | `warehouses/stock-decrement.ts:100` |
| ALTO | Fechas fiscales en UTC: una factura emitida a las 01:30 del 1 de julio se fecha el 30 de junio → trimestre ya presentado. `madridDateKey()` existe y **no se usa en ningún sitio** | `invoices/actions.ts:480` y 40 sitios más |
| ALTO | La cuota del mes no se emite si el contrato tiene **cualquier** otra factura ese mes | `invoices/actions.ts:1071` |
| MEDIO | Puntos revertidos que no se pueden volver a otorgar; reversión duplicable | `points/award.ts:58,111` |
| MEDIO | Mantenimientos que derivan por desbordamiento de `setMonth` (31-ene → 3-mar) | `maintenance/auto-schedule.ts:91` |
| MEDIO | Anular una factura emitida no exige estado ni genera la anulación en VeriFactu | `invoices/actions.ts:648` |

### Rendimiento

| | Hallazgo | Dónde |
|---|---|---|
| ALTO | **Las 8 exportaciones CSV están truncadas a 1.000 filas en silencio.** La peor: el registro horario para inspección de trabajo pide 4 años y entrega una semana | `api/export/[entity]/route.ts` |
| ALTO | El churn del cron diario: **50.000 round-trips secuenciales**, sin filtro `company_id` (seq scan). Cuando se corta, **todo lo que va después no se ejecuta jamás** — incluidos los recordatorios de impago y el propio `tracker.finish()` | `cron/daily/route.ts:1724` |
| ALTO | Y hay un **segundo** recálculo de churn en `:1097` que empieza con `requireSession()` — en un cron no hay cookie: **500 iteraciones que fallan siempre** | `cron/daily/route.ts:1097` |
| ALTO | `/clientes` carga la cartera entera sin paginar: ~100 consultas y varios MB de JSON al navegador con 3.000 clientes | `customers/actions.ts:71` |
| ALTO | KPIs de Wallet y del dashboard calculados sobre **1.000 filas arbitrarias**: el embudo, la comparativa interanual y el "pendiente del mes" cambian entre recargas | `wallet/actions.ts:145`, `dashboard/page.tsx:197,211` |
| ALTO | `import * as Icons from "lucide-react"` anula el tree-shaking: **641 KB sin comprimir (168 KB gzip) en las 116 páginas**. Iconos usados: ~50 | `sidebar.tsx:6`, `bottom-nav.tsx:6` |
| MEDIO | Faltan los índices del `ORDER BY` de todos los listados; `pg_trgm` instalado pero **sin un solo índice trigram** → seq scan en cada tecla del buscador | — |
| MEDIO | `/clientes/[id]`: 24 `await` en cascada, ninguno dependiente → ~1.080 ms de espera pura | `clientes/[id]/page.tsx:62` |
| MEDIO | 157 `force-dynamic`, 0 `revalidate`, 0 `unstable_cache`: ~120 `revalidatePath` invalidando un caché que no existe | — |
| MEDIO | `.in()` sin trocear por encima de ~200 ids → HTTP 414 o truncamiento silencioso | `contracts/rentals-actions.ts:129` |
| MEDIO | `notifyByRoles` + push: ~93 round-trips por notificación, ~18.000 por noche | `notifications/push-send.ts:46` |
| — | **Buena noticia:** `@ffmpeg/ffmpeg` **no** entra en el bundle del navegador (import dinámico, bien hecho). Tampoco `pdf-lib`, `satori`, `sharp`, `qrcode`. Y hay **8 dependencias que no se importan en ningún sitio** (`leaflet`, `react-leaflet`, `motion`, `date-fns`, `zustand`, `@tanstack/react-query`, `satori-html`, `@types/leaflet`) | — |

### Arquitectura

La raíz de casi todo: **`Database = any`**. El typecheck verde no detecta un nombre de
columna equivocado, y ya hay al menos dos bugs en producción por eso (`pending_cents`
y `discount_pct` cuando la columna es `discount_percent`).

Sé que hay un motivo documentado (TS2349 con 176+ tablas) y **no propongo el
interruptor global**. El camino incremental: subir `@supabase/ssr` (0.5.2 → 0.12.7, siete
minors atrás, y es la librería que gestiona las cookies de sesión) y `supabase-js`,
generar los tipos a un fichero aparte sin enchufarlos, y adoptarlos con un `Pick` por
módulo empezando por `invoices` y `warehouses`.

Otros:

- **68 `page.tsx` destructuran solo `data`, uno destructura `data, error`.** Una query
  fallida se renderiza como lista vacía y nadie lo reporta.
- **108 ocurrencias del patrón viejo de `catch` en 45 ficheros** convierten el
  `redirect()` de sesión caducada en un toast incomprensible. El peor:
  `installations/wizard-actions.ts` con 13 — el parte de trabajo del técnico, el flujo
  con más probabilidad de sesión caducada.
- **El texto crudo de Postgres llega al usuario**, y hay un test que lo blinda. El
  equipo ya resolvió esto para Auth (`auth-error-es.ts`): falta el hermano para Postgres.
- **`format-money.ts` tiene 0 importadores** y ~50 copias locales que ya divergen — dos
  con la escala opuesta bajo el mismo nombre.
- **42 `ensureAdmin` copiados** con políticas distintas bajo el mismo nombre.
- **`cron/daily/route.ts`: 2.234 líneas en una sola función**, 24 trabajos, 63 `catch`.
  Su propio `summary` final enumera los 24 trabajos: es el índice del troceado, ya escrito.
- **`tailwindcss` NO está en beta** pese a lo que declara `package.json` (el caret
  resuelve a 4.2.4 estable). Pero `tailwind.config.ts` **es código muerto**: con
  Tailwind v4 y `@theme inline` no se lee. Alguien editará ahí los colores y no pasará nada.

### Documentación que hace daño

Cuatro ficheros de `docs/` se autoproclaman fuente de verdad y contradicen el código:

- `DATABASE_MEMORY.md:3` — *"si una tabla no aparece aquí, no existe"*. Lista ~20; hay ~187.
- `MODULES_MEMORY.md:27` — marca como "aparcado" o "planeado" módulos que llevan meses
  en producción. **El de mayor riesgo de provocar trabajo destructivo duplicado.**
- `AUDITORIA_2026-07-06.md:290` — pide regenerar `database.types.ts`, lo cual **rompe el
  build**; el propio documento se desmiente en su línea 25.
- `PLAN_ADJUST_STOCK.md:210` — lista como pendientes dos migraciones que fueron
  reescritas después: aplicarlas hoy **revertiría un hardening de seguridad**.

Vigentes y valiosos (no tocar): `AUDITORIA_SEGURIDAD_2026-05-31.md`,
`AUDITORIA_GRAFOS_2026-06-09.md`, `AUDITORIA_2026-06-21/`, `ESPECIFICACION_PORTADO_FICHAJES.md`,
`docs/VERIFACTU_GUIA.md`.

---

## Preguntas que bloquean arreglos

1. **Semántica del precio** — ¿particulares IVA incluido y empresas base imponible?
   Bloquea el arreglo del doble IVA.
2. **¿Se han emitido facturas reales** por "Facturar contrato" a particulares? Si sí,
   hay rectificativas que hacer.
3. **¿Alguien ha verificado alguna vez** que la remesa mensual automática generase
   facturas en producción? ¿Se refacturan los meses perdidos?
4. **SEPA:** ¿qué plazo exige tu banco entre presentación y fecha de cobro (D+1, D+2)?
   ¿Acepta `RCUR` siempre o exige `FRST` en el primer cargo?
5. **Rectificativas:** ¿R1 (error fundado en derecho) o R4 (resto)?
6. **¿Vendéis algo a tipo reducido (10 %) o exento?** Hay dos sitios con el 21 %
   escrito a fuego.
7. **Contratos cancelados:** ¿se cancelan *todas* las visitas futuras, o hay
   mantenimiento pagado por adelantado que se respeta?
8. **Instalación no incluida:** ¿debe sumarse al total de la propuesta o es deliberado
   que se cobre aparte el día de la instalación?

---

## Orden que propongo

**Esta semana** — lo que cuesta dinero o filtra datos hoy:

1. RLS de las tres tablas (parche ya escrito, verificar remoto antes).
2. `testSmtpAction` (4 líneas).
3. `pending_cents`: verificar en producción y arreglar facturación mensual + impagos.
4. `.eq("company_id")` en `message_templates` (2 líneas).
5. Guard de estado en `completeInstallation` / `completeMaintenance` (doble stock).

**Semana siguiente** — lo barato con más retorno:

6. `cache()` en `requireSession()` (2 líneas, 300-900 ms por página).
7. `fetchAllRows` en las 8 exportaciones CSV.
8. Doble IVA, una vez respondida la pregunta 1.
9. Churn del cron a una RPC agregada, y borrar el bloque duplicado que falla siempre.
10. Mapa de iconos (−168 KB gzip en 116 páginas).

**Después** — lo estructural: codemod de `toActionError` + `pg-error-es.ts`, enchufar
`format-money` / `madridDateKey`, `line-math.ts` unificado, trocear el cron diario,
tipar la capa de datos módulo a módulo.

**Los 10 tests que faltan**, por orden: `computeOfferableSlots`, `line-math`,
`sepa-xml`, `verifactu-xml`, `planMaintenanceOccurrences`, `permissions`,
`format-date` (frontera DST), `nextReferenceCode`, reconciliación de wallet/ventas,
y el orquestador de `dedupe`.
