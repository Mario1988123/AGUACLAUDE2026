# Agente de voz IA — guía de implantación

**Actualizado el 10 de septiembre de 2026.** Complemento operativo de
`AGENTE_IA_VOZ_INVESTIGACION.md` (que es el análisis previo). Esto es el manual:
qué se ha construido, cómo se enciende, qué dice la ley y cómo se forma al agente.

Cubre los **tres canales de voz** que pedía la investigación: saliente de
mantenimientos, recepcionista entrante y captación comercial B2B. El cuarto canal
(WhatsApp conversacional entrante) sigue sin construir — ver §8.

---

## 0. Antes de nada: la ley que buscabas no es la 10/2026

Conviene aclararlo porque el nombre lleva a la norma equivocada. **No existe ninguna
"Ley 10/2026" sobre llamadas.** Con ese número hay dos cosas, y ninguna te afecta:

- **Ley 10/2026, de 9 de julio** — presupuestos de la Generalitat de Catalunya.
- **Real Decreto-ley 10/2026, de 28 de abril** — medidas tributarias por la DANA.

Lo que sí te afecta son **tres normas distintas**, y conviene no mezclarlas porque
cada una obliga a algo diferente:

| Norma | Desde cuándo | Qué te obliga a hacer |
|---|---|---|
| **Ley 10/2025** de servicios de atención a la clientela | 27-dic-2025 | Que el cliente pueda pedir hablar con una persona en cualquier momento |
| **Resolución de 14-abr-2026** (BOE-A-2026-8409) — rango 400 | **17-oct-2026** | Que las llamadas **comerciales** salgan del rango 400, y que el 400 **no** se use para atención al cliente |
| **Reglamento Europeo de IA, art. 50** | 2-ago-2026 (ya en vigor) | Declarar que es una IA en la primera frase |

Y de fondo, para las comerciales: **art. 66.1.b LGTel** + **Circular 1/2023 de la AEPD**
(consentimiento o interés legítimo, caducidad a 2 años, listas de exclusión, 9-21 L-V).

**La que probablemente tenías en mente es la del 17 de octubre de 2026** — el prefijo
400. Quedan pocas semanas y **no afecta al caso de uso principal**: agendar
mantenimientos no es una llamada comercial.

### El detalle que cambia el diseño

He leído la resolución. Dos frases importan:

> *"Los números comprendidos en el rango NXY = 400 no podrán utilizarse para la
> prestación de servicios de atención al cliente, ni para otros usos distintos de los
> previstos."*

O sea: **el 400 no es "el número de la IA". Es el número del marketing, y está
prohibido usarlo para atención al cliente.** Llamar a un cliente para agendarle la
revisión que ya paga es atención al cliente. Sale del número de siempre.

> La resolución **no distingue** entre destinatarios personas físicas y jurídicas.

Es decir: aunque llames a empresas, si la llamada es comercial necesitas el 400.
Ser B2B te ayuda en la **base legal** (art. 19 LOPDGDD: los datos de contacto
profesionales admiten interés legítimo con más holgura), pero **no te exime del 400**.

**Traducción a decisiones:**

1. Mantenimientos → adelante hoy, sin trámites, con tu número actual.
2. Captación comercial → necesitas numeración 400 de un operador español.
   Twilio no te la da. Si la quieres para octubre, **habla con el operador esta semana**:
   el alta no es inmediata.

---

## 1. Qué se ha construido

```
   SALIENTE                                               ENTRANTE
 ┌───────────────────────────┐                    ┌──────────────────────────┐
 │ maintenance_jobs          │                    │ llamada al nº de la      │
 │  preprogrammed /          │──┐                 │ empresa                  │
 │  needs_callback           │  │                 └────────────┬─────────────┘
 ├───────────────────────────┤  │                              │
 │ leads party_kind=company  │──┤                              ▼
 │ (solo campañas)           │  │              ┌───────────────────────────────┐
 └───────────────────────────┘  │              │ voice_company_for_inbound()   │
                                │              │ el nº marcado = la empresa    │
                                ▼              └───────────────┬───────────────┘
              ┌──────────────────────┐                         ▼
              │  evaluateCallGate()  │         ┌───────────────────────────────┐
              │  consentimiento,     │         │  evaluateInboundGate()        │
              │  numeración, horario │         │  solo módulo + presupuesto:   │
              │  presupuesto, DNC    │         │  ha llamado él                │
              └──────────┬───────────┘         └───────────────┬───────────────┘
                         │                                     │
                         └──────────────┬──────────────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │  ElevenLabs / Twilio     │
                          │  (solo pone el audio)    │
                          └────────────┬─────────────┘
                                       ▼
                    ┌──────────────────────────────────────┐
                    │  /api/voice-agent/tools/*            │
                    │  la superficie ENTERA del agente     │
                    │  · huecos / confirmar / posponer     │
                    │  · identificar / consultar equipo    │
                    │  · crear incidencia / crear lead     │
                    │  · escalar a persona / no llamar más │
                    └──────────────────────────────────────┘
```

