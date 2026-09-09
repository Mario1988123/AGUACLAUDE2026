# Agente IA de voz + WhatsApp para Hidromanager

**Investigación previa a implementación — 9 de septiembre de 2026**

Alcance pedido: un agente de IA que **reciba llamadas**, **haga llamadas**, **venda** y **conteste WhatsApp**, integrado en el SaaS multi-tenant (Next.js 15 + Supabase).

Alcance revisado tras la primera lectura: se añade **agendar mantenimientos a clientes existentes** como caso de uso, y el análisis lo sitúa como el punto de entrada correcto (§3). El resto del informe se mantiene y sigue siendo válido para los otros tres canales.

---

## 0. Resumen ejecutivo

**El caso de uso ganador no es vender: es agendar mantenimientos a clientes que ya lo tienen contratado.** Es el único de los cuatro que no tiene bloqueo legal, el que más código reutiliza (≈80% ya está escrito) y el que genera dinero de forma medible.

| Canal | Viabilidad técnica | Bloqueo real |
|---|---|---|
| **Agendar mantenimientos a clientes propios** | **Muy alta — el 80% del backend ya existe** | **Ninguno.** Es llamada de servicio, no comercial |
| Recibir llamadas | Alta — ~2 semanas con plataforma | Ley 10/2025: no puedes atender *solo* con IA; escape a humano obligatorio |
| Contestar WhatsApp | Alta — ya tienes la mitad hecha | Falta webhook entrante + sender por empresa (hoy es global) |
| Vender / captar en frío | Baja sin preparación | Consentimiento previo (art. 66.1.b LGTel) + **prefijo 400 desde el 17-oct-2026**. Sin opt-in trazable no hay campaña legal |

**Por qué agendar mantenimientos lo cambia todo:**

- **No es una llamada comercial.** La AEPD (Circular 1/2023) trata las comunicaciones necesarias para prestar el servicio contratado como *ejecución del contrato* (art. 6.1.b RGPD), no como marketing. Sin consentimiento previo, sin Lista Robinson, sin ventana 9-21 L-V.
- **No necesita el prefijo 400.** El BOE lo reserva a llamadas comerciales salientes y **prohíbe** usarlo para atención al cliente. Confirmar citas y coordinar instalaciones sale de numeración geográfica o 800/900 — la que tus clientes ya tienen. Adiós al bloqueo del 17 de octubre.
- **Ya lo tienes construido.** `maintenance_jobs`, motor de disponibilidad con zonas (`computeOfferableSlots`), huecos ofrecibles, confirmar/reprogramar/posponer y la cola de "pendientes de confirmar" existen y funcionan. El agente de voz es un **frontal hablado del flujo `/m/[token]`** que ya está en producción, no un sistema nuevo.

**Recomendación — orden de construcción:**

1. **Saliente de mantenimientos** (el caso estrella).
2. **WhatsApp entrante con IA** (el mismo cerebro, canal barato).
3. **Recepcionista telefónica entrante.**
4. Comercial en frío, **solo si** antes se monta la maquinaria de consentimiento y numeración 400.

Invertir el orden es la forma más rápida de comerse una sanción de la AEPD y de gastar seis semanas en lo que menos margen deja.

**Plataforma recomendada para arrancar:** ElevenLabs Agents (calidad en español peninsular + STT/TTS/telefonía incluidos) o Twilio ConversationRelay (ya tienes `twilio` en `package.json` y credenciales). Coste realista: **0,10–0,12 $/min** todo incluido. Migrar a OpenAI Realtime propio (0,03–0,05 $/min) solo cuando el volumen justifique 3-6 semanas de ingeniería.

---

## 1. Lo legal, primero (porque cambia la arquitectura)

No es la sección aburrida del final. Tres de estas normas obligan a escribir código distinto.

### 1.1 Ley 10/2025 de servicios de atención a la clientela (en vigor desde 27-dic-2025)

Prohíbe atender llamadas **exclusivamente** con contestador automático o inteligencia artificial: el cliente debe poder pedir hablar con una persona física en cualquier momento de la consulta o reclamación.

**Ámbito subjetivo — mira esto con cuidado:**

- Empresas con ≥250 empleados, >50 M€ de facturación o >43 M€ de balance → obligadas.
- **Sectores de servicios básicos de interés general → obligados sin importar el tamaño**, e incluyen expresamente *suministro y distribución de agua*.

Tus clientes son empresas de **tratamiento** de agua (descalcificadores, ósmosis, mantenimiento), no de *suministro y distribución*. Interpretación razonable: no les aplica por sector, y por tamaño tampoco. **Pero la frontera no es evidente y no soy tu abogado.** Consulta antes de vender la funcionalidad como "atiende el teléfono por ti".

**Impacto en el diseño (hazlo igualmente, aplique o no):**
- Frase de escape siempre activa: *"si en cualquier momento quiere hablar con una persona, dígamelo"*.
- Detección de intención de escalado → transferencia a móvil del comercial de guardia o creación de tarea urgente.
- Nunca colgar al cliente por esperar.
- Registrar en BD si el escalado se ofreció y si se cumplió.

### 1.2 Prefijo 400 obligatorio desde el 17 de octubre de 2026