### Ficheros

**Migraciones** — se aplican en este orden:

| Fichero | Qué hace |
|---|---|
| `20260909090000_rls_tablas_sin_candado.sql` | **No es de este módulo, pero va primero.** Cierra tres tablas sin RLS y una política de WhatsApp que no filtraba nada |
| `20260909100000_voice_agent_module.sql` | Tablas, RLS, RPC de reserva atómica, y los CHECK que impiden llamar a un particular |
| `20260910100000_voice_agent_inbound_commercial.sql` | Canal entrante, campañas, sender de WhatsApp por empresa y purga de transcripciones |

**Código**

| Fichero | Qué es |
|---|---|
| `voice-agent/guardrails.ts` | Las dos puertas: `evaluateCallGate` (saliente) y `evaluateInboundGate` (entrante). Funciones puras |
| `voice-agent/guardrails.test.ts` | 30 tests. El primero comprueba que un particular no recibe llamada comercial |
| `voice-agent/prompts.ts` | Los **tres** guiones. La declaración de IA va incrustada y no es configurable |
| `voice-agent/prompts.test.ts` | 37 tests que vigilan que nadie quite las frases obligatorias de ningún guion |
| `voice-agent/lookup.ts` | Consultas sin sesión: teléfono → cliente, equipos, abrir incidencia, crear lead |
| `voice-agent/settings.ts` | Config, reloj de Madrid, contador de gasto, secreto por tenant |
| `voice-agent/webhook-auth.ts` | Firma HMAC compartida por los dos webhooks |
| `voice-agent/queue-actions.ts` | Cola de mantenimientos |
| `voice-agent/campaign-actions.ts` | Campañas comerciales B2B |
| `voice-agent/inbound-actions.ts` | Números de entrada y registro de llamadas atendidas |
| `voice-agent/whatsapp-out.ts` | Cierre por WhatsApp con el sender de cada empresa |
| `voice-agent/provider.ts` | Telefonía. Con **modo simulación** si no hay credenciales |
| `api/voice-agent/inbound/route.ts` | La recepcionista descuelga: resuelve empresa, identifica y devuelve el guion |
| `api/voice-agent/tools/[tool]/route.ts` | Las herramientas de los tres papeles |
| `api/voice-agent/webhook/route.ts` | Cierre de llamada, transcripción y contabilización del gasto |
| `api/cron/voice-calls/route.ts` | El marcador, cada hora de 8 a 19 UTC, L-V |
| `api/cron/voice-retention/route.ts` | Purga de transcripciones y tareas zombi, de madrugada |
| `(tenant)/agente-voz/` | Cola, llamadas atendidas y métricas |
| `(tenant)/agente-voz/campanas/` | Campañas comerciales |
| `(tenant)/configuracion/agente-voz/` | Configuración y números de entrada |

### Lo que reutiliza (y por tanto no hay que volver a probar)

El agente es **un frontal hablado del flujo `/m/[token]`** que ya está en producción.
`confirmar_mantenimiento` llama literalmente a `customerConfirmAction` /
`customerRescheduleAction`, las mismas que usa el enlace del email. Mismo motor de
huecos (`computeOfferableSlots`), mismas validaciones, mismos eventos en el timeline,
mismas notificaciones al admin. Lo único nuevo es el audio y la cola.

---

## 2. La separación servicio ≠ comercial

Pediste que no se mezclen. Está impuesto en **cuatro capas independientes**, y las
cuatro tendrían que fallar a la vez para que una llamada comercial llegue a un
particular.

Con la recepcionista en juego son tres papeles, no dos, y conviene tener clara la
regla que los ordena: **una llamada entrante es siempre atención al cliente**, así
que su propósito interno es `service` y nunca `commercial`. Lo que cambia es la
dirección. Por eso una entrante jamás puede acabar usando el número comercial ni
las herramientas de campaña, aunque quien llame resulte ser una empresa.

### Capa 1 — La base de datos (la que de verdad importa)

```sql
constraint voice_task_commercial_never_individual
  check (purpose <> 'commercial' or target_party_kind = 'company'),

constraint voice_task_commercial_targets_lead
  check (purpose <> 'commercial' or (lead_id is not null
                                     and customer_id is null
                                     and maintenance_job_id is null)),
```

Más un trigger que **revalida contra la fila real** de `leads`, porque un CHECK confía
en la columna y la columna se podría rellenar mal:

```sql
if v_kind <> 'company' then
  raise exception 'VOICE_B2C_BLOCKED: prohibido encolar una llamada comercial a un particular';
end if;
```

Da igual el bug que tenga el código de arriba: **la fila no entra**.

### Capa 2 — El gate en tiempo de marcado

`evaluateCallGate()` lo comprueba otra vez, y es lo primero que mira, antes incluso de
si el módulo está activo. No hay configuración, plan ni permiso que lo levante.

### Capa 3 — Numeración separada

Dos columnas distintas, cada una con su CHECK:

- `caller_id_service` — **rechaza** cualquier número que empiece por 400.
- `caller_id_commercial` — **exige** `+34400XXXXXX`.

No se puede llamar a un cliente desde el número del marketing ni al revés. Y no por
convención: por constraint.

### Capa 4 — Herramientas separadas

El agente comercial no tiene `confirmar_mantenimiento` en su lista. Y si lo llamara,
la ruta lo rechaza comparando contra el propósito de la tarea. Un prompt se puede
manipular con una frase ingeniosa por teléfono; una tabla de permisos no.

### Cómo comprobarlo tú mismo

```bash
npx vitest run src/modules/voice-agent/guardrails.test.ts
```

El primer test se llama *"BLOQUEA una llamada comercial a un particular"*, y el segundo
*"la bloquea aunque todo lo demás esté perfectamente configurado"*.

---

## 3. Puesta en marcha

### Paso 1 — Migraciones

**Estado verificado contra producción el 10-sep-2026:** no existe ninguna tabla
`voice_*` en el remoto. Las tres migraciones están enteras por aplicar. Las tablas
a las que apuntan las claves ajenas (`companies`, `customers`, `leads`,
`maintenance_jobs`) sí existen, así que no hay nada que preparar antes.

Orden, que importa:

```bash
supabase db push          # local

# remoto, en este orden:
#   1. 20260909090000_rls_tablas_sin_candado.sql
#   2. 20260909100000_voice_agent_module.sql
#   3. 20260910100000_voice_agent_inbound_commercial.sql
```

> ⚠️ **`supabase db push` contra el remoto no funciona ahora mismo**: la
> `SUPABASE_DB_PASSWORD` de `.env.local` está caducada — el pooler responde
> `password authentication failed for user "postgres"`. O la actualizas desde
> *Project Settings → Database*, o aplicas el SQL a mano desde el editor del panel
> de Supabase. El `SUPABASE_ACCESS_TOKEN` sí es válido.

> La primera, `20260909090000_rls_tablas_sin_candado.sql`, no es de este módulo:
> viene de la auditoría. Su cabecera describía tres tablas *sin* RLS y una política
> de WhatsApp abierta — **eso es el esquema local, no el remoto**. En producción las
> tres ya tienen RLS y la política de WhatsApp sí filtra por empresa. Sigue
> mereciendo aplicarse (le faltan políticas de tenant a `invoice_taxes`), pero es
> higiene, no una fuga activa. El detalle está en la cabecera del propio fichero.

> **El historial de migraciones del remoto está roto** y no sirve para saber qué se
> aplicó: `supabase_migrations.schema_migrations` solo tiene dos filas
> (`20260501120000` y `20260828100000`) frente a las decenas de ficheros del repo.
> Comprueba siempre contra el esquema real (`pg_tables`, `pg_policies`), no contra
> esa tabla.

Activa el módulo en `/configuracion/modulos` (viene **apagado** por defecto: cuesta
dinero por minuto y tiene implicaciones legales).

### Paso 2 — Modo simulación

```bash
VOICE_AGENT_SIMULATE=true
```

Con esto **la cola funciona entera y no se marca ningún número**. Los guardarraíles se
aplican, las tareas se reservan, todo queda registrado — pero nadie recibe una llamada.

**Deja el sistema aquí una semana.** Entra en `/agente-voz`, pulsa *Llenar cola con los
mantenimientos pendientes* y mira a quién llamaría. Si la lista tiene sentido, sigue.
Si aparece alguien que no debería estar, has ahorrado una llamada incómoda.

### Paso 3 — Cuenta de voz

Recomendación: **ElevenLabs Agents**, plan Pro (99 $/mes). Gana en lo único que el
cliente juzga en los tres primeros segundos: si la voz suena a persona española o a GPS.

1. Crea **dos agentes**, no uno: `Hidromanager — Mantenimientos` y (más adelante)
   `Hidromanager — Comercial`.
2. Idioma español, voz peninsular.
3. En cada agente, declara las herramientas como *webhook tools* apuntando a
   `https://TU-DOMINIO/api/voice-agent/tools/<nombre>`, método POST, con la cabecera
   `x-hm-voice-secret: <el secreto>`.
   Los nombres exactos están en `prompts.ts` (`SERVICE_TOOLS` y `COMMERCIAL_TOOLS`).
4. Cada herramienta recibe `task_id` (viene solo, en las variables dinámicas) más sus
   propios argumentos.

> **No pegues el prompt en el panel de ElevenLabs.** Se manda en cada llamada desde
> `provider.ts`, de forma que el guion vive en este repositorio, se versiona con git y
> se sabe quién lo cambió. En su panel, nadie lo sabría.

### Paso 4 — Variables de entorno

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_PHONE_NUMBER_ID=...
VOICE_WEBHOOK_SECRET=...          # genera con: openssl rand -hex 32
# VOICE_AGENT_SIMULATE=true       # quítala cuando vayas a llamar de verdad