Publicado en BOE en desarrollo de la Ley 10/2025: a partir del **17-oct-2026 las llamadas comerciales solo pueden salir del rango 400** (números nacionales de 9 dígitos, solo salientes). Los operadores deben **bloquear** llamadas comerciales que salgan de otro rango. La CNMC asigna numeración 400 a operadores registrados; la empresa la pide **a través de su operador**.

**Qué NO va por el 400 — y esto te salva el caso de uso principal.** La resolución es explícita: *"los números comprendidos en el rango NXY = 400 no podrán utilizarse para la prestación de servicios de atención al cliente, ni para otros usos distintos de los previstos"*. El rango es **exclusivamente saliente y exclusivamente comercial**. Quedan fuera, y deben salir de numeración geográfica o 800/900:

- Confirmar citas y coordinar instalaciones o visitas de técnico ← **tu caso de mantenimientos**
- Resolver incidencias o prestar soporte
- Informar sobre pedidos o servicios ya contratados
- Gestionar facturas y documentación
- Atender consultas, quejas o reclamaciones

Es decir: **llamar a un cliente con contrato de mantenimiento para agendarle la visita anual no es una llamada comercial y no toca el 400.** Puede salir del número de siempre de la empresa.

Ahora bien, si vas a hacer *también* captación comercial, esto es dentro de **cinco semanas** y tiene dos consecuencias duras:

1. **Twilio no te va a dar un número 400 español.** Si quieres llamadas comerciales salientes legales necesitas un operador español (Masvoz, Fonvirtual, Netelip, Zadarma, VoIPstudio, Aircall…) que ofrezca numeración 400 y trunk SIP. Casi todas las plataformas de voz IA (Vapi, Retell, ElevenLabs, Twilio ConversationRelay) aceptan **SIP trunk propio**, así que la arquitectura no cambia: cambias el proveedor de la "patilla" telefónica, no el cerebro.
2. **El caller ID tiene que ser configurable por empresa**, y distinto según el propósito de la llamada: 400 para comercial, geográfico/900 para atención al cliente. Es una columna en la tabla de configuración del tenant, no una env var.

> Matiz: varias fuentes indican que la obligación recae sobre las empresas dentro del ámbito de la Ley 10/2025; otras lo describen como bloqueo genérico por parte de los operadores. Confírmalo con el operador que elijas antes de lanzar campañas.

### 1.3 La frontera entre llamada de servicio y llamada comercial

Esta distinción es el eje de todo el proyecto, así que conviene tenerla clara.

**Llamada de servicio (libre).** Comunicación necesaria para prestar el servicio ya contratado: recordatorio de cita, agendar el mantenimiento anual incluido en el contrato, avisar del cambio de filtros, incidencia, aviso de que el técnico llega tarde. Base de legitimación: **ejecución del contrato, art. 6.1.b RGPD**. No requiere consentimiento, no consulta la Lista Robinson, no tiene ventana horaria legal y no usa el 400.

**Llamada comercial (regulada).** Promociona, directa o indirectamente, bienes o servicios. Requiere consentimiento previo o interés legítimo restringido, prefijo 400 desde octubre, Robinson y horario.

**El matiz que importa: el upselling contamina la llamada.** Si el agente llama para agendar el mantenimiento y aprovecha para ofrecer un descalcificador nuevo, la llamada deja de ser puramente de servicio. Dos formas de gestionarlo:

- **Segura:** el agente agenda y nada más. Si detecta interés comercial (el cliente se queja de cal, pregunta por un equipo), crea un lead con origen "IA mantenimiento" y **que llame un humano**. Esto además convierte mejor.
- **Con base legal:** la AEPD, en la **Circular 1/2023**, presume lícito el tratamiento por interés legítimo cuando hay relación contractual previa, los datos se obtuvieron lícitamente y la oferta es de **productos o servicios similares a los ya contratados**, siempre con derecho de oposición disponible. Un filtro nuevo o una ampliación de equipo encajan; un producto de otra familia, no.

Recomendación: **arranca con la opción segura.** El guardarraíl es una línea de prompt y te ahorra la discusión entera.

### 1.4 Llamadas comerciales: consentimiento previo (art. 66.1.b LGTel + RGPD)

Aplica solo si haces captación. Desde 2023 la llamada comercial no solicitada a personas físicas está prohibida salvo consentimiento previo. Estado en 2026:

- **Bases válidas:** consentimiento expreso e inequívoco, o interés legítimo **muy restringido** (cliente actual, producto similar, informado previamente, con oposición disponible, no en listas de exclusión).
- **El consentimiento caduca a los 2 años** → hace falta re-opt-in activo. Contratos derivados de consentimiento caducado son nulos.
- **Consultar Lista Robinson y Stop Publicidad como máximo 24 h antes** de llamar.
- **Horario:** 9:00–21:00, lunes a viernes, sin festivos.
- **Identificación obligatoria** al inicio: responsable y finalidad comercial. Prohibido número oculto.
- **Oposición:** número de referencia al cliente, registro mínimo 1 año, justificante escrito en ≤30 días.
- **El consentimiento es por canal.** Un opt-in para llamadas **no** autoriza WhatsApp, y viceversa.
- Multas AEPD recientes por esto: 10.000 €, 30.000 €, 40.000 €.