# Solo para desarrollo o instalación de un único cliente: permite que la
# confirmación por WhatsApp salga del número global compartido. En multi-tenant
# NO la pongas — cada empresa debe tener su propio sender.
# VOICE_ALLOW_SHARED_WHATSAPP_SENDER=true
```

Dos webhooks que configurar en ElevenLabs, los dos firmados con el mismo secreto:

| Webhook | URL |
|---|---|
| Post-llamada (cierre, transcripción, gasto) | `https://TU-DOMINIO/api/voice-agent/webhook` |
| Inicio de conversación entrante | `https://TU-DOMINIO/api/voice-agent/inbound` |

> Sin `VOICE_WEBHOOK_SECRET` los dos **rechazan todo**. Es deliberado: un webhook
> abierto permite cerrar llamadas ajenas, inyectar transcripciones, descuadrar el
> contador de gasto y —en el de entrada— obtener el nombre del cliente asociado a
> cualquier teléfono.

> Si `VOICE_WEBHOOK_SECRET` no está puesta, el webhook **rechaza todo**. Es
> deliberado: un webhook abierto permite a cualquiera cerrar llamadas, inyectar
> transcripciones y descuadrar el contador de gasto.

### Paso 5 — Configuración en la app

`/configuracion/agente-voz`:

| Campo | Qué poner |
|---|---|
| Número de servicio | El geográfico o el 900 de siempre. **No un 400** |
| ID del agente de servicio | El de ElevenLabs |
| Ventana | 10:00–20:00 va bien. Es hora de Madrid, no del servidor |
| Tope de minutos | **Empieza en 100.** Son ~80 llamadas. Ya lo subirás |
| Duración máxima | 300 s |
| Móvil de guardia | El del comercial que atiende escalados |
| Grabar audio | **No.** La transcripción se guarda igual y da menos problemas |

Genera el secreto de herramientas y pégalo en ElevenLabs. Se muestra una vez.

### Paso 6 — La primera llamada de verdad

**Llámate a ti mismo.** Créate un cliente de prueba con tu móvil y un mantenimiento
`preprogrammed`, quita `VOICE_AGENT_SIMULATE` y llena la cola.

Escucha la llamada entera. Comprueba:

- [ ] ¿Dice que es una IA en la primera frase? (obligatorio, art. 50)
- [ ] ¿Ofrece hablar con una persona? (obligatorio, Ley 10/2025)
- [ ] ¿Ofrece **dos** huecos, no cinco?
- [ ] ¿Dice "el jueves dieciocho por la mañana" y no "2026-09-18"?
- [ ] Di *"quiero hablar con una persona"* → ¿escala sin discutir?
- [ ] Di *"¿cuánto cuesta un descalcificador?"* → ¿se niega a dar precio y crea el aviso?
- [ ] Di *"no me llaméis más"* → ¿lo confirma? ¿aparece en la lista de exclusión?
- [ ] ¿Se ha creado la cita en la agenda con la fecha correcta?

Si algo falla, se ajusta en `prompts.ts` y se despliega. No en el panel del proveedor.

### Paso 7 — Producción, despacio

Primera semana: tope de 100 minutos y **lee todas las transcripciones**. Son 80
llamadas, se leen en media hora, y de ahí salen las tres correcciones de guion que
valen por veinte hipótesis.

Segunda semana: sube el tope si las métricas acompañan.

---

## 4. La formación del agente de mantenimientos

Es lo que pediste: que sepa llamar a los mantenimientos pendientes. El guion completo
está en `prompts.ts` (`buildServicePrompt`) y se puede leer entero desde
*Configurar → Ver el guion que dirá el agente*.

### Lo que hace

Llamada de 90 segundos, guion cerrado, decisión binaria con tres salidas. Es
exactamente el tipo de conversación en la que la IA de voz es buena hoy — no el tipo
en el que es mala.

```
[Declaración de IA + salida a persona — obligatorio, ~7 s]
  "Buenos días, ¿hablo con María? Le llamo de Aguas del Sur. Soy un sistema
   automático con inteligencia artificial, y si en cualquier momento prefiere
   hablar con una persona, dígamelo y le paso."

[Motivo — deja claro que no vende]
  "Le llamo por la revisión de su equipo, la que lleva incluida en el contrato.
   Es para ponerle fecha."

[Oferta — DOS opciones, nunca tres]
  "Tengo hueco el jueves dieciocho por la mañana, o el viernes diecinueve por la
   tarde. ¿Cuál le viene mejor?"

[Cierre — repite la fecha en voz alta]
  "Perfecto: jueves dieciocho por la mañana. Le llega ahora un WhatsApp con la
   confirmación. Que tenga buen día."
```

### El guardarraíl que sostiene todo lo demás

**El agente de mantenimientos no ofrece nada.** Ni descuentos, ni equipos, ni "ya que
le llamo…".