**Impacto en el diseño:** necesitas una tabla de consentimientos por `(persona, canal, fecha, prueba, caducidad)` y un *gate* que el marcador saliente consulte antes de cada llamada. Ya existe `consents-card.tsx` en el módulo de clientes — hay que extenderla, no empezar de cero.

### 1.5 Reglamento Europeo de IA, art. 50 — aplicable desde el 2 de agosto de 2026

**Ya está en vigor.** Todo sistema de IA que interactúe directamente con personas debe informar de que es IA, en la primera interacción, de forma clara y en el idioma del usuario. La excepción ("es obvio") no es de fiar. La responsabilidad recae también en quien pone el sistema delante del cliente europeo, no solo en el proveedor.

**Impacto:** la primera frase del agente lo declara. Sin excepciones, sin "asistente virtual" ambiguo.

> *"Buenos días, le atiende el asistente virtual de [Empresa]. Es un sistema automático con inteligencia artificial. Si prefiere hablar con una persona, dígamelo en cualquier momento. ¿En qué puedo ayudarle?"*

Esa frase cubre 1.1 y 1.4 a la vez, y son ~7 segundos de audio ≈ 0,0002 $. Barata.

### 1.6 RGPD y multi-tenant

- **Grabación de llamadas:** base legal + aviso previo. Si grabas, minuta la retención (30–90 días) y bórralo automáticamente. Con Retell/Vapi hay add-on de eliminación de PII (~0,01 $/min).
- **Tú eres encargado del tratamiento**; cada empresa cliente es responsable. Necesitas DPA con tus clientes y **subencargados** declarados (Twilio, ElevenLabs, OpenAI…). Actualiza la lista de subencargados antes de lanzar.
- **Transferencias fuera del EEE:** Vapi y Retell son estadounidenses y no publican residencia de datos en la UE. ElevenLabs sí ofrece residencia europea, pero **solo en plan Enterprise**, y su documentación aclara que el *almacenamiento* es en la región elegida mientras el *procesamiento* puede ocurrir en otro sitio. Si un cliente tuyo exige datos en la UE, la respuesta honesta hoy es: SCCs + minimización + retención corta, no "está todo en Europa".

---

## 2. Arquitectura recomendada: un cerebro, cuatro canales

El error caro sería montar cuatro bots. La lógica de negocio (quién es este teléfono, qué contrato tiene, hay hueco el jueves, crear aviso) es **la misma** en los cuatro canales y ya vive en tus server actions.

```
        ENTRADA                      CEREBRO                    ACCIONES
 ┌────────────────────┐
 │ Llamada entrante   │──┐
 │ (nº geográfico)    │  │
 ├────────────────────┤  │      ┌──────────────────┐      ┌──────────────────────┐
 │ Llamada saliente   │──┤      │  agent-core      │      │ Supabase (RLS)       │
 │ (nº 400)           │  ├─────▶│                  │─────▶│ · buscar cliente     │
 ├────────────────────┤  │      │ · identidad      │      │ · crear lead         │
 │ WhatsApp texto     │──┤      │   del tenant     │      │ · crear incidencia   │
 │ (webhook Twilio)   │  │      │ · consentimiento │      │ · hueco en agenda    │
 ├────────────────────┤  │      │ · herramientas   │      │ · consultar contrato │
 │ Llamada WhatsApp   │──┘      │ · escalado       │      │ · timeline / eventos │
 │ (Calling API)      │         │ · transcripción  │      └──────────────────────┘
 └────────────────────┘         └──────────────────┘                  │
                                          │                           ▼
                                          ▼                  ┌──────────────────┐
                                 ┌──────────────────┐        │ Escalado humano  │
                                 │ ai_conversations │        │ · transferencia  │
                                 │ ai_messages      │        │ · tarea urgente  │
                                 │ ai_tool_calls    │        │ · push al comercial│
                                 └──────────────────┘        └──────────────────┘
```

**Las "herramientas" del agente son endpoints HTTP tuyos**, no lógica dentro de la plataforma de voz. Esto es lo que te permite cambiar de Vapi a ElevenLabs a OpenAI Realtime sin reescribir nada, y es lo que mantiene el `company_id` bajo tu control en vez de en el prompt de un tercero.

**Herramientas mínimas del MVP** (`/api/ai-agent/tools/*`, autenticadas con un secreto por tenant):

| Herramienta | Qué hace | Reutiliza |
|---|---|---|
| `huecos_mantenimiento` | 2-3 huecos ofrecibles de un job | `getMaintenanceOfferableSlots` / `computeOfferableSlots` |
| `confirmar_mantenimiento` | fija la cita | `customerConfirmAction` / `customerRescheduleAction` |
| `posponer_mantenimiento` | aplaza con motivo | `customerPostponeAction` |
| `identificar_contacto` | teléfono → cliente / lead / desconocido | `modules/customers`, `modules/leads` |
| `consultar_equipo` | qué tiene instalado, último mantenimiento | `modules/installations`, `maintenance` |
| `crear_incidencia` | avería / reclamación | `modules/incidents` |
| `crear_lead` | interesado nuevo + origen `ia_mantenimiento` / `ia_voz` | `modules/leads` |
| `escalar_humano` | transferir o crear tarea urgente | `modules/notifications` |
| `enviar_whatsapp` | confirmación tras la llamada | `modules/mailing/whatsapp.ts` |

Las tres primeras son **todo el MVP**. Las demás llegan con la recepcionista entrante.

---

## 3. El caso estrella: agendar mantenimientos por teléfono

Este es el que hay que construir primero. No por prudencia legal: porque es **el que más barato sale y más dinero mueve**.

### 3.1 El problema real que resuelve

Hoy el recordatorio de mantenimiento sale por email (`api/cron/maintenance-reminders`, plantillas `maintenance_confirm_request` y `maintenance_day_before`) con deep-link público a `/m/[token]`. Funciona, pero el email tiene un techo: en clientes de 55+ años con un descalcificador en el garaje, la tasa de apertura es baja y la de confirmación, peor. Lo que queda sin confirmar cae en la cola de `listMaintenanceToConfirm` y **alguien lo tiene que llamar a mano**.

Esa cola es exactamente el trabajo que el agente puede absorber: llamadas cortas (60–90 s), guion cerrado, decisión binaria con tres salidas (confirmo / otra fecha / pospón). Es el tipo de conversación que la IA de voz hace bien hoy, no el tipo que hace mal.

### 3.2 Lo que ya está construido (y no hay que volver a hacer)

| Pieza | Dónde vive | Qué aporta al agente |
|---|---|---|
| Cola de pendientes | `maintenance/to-confirm-actions.ts` → `listMaintenanceToConfirm`, `countMaintenanceToConfirm` | **A quién llamar**, ya filtrado por rol y empresa |
| Motor de disponibilidad | `scheduling/availability.ts` → `computeOfferableSlots`, `isSlotOfferable` | **Qué huecos ofrecer**, con zonas, técnico y mañana/tarde |
| Huecos de un job | `maintenance/public-confirmation-actions.ts` → `getMaintenanceOfferableSlots` | Las 2-3 opciones que el agente lee en voz alta |
| Confirmar / reprogramar / posponer | `customerConfirmAction`, `customerRescheduleAction`, `customerPostponeAction` | **Las tres únicas acciones** que el agente necesita ejecutar |
| Programación automática | `maintenance/auto-schedule.ts` → `ensureMaintenanceWindow`, `autoScheduleMaintenanceForContract` | Genera los jobs que luego se confirman |
| Idempotencia | `customer_reminder_sent_at`, `customer_day_before_sent_at` en `maintenance_jobs` | Evita llamar dos veces — el mismo patrón sirve para `voice_call_attempted_at` |
| Token público | `ensureConfirmationToken` | Enviar el resumen por WhatsApp al colgar |

**El agente de voz es un frontal hablado de `/m/[token]`.** Mismas acciones, mismas validaciones, mismo motor de huecos. Lo único nuevo es el audio y el orquestador de llamadas.

### 3.3 Lo que hay que construir

1. **Cola de llamadas** — tabla `voice_call_queue` (job_id, company_id, teléfono, intentos, próximo intento, resultado) alimentada desde `listMaintenanceToConfirm`, con reintentos (máx. 3, separados 24 h) y ventana horaria configurable por empresa.
2. **Tres herramientas HTTP** que envuelven las server actions ya existentes: `huecos_mantenimiento(job_id)`, `confirmar(job_id, slot)`, `posponer(job_id, motivo)`. Nada más. Cuanto más pequeña la superficie, menos se inventa el agente.
3. **Extensión del cron**: `maintenance-reminders` ya decide a quién recordar; añadir la rama "si no confirmó por email en X días → encolar llamada".
4. **Cierre por WhatsApp**: al colgar, mensaje con la fecha confirmada usando `whatsapp.ts` y el token existente. Duplica la tasa de asistencia y deja prueba escrita.
5. **Guardarraíl anti-upsell**: si el cliente pregunta por productos → `crear_lead` con origen `ia_mantenimiento` y fin de tema. (Ver §1.3.)

### 3.4 Guion (90 segundos)

```
[Declaración art. 50 + escape Ley 10/2025 — obligatorio, ~7 s]
  "Buenos días, ¿hablo con {nombre}? Le llama el asistente virtual de {empresa};
   es un sistema automático con inteligencia artificial y si prefiere hablar con
   una persona, dígamelo y le paso."

[Motivo — servicio, no venta]
  "Le llamo porque le toca la revisión de su {equipo}, incluida en su contrato."

[Oferta cerrada — máximo 2 opciones, de computeOfferableSlots]
  "Tengo hueco el jueves 18 por la mañana o el viernes 19 por la tarde.
   ¿Cuál le viene mejor?"

[Salidas]
  confirma      → customerConfirmAction + WhatsApp con la fecha
  otra fecha    → customerRescheduleAction, u ofrecer 2 más
  ahora no      → customerPostponeAction con motivo
  no contesta   → reintento en 24 h (máx. 3), luego a cola humana
  pide persona  → transferencia inmediata o tarea urgente
  pregunta por productos → crear_lead y cerrar: "le llama un compañero"
```

### 3.5 El número: por qué esto es barato