No es prudencia comercial: es lo que mantiene la llamada dentro del art. 6.1.b RGPD.
En el momento en que ofrece algo, deja de ser una llamada de servicio, pasa al régimen
comercial y necesitaría consentimiento previo, rango 400, listas de exclusión y ventana
horaria. Una frase de más convierte una llamada legal en una sancionable.

Cuando el cliente pregunta por su cuenta (se queja de la cal, pide precio):

1. *"Se lo paso a un compañero y le llama él, que se lo explicará mejor."*
2. `crear_lead` con lo que haya dicho → notificación al comercial.
3. Vuelta a la cita.

Además convierte mejor. Un comercial que llama a alguien que preguntó cierra más que
un bot que improvisa una oferta.

### Las salidas

| Lo que dice el cliente | Qué hace |
|---|---|
| Acepta un hueco | `confirmar_mantenimiento` → cita en agenda |
| Ninguna le va bien | Ofrece dos más; si no, `posponer_mantenimiento` |
| "Ahora no puedo" | `posponer_mantenimiento` y cuelga rápido |
| "Ya no tengo el equipo" | `posponer_mantenimiento`. No discute ni retiene |
| Pide una persona | `escalar_humano` **inmediatamente**, sin rebatir |
| Enfadado o con avería | `escalar_humano`. Una avería no se gestiona aquí |
| Pregunta por productos | `crear_lead` y vuelta a la cita. Sin precios |
| "No me llaméis más" | `no_llamar_mas` + exclusión + cancela lo que tenga en cola |
| Número equivocado | Disculpas, exclusión, colgar |
| No contesta | Reintento en 24 h, máximo 3. Luego a la cola humana |

### Lo que tiene prohibido decir

Precios (ni "sobre X euros"), hora exacta de llegada (se trabaja por franjas), nombre
del técnico salvo que lo devuelva una herramienta, nada sobre facturas o cobros, y
ninguna promesa de compensación o regalo.

### Ajustar el guion

Dos sitios, y solo dos:

- **Por empresa**, desde la UI: *Contexto de tu empresa* y *Temas que no puede tocar*.
  Se **añaden al final** del guion, de forma que no puedan alterar las frases legales.
- **Para todos**, en `prompts.ts`. Es código, va en un commit, y se sabe quién lo cambió.

---

## 4-bis. La recepcionista: cuando llaman ellos

Es el canal con la relación esfuerzo/valor más alta después de los
mantenimientos, y el que más cambia el trato con el cliente: hoy, si nadie coge
el teléfono, se pierde la llamada y no queda ni rastro de que existió.

### Lo que cambia respecto a las salientes

| | Saliente | Entrante |
|---|---|---|
| ¿Quién inicia? | Nosotros | El cliente |
| Consentimiento | Obligatorio en comercial | **No aplica**: ha llamado él |
| Ventana horaria | 9-21 L-V (comercial) | **No aplica**: marca cuando quiere |
| Numeración | Geográfico o 400 según propósito | Geográfico o 900. **Nunca 400** (no admite entrantes) |
| Declaración de IA | Obligatoria | Obligatoria |
| Salida a persona | Obligatoria | Obligatoria, y **más exigible**: es un servicio de atención al cliente |

El filtro de entrada es a propósito muy corto (`evaluateInboundGate`): módulo
encendido, agente configurado y presupuesto. Nada más, porque nada más aplica.

**Un detalle que importa: si el presupuesto se agota, no se cuelga.** El webhook
devuelve `reject` con el motivo y la plataforma debe estar configurada para
desviar al teléfono de siempre. Colgarle a un cliente que llama a su proveedor de
agua es mucho peor que pagar el minuto.

### Lo primero que hace: saber con quién habla

Nada más descolgar, el sistema resuelve el teléfono contra clientes y leads. Es
la pieza que no existía en el CRM y que ha habido que escribir
(`resolveCallerByPhone`), porque las búsquedas que ya había exigen sesión y aquí
no hay usuario.

Tres resultados, tres conversaciones distintas:

- **Cliente** → puede hablar de SU equipo, SUS visitas, SUS incidencias.
- **Lead** → sabe que existe, pero no le habla de contratos ni instalaciones.
- **Desconocido** → consulta nueva. **No confirma ningún dato de nadie.**

Y un caso que merece su propia regla: si el mismo teléfono aparece en **dos**
clientes (un matrimonio, una empresa familiar), se trata como desconocido. Es
mejor preguntar que saludar a alguien con el nombre de otra persona.

### Los cinco motivos por los que llama la gente

El guion está organizado alrededor de esto, no alrededor de las herramientas:

| Motivo | Qué hace el agente |
|---|---|
| Avería | `crear_incidencia`. Si detecta fuga: "cierre la llave de paso" y escala ya |
| "¿Cuándo me toca?" | `consultar_equipo`, y si quiere cambiarla, los mismos huecos que en la saliente |
| Pide información | `crear_lead` de verdad — es un interesado que ha llamado él |
| Factura o cobro | `escalar_humano` directo. No lo toca |
| Baja o reclamación | `escalar_humano`. No intenta retener ni rebatir |