| Concepto | Cifra |
|---|---|
| Duración media de llamada | 60–90 s |
| Coste por llamada a 0,11 $/min + móvil | **≈ 0,15 $** |
| Cola típica de una empresa (800 clientes, 30% sin confirmar por email) | ~240 llamadas/mes |
| **Coste mensual del caso de uso completo** | **≈ 36 $ ≈ 33 €** |
| Coste de que un administrativo haga esas 240 llamadas (≈ 12 h a 15 €/h) | ≈ 180 € |
| Valor de un mantenimiento no perdido | 80–150 € |

Con recuperar **una sola visita al mes** el módulo se paga cinco veces. Y hay un segundo efecto, más grande que el ahorro: un mantenimiento que no se agenda es un contrato que no se renueva. Ahí está el dinero de verdad.

### 3.6 Cómo medirlo

Sin esto no sabrás si funciona. Instrumenta desde el día uno:

- % de llamadas contestadas
- % que terminan en cita confirmada (**la métrica que importa**)
- Duración media y coste por cita conseguida
- % de escalados a humano y por qué
- Comparativa contra el email: confirmación por email vs. por voz sobre la misma cola
- Tasa de asistencia real a la cita agendada por IA vs. por humano

Recomendación: **A/B contra el flujo actual durante el primer mes.** Mitad de la cola por email como siempre, mitad con llamada. Si la voz no gana claramente, el problema es el guion, no la tecnología.

---

## 4. Comparativa de plataformas de voz

Precios verificados en las páginas oficiales el 9-sep-2026.

| | **ElevenLabs Agents** | **Vapi** | **Retell AI** | **Twilio ConversationRelay** | **OpenAI Realtime (DIY)** |
|---|---|---|---|---|---|
| Modelo de precio | Suscripción + 0,08 $/min extra | 0,05 $/min plataforma + coste real STT/LLM/TTS | 0,07–0,31 $/min todo incluido | 0,07 $/min + voz Twilio + tu LLM | Solo tokens |
| STT/TTS incluidos | Sí | No (a coste) | Sí | Sí (Deepgram + ElevenLabs por defecto) | No |
| LLM | Aparte, a coste | Aparte, a coste (0 $ con tu API key) | Incluido en el tramo | Tuyo | Incluido |
| Telefonía | Incluida en plataforma | Twilio ~0,013 $/min | SIP propio gratis | Twilio | Twilio Media Streams |
| **Coste realista/min** | **0,10–0,12 $** | **0,12–0,15 $** | **0,09–0,15 $** | **0,10 $** | **0,03–0,05 $** (mini) / 0,07–0,13 $ (full) |
| Concurrencia | 20 en Pro (99 $/mes), 30 en Scale (299 $) | 10 incl., +10 $/línea | 20 gratis, +8 $/llamada | Twilio | Tu infraestructura |
| Nº teléfono | Incluido | Twilio ~1,15 $/mes | 2 $/mes (10 $ verificado) | ~1,15 $/mes | ~1,15 $/mes |
| Calidad español (ES) | **La mejor** | Depende del TTS | Buena | Buena (usa ElevenLabs) | Buena, mejorando |
| Residencia UE | Sí, **solo Enterprise** | No publicada | No (EE. UU. + SCCs) | Depende de configuración | No (EE. UU.) |
| SIP propio (→ nº 400) | Sí | Sí | Sí, sin coste | Sí | Sí |
| Esfuerzo hasta primera llamada | 2–3 días | 3–5 días | 3–5 días | 1 semana | 3–6 semanas |
| Riesgo de lock-in | Medio | Bajo | Medio | Bajo | Ninguno |

**Extras que suman en Retell** (útiles y baratos): base de conocimiento +0,005 $/min, **eliminación de PII +0,01 $/min**, denoising avanzado +0,005 $/min, guardarraíles +0,005 $/min. El denoising importa más de lo que parece: tus usuarios llaman desde furgonetas y obras.

**Veredicto:**

- **Empieza con ElevenLabs Agents.** Gana en lo único que el cliente final juzga en los primeros 3 segundos: si la voz suena a persona española o a GPS. El plan Pro (99 $/mes, 1.238 min, 20 concurrentes) cubre el piloto completo.
- **Twilio ConversationRelay es el plan B fuerte** porque ya tienes `twilio@6` instalado, credenciales y `whatsapp.ts` funcionando: una sola factura, un solo proveedor, un solo DPA. Y usa ElevenLabs como TTS por defecto, así que la voz no empeora.
- **OpenAI Realtime propio** es 2–3× más barato pero solo compensa a partir de ~5.000 min/mes agregados entre todos tus tenants. Con `gpt-realtime-2.1-mini` (10 $/1M tokens audio in, 20 $/1M out) y caché de prompt (audio cacheado a 0,40 $/1M, ~99% de descuento) bajas a 0,02–0,05 $/min. Guárdalo como fase 4.
- **Vapi** solo si quieres mezclar proveedores a mano. Flexibilidad que ahora mismo no necesitas.

---

## 5. WhatsApp: lo que ya tienes y lo que falta

`src/modules/mailing/whatsapp.ts` (249 líneas) ya envía por Twilio, con soporte de plantillas Meta (`HX...`), tabla `whatsapp_sends` y registro en timeline. **Falta todo lo entrante.**

### 5.1 Problema de multi-tenant, hoy