### Dos interruptores para empezar prudente

En la configuración, la recepcionista tiene dos permisos que **conviene apagar
el primer mes**:

- **Puede cerrar y cambiar citas** — con esto apagado informa de la fecha pero
  deriva el cambio. Así ves cómo va sin que toque la agenda.
- **Puede abrir incidencias** — apagado, toma nota y avisa.

Cuando se apagan, la herramienta correspondiente **no se declara al proveedor**:
no es que el agente se contenga, es que no la tiene. Y el guion cambia para no
prometer lo que no puede hacer.

### Alta de los números

En *Configurar → Números que atiende la recepcionista*. Un número atiende a una
sola empresa, y la unicidad es global: es lo único que identifica de quién es la
llamada cuando entra. La base de datos rechaza el rango 400 aquí.

---

## 4-ter. Campañas comerciales

La fase 1 dejó los guardarraíles comerciales puestos pero sin puerta de entrada:
no había forma de encolar una llamada comercial. Ahora está en
*Agente de voz → Campañas*.

**Una campaña es una tanda que se puede medir y, sobre todo, parar.** Ese es el
motivo de que exista el concepto: si algo va mal a mitad de una tanda de 300
llamadas, quieres un botón, no una consulta SQL.

Sembrar una campaña filtra leads por `party_kind = 'company'`, provincia y
prefijo de CP, y te dice cuántos ha descartado y por qué: sin teléfono,
particulares, ya en cola, o excluidos por la lista de no-llamar. Ese recuento de
particulares no es adorno — es lo que explica por qué una selección de 300 leads
encola 40.

**Pausar cancela lo pendiente y no lo recupera.** Es asimétrico a propósito:
quien pausa lo hace porque algo va mal, y reactivar en silencio una cola que se
paró por un problema es la forma de repetir el problema. Para volver, se siembra
de nuevo.

Recuerda que sin numeración 400 dada de alta, desde el 17-oct-2026 esto no puede
funcionar: la página te lo avisa arriba del todo.

---

## 5. Números

Una empresa tipo (800 clientes, ~240 llamadas de mantenimiento al mes):

| Concepto | Cifra |
|---|---|
| Duración media | 60–90 s |
| Coste por llamada (0,11 $/min + móvil) | ≈ 0,15 $ |
| **Coste mensual** | **≈ 36 $ ≈ 33 €** |
| Lo mismo hecho por un administrativo (12 h × 15 €) | ≈ 180 € |
| Valor de un mantenimiento no perdido | 80–150 € |

Con recuperar **una sola visita al mes**, el módulo se paga cinco veces. Y el dinero
de verdad no está ahí: un mantenimiento que no se agenda es un contrato que no se
renueva.

### Qué medir

Desde el día uno, en `/agente-voz`:

- % de llamadas contestadas
- **% que terminan en cita confirmada** ← la métrica que importa
- Coste por cita conseguida
- % de escalados a humano, y por qué
- Asistencia real a la cita agendada por IA vs. por persona

**Haz un A/B el primer mes.** Media cola por email como siempre, media con llamada.
Si la voz no gana claramente, el problema es el guion, no la tecnología.

---

## 6. Cuando quieras hacer captación comercial

Solo si de verdad lo quieres. Es la fase con más fricción y menos margen.

La maquinaria ya está construida (*Agente de voz → Campañas*, §4-ter). Lo que
falta no es código.

**Requisitos, todos obligatorios:**

1. **Numeración 400** de un operador español (Masvoz, Fonvirtual, Netelip, Zadarma,
   VoIPstudio…). Twilio no la da. **Empieza el trámite ya si la quieres para octubre.**
2. **Base legal documentada por lead**, en `voice_consents`. Para empresas suele ser
   interés legítimo (art. 19 LOPDGDD); aun así se registra.
3. **Solo empresas.** El sistema lo impone; tú solo tienes que asegurarte de que los
   leads tienen `party_kind = 'company'` bien puesto.
4. Ventana 9-21 L-V sin festivos — fija, no configurable.
5. Lista de exclusión consultada siempre.

El agente comercial **no vende y no agenda**: consigue el interés y crea el lead para
que llame una persona. Un agente de IA cierra bien *citas*, no *ventas* — y en
tratamiento de agua la venta necesita análisis en casa y firma.

---

## 7. Riesgos y cómo están cubiertos