```ts
// whatsapp.ts:127
const from = process.env.WHATSAPP_TWILIO_FROM!;
```

Un único sender global. Consecuencias:

- Un mensaje entrante **no se puede enrutar** a la empresa correcta: todas comparten número.
- Todos tus tenants aparecen ante el cliente final como el mismo remitente.
- Es una fuga de contexto entre empresas esperando a ocurrir (mismo patrón que el fallo de `admin client sin company_id`).

**Hay que mover el sender a la configuración del tenant** (`company_settings.whatsapp_sender` + credenciales de subcuenta Twilio, o Twilio Subaccounts por empresa). El webhook entrante enruta por el campo `To` del payload.

### 5.2 Qué construir

1. `src/app/api/webhooks/whatsapp/route.ts` — validar firma con `twilio.validateRequest`, resolver `company_id` desde `To`, persistir, encolar respuesta IA.
2. Tablas `ai_conversations` / `ai_messages` con RLS por `company_id`.
3. **Ventana de 24 h**: fuera de ella solo plantillas aprobadas por Meta. El agente tiene que saber en qué lado está — si no, responderá y Meta lo rechazará.
4. **Opt-out**: `BAJA` / `STOP` → marcar consentimiento revocado y no volver a escribir. Obligatorio.
5. Reutilizar `MESSAGE_TEMPLATES` de `modules/messaging/templates.ts` como few-shot del tono de la empresa.

### 5.3 Costes WhatsApp

- Meta cambió a **precio por mensaje** el 1-jul-2025. Los mensajes de **servicio** (respuestas dentro de la ventana de 24 h) son **gratis**. Utilidad y autenticación son gratis dentro de la ventana, ~0,0034 $ fuera. Marketing se cobra siempre, y España subió tarifa de marketing el 1-jul-2026.
- **Twilio añade 0,005 $/mensaje** (entrante y saliente) sobre lo de Meta. A 5.000 mensajes/mes son 25 $. Ir directo a **Meta Cloud API** te ahorra ese fee, pero pierdes la integración que ya tienes escrita. Para el MVP: quédate en Twilio; el ahorro no paga la reescritura hasta ~20.000 msg/mes.
- **Aviso:** circula información de que Meta empezará a cobrar mensajes de servicio y utilidad dentro de la ventana de 24 h desde el 1-oct-2026, y de un "Meta Business Agent" a 2 $/1M tokens (~0,04–0,05 $ por mensaje). **La documentación oficial de Meta no lo confirma** a día de hoy; sí aparece una política de precios para "AI Providers" con efecto 16-feb-2026. Vigílalo: si se confirma, el coste por mensaje se multiplica por 10 y el modelo de negocio del canal cambia.

### 5.4 Bonus: llamadas dentro de WhatsApp

La **WhatsApp Business Calling API** (VoIP dentro del hilo de WhatsApp) permite recibir y hacer llamadas sin telefonía tradicional. Las llamadas **iniciadas por el usuario son gratuitas**; las iniciadas por el negocio se facturan por duración.

Es la vía más interesante a medio plazo: sin coste de minuto entrante, sin número 400, sin operador, y el cliente ya está en el hilo donde tiene sus facturas y su historial. Requiere aprobación de Meta y no todas las cuentas tienen acceso. **Evaluar en fase 3, no bloquear el MVP con esto.**

---

## 6. Costes: ejemplo con números reales

Escenario: **una empresa cliente**, tamaño típico de tu base (2 técnicos, ~800 clientes).

| Concepto | Volumen/mes | Precio unitario | Coste |
|---|---|---|---|
| Llamadas entrantes atendidas por IA | 250 × 2,5 min = 625 min | 0,11 $/min | 69 $ |
| Llamadas salientes (recordatorio mantenimiento a clientes propios) | 400 × 1,2 min = 480 min | 0,11 $/min + 0,018 $/min móvil | 62 $ |
| Números (1 geográfico + 1 del rango 400) | 2 | ~3–8 $/mes | 10 $ |
| WhatsApp entrante+saliente | 3.000 msg | 0,005 $ Twilio + LLM | 22 $ |
| Plantillas Meta fuera de ventana | 300 | 0,0034 $ | 1 $ |
| **Total coste directo** | | | **~164 $/mes ≈ 150 €** |

Con 20 empresas: ~3.000 €/mes de coste variable. Precio de venta razonable del módulo: **199–349 €/empresa/mes** → margen bruto 55–70%. Es un módulo premium vendible, no un extra gratis.

**Palancas de coste, por orden de impacto:**
1. Cortar llamadas muertas rápido (buzón, silencio, colgado) — hasta 20% del gasto en marcadores mal configurados.
2. Caché de prompt (system prompt idéntico entre llamadas) — 99% de descuento en la parte cacheada con OpenAI Realtime.
3. Modelo pequeño para clasificar + grande solo si hace falta.
4. Migrar a Realtime propio a partir de ~5.000 min/mes agregados.

---

## 7. Encaje multi-tenant (lo que hay que hacer bien desde el minuto uno)

Dado el historial del proyecto (fugas cross-tenant en informes de almacén, admin client sin `company_id`), esto no es teórico:

1. **`company_id` nunca viaja en el prompt.** Viaja en el token de la herramienta. El agente no puede "decir" que es de otra empresa.
2. **Un secreto por tenant** para firmar las llamadas a `/api/ai-agent/tools/*`. Rotable.
3. **Cliente Supabase con `company_id` explícito** en todos los endpoints de herramientas — nada de service role sin filtro.
4. **Límite de gasto por empresa** (minutos/mes, mensajes/mes) con corte automático. Un bucle de agente sin límite es una factura de cuatro cifras en una noche.
5. **`ai_conversations`, `ai_messages`, `ai_tool_calls` con RLS por `company_id`**, igual que `whatsapp_sends`.
6. **Prompt por empresa**: nombre comercial, tono, marcas que instala, zona, horario, qué NO puede prometer (precios, plazos). Editable desde `configuracion/`.
7. **Ojo con `fetchAllRows`**: si una herramienta lista clientes o citas, el límite de 1.000 filas de PostgREST vuelve a morder.

---

## 8. Riesgos, ordenados por probabilidad de arruinarte el proyecto

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **La llamada de mantenimiento deriva en venta** y pasa a ser comercial: pierde la cobertura del art. 6.1.b y entra en el régimen del 400 | Guardarraíl duro: el agente agenda y no ofrece nada. Interés comercial → `crear_lead` y llama un humano (§1.3) |
| 2 | **Venta en frío por IA sin consentimiento** → sanción AEPD + reputación de tus clientes | No lanzar la fase 4 sin opt-in trazable y numeración 400 |
| 2b | **17-oct-2026, prefijo 400** bloquea las salientes comerciales | Solo afecta a la fase 4. Operador español con numeración 400; caller ID por tenant **y por propósito** (servicio ≠ comercial) |
| 3 | **Sender WhatsApp global** → mensajes entrantes irrutables y contexto mezclado entre empresas | Mover sender a config del tenant *antes* de abrir el canal entrante |
| 4 | La IA **promete precios o plazos** que la empresa no cumple | Guardarraíles duros en prompt + lista de temas prohibidos + validación de herramientas (que no pueda cerrar precio, solo agendar) |
| 5 | Cliente enfadado atrapado con un bot → viral en reseñas | Escalado a humano en la primera señal; detección de frustración; nunca más de 2 vueltas sin ofrecer persona |
| 6 | Coste descontrolado por bucles o llamadas zombi | Límite de duración por llamada (5 min), límite mensual por tenant, corte por silencio |
| 7 | Vendor lock-in de la plataforma de voz | Toda la lógica en herramientas HTTP propias; la plataforma solo hace audio |
| 8 | Meta cambia precios de WhatsApp (posible 1-oct-2026) | Diseñar el coste por conversación, no por mensaje; poder cambiar a Cloud API directo |

**Sobre "vender":** un agente IA cierra bien *citas*, no *ventas*. En tratamiento de agua la venta necesita análisis de agua en casa y firma. El objetivo realista del agente es **llenar agendas** — la del técnico con mantenimientos, la del comercial con visitas calificadas. Ambas cosas ya las modelan `modules/maintenance`, `modules/scheduling` y `modules/leads`. Plantearlo como "la IA vende sola" es la vía rápida al desengaño.

Y hay una razón de negocio, no solo legal, para empezar por mantenimientos: **es el caso donde la IA compite contra nadie.** Esas 240 llamadas al mes hoy no las hace nadie o las hace mal un administrativo entre otras diez tareas. No tienes que demostrar que la IA es mejor que una persona — solo mejor que el silencio. En captación comercial compites contra tu mejor comercial, y ahí pierdes.

---

## 9. Plan por fases

Reordenado: el saliente de mantenimientos pasa primero porque no tiene bloqueo legal y reutiliza casi todo.

| Fase | Contenido | Esfuerzo | Requisitos previos |
|---|---|---|---|
| **0. Cimientos** | Tablas `ai_*` con RLS, endpoints de herramientas, secreto por tenant, config de agente y caller ID por empresa, límite de gasto | 1 semana | Ninguno |
| **1. Mantenimientos por voz** ⭐ | Cola `voice_call_queue`, 3 herramientas sobre las server actions existentes, reintentos, ventana horaria, cierre por WhatsApp, guardarraíl anti-upsell, métricas + A/B contra email | **1–1,5 semanas** | Fase 0. Cuenta ElevenLabs o Twilio |
| **2. WhatsApp IA** | Sender por tenant, webhook entrante, ventana 24 h, opt-out, respuesta con IA + escalado | 1–1,5 semanas | Fase 0. WhatsApp Business verificado (no sandbox) |
| **3. Recepcionista telefónica** | Número geográfico por empresa, declaración de IA, escalado a humano, transcripción al timeline, `crear_incidencia` | 1,5–2 semanas | Fase 0 |
| **4. Comercial en frío** *(opcional)* | Consentimiento por canal, Listas Robinson, ventana 9-21 L-V, **numeración 400 con operador español** | 2 semanas | Fase 3 + **operador con numeración 400** + base de opt-in |
| **5. Optimización** | Realtime propio si el volumen lo justifica, A/B de guiones, llamadas dentro de WhatsApp | Abierto | Volumen real medido |

**Primer valor en producción: 2–2,5 semanas** (fases 0+1). Los tres canales de servicio vivos: 4–5 semanas. La fase 4 es opcional y puede no hacerse nunca.