| Riesgo | Cobertura |
|---|---|
| La llamada de mantenimiento deriva en venta y pierde su base legal | Guardarraíl duro en el prompt + el agente no tiene herramienta de venta |
| Llamar a un particular con fines comerciales | 4 capas: CHECK, trigger, gate, herramientas separadas |
| Usar el 400 para atención al cliente (prohibido) | CHECK en BD + validación en el gate |
| Cliente atrapado con un bot | `escalar_humano` sin rebatir + notificación inmediata |
| Coste descontrarolado | Tope mensual con corte duro + límite por llamada + corte de llamadas muertas |
| Fuga entre empresas | El `company_id` sale del secreto de cabecera, nunca del prompt ni del body |
| El webhook no llega y el gasto no se contabiliza | Firma HMAC obligatoria + guard de idempotencia + liberación de tareas colgadas |
| Vendor lock-in | Toda la lógica en herramientas propias; el proveedor solo pone el audio |

---

## 8. Lo que queda pendiente

Corto, y por eso conviene leerlo: es lo que **no** está hecho.

- **WhatsApp entrante con IA.** Este módulo manda la confirmación tras una
  llamada, pero **no lee ni contesta** los WhatsApp que llegan. Es la fase 2 de
  la investigación y sigue entera por hacer: hace falta el webhook entrante,
  las tablas de conversación, la ventana de 24 h de Meta y el opt-out por
  `BAJA`/`STOP`. Nada de lo construido lo bloquea.
- **Transferencia en caliente.** El sistema ya decide *si* puede transferir y le
  pasa el número al proveedor, pero **el pase real hay que configurarlo en el
  panel de la plataforma de voz** (ElevenLabs lo llama *transfer to number*).
  Hasta que lo hagas, deja `transfer_enabled` apagado: con él apagado el agente
  dice "le llama un compañero" en vez de prometer un pase que no ocurre.
- **Llamadas dentro de WhatsApp** (Business Calling API). Sin coste de minuto
  entrante y sin operador. Requiere aprobación de Meta. Evaluar más adelante.
- **DPA y subencargados.** Si usas ElevenLabs/Twilio eres encargado del
  tratamiento frente a tus clientes: actualiza la lista de subencargados antes
  de lanzar. Esto no es código, pero sin ello no deberías encender nada.

## 8-bis. Cómo se le enseña a hablar y a concertar visitas

La pregunta natural es "¿cómo hago que aprenda?". Conviene desmontar eso
primero, porque la respuesta correcta cambia todo lo demás.

### El agente no aprende solo. Nunca

No hay entrenamiento, ni memoria entre llamadas, ni mejora con el uso. Cada
llamada empieza de cero con el mismo guion. Si hoy dice una tontería, mañana
dirá exactamente la misma tontería, mil veces, hasta que **alguien cambie el
guion**.

Eso no es una limitación: es lo que lo hace gobernable. En un sistema que
aprendiera solo, nadie podría garantizar que mañana sigue diciendo que es una
IA. Aquí el comportamiento vive en `prompts.ts`, se versiona con git y se sabe
quién lo cambió y cuándo.

**El que aprende eres tú, leyendo transcripciones.** El agente solo hereda lo
aprendido cuando tú lo escribes en el guion.

### El bucle, que es todo el secreto

```
   llamada real  →  transcripción  →  la lees  →  la clasificas
        ↑                                              │
        │                                              ▼
   despliegas  ←  pasan los tests  ←  UN cambio en prompts.ts
```

Cuatro reglas que hacen que el bucle funcione en vez de dar vueltas:

1. **Una semana en simulación antes de marcar a nadie.** Con
   `VOICE_AGENT_SIMULATE=true` la cola corre entera y no suena ningún teléfono.
   Mira a quién *llamaría*. La primera cosecha de errores sale de ahí, gratis.
2. **Lee las transcripciones. Todas, al principio.** Con un tope de 100 minutos
   son unas 80 llamadas; se leen en media hora. De ahí salen tres correcciones
   que valen por veinte hipótesis de despacho.
3. **Un cambio cada vez.** Si tocas cuatro cosas y la siguiente tanda va mejor,
   no sabes cuál fue. Cambias una, despliegas, comparas.
4. **Cada fallo corregido se convierte en un test.** Hay 37 en
   `prompts.test.ts` que vigilan que nadie borre las frases obligatorias. Cuando
   arregles algo, añade el test: así el arreglo no se pierde dentro de tres
   meses cuando alguien reescriba el guion.

### Qué mirar en cada transcripción

Clasifica cada llamada en una de estas casillas. La casilla dice qué arreglar:

| Lo que ves | Qué significa | Dónde se arregla |
|---|---|---|
| Cuelga en los primeros 5 segundos | La apertura no convence | La frase de apertura en `prompts.ts` |
| "¿Qué? ¿Cómo dice?" repetido | Habla demasiado rápido o largo | Frases más cortas en `VOICE_STYLE` |
| Ofrece hueco y el cliente duda mucho | Demasiadas opciones | Ya está en dos; no subir de ahí |
| Da un dato que no le consta | Se lo está inventando | Reforzar la regla 4 del bloque legal |
| Acaba sin cita ni motivo claro | Falta una salida en la tabla | Añadir fila a "Qué hacer en cada salida" |
| Escala a persona sin hacer falta | El umbral está bajo | Acotar cuándo escalar |
| El cliente se enfada | Casi siempre: no entendió que era una IA | La declaración tiene que ir más clara |