---

## 10. Decisiones que tienes que tomar antes de empezar

1. **¿Empiezas solo por mantenimientos?** Recomendación: sí. 2-2,5 semanas, ~33 €/mes de coste por empresa, cero fricción legal y una métrica clara (citas confirmadas). Si eso funciona, lo demás se vende solo.
2. **¿Módulo vendible aparte o incluido?** Solo mantenimientos (~33 €/mes de coste) cabe en el plan base como gancho. Los tres canales (~150 €/mes) no: módulo premium con cuota + bolsa de minutos.
3. **¿Plataforma o DIY?** Recomendación: plataforma ahora, DIY cuando midas >5.000 min/mes.
4. **¿Vas a hacer captación comercial algún día?** Si la respuesta es sí, habla con un operador español con numeración 400 **este mes** — el 17 de octubre no espera y el alta no es inmediata. Si es no, te ahorras el trámite entero.
5. **¿Grabas las llamadas?** Cambia el aviso legal, la retención y el DPA. Recomendación: transcripción sí, audio no (o 30 días).
6. **¿Quién firma el DPA con Twilio/ElevenLabs?** Si lo firmas tú como encargado, asumes la responsabilidad ante tus 20 clientes. Es lo normal, pero debe estar en el contrato.

---

## Fuentes

**Plataformas y precios**
- [Vapi — Pricing](https://vapi.ai/pricing)
- [Retell AI — Pricing](https://www.retellai.com/pricing)
- [ElevenLabs — Agents Pricing](https://elevenlabs.io/pricing/agents)
- [ElevenLabs — European Data Residency](https://elevenlabs.io/blog/introducing-european-data-residency)
- [Twilio — ConversationRelay docs](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- [Twilio — Programmable Voice Pricing España](https://www.twilio.com/en-us/voice/pricing/es)
- [Twilio — WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing)
- [OpenAI — API Pricing](https://developers.openai.com/api/docs/pricing)
- [Comparativa per-minute cost Vapi/ElevenLabs/Retell/Bland](https://devaland.com/blog/voice-ai-pricing-comparison-2025)
- [Retell AI — Vapi vs ElevenLabs (2026)](https://www.retellai.com/blog/vapi-vs-elevenlabs)

**WhatsApp**
- [Meta — WhatsApp Business Platform Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Meta — Cloud API Calling](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling)
- [WhatsApp Business Calling API — anuncio oficial](https://whatsappbusiness.com/blog/whatsapp-business-calling-api/)
- [360Dialog — Meta Business Agent guide](https://360dialog.com/blog/meta-business-agent-complete-guide-whatsapp-api/)

**Legal España / UE**
- [BOE — Ley 10/2025 de servicios de atención a la clientela](https://www.boe.es/buscar/act.php?id=BOE-A-2025-26698)
- [Protección Data — Aspectos clave de la Ley 10/2025](https://protecciondata.es/ley-10-2025-regulacion-servicios-atencion-clientela/)
- [PwC — Ley 10/2025 y protección de datos](https://www.pwc.es/es/newlaw-pulse/regulacion-digital/ley-10-2025-atencion-clientela-nuevas-obligaciones-proteccion-datos.html)
- [La Moncloa — Prefijo 400 obligatorio desde octubre de 2026](https://www.lamoncloa.gob.es/serviciosdeprensa/notasprensa/transformacion-digital-y-funcion-publica/paginas/2026/160426-prefijo-400-llamadas-comerciales.aspx)
- [Sinologic — Numeración 400: manual para operadores (BOE 2026)](https://www.sinologic.net/2026-07/numeracion-400-para-llamadas-comerciales-manual-de-instrucciones-para-operadores-boe-2026.html)
- [CNMC — Informe numeración comercial](https://www.cnmc.es/prensa/inf-numeracion-comercial-20260401)
- [Pablo F. Burgueño — Cómo hacer llamadas comerciales legalmente en España 2026](https://pablofb.com/2026/02/22/el-ocaso-del-spam-telefonico-normas-multas-y-estrategias-de-captacion-de-leads/)
- [AEPD — Derecho a no recibir llamadas comerciales no solicitadas (PDF)](https://www.aepd.es/infografias/info-derechos-llamadas-comerciales-no-solicitadas.pdf)
- [BOE — Circular 1/2023 de la AEPD sobre el art. 66.1.b) LGTel](https://www.boe.es/buscar/doc.php?id=BOE-A-2023-15071)
- [ECIJA — Criterio de la AEPD en la Circular 1/2023](https://www.ecija.com/actualidad-insights/criterio-de-la-aepd-en-la-circular-1-2023-sobre-el-envio-de-llamadas-comerciales-en-la-reforma-de-la-ley-general-de-telecomunicaciones/)
- [BOE — Resolución de 14 de abril de 2026, numeración 400](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-8409)
- [Vodafone Empresas — Prefijo 400: qué llamadas quedan fuera](https://www.vodafone.es/c/empresas/es/nuestra-vision/prefijo-400/)
- [Comisión Europea — Obligaciones de transparencia del art. 50 del Reglamento de IA](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
- [Cooley — AI Act transparency obligations in effect 2 Aug 2026](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026)