### Lo que hace que una llamada de este tipo funcione

Esto no es opinión: es lo que coincide entre la documentación de ElevenLabs, la
gente que ha montado agendadores en producción y lo que ya está escrito en
nuestro guion.

- **Dos opciones de hueco, no cinco.** Con tres la gente duda, pide pensarlo y
  la llamada se muere. Dos es una decisión, no un menú.
- **El modelo no elige la fecha: elige entre las que le da el backend.** Nuestro
  `huecos_mantenimiento` devuelve los huecos ya redactados para decirlos en voz
  alta, y `confirmar_mantenimiento` revalida contra el motor de disponibilidad
  antes de tocar la agenda. Cada responsabilidad que le quitas al modelo es una
  clase entera de errores que deja de existir.
- **Fechas habladas, no escritas.** "El jueves dieciocho por la mañana", nunca
  "18/09". El motor de voz lee texto; los números y las barras los pronuncia
  fatal.
- **Franjas, no horas exactas.** Prometer "a las 10:15" es prometer algo que el
  técnico no controla.
- **Repetir la cita en voz alta al cerrar**, y mandar el WhatsApp. La
  confirmación hablada evita el malentendido; la escrita evita el "yo no dije
  eso".
- **Repite dos veces lo más importante.** ElevenLabs recomienda literalmente
  duplicar la instrucción crítica dentro del prompt, y marcar los pasos
  obligatorios con un *"este paso es importante"* al final de la línea. Los
  modelos le prestan atención extra.
- **Guardarraíles en su propia sección.** No repartidos por el texto: juntos,
  bajo un encabezado propio. Es lo que hace nuestro `LEGAL_BLOCK`.

### Cuándo dejar de tocar el prompt

Cuando el guion pasa de unas 1.000 palabras o necesita más de tres caminos de
conversación distintos, el prompt deja de ser la herramienta adecuada y toca
partirlo en un flujo con estados (ElevenLabs los llama *workflows*). Señal de
que has llegado: empiezas a añadir "si pasó X antes, entonces…". Nuestros tres
guiones están holgadamente por debajo de ese punto, y conviene que sigan así.

### Las tres métricas que dicen si va bien

No mires "cuántas llamadas ha hecho". Mira:

1. **Citas cerradas ÷ llamadas contestadas.** Es el número. Todo lo demás lo
   explica.
2. **Tasa de escalado a persona.** Si sube, el guion tiene un agujero. Si es
   cero, sospecha: significa que no está escalando cuando debería.
3. **Duración media.** Si crece llamada a llamada, se está enredando.

Y una cuarta que no es una métrica pero vale más que las tres: **escucha diez
llamadas enteras tú mismo el primer mes.** No hay panel que sustituya a oír a un
cliente tuyo hablando con tu máquina.

## 9. Fuentes

- [BOE — Resolución de 14 de abril de 2026, numeración 400](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-8409)
- [La Moncloa — Prefijo 400 obligatorio desde octubre de 2026](https://www.lamoncloa.gob.es/serviciosdeprensa/notasprensa/transformacion-digital-y-funcion-publica/paginas/2026/160426-prefijo-400-llamadas-comerciales.aspx)
- [BOE — Ley 10/2025 de servicios de atención a la clientela](https://www.boe.es/buscar/act.php?id=BOE-A-2025-26698)
- [BOE — Circular 1/2023 de la AEPD sobre el art. 66.1.b) LGTel](https://www.boe.es/buscar/doc.php?id=BOE-A-2023-15071)
- [Comisión Europea — Obligaciones de transparencia del art. 50 del Reglamento de IA](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
- [ElevenLabs — Agents Pricing](https://elevenlabs.io/pricing/agents)
- [ElevenLabs — Guía de prompting para agentes](https://elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide) (secciones del prompt, normalización para TTS, énfasis en pasos críticos)
- [Un agendador real con ElevenLabs y Cal.com: que el modelo nunca adivine](https://dev.to/devrchancay/voice-agent-that-books-appointments-elevenlabs-calcom-and-a-backend-that-never-lets-the-model-34e9)
- [Cuándo pasar de un prompt único a un workflow](https://growwstacks.com/blog/how-to-build-workflow-agents-in-elevenlabs)
- [Hamming AI — Rúbrica para puntuar llamadas con un LLM juez](https://hamming.ai/resources/llm-grader-voice-agent-call-scoring-rubric)
- [Coval — Guía de evaluación de agentes de voz](https://www.coval.ai/blog/voice-ai-agent-evaluation-guide/)
- [Twilio — ConversationRelay](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- [Cuatrecasas — Circular de la AEPD sobre llamadas comerciales no solicitadas](https://www.cuatrecasas.com/es/spain/art/publicacion-de-la-circular-de-la-aepd-sobre-llamadas-comerciales-no-solicitadas)
