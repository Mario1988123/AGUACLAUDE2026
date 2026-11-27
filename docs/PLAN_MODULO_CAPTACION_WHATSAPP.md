# Plan — Módulo de captación por WhatsApp («Captación»)

Fecha: 2026-11-25 · Estado: **PLAN, nada aplicado** (ni código, ni migraciones, ni configuración).
Encargo de Mario: copiar el embudo de Rexen dentro de Hidromanager, multiempresa, con Vercomi como
Tech Provider de la WhatsApp Cloud API. Primera empresa: Infinity Aqua 2021 SL.

Leyenda: **[V]** = comprobado leyendo el código o las migraciones del repo el 2026-11-25 ·
**[NV]** = no verificado (deducción o dato que no he podido comprobar) · **[decide]** = decisión
rutinaria tomada por mí · **[Mario]** = necesita respuesta o acción de Mario · **[Meta]** = depende
de Meta.

No he consultado la base de datos de producción: todo lo que digo del esquema sale de
`supabase/migrations/`. En este repo ya ha pasado que el remoto no coincide con las migraciones
(`20260910120000_columnas_que_faltaban_en_remoto.sql`), así que antes de la fase 1 hay que
contrastar con el remoto. Tampoco he comprobado que Infinity exista como company ni sus 804
clientes: lo tomo del encargo.

---

## Decisiones de Mario (25-11-2026). Mandan sobre el resto del documento

Si algo de más abajo contradice esta lista, vale la lista. Hay que repasar el cuerpo del documento para que cuadre con ella.

1. **Recordatorio: a los 15 días, no a los 3.** Solo para quien no ha contestado nada. Uno y ningún otro.
2. **La propuesta no lleva precios por defecto.** Es un PDF que propone equipos según el tipo de negocio, y los precios los da el comercial en la llamada. Por empresa se puede ajustar si se enseñan precios (y cuáles).
3. **Verificación de Infinity Aqua en Meta: sí, antes del piloto.** Mario necesita la guía paso a paso.
4. **El lead se crea con el primer «Sí»** (ya muestra interés), con el origen `whatsapp`, y entra en la bolsa común. El botón [Que me llaméis] solo lo marca como prioritario.
5. **Un «No» solo bloquea dentro de este módulo.** No afecta a las llamadas ni al mailing de Hidromanager.
6. **Los interesados van a una bolsa común.** El admin de la empresa los reparte a los comerciales para que llamen.
7. **Búsqueda de negocios gratis, como en Theramic y WaterGo.** La fuente principal es OpenStreetMap (Overpass): sin clave ni tarjeta. Después se lee la web de cada negocio para sacar el teléfono. Google Places queda opcional y apagado: solo si OSM se queda corto, con el proyecto `aguaclaude` de Hidromanager, una clave de servidor nueva restringida a «Places API (New)» (nunca la `NEXT_PUBLIC_GOOGLE_MAPS_KEY` pública) y un tope dentro de las 1.000 gratis al mes.
8. **MVP sin IA.** El embudo va solo con botones, sin coste de IA:
   - Mensaje en frío: [Sí, cuéntame] [No, gracias].
   - Quien pulsa «Sí» recibe el PDF de su nicho y otros dos botones: [Que me llaméis] [Ahora no].
   - «Que me llaméis» marca el lead (creado con el primer «Sí») como prioritario para llamar.
   - Si escriben texto libre, va a la bandeja para que conteste una persona y se avisa. Un «no» o un «baja» escrito sigue bloqueando (detección por palabras clave, sin IA).
   - El asistente de IA y la base de conocimiento por empresa (FAQ, textos, PDF, web) son la **fase 2**, activables por empresa. Las tablas pueden quedar previstas.
9. **Cada nicho (campaña) tiene asignado su PDF en el mando.**

## 0. Lo que hay que saber antes de leer el resto

1. **El tope de 200 al día no cabe en el límite inicial de Meta si hay recordatorio.** El límite
   es de 250 usuarios únicos por portfolio cada 24 h, y el recordatorio también es una plantilla
   fuera de ventana: cuenta. Con un 80 % de gente que no contesta, 200 nuevos generan 160
   recordatorios tres días después: 360 al día. Con 250 (y un margen de 25) el régimen estable
   son **unos 125 nuevos al día**. Los 200 exigen el portfolio de Infinity verificado (2.000).
   El diseño trata el límite como un presupuesto diario compartido (§4.3).
2. **El recordatorio casi duplica el coste de Meta** (≈176 € de ≈431 € al mes, §7) y duplica la
   exposición legal y de calidad. Queda dentro porque está decidido, pero es apagable por campaña.
3. **La propuesta PDF no puede salir hoy de una `proposal` real** sin crear antes un lead: la tabla
   exige `lead_id` o `customer_id` y el generador exige sesión de usuario (§3.4). Se diseña una
   propuesta ligera propia, con los precios leídos de Hidromanager, y el salto a lead + propuesta
   real cuando hay interés.
4. **El guard de módulos de Hidromanager es «abierto si falla»**: sin fila en `company_modules`
   da el módulo por activo (§2.1). Este módulo cuesta dinero y tiene riesgo legal: lleva su
   propio guard estricto.
5. **Enviar en frío incumple la política de opt-in de Meta y, con toda probabilidad, el art. 21 de
   la LSSI.** Las mitigaciones de §8 bajan la probabilidad y el daño; no lo convierten en legal.

---

## 1. Resumen y alcance

Un módulo opcional por empresa que: busca negocios de una tipología en una zona, les manda un
primer WhatsApp con una plantilla aprobada y dos botones, bloquea para siempre a quien dice «No»,
entrega una propuesta en PDF y una página privada con seguimiento a quien dice «Sí», deja que un
asistente de IA resuelva dudas con los productos y precios de esa empresa, avisa al comercial
cuando hay interés y enseña todo en un panel por etapas.

### Entra en el MVP

- Conexión de WhatsApp por empresa con Embedded Signup v4 (un número por empresa).
- Webhook único de la app de Vercomi: `messages`, `statuses`, `account_update`,
  `message_template_status_update`.
- Campañas («mando»): tipología, zonas, productos recomendados, PDF, plantilla, tope y horario.
- Búsqueda de negocios con OSM Overpass + lectura de la web del negocio; Places como complemento.
- Deduplicación contra clientes y leads de la empresa; prioridad a móviles.
- Envío por tandas con tope diario, arranque escalonado y cortacircuitos.
- «Sí» → PDF + página `/p/[codigo]` con caducidad y seguimiento (abre, segundos, % de scroll).
- «No» → lista de bloqueo.
- Asistente de IA (`claude-sonnet-5-5`) con `enviar_pdf`, `pasar_a_persona`, `marcar_interes`, y
  regla de silencio.
- Bandeja de conversaciones para contestar desde el panel (el número va solo por API).
- Un recordatorio a los 3 días.
- Avisos al comercial (campana + push).
- FAQ editable.

### No entra en el MVP

- Coexistencia con la app de WhatsApp Business. Varios números por empresa.
- Llamadas, catálogo de WhatsApp, Flows, pagos, grupos.
- Plantilla con cabecera DOCUMENT para mandar el PDF fuera de las 24 h (fase 8).
- Búsqueda vectorial: la tabla queda prevista, el MVP mete el conocimiento entero en el prompt
  (§3.6).
- Envío a teléfonos fijos [decide]: se guardan, no se les escribe.
- Editor de plantillas dentro de Hidromanager: se crean en el administrador de WhatsApp y aquí se
  sincronizan.
- Uso del canal para clientes existentes (avisos de mantenimiento, cobros). Hoy eso va por Twilio
  (`src/modules/mailing/whatsapp.ts`, tabla `whatsapp_sends`) [V] y **no se toca**.
- Segundo recordatorio o secuencias largas.

---

## 2. Encaje en Hidromanager

### 2.1 Activación por empresa

Cómo funciona hoy [V]:

- `modules_catalog` (clave, etiqueta, `default_active`, `is_core`, `is_parked`) y
  `company_modules (company_id, module_key, is_active, settings)`.
- El menú solo enseña un módulo si hay fila con `is_active = true`
  (`src/app/(tenant)/layout.tsx`).
- `/configuracion/modulos` usa `default_active` cuando no hay fila
  (`src/modules/config/modules/actions.ts`).
- `assertModuleActive()` e `isModuleActiveForCompany()` devuelven **true si no hay fila o si la
  consulta falla** (`src/shared/lib/auth/module-guard.ts`). Para un módulo opt-in eso significa:
  oculto en el menú, pero accesible por URL.

Diseño:

- Alta en `modules_catalog`: clave `captacion` [decide], etiqueta «Captación WhatsApp», icono
  `message-circle`, `default_active = false`, `is_core = false`, `sort_order = 76` (detrás de
  `voice_agent`, 75).
- Guard propio y estricto `captacionActiva(companyId)`: exige fila explícita `is_active = true`
  **y** `captacion_conexiones.estado = 'activa'` para todo lo que envía. Si la consulta falla,
  responde «no». Las páginas usan `assertCaptacionActiva()`; los crons no usan
  `companiesWithModuleDisabled()` (es de lista negra), sino que recorren solo las empresas con
  conexión activa.
- Tres llaves para que salga un mensaje en frío, copiando las «dos llaves» de WaterGo
  (`D:\WATERGO\docs\PROSPECCION-EMPRESAS.md` §2): módulo activo + `envios_activos` en la conexión
  + variable `CAPTACION_ENVIOS_ACTIVOS=1` en Vercel. Las respuestas dentro de una conversación ya
  abierta solo necesitan la primera.
- Quién lo activa: el superadmin (Vercomi) desde `/superadmin/empresas/[id]`. El admin de la
  empresa no debería poder encenderlo solo desde `/configuracion/modulos` porque lleva contrato y
  coste: se excluye de ese listado o se muestra bloqueado [decide].

### 2.2 Permisos

Cómo funciona hoy [V]: existe la matriz `permissions_catalog` / `role_permissions` / `app.can()`,
pero los módulos añadidos después (`voice_agent`, `referrals`, `routes`, `social_media`) **no
siembran permisos**: usan `app.has_role()` en las políticas y `rolesAllowed` en
`src/shared/lib/modules.ts`. Se sigue esa convención [decide].

| Acción | company_admin | commercial_director · telemarketing_director | sales_rep · telemarketer | installer |
|---|---|---|---|---|
| Conexión de WhatsApp, interruptores, topes | sí | ver | no | no |
| Campañas: crear, lanzar, pausar | sí | sí | no | no |
| Buscar negocios, revisar prospectos | sí | sí | ver los suyos | no |
| Bandeja: leer y contestar | todas | todas | las asignadas a él | no |
| FAQ y base de conocimiento | sí | sí | ver | no |
| Lista de bloqueo: añadir | sí | sí | sí | no |
| Lista de bloqueo: quitar | sí | no | no | no |

«Asignadas a él» = `captacion_prospectos.assigned_user_id = auth.uid()`. Doble comprobación como
en el resto del repo: RLS y además comprobación en el servidor (`src/shared/lib/auth/role-scope.ts`
es el precedente; no he leído sus funciones en detalle [NV]).

### 2.3 Navegación y código

- `src/shared/lib/modules.ts`: nueva entrada
  `{ key: "captacion", label: "Captación", icon: "MessageCircle", href: "/captacion",
  configHref: "/configuracion/captacion", group: "sales", rolesAllowed: [...LEVEL_1_2,
  "sales_rep", "telemarketer"] }`.
- Rutas con sesión, en `src/app/(tenant)/`:
  - `/captacion` — panel por etapas (entrada por defecto).
  - `/captacion/campanas`, `/captacion/campanas/nueva`, `/captacion/campanas/[id]`.
  - `/captacion/bandeja`, `/captacion/bandeja/[id]`.
  - `/captacion/prospectos/[id]`.
  - `/captacion/bloqueos`.
  - `/configuracion/captacion` (conexión, interruptores, IA) y `/configuracion/captacion/faq`.
- Rutas públicas: `/p/[codigo]` y `/p/[codigo]/pdf`. Hay que añadir `"/p/"` a `PUBLIC_PATHS`
  (`src/shared/lib/supabase/public-paths.ts`). No choca con `/portal`, `/perfil`, `/productos`,
  `/propuestas`, `/pruebas-gratuitas`, `/puntos` ni `/privacidad` porque lleva la barra final [V].
  `/api/webhooks/` y `/api/cron/` ya son públicos por prefijo [V].
- Código en `src/modules/captacion/` (nombre en español, como `mant-incluido` y
  `portal-clientes`). Las mutaciones del panel son server actions (`*-actions.ts`), como en el
  resto del repo; rutas API solo para quien llama desde fuera (Meta, Vercel Cron, el navegador
  del prospecto).
- Nombres de base de datos [decide]: tablas con prefijo `captacion_` y columnas de dominio en
  español sin tildes, que es lo que hacen las migraciones recientes
  (`correcciones_modelo_equipo`, `mant_*`). Se mantienen en inglés las columnas de sistema que
  usan los triggers y helpers existentes: `company_id`, `created_at`, `updated_at`, `created_by`.

---

## 3. Modelo de datos

Migración prevista: `supabase/migrations/20261127100000_captacion_whatsapp.sql` (la última hoy es
`20261126100000_catalogo_maestro_fase2.sql`). Aditiva e idempotente (`create table if not exists`,
`drop policy if exists`), con `notify pgrst, 'reload schema'` al final, como las demás.

Reglas comunes a todas las tablas:

- `id uuid primary key default gen_random_uuid()`, `company_id uuid not null references
  public.companies(id) on delete cascade`, `created_at`, y `updated_at` con el trigger
  `app.set_updated_at()` donde haya ediciones.
- `enable` + `force row level security`.
- Política `*_super`: `for all using (app.is_superadmin())`.
- Política de lectura: `company_id = app.current_company_id()` más el rol de §2.2.
- Las escrituras del sistema (webhook, crons, IA) van con el cliente de servicio
  (`createAdminClient()`), siempre con `company_id` explícito en el filtro. Las políticas de
  escritura para `authenticated` solo existen donde una persona edita (campañas, FAQ, bloqueos,
  asignación).
- FKs a `customers`, `leads` y `proposals`: se enganchan al trigger
  `app.exigir_fk_misma_empresa()` (`20261002110000_fk_misma_empresa.sql`) para que no puedan
  apuntar a otra empresa. No se aplica a `products`, que admite filas globales [V].
- Los estados van como `text` con `check (...)`, como en `voice_campaigns`, no como enum: añadir
  un valor a un enum exige transacción aparte [V].

### 3.1 Conexión de WhatsApp

**`captacion_conexiones`** — una por empresa (PK `company_id`).

| Columna | Tipo | Nota |
|---|---|---|
| `estado` | text | `pendiente` · `activa` · `suspendida` · `desconectada` |
| `waba_id`, `business_id`, `phone_number_id` | text | `phone_number_id` **único global**: es la clave con la que el webhook encuentra la empresa |
| `numero_e164`, `nombre_visible` | text | |
| `calidad` | text | `verde` · `amarilla` · `roja` · `desconocida` |
| `limite_diario_meta` | int, 250 | se actualiza cuando Meta suba el tramo |
| `margen_seguridad` | int, 25 | lo que se deja sin gastar del límite |
| `negocio_verificado` | bool | |
| `envios_activos` | bool, false | interruptor del frío |
| `ia_activa` | bool, false | interruptor del asistente |
| `modelo_ia` | text, `claude-sonnet-5-5` | |
| `presentacion_empresa`, `temas_prohibidos` | text | se inyectan en el prompt |
| `tope_gasto_mensual_cents` | int, 50000 | corte duro, como `monthly_minutes_cap` del agente de voz |
| `retencion_dias` | int, 365 | mensajes y transcripciones |
| `conectada_at`, `conectada_por`, `ultimo_webhook_at`, `ultimo_error` | | salud |

Lectura: admin y directores. Escritura de interruptores: `company_admin`.

**`captacion_conexion_secretos`** — PK `company_id`. Columnas: `token_cifrado text`,
`token_rotado_at`, `pin_registro_cifrado text`. **Sin ninguna política para `authenticated`**:
solo la lee el cliente de servicio. Va en tabla aparte porque la RLS protege filas, no columnas,
y `captacion_conexiones` sí la leen los directores [decide].

Cifrado: `encryptSecret()` / `decryptSecret()` de `src/modules/mailing/encryption.ts`
(AES-256-GCM, clave `ENCRYPTION_KEY`, formato versionado `v1:iv:tag:cifrado`) [V]. En el repo hay
un segundo cifrador, `src/shared/lib/crypto/aes-gcm.ts`, con otra clave (`VERIFACTU_MASTER_KEY`),
que usa Google Maps [V]. Se elige el primero porque su formato lleva versión y permite rotar
[decide]. No se crea una tercera clave.

**`captacion_plantillas`** — copia local de las plantillas de la WABA. Columnas: `nombre`,
`idioma`, `categoria` (`marketing` · `utility`), `estado` (`aprobada` · `pendiente` · `rechazada`
· `pausada` · `desactivada`), `componentes jsonb`, `uso` (`primer_contacto` · `recordatorio` ·
`documento`), `meta_template_id`, `sincronizada_at`. Único `(company_id, nombre, idioma)`. La
actualizan el webhook `message_template_status_update` y la sincronización diaria.

### 3.2 Campañas

**`captacion_tipologias`** — catálogo de presets, global (sin `company_id`, lectura para todos,
escritura solo superadmin): `clave` PK (`restaurante`, `gimnasio`, `oficina`, `colegio`…),
`nombre`, `etiquetas_osm jsonb` (p. ej. `[{"amenity":"restaurant"},{"amenity":"cafe"}]`),
`terminos_busqueda text[]` (para Places). La campaña copia los valores al crearse y se pueden
retocar: cambiar el preset no altera campañas en marcha [decide].

**`captacion_campanas`**

| Columna | Tipo | Nota |
|---|---|---|
| `nombre` | text | |
| `estado` | text | `borrador` · `activa` · `pausada` · `terminada` |
| `motivo_pausa` | text | lo escribe el cortacircuitos |
| `tipologia_clave`, `etiquetas_osm jsonb`, `terminos_busqueda text[]` | | |
| `zonas` | jsonb | lista de `{tipo:"municipio", nombre, osm_area_id}` · `{tipo:"provincia", iso}` · `{tipo:"radio", lat, lng, km}` |
| `plantilla_primer_contacto_id`, `plantilla_recordatorio_id` | uuid → `captacion_plantillas` | la segunda nula = sin recordatorio |
| `recordatorio_dias` | int, 3 | |
| `tope_diario` | int, 200 | |
| `escalado` | jsonb, `[{"dias":3,"tope":50},{"dias":3,"tope":100}]` | después, `tope_diario` |
| `lanzada_at` | timestamptz | origen del escalado |
| `horario` | jsonb, `{"dias":[1,2,3,4,5],"desde":"10:00","hasta":"19:00"}` | hora de Madrid |
| `pdf_modo` | text | `generado` (con los productos) · `subido` (PDF propio con el nombre sellado en portada) |
| `pdf_ruta` | text | Storage, si `subido` |
| `propuesta_titulo`, `propuesta_intro` | text | |
| `propuesta_caduca_dias` | int, 30 | |
| `responsable_user_id` | uuid → `auth.users` | quién recibe los avisos y los prospectos |

Hidromanager ya tiene `service_zones` (`20260622200000_service_zones.sql`) y
`postal_code_municipalities`; podrían servir para elegir zonas, pero no las he leído [NV].

**`captacion_campana_productos`** — `campana_id`, `product_id` → `products`, `orden`,
`plan_destacado` (valor de `app.pricing_plan_type`), `argumento text`. Único
`(campana_id, product_id)`. Solo guarda **qué** productos; el precio no se copia aquí.

### 3.3 Prospectos, bloqueos y envíos

**`captacion_busquedas`** — cola de trabajo de la captación: una fila por campaña × zona × fuente.
`campana_id`, `fuente` (`osm` · `places`), `zona jsonb`, `estado` (`pendiente` · `en_curso` ·
`hecha` · `fallida`), `cursor jsonb` (página de Places o tramo de Overpass por el que va),
`encontrados`, `nuevos`, `llamadas_places`, `error`, `terminada_at`. El gasto de Places del mes
se calcula **sumando** `llamadas_places`, no con un contador que se incrementa: es la lección
escrita en `D:\AUTOMATIZACION_COMERCIAL_OSMOFILTER\src\lib\captacion\barrido.ts` (el contador
llegó a marcar 5.000 con 2.400 reales) [V].

**`captacion_prospectos`**

| Columna | Tipo | Nota |
|---|---|---|
| `campana_id` | uuid | la campaña que lo encontró |
| `nombre_negocio` | text not null | |
| `tipologia_clave` | text | |
| `direccion`, `municipio`, `codigo_postal`, `lat`, `lng` | | solo de OSM o de su web |
| `telefono_e164` | text | normalizado `+34XXXXXXXXX` |
| `es_movil` | bool, generada | `telefono_e164 ~ '^\+34[67]'` |
| `telefono_fuente` | text | `osm` · `web_propia` · `manual` — **nunca `places`** |
| `telefono_url_fuente` | text | la página donde estaba publicado: es la prueba de origen |
| `web`, `email` | text | |
| `osm_id` | text | p. ej. `node/123` |
| `place_id` | text | lo único de Places que se guarda |
| `bsuid` | text | `user_id` de los webhooks; se rellena al primer mensaje entrante |
| `etapa` | text | ver abajo |
| `cliente_coincidente_id` → `customers`, `lead_coincidente_id` → `leads` | | resultado de la deduplicación |
| `lead_id` → `leads` | | lead creado al convertir |
| `assigned_user_id` | uuid | |
| `interes` | smallint 0–3 | lo marca la IA o una persona |
| `interes_resumen` | text | |
| `aviso_interes_at` | timestamptz | para no avisar dos veces |
| `descartado_motivo` | text | |
| `anonimizado_at` | timestamptz | retención |

Etapas: `nuevo` → `revisar` (posible cliente, sin móvil, sin teléfono) → `en_cola` → `contactado`
→ `recordado` → `interesado` (dijo «Sí», PDF enviado) → `conversando` → `caliente` (interés
marcado) → `convertido` (lead creado). Salidas: `descartado` («No», baja o a mano),
`sin_respuesta` (7 días después del recordatorio), `fallido` (número sin WhatsApp).

Índices únicos, todos parciales `where ... is not null`:

- `(company_id, telefono_e164)` — **un negocio se contacta una sola vez por empresa**, aunque
  aparezca en dos campañas. Lo impide la base, no un `if`.
- `(company_id, osm_id)`, `(company_id, place_id)`, `(company_id, bsuid)`.

Más `(company_id, etapa)`, `(campana_id, etapa)` y trigramas sobre `nombre_negocio` (`pg_trgm`
ya está instalada [V]).

**`captacion_bloqueos`** — `ambito` (`telefono` · `bsuid`), `valor`, `motivo` (`boton_no` ·
`baja_texto` · `queja` · `manual` · `cliente`), `prospecto_id`, `origen_wamid`, `created_by`.
Único `(company_id, ambito, valor)`. Solo inserción; borrar, solo `company_admin`. Nunca se purga
por retención: es lo que garantiza el «nunca más». El control de envío mira **también**
`voice_do_not_call` del agente de voz [decide] (existe y tiene índice por teléfono [V]; no he
leído sus columnas [NV]).

**`captacion_envios`** — una fila por plantilla que sale fuera de ventana.

| Columna | Nota |
|---|---|
| `prospecto_id`, `campana_id`, `plantilla_id` | |
| `tipo` | `primer_contacto` · `recordatorio` |
| `estado` | `en_cola` · `reclamado` · `enviado` · `entregado` · `leido` · `fallido` · `cancelado` |
| `programado_at` | cuándo puede salir |
| `reclamado_at`, `token_reclamo` | reserva atómica, como `voice_claim_tasks` |
| `wamid` | único global parcial |
| `enviado_at`, `entregado_at`, `leido_at` | |
| `error_codigo`, `error_texto` | |
| `coste_cents` | se apunta al entregarse |

Único `(prospecto_id, tipo)`: **la base impide** un segundo primer contacto y un segundo
recordatorio. Índice de cola `(company_id, estado, programado_at)`.

### 3.4 Conversaciones, mensajes, propuestas y visitas

**`captacion_conversaciones`** — una por prospecto. `prospecto_id` (nulo si escribe un
desconocido), `bsuid`, `telefono_e164`, `modo` (`ia` · `humano` · `cerrada`), `ventana_hasta`
(último entrante + 24 h), `ia_identificada_at`, `ia_silenciada_at`, `ia_silenciada_por`,
`ia_mensajes` (contador), `atendida_por`, `no_leidos`, `ultimo_mensaje_at`, `ultimo_extracto`.
Único `(company_id, prospecto_id)` y `(company_id, bsuid)`, parciales.

**`captacion_mensajes`** — `conversacion_id`, `direccion` (`entrante` · `saliente`), `autor`
(`contacto` · `ia` · `humano` · `sistema`), `usuario_id`, `tipo` (`plantilla` · `texto` · `boton`
· `documento` · `imagen` · `audio` · `otro`), `cuerpo`, `payload_boton`, `media_ruta`,
`media_id_meta`, `wamid` (**único global**), `responde_a_wamid`, `estado` (`recibido` · `enviado`
· `entregado` · `leido` · `fallido`), `error_codigo`, `procesado_ia_at`, `tokens_entrada`,
`tokens_salida`. Índice `(conversacion_id, created_at)`. Se añade a la publicación
`supabase_realtime`, como el chat interno (`20260503190000_chat_realtime.sql`) [V].

**`captacion_propuestas`** — la propuesta ligera y su página privada.

| Columna | Nota |
|---|---|
| `prospecto_id`, `campana_id` | |
| `codigo` | único global, 12 caracteres en base32 minúscula (60 bits) |
| `nombre_negocio` | tal como sale en el PDF |
| `lineas` | jsonb: **foto de los productos y precios en el momento de generarla** |
| `pdf_ruta` | bucket privado `captacion-propuestas`, ruta `company_id/prospecto_id/codigo.pdf` |
| `caduca_at`, `revocada_at` | |
| `proposal_id` → `proposals` | se rellena si el comercial hace luego la propuesta real |
| `primera_visita_at`, `visitas`, `segundos_total`, `scroll_max` | resumen para listados |

¿Puede el PDF salir de una `proposal` real? **Hoy no, y no conviene** [V]:

- `proposals` lleva `check ((lead_id is null)::int + (customer_id is null)::int = 1)`: sin lead
  o cliente no hay propuesta.
- `generateProposalPdf()` (`src/modules/proposals/pdf-generator.ts`) empieza por
  `requireSession()` y aplica alcance por rol: no se puede llamar desde un webhook.
- Crear lead + propuesta por cada «Sí» llenaría leads (que tienen caducidad, antifraude y
  asignación con comisiones) de negocios que solo han pulsado un botón, y gastaría numeración
  `P-AAAA-NNNN`.

Diseño [decide]:

- El «Sí» crea una `captacion_propuestas`. El PDF se dibuja con las mismas piezas que el de
  propuestas (`src/shared/lib/pdf/dashstack.ts`, sobre `pdf-lib`, ya instalado [V]) en un
  generador nuevo sin sesión, `src/modules/captacion/pdf-propuesta.ts`, que recibe `company_id`.
- **Precios siempre de Hidromanager**: se leen de `product_pricing_plans` (`plan_type`,
  `duration_months`, `monthly_price_cents`, `total_price_cents`) en el momento de generar y se
  guardan como foto en `lineas`. Existen además precios separados para particular y empresa
  (`monthly_price_business_cents` y otros, migración `20260523100000_dual_pricing_and_autonomo.sql`);
  no he comprobado en qué tabla quedan ni cuál usa hoy la propuesta [NV]: hay que mirarlo antes
  de la fase 4 porque aquí el destinatario siempre es empresa.
- Lista blanca de campos que pueden salir hacia el PDF, la página y la IA: nombre, descripción
  corta, `marketing_claim`, imagen principal, medidas, garantías y los precios de venta al
  público. **Nunca** `cost_cents`, `supplier_price_cents`, `margin_cents`,
  `min_authorized_cents` ni `absolute_min_cents`.
- Cuando hay interés real se crea el lead (`party_kind = 'company'`) y se enlaza en
  `captacion_prospectos.lead_id`; desde ahí el comercial hace la propuesta de verdad con el módulo
  existente. `app.lead_origin` no tiene valor para esto (`web`, `referral`, `door_to_door`,
  `tmk`, `cold_call`, `event`, `social`, `other`) [V]: se propone añadir `whatsapp` en una
  migración aparte, y mientras tanto `other` + etiqueta `captacion_whatsapp` [Mario, §10].

**`captacion_visitas`** — una fila por visita a `/p/[codigo]`: `propuesta_id`, `visitante_hash`
(SHA-256 de IP + agente de usuario + día + sal; la IP no se guarda), `inicio_at`, `ultimo_at`,
`segundos`, `scroll_max` (0–100), `dispositivo` (`movil` · `escritorio`), `descargo_pdf bool`.
Solo la escribe el servidor.

### 3.5 FAQ

**`captacion_faq`** — `pregunta`, `respuesta`, `activa`, `orden`, `campana_id` (nulo = vale para
toda la empresa), `updated_by`. La editan admin y directores.

### 3.6 Base de conocimiento (pgvector)

**`captacion_conocimiento`** — trozos de texto que el asistente puede citar: `origen`
(`producto` · `faq` · `documento` · `empresa`), `origen_id`, `titulo`, `contenido`,
`contenido_hash`, `tokens`, `activo`, `embedding vector(N)`. Único
`(company_id, origen, origen_id, contenido_hash)`. Se regenera cuando cambia un producto de una
campaña activa o una FAQ (comparando el hash).

Lo que hay que saber [V]:

- La extensión `vector` **no está instalada**: las migraciones solo crean `pgcrypto`, `pg_trgm`
  y `unaccent`. Hay que añadir `create extension if not exists vector`.
- En el repo no hay ningún proveedor de embeddings. La única clave de IA que he visto es
  `GOOGLE_GENAI_API_KEY`, usada para imágenes en `src/modules/social/gemini-client.ts`. No hay
  SDK de Anthropic en `package.json`.
- La dimensión `N` depende del proveedor que se elija, así que la columna `embedding`, su índice
  HNSW y la función `app.captacion_buscar_conocimiento(p_company_id, p_embedding, p_limite)` se
  crean en la fase en que se decida, no en la primera migración.

Decisión [decide]: en el MVP el conocimiento de una empresa (los productos de sus campañas
activas, sus precios y la FAQ) se mete **entero** en el prompt del asistente, en un bloque
estable con caché de prompt. Para un catálogo de dispensadores es poco texto y evita depender de
un tercer proveedor. La búsqueda vectorial se enciende cuando el conocimiento de una empresa
supere un umbral (propuesta: 30.000 tokens), con la herramienta `buscar_conocimiento`. Si Mario
quiere el vector desde el primer día, es la pregunta 5 de §10.

### 3.7 Registro de webhooks

**`captacion_webhook_eventos`** — `company_id` (nulo si no se pudo resolver), `phone_number_id`,
`campo` (`messages`, `account_update`…), `clave_dedupe` (única: `wamid` + estado, o hash del
cuerpo), `cuerpo jsonb`, `procesado_at`, `error`, `intentos`. Sirve para reprocesar si falla el
código y para diagnosticar. Sin políticas para `authenticated`. Se purga a los 30 días.

### 3.8 Relaciones

```
companies ─┬─ captacion_conexiones ── captacion_conexion_secretos
           ├─ captacion_plantillas
           ├─ captacion_campanas ─┬─ captacion_campana_productos ── products ── product_pricing_plans
           │                      ├─ captacion_busquedas
           │                      └─ captacion_prospectos ─┬─ captacion_envios
           │                                               ├─ captacion_conversaciones ── captacion_mensajes
           │                                               ├─ captacion_propuestas ── captacion_visitas
           │                                               │        └─ (opcional) proposals
           │                                               ├─ (dedupe) customers · leads
           │                                               └─ (conversión) leads
           ├─ captacion_bloqueos
           ├─ captacion_faq
           └─ captacion_conocimiento
```

---

## 4. Flujos

### 4.1 Alta con Embedded Signup v4

Los nombres exactos de los endpoints de Meta de este flujo no estaban entre los hechos
verificados del encargo: van como [NV] y se confirman contra la documentación de Meta en la
fase 1.

1. El admin abre `/configuracion/captacion` y pulsa «Conectar WhatsApp».
2. El navegador carga el SDK de Facebook y lanza el Embedded Signup con el `config_id` de la app
   de Vercomi. El admin elige o crea su portfolio, su WABA y su número.
3. Al terminar, el navegador recibe un `code` y, por evento del SDK, el `waba_id` y el
   `phone_number_id`.
4. Server action `conectarWhatsappAction({ code, waba_id, phone_number_id })`:
   1. Exige `company_admin` y módulo activo.
   2. Cambia el `code` por el token de negocio con `META_APP_ID` + `META_APP_SECRET` [NV].
   3. Comprueba con la Graph API que ese token ve ese `waba_id` y ese `phone_number_id`: no se
      fía de lo que manda el navegador.
   4. Cifra el token y lo guarda en `captacion_conexion_secretos`.
   5. Suscribe la app de Vercomi a los webhooks de esa WABA [NV].
   6. Registra el número para la Cloud API con un PIN generado y guardado cifrado [NV].
   7. Rechaza la conexión si `phone_number_id` ya está en otra empresa (índice único).
   8. Guarda `captacion_conexiones` con `estado = 'activa'`, `envios_activos = false`,
      `ia_activa = false`.
   9. Sincroniza las plantillas.
5. La pantalla enseña número, nombre, calidad, límite y un botón «Enviar mensaje de prueba».

Desconexión: `estado = 'desconectada'`, se borra el token, se pausan las campañas. El webhook
`account_update` con baja o restricción hace lo mismo y avisa al admin.

### 4.2 Búsqueda de negocios

Reutiliza la lógica de `D:\THERAMIC_WEB\herramientas\buscar-en-mapa.mjs` (Overpass + lectura de
la web) y de `barrido.ts` de Osmofilter (Places con tope), portada a `src/modules/captacion/`.

1. En la campaña, «Buscar negocios» crea filas en `captacion_busquedas` (una por zona y fuente).
   No busca en caliente.
2. El cron `captacion-diario`, y un botón «Procesar ahora» con el mismo código, procesa la cola
   por trozos de 50 s como mucho.
3. **OSM** (fuente principal, gratis): consulta Overpass con las `etiquetas_osm` dentro del área
   (`area["ISO3166-2"=...]`, área del municipio, o `around` para el radio). Una petición cada
   vez, con pausa y un agente de usuario que identifica a Hidromanager y da un contacto. De cada
   elemento: nombre, dirección, `phone` / `contact:phone` / `contact:mobile`, `website`, `email`.
4. **Web del negocio**: si hay web, se abre la portada y, si hace falta, la página de contacto.
   Teléfonos por este orden: enlaces `tel:`, enlaces `wa.me` / `api.whatsapp.com` (señal clara de
   que atienden por WhatsApp), `telephone` del JSON-LD, y expresión regular sobre el texto. Si
   hay varios, se prefiere el móvil. Se guarda la URL donde estaba. **Nunca se adivina** un
   número.
5. **Places** (complemento, dentro de las 1.000 gratis): Text Search con `terminos_busqueda` +
   zona. Se pide solo `places.id` y `places.websiteUri`; el segundo ya lo convierte en SKU
   Enterprise, cuyo tramo gratuito son 1.000 al mes (documentado en `barrido.ts`) [V]. La web se
   usa **en esa misma ejecución** para ir al sitio del negocio y sacar de ahí nombre, teléfono y
   dirección. Se guarda `place_id` y lo leído del sitio (con `telefono_fuente = 'web_propia'`).
   No se guarda nombre, teléfono, dirección ni coordenadas devueltos por Places. Tope propio de
   900 llamadas al mes, sumando `captacion_busquedas.llamadas_places` de **todas** las empresas
   si la clave es la de plataforma (§10, pregunta 6). Al llegar al tope, la búsqueda se queda en
   `pendiente` hasta el mes siguiente.
6. Normalización: teléfono a E.164, `es_movil`, dominio principal de la web.
7. Deduplicación, por este orden:
   1. Contra `captacion_bloqueos` y `voice_do_not_call` → no se inserta.
   2. Contra `captacion_prospectos` de la empresa (teléfono, `osm_id`, `place_id`, dominio) →
      se completa la fila existente.
   3. Contra clientes y leads: `customers.phone_primary` / `phone_secondary`,
      `customer_contacts.phone`, `leads.phone_primary` / `phone_company`, comparando los últimos
      9 dígitos (no he comprobado que estén guardados en E.164 [NV]). Coincidencia de teléfono →
      `etapa = 'revisar'`, `cliente_coincidente_id` relleno, **nunca entra en cola**.
   4. Parecido de nombre (`pg_trgm` ≥ 0,6) en el mismo código postal → `revisar` para que lo
      mire una persona; no se excluye solo.
8. Prioridad de la cola: móvil sacado de un enlace de WhatsApp > móvil de su web > móvil de OSM.
   Sin móvil → `revisar`.
9. Los prospectos limpios quedan en `nuevo`. Pasan a `en_cola` cuando una persona pulsa «Encolar»
   (uno, varios o todos los de la campaña). Nadie entra en cola sin esa pulsación.

### 4.3 Envío de tanda con tope

Cron `captacion-envios`, cada 10 minutos. El cron de Vercel va en UTC; la ventana se comprueba en
el código con hora de Madrid, como hace `voice-calls` [V].

Por cada empresa con conexión activa:

1. Controles previos. Si falla uno, no sale nada y se anota el motivo: tres llaves (§2.1),
   `calidad` distinta de `roja`, gasto del mes por debajo de `tope_gasto_mensual_cents`, plantilla
   en `aprobada`.
2. Libera los envíos colgados en `reclamado` más de 15 minutos.
3. Encola los recordatorios que tocan (§4.7).
4. **Presupuesto del día** = `limite_diario_meta − margen_seguridad − plantillas enviadas en las
   últimas 24 h` (de cualquier campaña y tipo). Es rodante, como el límite de Meta.
5. Reparto: primero los recordatorios pendientes [decide]: son de gente a la que ya se pagó el
   primer mensaje y tienen fecha. Lo que sobra, para primeros contactos.
6. **Tope de la campaña hoy**: el del tramo de `escalado` según los días con envíos desde
   `lanzada_at` (50 → 100 → `tope_diario`). El escalado solo avanza si la calidad sigue en verde
   y el cortacircuitos no ha saltado.
7. Trozo de esta pasada = lo que queda del día ÷ pasadas que quedan en la ventana, con un máximo
   de 25, para repartir los envíos a lo largo del horario.
8. Reserva atómica con una función `app.captacion_reclamar_envios(p_company_id, p_limite,
   p_token)`: `update ... where id in (select ... for update skip locked) returning *`. Es el
   patrón de `app.voice_claim_tasks` [V]: dos ejecuciones solapadas no cogen la misma fila.
9. Por cada envío reclamado, **segunda mirada** justo antes de enviar (entre encolar y enviar
   pueden pasar horas): bloqueos, cliente o lead dado de alta entretanto, horario, que no haya
   mensaje entrante de ese prospecto.
10. Envío de la plantilla a `/{phone_number_id}/messages` con `{{1}}` = nombre del negocio y los
    botones con carga `SI:<envio_id>` y `NO:<envio_id>`.
11. Con la respuesta: guarda `wamid`, `estado = 'enviado'`, crea la conversación (`modo = 'ia'`)
    y el mensaje saliente. Con error: `fallido` con código y texto; si el error es de límite o
    de salud de la cuenta, **corta la tanda entera** de esa empresa.
12. **Cortacircuitos** tras cada pasada, sobre los últimos 100 envíos de la campaña: más de un
    25 % de «No», más de un 15 % de fallidos, o `calidad` en amarillo → campaña `pausada` con
    `motivo_pausa` y aviso al admin. Los umbrales son una propuesta para ajustar en el piloto.

### 4.4 Webhook entrante

`POST /api/webhooks/whatsapp`. Un solo endpoint para todas las empresas.

1. Lee el cuerpo **crudo** y verifica `X-Hub-Signature-256` (HMAC-SHA256 con `META_APP_SECRET`,
   comparación en tiempo constante). Si no cuadra: 401 y registro en el log, como
   `verifyVoiceSignature` [V].
2. Por cada `entry.changes[]`, resuelve la empresa por `value.metadata.phone_number_id`
   (mensajes y estados) o por `waba_id` (plantillas, cuenta).
3. Inserta en `captacion_webhook_eventos` con `clave_dedupe`. Si ya existía, se salta.
4. Responde 200 enseguida. El trabajo lento (PDF, IA) sigue con `after()` de Next 15; si la
   función muere, el cron `captacion-pendientes` lo recoge.

**Identificar al contacto**, por este orden:

1. `context.id` del mensaje (el `wamid` de nuestra plantilla) → `captacion_envios` → prospecto.
   Es el camino normal de la primera respuesta y no depende del teléfono.
2. `user_id` (BSUID) → `captacion_prospectos.bsuid`.
3. Teléfono, si viene.

En cuanto se identifica, se guarda el BSUID en el prospecto y en la conversación. Si no encaja
con nadie, se crea una conversación sin prospecto en `modo = 'humano'` y **la IA no contesta**
[decide].

**Tipo `button`** (pulsación de la plantilla): manda la carga, no el texto del botón.

- `NO:<envio_id>` →
  1. `captacion_bloqueos` (teléfono y BSUID).
  2. Cancela los envíos pendientes de ese prospecto.
  3. `etapa = 'descartado'`, conversación `cerrada`.
  4. Una sola línea de cortesía dentro de la ventana: «Entendido, no volveremos a escribirte.
     Gracias.» [decide].
- `SI:<envio_id>` → cancela el recordatorio pendiente, `etapa = 'interesado'`, abre la ventana
  de 24 h y lanza §4.5.

**Tipo texto** (o cualquier otro):

1. Guarda el mensaje (`wamid` único), actualiza `ventana_hasta` y `no_leidos`, cancela el
   recordatorio pendiente.
2. Baja por texto, con expresión regular y **antes de cualquier IA**: «baja», «no me escribas»,
   «no me interesa», «stop», «borra mi número», «denuncia» → mismo camino que «No».
3. Si es la primera respuesta a la plantilla y no pulsó botón: `claude-haiku-5-5` la clasifica
   en `si` · `no` · `duda` · `otro` con salida estructurada. `si` → §4.5. `no` → bloqueo.
   `duda` y `otro` → §4.6.
4. En una conversación en marcha: §4.6 si `modo = 'ia'`; si `modo = 'humano'`, solo aviso a
   quien la atiende.
5. Audio, imagen o documento entrante: se guarda la referencia; la IA responde que por ahí solo
   lee texto y ofrece pasar a una persona.

**Estados** (`statuses`): actualiza `captacion_envios` y `captacion_mensajes` por `wamid`, solo
hacia delante (`enviado` < `entregado` < `leido`; `fallido` cierra). Al entregarse se apunta
`coste_cents`. Un fallo por número sin WhatsApp deja el prospecto en `fallido`.

**`message_template_status_update`**: actualiza `captacion_plantillas`. Si deja de estar
`aprobada`, se pausan las campañas que la usan y se avisa.

**`account_update`**: actualiza estado, verificación y límite de la conexión. Restricción o baja
→ `estado = 'suspendida'`, todo pausado, aviso al admin y a Vercomi.

No he verificado si la calidad del número llega por alguno de estos cuatro campos [NV]; si no,
se lee a diario de la Graph API en `captacion-diario`.

### 4.5 PDF y página privada

1. Carga la campaña, sus productos y los planes de precio activos (lista blanca de §3.4).
2. Crea `captacion_propuestas` con `codigo`, `lineas` y `caduca_at`.
3. Genera el PDF:
   - `generado`: portada con el nombre del negocio y el logo de la empresa, una página por
     producto con su precio, condiciones y contacto.
   - `subido`: abre el PDF de la campaña con `pdf-lib` y sella el nombre del negocio en portada.
4. Lo sube al bucket privado y a `/{phone_number_id}/media`; guarda el identificador del medio.
5. Envía, dentro de la ventana de 24 h:
   - un mensaje `document` con nombre de archivo `Propuesta <negocio>.pdf` y un pie corto;
   - un texto con el enlace `https://<dominio>/p/<codigo>` y la frase de identificación de IA
     (§4.6).
6. Objetivo: que llegue en menos de 15 s desde el «Sí». Si algo falla, se reintenta desde
   `captacion-pendientes` mientras la ventana siga abierta; si se cierra, aviso al comercial.

**Página `/p/[codigo]`** (pública, `noindex`, sin cookies):

- Busca la propuesta por `codigo` con el cliente de servicio. Si no existe: 404 sin pistas.
- Si está caducada o revocada: pantalla «Esta propuesta ha caducado» con botón «Pedir una
  actualizada», que abre WhatsApp con el número de la empresa. Nunca un vacío.
- Contenido: nombre del negocio, productos recomendados con precio, qué incluye, botones
  «Escribir por WhatsApp» y «Que me llamen», descarga del PDF, identidad de la empresa y enlace
  a privacidad.
- La apertura **no se cuenta en el servidor**: la vista previa de enlaces de WhatsApp y los
  antivirus piden la URL sin que nadie la abra. Se cuenta cuando el navegador ejecuta el script
  y llama a `POST /api/captacion/visita`.
- El script manda un latido cada 10 s mientras la pestaña está visible y otro al cerrarla
  (`sendBeacon`), con `segundos` y `scroll_max`. El servidor solo acepta que los valores
  crezcan, y como mucho 15 s por latido.
- `/p/[codigo]/pdf` sirve el PDF desde Storage (mismas comprobaciones) y marca `descargo_pdf`.

La página `/p/` es web pública de cara a clientes: antes de programarla pasa por el proceso de
diseño de Mario (registro, documento de diseño, lista anti-IA).

### 4.6 El asistente

Arquitectura [decide]: API de mensajes de Claude con el bucle de herramientas alojado en
Hidromanager (ruta Node, dentro de `after()` del webhook). No se usa un agente gestionado por
Anthropic: las herramientas escriben en la base propia con la clave de servicio, los turnos son
de segundos y la regla de silencio tiene que estar en nuestro código. Hace falta añadir
`@anthropic-ai/sdk` y `ANTHROPIC_API_KEY`.

Cosas del modelo que condicionan el diseño (referencia de la API a 2026-11-03):

- `claude-sonnet-5-5` no admite forzar una herramienta (`tool_choice` `any` / `tool` devuelve
  400): va en `auto` con `strict: true`, y la obligación se impone en el código.
- Puede devolver `stop_reason: "refusal"`: se trata como «pasar a persona», sin enseñar nada al
  cliente.
- Esfuerzo `low` para chat; se ajusta en el piloto.

**Turno**:

1. Espera 8 s y comprueba que no ha llegado otro mensaje del mismo contacto (la gente escribe a
   ráfagas). Si ha llegado, este turno se abandona y contesta el siguiente.
2. **Puerta 1**: `modo = 'ia'`, `ia_activa`, ventana abierta, `ia_mensajes < 12`, sin bloqueo.
   Si no, no hay turno.
3. Prompt:
   - bloque estable con caché: reglas, presentación de la empresa, temas prohibidos, productos
     de la campaña con precios, FAQ;
   - después: datos del prospecto (nombre del negocio, tipología) y los últimos 20 mensajes.
   - Nada variable (fechas, identificadores) dentro del bloque estable.
4. Bucle de herramientas, máximo 3 vueltas.
5. **Puerta 2**, justo antes de enviar: se vuelve a leer `modo`. Si alguien ha escrito desde el
   panel mientras el modelo pensaba, **la respuesta se tira**.
6. Envío, guardado con `autor = 'ia'` y tokens, `ia_mensajes + 1`.

**Herramientas**:

| Herramienta | Entrada | Qué hace |
|---|---|---|
| `enviar_pdf` | `producto_id` (opcional) | Reenvía la propuesta vigente o genera una de ese producto. Solo productos de la campaña. Máximo 3 por conversación. |
| `pasar_a_persona` | `motivo` | `modo = 'humano'`, aviso al comercial, mensaje fijo: «Te paso con una persona del equipo, te escribe por aquí.» |
| `marcar_interes` | `nivel` 1–3, `resumen` | Guarda el interés; con nivel 2 o más, etapa `caliente` y aviso. No escribe al cliente. |
| `buscar_conocimiento` | `consulta` | Solo cuando se active la búsqueda vectorial. |

**Reglas que impone el código, no el prompt**:

- **Identificación como IA** (art. 50 del Reglamento de IA): el primer mensaje del asistente en
  cada conversación lleva delante, añadido por el código, «Soy el asistente virtual de
  {empresa}, una inteligencia artificial.» y se anota `ia_identificada_at`. Si preguntan si es
  una persona, siempre dice que no.
- **Silencio**: cualquier mensaje enviado desde el panel pone `modo = 'humano'` en la misma
  transacción. La IA no vuelve sola: solo con el botón «Devolver al asistente» [decide].
- **Petición de persona**: expresión regular («persona», «humano», «comercial», «llamadme»,
  «hablar con alguien») antes de llamar al modelo, además de la herramienta.
- **Precios**: después de generar, se comprueba que toda cifra en euros de la respuesta está
  entre los precios del contexto. Si no, la respuesta se descarta y se pasa a persona.
- Sin descuentos, sin plazos de instalación, sin afirmaciones de salud sobre el agua, sin
  hablar de la competencia. Ante la duda, `pasar_a_persona`.
- Lo que escribe el contacto y el texto de la FAQ son datos, nunca instrucciones.
- Fuera de la ventana de 24 h la IA no escribe.

### 4.7 Recordatorio

1. Condición: `primer_contacto` en `entregado` o `leido`, hace `recordatorio_dias` o más,
   **ningún** mensaje entrante del prospecto, sin bloqueo, campaña activa con plantilla de
   recordatorio aprobada.
2. Crea el envío `recordatorio` (el índice único impide el segundo) y sale por §4.3 con sus
   mismos controles, dentro del horario.
3. Lleva los mismos dos botones.
4. A los 7 días del recordatorio sin respuesta: `etapa = 'sin_respuesta'` y no se le escribe más.
5. Quien dijo «Sí» y luego calla no recibe recordatorio automático en el MVP [decide]: le sigue
   el comercial, que ve en la ficha si abrió la página.

### 4.8 Avisos

Con `src/modules/notifications/notifier.ts` (`notify`, `notifyByRoles`) y
`push-send.ts` (`sendPushToUser`) [V existen; no he leído sus firmas en detalle, NV].
`app.subject_type` no tiene valor para prospecto: se manda sin sujeto y con `action_url` a la
ficha [decide], para no tocar el enum.

| Qué pasa | A quién | Gravedad |
|---|---|---|
| Dice «Sí» | responsable de la campaña | info |
| `marcar_interes` ≥ 2, pide precio en firme o visita | responsable | aviso + push |
| Pide una persona, o la IA pasa la conversación | responsable; si no hay, directores | aviso + push |
| Abre la página más de 60 s, o scroll > 70 %, o vuelve otro día | responsable | info, una vez |
| Mensaje entrante en `modo = 'humano'` | quien atiende | push |
| Campaña pausada por el cortacircuitos, plantilla rechazada | admin y directores | error |
| Conexión suspendida, token inválido, calidad en rojo | admin y superadmin | error |
| 80 % del tope de gasto mensual | admin | aviso |

Un aviso por prospecto y tipo cada 24 h. Fuera del horario de la campaña no hay push: se queda
en la campana.

---

## 5. Endpoints y crons

### 5.1 Rutas

| Ruta | Método | Quién llama | Seguridad |
|---|---|---|---|
| `/api/webhooks/whatsapp` | GET | Meta, al dar de alta | compara `hub.verify_token` con `META_WEBHOOK_VERIFY_TOKEN`, devuelve `hub.challenge` |
| `/api/webhooks/whatsapp` | POST | Meta | `X-Hub-Signature-256` sobre el cuerpo crudo |
| `/api/captacion/visita` | POST | navegador del prospecto | `codigo` válido y no caducado + identificador de visita firmado (HMAC); límite por IP con `src/shared/lib/rate-limit.ts` |
| `/p/[codigo]`, `/p/[codigo]/pdf` | GET | prospecto | código de 60 bits, caducidad, revocación, `noindex` |
| `/api/cron/captacion-envios` | GET | Vercel Cron | `verifyCronAuth()` (`CRON_SECRET`, cerrado si falta) [V] |
| `/api/cron/captacion-pendientes` | GET | Vercel Cron | igual |
| `/api/cron/captacion-diario` | GET | Vercel Cron | igual |

Todas con `runtime = "nodejs"` y `dynamic = "force-dynamic"`, como las existentes.

### 5.2 Crons (añadir a `vercel.json`; hoy hay 10)

| Ruta | Horario (UTC) | Qué hace | `maxDuration` |
|---|---|---|---|
| `captacion-envios` | `*/10 6-19 * * 1-6` | §4.3 y §4.7 | 300 |
| `captacion-pendientes` | `*/2 * * * *` | eventos de webhook sin procesar, PDF sin enviar, turnos de IA huérfanos | 60 |
| `captacion-diario` | `30 2 * * *` | cola de búsquedas, sincronizar plantillas y calidad, caducidades, `sin_respuesta`, retención | 300 |

Todos registran en `cron_runs` con `startCronRun()` [V]. No he verificado el plan de Vercel
[NV]: ya hay crons horarios, así que no es el gratuito, pero un cron cada 2 minutos conviene
confirmarlo. Si no se puede, `captacion-pendientes` baja a cada 10 minutos y se asume más
retraso en los reintentos.

### 5.3 Idempotencia

- Entrantes: `captacion_mensajes.wamid` único; `insert ... on conflict do nothing`. Meta
  reenvía: el segundo no hace nada.
- Eventos: `captacion_webhook_eventos.clave_dedupe` única.
- Estados: solo avanzan; un `entregado` que llega después de un `leido` se ignora.
- Salientes: `(prospecto_id, tipo)` único + reserva con `skip locked`. Si la llamada a Meta
  queda sin respuesta, el envío **no se reintenta solo**: se marca `fallido` con «resultado
  desconocido». Es mejor perder un envío que mandar dos.
- Bloqueos: `(company_id, ambito, valor)` único.
- Propuesta por «Sí»: una vigente por prospecto; un segundo «Sí» reenvía la misma.
- Turno de IA: `procesado_ia_at` en el mensaje entrante, marcado con comparación y escritura
  atómica antes de llamar al modelo.

### 5.4 Variables de entorno nuevas

`META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`,
`META_GRAPH_VERSION`, `ANTHROPIC_API_KEY`, `CAPTACION_ENVIOS_ACTIVOS`, `CAPTACION_VISITA_SAL`.
Se reutilizan `ENCRYPTION_KEY` y `CRON_SECRET`. Se declaran en `src/shared/lib/env.ts`.

---

## 6. Pantallas (móvil primero, 390 px)

Se montan con lo que ya hay en `src/shared/ui/` y `src/shared/components/` (tarjetas, hojas
inferiores, `status-pill`, `kpi-card`, `pagination`). Nada se da por bueno sin verlo a 390 px.

### 6.1 Mando de campañas — `/captacion` y `/captacion/campanas/[id]`

- **Panel**: arriba, una franja con el estado de la conexión (número, calidad, «87 de 225 hoy»).
  Debajo, las etapas como pestañas con desplazamiento horizontal y su contador (Nuevos · En cola
  · Contactados · Interesados · Calientes · Descartados). Cada prospecto es una tarjeta: negocio,
  municipio, último evento y hace cuánto. En escritorio, las mismas etapas en columnas.
- **Lista de campañas**: tarjeta con nombre, estado, enviados hoy sobre el tope y la tasa de
  «Sí». Interruptor grande de pausa en la propia tarjeta.
- **Campaña**, en pasos, uno por pantalla en móvil:
  1. A quién: tipología y zonas, con mapa (`leaflet` ya está).
  2. Qué se ofrece: productos de Hidromanager con su precio leído al momento, y el modo del PDF
     con vista previa.
  3. Mensaje: plantilla de primer contacto y de recordatorio, con la vista previa tal como se
     verá en WhatsApp.
  4. Ritmo: tope, escalado, horario y responsable.
  5. Resumen con el **coste estimado** del mes y los avisos legales antes de «Lanzar».
- Barra fija inferior con la acción principal del paso.
- Embudo de la campaña: encontrados → encolados → enviados → entregados → «Sí» / «No» → abrieron
  la página → calientes → leads, con el coste acumulado.

### 6.2 Bandeja — `/captacion/bandeja`

- Lista: negocio, extracto del último mensaje, hora, sello del modo («Asistente» / «Tú» /
  «Sin atender») y contador de no leídos. Filtros en pastillas: Sin atender · Mías · Asistente ·
  Todas.
- Conversación a pantalla completa en móvil: burbujas, con las del asistente marcadas con otro
  color y la etiqueta «IA»; los eventos («Abrió la propuesta 2 min 40 s», «Pasada a persona»)
  como líneas centradas.
- Caja de escribir fija abajo, con la zona segura del móvil. Encima, un aviso permanente
  mientras el modo sea `ia`: «Si escribes, el asistente se calla». Al enviar, cambia a «Atiendes
  tú» con el botón «Devolver al asistente».
- Ventana cerrada: la caja se sustituye por «Han pasado más de 24 h: solo puedes enviar una
  plantilla» y el selector de plantillas aprobadas.
- Acciones en una hoja inferior: enviar PDF, marcar interés, convertir en lead, bloquear.
- Tiempo real con Supabase Realtime; si falla, consulta cada 15 s.

### 6.3 Ficha del prospecto — `/captacion/prospectos/[id]`

- Cabecera: negocio, tipología, municipio, etapa, botones grandes de llamar y de abrir la
  conversación.
- Bloques plegables: **Origen del dato** (fuente y enlace a la página donde estaba el teléfono)
  · **Cronología** (envíos, respuestas, aperturas, avisos) · **Propuesta** (enlace, caducidad,
  visitas con segundos y % de scroll, revocar, regenerar) · **Coincidencias** (posible cliente
  o lead, con enlace a su ficha).
- Acciones: asignar, convertir en lead, descartar, bloquear.

### 6.4 Configuración — `/configuracion/captacion`

- Estado en una tarjeta: conectado o no, número, nombre visible, calidad, límite, último
  webhook recibido.
- «Conectar WhatsApp». El Embedded Signup abre una ventana emergente de Facebook: en el móvil
  hay que probarlo en un teléfono de verdad; si no funciona bien, se muestra «Hazlo desde un
  ordenador».
- Interruptores separados con su explicación: envíos en frío · asistente de IA.
- Tope de gasto mensual, margen de seguridad, presentación de la empresa, temas prohibidos,
  retención.
- Plantillas sincronizadas con su estado, y enlace al administrador de WhatsApp para crearlas.
- Zona de peligro: desconectar.

### 6.5 FAQ — `/configuracion/captacion/faq`

- Lista de preguntas con interruptor de activa y orden por arrastre (con botones de subir y
  bajar en móvil).
- Edición en hoja inferior: pregunta, respuesta, campaña a la que aplica.
- «Probar el asistente»: un chat de prueba que usa el mismo prompt y **no envía nada por
  WhatsApp**. Enseña qué herramientas habría llamado.
- Aviso si una respuesta contiene un precio: los precios salen de Productos, no de la FAQ.

---

## 7. Costes estimados al mes

Tarifas del encargo, verificadas a 2026-11-25: marketing en España 0,0585 € por mensaje
entregado; servicio, 1.000 gratis al mes por número y después 0,0166 €.

**Supuestos** (inventados para poder calcular; el piloto dará los reales):

- 200 primeros contactos al día, 22 días laborables: 4.400 al mes. Esto presupone el portfolio
  verificado (§0.1).
- Se entrega el 90 %: 3.960.
- De los entregados: 8 % «Sí» (317), 12 % «No» (475), 80 % no contesta (3.168).
- Recordatorio a los que no contestan, entregado el 95 %: 3.010.
- Por cada «Sí»: 6 mensajes nuestros dentro de la ventana (PDF, enlace y 4 respuestas). Por
  cada «No»: 1.

| Concepto | Cálculo | € al mes |
|---|---|---|
| Primer contacto (marketing) | 3.960 × 0,0585 | 231,66 |
| Recordatorio (marketing) | 3.010 × 0,0585 | 176,09 |
| Servicio | (317 × 6 + 475 − 1.000) × 0,0166 = 1.377 × 0,0166 | 22,86 |
| **Meta** | | **430,61** |
| Asistente `claude-sonnet-5-5` | ver abajo | 10–30 |
| Clasificación `claude-haiku-5-5` | despreciable | < 1 |
| Google Places | dentro de las 900 llamadas | 0 |
| OSM Overpass | gratis | 0 |
| **Total aproximado** | | **≈ 440–460** |

- Sin recordatorio: Meta ≈ 254,52 €.
- Techo (todo entregado y recordatorio a todos): 8.800 × 0,0585 = 514,80 €.
- Coste de Meta por cada «Sí» con estos supuestos: 430,61 ÷ 317 ≈ 1,36 €.
- Con el límite inicial de 250 (unos 125 nuevos al día): aproximadamente el 62 % de todo lo
  anterior.

Asistente: 317 conversaciones × 4 turnos ≈ 1.650 llamadas contando las vueltas de herramientas.
Con 8.000 tokens de entrada y 400 de salida por llamada, y precios de 2 $ y 10 $ por millón
(tabla de la API a 2026-11-03): 13,2 M × 2 $ + 0,66 M × 10 $ ≈ 33 $ sin caché. Con el bloque
estable en caché (lectura a 0,10 $ por millón) baja a unos 10 $.

No he verificado si Supabase o Vercel suben de tramo [NV]. El almacenamiento de PDF es pequeño:
unos 300 KB × 317 ≈ 95 MB al mes antes de la retención.

`tope_gasto_mensual_cents` (500 € por defecto) corta los envíos en frío al alcanzarse. Las
conversaciones abiertas siguen.

---

## 8. Riesgos legales y de plataforma

Esto no es asesoramiento jurídico. Antes del piloto real debería verlo un abogado.

| Riesgo | Por qué | Mitigación | Lo que queda |
|---|---|---|---|
| **Art. 21 LSSI** | Prohíbe las comunicaciones comerciales por medios electrónicos sin consentimiento previo o relación contractual, también a empresas. Que la pregunta «no venda nada» no cambia la finalidad. | Solo números publicados por el propio negocio, guardando dónde. Identificación del remitente en el primer mensaje. Botón «No» en el primer mensaje y bloqueo definitivo. Un mensaje y un recordatorio. Registro de origen por prospecto. | **El envío sigue sin consentimiento.** Una denuncia ante la AEPD puede acabar en sanción. La vía limpia es conseguir antes el opt-in (anuncios de clic a WhatsApp, formulario web, llamada). |
| **RGPD** | Un móvil 6xx de un autónomo es un dato personal. | Interés legítimo sobre datos de contacto profesionales; información del origen en la página y a petición; derecho de oposición = botón «No»; retención corta; contrato de encargo entre Vercomi y cada empresa; Meta y Anthropic como subencargados. | Hay que documentar la ponderación del interés legítimo. No he comprobado si procede consultar listas de exclusión publicitaria [NV]. |
| **Opt-in de Meta** | La política de mensajería exige consentimiento previo. El frío genera bloqueos y denuncias. | Número dedicado, nunca el principal de la empresa. Arranque escalonado. Cortacircuitos. Pregunta suave. Volumen bajo. | Meta puede bajar el límite, pausar la plantilla, restringir el número o cerrar la WABA. |
| **Riesgo para Vercomi como Tech Provider** | Todas las empresas cuelgan de la misma app. El abuso de una puede afectar a la app entera. | Activación solo por superadmin, contrato con cada empresa, topes por empresa, panel de salud de todas las conexiones para Vercomi, corte remoto. | Es el riesgo más caro: afecta a todos los clientes a la vez. |
| **Calidad del número** | La calidad baja con bloqueos y denuncias y arrastra el límite. | Lectura diaria, pausa automática en amarillo, parada total en rojo, escalado condicionado. | Recuperar un número marcado es lento. |
| **Plantilla rechazada o recategorizada** | Meta revisa el texto y puede pausarla. | Estado sincronizado, pausa automática, una segunda plantilla aprobada de reserva. | Días sin enviar. |
| **Art. 50 del Reglamento de IA** | Hay que informar de que se habla con una IA. | Identificación añadida por el código en el primer mensaje, y en la página. | — |
| **La IA se inventa algo** | Un precio o una condición falsa compromete a la empresa. | Precios solo del contexto y comprobados después; lista blanca de campos; tope de mensajes; paso a persona ante la duda; chat de prueba; revisar transcripciones en el piloto. | No es cero. |
| **Condiciones de Google Places** | Solo se puede guardar `place_id`. | §4.2: lo persistido lleva fuente `osm`, `web_propia` o `manual`. | Usar la web devuelta por Places para ir al sitio es una interpretación; revisarla. |
| **Lectura de webs ajenas** | Condiciones de uso y carga en servidores de terceros. | Una o dos páginas por negocio, con pausa, agente de usuario identificado, sin saltarse bloqueos. | Bajo. |
| **Retención** | Guardar datos de quien no contestó no tiene justificación indefinida. | Prospecto sin respuesta: se anonimiza a los 90 días del último envío (se conserva teléfono y fecha para no volver a escribirle). Mensajes: `retencion_dias`. Bloqueos: no se borran. Eventos de webhook: 30 días. Visitas: 12 meses. | Decidir los plazos con el abogado. |
| **Fuga entre empresas** | Un webhook para todas. | Empresa resuelta por `phone_number_id` único; cliente de servicio siempre con `company_id` explícito; trigger de misma empresa; RLS forzada; prueba con dos empresas. | — |
| **Token robado** | El token permite enviar en nombre de la empresa. | Cifrado, en tabla sin acceso para usuarios, nunca al navegador ni a los logs. | Si se filtra `ENCRYPTION_KEY`, caen todos. |
| **Gasto descontrolado** | Un bucle envía miles. | Índices únicos, tope diario, tope mensual, tres llaves. | — |
| **Bucle con otro bot** | El negocio tiene respuesta automática. | Tope de 12 mensajes de IA; paso a persona si detecta respuestas repetidas. | — |

---

## 9. Fases de implementación

Cada fase se puede verificar sola y no rompe lo que hay. Nada sale a un número ajeno hasta la
fase 7.

**Fase 0 — Requisitos previos (sin código)**
- [Mario/Meta] App de Meta de Vercomi, verificación del negocio de Vercomi, alta como Tech
  Provider, revisión de la app con los permisos de WhatsApp, configuración de Embedded Signup.
- [Mario] Confirmar que el +34 682 66 37 97 no tiene cuenta activa en la app de WhatsApp.
- [Mario] Clave de Anthropic.
- [Mario] Decisión sobre §8 y contrato con Infinity.
- Verificable: el Embedded Signup se abre en modo de prueba.

**Fase 1 — Esqueleto y conexión**
- Migración base (conexión, secretos, plantillas, eventos de webhook), módulo en el catálogo,
  guard estricto, pantalla de configuración, Embedded Signup, webhook con verificación y firma.
- Verificable: se conecta el número de prueba; un «hola» desde un móvil aparece en
  `captacion_webhook_eventos`; una petición con firma falsa devuelve 401; otra empresa no ve
  nada.

**Fase 2 — Bandeja manual**
- Conversaciones y mensajes, responder desde el panel dentro de las 24 h, estados de entrega,
  tiempo real.
- Verificable: conversación completa de ida y vuelta a 390 px; el mismo webhook enviado dos
  veces no duplica.

**Fase 3 — Plantillas, envío con tope, «Sí»/«No» y bloqueos**
- Campañas (versión mínima), prospectos cargados a mano, envíos, cron, botones, bloqueos.
- [Mario/Meta] Plantilla de primer contacto aprobada.
- Verificable con 5 móviles propios: llega la plantilla; «No» bloquea y un segundo intento no
  sale; dos ejecuciones del cron a la vez no duplican; el tope puesto a 3 corta en 3.

**Fase 4 — PDF, página privada, seguimiento y avisos**
- Antes: confirmar qué precio de empresa usa hoy la propuesta (§3.4) y diseñar `/p/`.
- Verificable: «Sí» → PDF en menos de 15 s con el nombre del negocio y precios iguales a los de
  Productos; la página registra segundos y scroll; la vista previa de WhatsApp no cuenta como
  apertura; la propuesta caducada enseña su pantalla; llega el aviso.

**Fase 5 — Asistente**
- Prompt, herramientas, puertas de silencio, identificación, FAQ, chat de prueba.
- Verificable: batería de 30 preguntas reales sin ningún precio inventado; escribir desde el
  panel calla a la IA aunque esté a medio generar; «quiero hablar con una persona» la calla y
  avisa.

**Fase 6 — Captación de negocios**
- OSM, lectura de webs, Places con tope, deduplicación, revisión.
- Verificable en Infinity: una tipología en un municipio; ninguno de sus clientes actuales entra
  en `nuevo`; todos los teléfonos tienen fuente y URL; `place_id` sin más datos de Places.

**Fase 7 — Mando completo y piloto**
- Escalado, recordatorio, cortacircuitos, costes, embudo.
- [Mario/Meta] Verificación del portfolio de Infinity si se quieren 200 al día.
- Piloto real a 50 al día durante una semana, revisando calidad y transcripciones a diario.

**Fase 8 — Endurecimiento**
- Retención automática, panel de salud para Vercomi, plantilla con cabecera DOCUMENT, búsqueda
  vectorial si hace falta, segunda empresa.

---

## 10. Preguntas abiertas (solo las que cambian el diseño)

1. **[Mario/Meta] ¿Estará verificado el portfolio de Infinity antes del piloto?** Sin eso, el
   régimen es de unos 125 nuevos al día, no 200.
2. **[Mario] ¿Quién atiende?** ¿Cada campaña tiene un responsable (lo diseñado) o hay una bolsa
   común que se reparte? Cambia la RLS de la bandeja y los avisos.
3. **[Mario] ¿Cuándo se crea el lead?** Diseñado: al marcar interés o a mano, nunca con el
   simple «Sí». ¿Y se añade `whatsapp` a los orígenes de lead?
4. **[Mario] ¿Qué precio se enseña?** ¿Cuota de alquiler, venta, o las dos? ¿Con IVA o sin él,
   siendo el destinatario una empresa?
5. **[Mario] ¿Hace falta el vector desde el primer día?** Si sí, hay que elegir proveedor de
   embeddings (no hay ninguno en el repo) y eso fija la dimensión de la columna.
6. **[Mario] ¿De quién es la clave de Places?** Si es de Vercomi, las 1.000 gratis se reparten
   entre todas las empresas.
7. **[Mario] ¿El «No» por WhatsApp bloquea también las llamadas del agente de voz y el
   mailing?** Diseñado: el envío de WhatsApp respeta la lista del agente de voz, pero no al
   revés.
8. **[Mario] ¿Se mantiene el recordatorio visto su coste (≈176 € al mes) y que compite por el
   límite diario?**

---

## 11. Lista «Don't»

- No enviar nada en caliente desde un clic: todo primer contacto pasa por la cola y sus
  controles.
- No confiar en un `if` para «una vez por negocio» o «nunca más»: lo imponen los índices únicos.
- No identificar al contacto por el teléfono: BSUID y `context.id` primero.
- No decidir «Sí» o «No» por el texto del botón: por su carga.
- No guardar de Google Places nada más que `place_id`.
- No adivinar teléfonos ni correos.
- No escribir a quien ya es cliente o lead de la empresa.
- No escribir a fijos en el MVP.
- No dejar que el asistente conteste si `modo` no es `ia`; comprobarlo antes de generar y antes
  de enviar.
- No dejar que el asistente vuelva solo después de que haya escrito una persona.
- No confiar al prompt la identificación como IA, el silencio ni los precios: van en el código.
- No pasar a la IA, al PDF ni a la página costes, márgenes ni precios mínimos.
- No copiar precios a mano en campañas ni en la FAQ: se leen de Productos.
- No crear una `proposal` ni un lead por cada «Sí».
- No reintentar a ciegas un envío de plantilla con resultado desconocido.
- No contar una apertura de la página en el servidor.
- No guardar el token en claro, en `company_settings`, en logs ni en ningún `.md`.
- No usar `assertModuleActive()` ni `companiesWithModuleDisabled()` como única barrera.
- No usar el número principal de la empresa para el frío.
- No mezclar este canal con el WhatsApp por Twilio que ya existe para clientes.
- No avanzar el escalado con la calidad en amarillo.
- No borrar nunca una fila de `captacion_bloqueos` por retención.
- No añadir valores a enums existentes en la misma transacción que los usa.
- No dar una pantalla por buena sin verla a 390 px.

## Coexistencia (añadida el 2026-11-27)

El mismo número en la app de WhatsApp Business y en la Cloud API. Fuente: developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users (leída el 27-11-2026; ya no lista la UE entre los países excluidos).

- Alta: botón «Conectar el número de WhatsApp Business» → FB.login con `extras.featureType = "whatsapp_business_app_onboarding"` y `sessionInfoVersion: "3"` (Embedded Signup v4). El cliente escanea un QR con la app (≥ 2.24.17).
- Evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`: solo se documenta `waba_id`; el servidor saca el número con `GET /{waba_id}/phone_numbers`.
- Servidor: canje del code → `subscribed_apps` → SIN `/register` ni PIN → comprobación `is_on_biz_app` → `POST /{pnid}/smb_app_data` con `smb_app_state_sync` y luego `history` (una vez cada uno, dentro de 24 h; se guarda `request_id`).
- Webhooks añadidos a la app Vercomi el 27-11: `smb_message_echoes` (lo que se escribe desde el móvil), `history`, `smb_app_state_sync`. Se guardan sin procesar hasta la bandeja (fase 2).
- Baja: `/deregister` no vale; la hace el cliente en la app (Ajustes → Cuenta → Plataforma empresarial → Desconectar cuenta). Llega `PARTNER_REMOVED` con `disconnection_info.reason`; `PRIMARY_INACTIVITY` = 14 días sin abrir la app.
- Limitaciones: 20 mensajes/s; sin grupos; en el móvil se desactivan difusiones nuevas, mensajes temporales y «ver una vez». Lo enviado desde la app es gratis; lo enviado desde la API se cobra normal y los mensajes de la app no abren la ventana de 24 h.
- Fase 2 (bandeja): mostrar los `smb_message_echoes` como mensajes salientes «desde el móvil» y volcar `history` en las conversaciones.

## Fase 2 — Bandeja manual (programada el 2026-11-27)

- Migración `20261129140000_captacion_bandeja.sql` (aplicada): `captacion_conversaciones` (una por BSUID o teléfono y empresa) y `captacion_mensajes` (`wamid` único; `origen` api · movil · historial). Un trigger (security invoker) mantiene último mensaje, no leídos (solo entrantes por la API) y `ventana_hasta`. RLS de lectura: gestores, todo; comerciales, lo que atienden o lo de sus prospectos (probado con JWT simulado). En `supabase_realtime`.
- Webhook: `messages` (entrantes y estados, solo hacia delante), `smb_message_echoes` (incluye edit/revoke) y `smb_app_state_sync` en el momento; `history` con `after()`; lo que falle lo recoge `captacion-diario` (hasta 5 intentos).
- Envío: texto libre dentro de las 24 h; al BSUID con `recipient` si no hay teléfono. Quien contesta se queda la conversación.
- Pantallas: `/captacion/bandeja` (Sin atender · Mías · Todas) y `/captacion/bandeja/[id]`, en vivo con Realtime y sondeo cada 15 s si falla.
- Queda fuera: plantillas fuera de ventana (fase 3), descarga de adjuntos, avisos/push, IA (fase 5), cambio de BSUID (`user_changed_user_id`).

## Fase 3 — Plantillas, envío con tope, «Sí»/«No» y bloqueos (programada el 2026-11-27)

- Migraciones (aplicadas): `20261129160000_lead_origin_whatsapp.sql` (`app.lead_origin` + `whatsapp`) y `20261129160100_captacion_envios.sql`: `captacion_envios` (único `(prospecto_id, tipo)` y `wamid`), `public.captacion_reclamar_envios()` (`for update skip locked`, recordatorios primero), `public.captacion_cerrar_envios_colgados()` (reclamado > 15 min → fallido «resultado desconocido», sin reintento). RLS de lectura: gestores; los comerciales ven bloqueos y plantillas aprobadas.
- Plantillas desde `/configuracion/captacion`: formulario con la propuesta de Infinity prellenada (no se envía sola), `POST /{waba_id}/message_templates` (MARKETING, `es`, {{1}} = negocio, QUICK_REPLY «Sí, cuéntame» / «No, gracias»), y uso (primer contacto / recordatorio) solo en aprobadas que tengan el Sí y el No.
- Cron `captacion-envios` (`*/10 6-19 * * 1-6`): tres llaves, calidad ≠ roja, presupuesto = min(límite Meta − margen, 200) − enviados 24 h; tope de campaña con escalado; horario de la campaña en hora de Madrid; trozo ≤ 25 por pasada; segunda mirada (bloqueos, `voice_do_not_call`, coincidencias con clientes o leads, ya ha escrito); cargas `SI:<envio_id>` / `NO:<envio_id>`; corte de la tanda ante errores de límite o de cuenta. Recordatorio a los `recordatorio_dias` (15) si el primero se entregó y no hay respuesta; `sin_respuesta` 7 días después.
- Respuestas: «No» o baja por texto (solo prospectos de campaña) → bloqueo teléfono + BSUID, envíos cancelados, `descartado`, conversación `cerrada`, cortesía. «Sí» → `interesado`, lead `whatsapp` en la bolsa (o enlace al lead con ese teléfono), botones [Que me llaméis] [Ahora no]; `enganchePropuestaFase4()` en `respuestas.ts` es donde la fase 4 mandará el PDF. [Que me llaméis] → lead potencial A + etiqueta `llamar`, prospecto `caliente`.
- Bandeja: con la ventana cerrada, selector de plantillas aprobadas; nada a contactos bloqueados. «Sin atender» ya no enseña plantillas sin respuesta.
- `/captacion/bloqueos`: ver y añadir (gestores y comerciales), quitar (solo `company_admin`).
- Queda fuera: cortacircuitos y coste por envío (fase 7), aviso al responsable, reabrir una conversación cerrada si vuelve a escribir.

## Fase 7 — Mando completo (programada el 2026-11-27)

- Migraciones (aplicadas): `20261129180000_captacion_fase7_mando.sql` (`captacion_envios.coste_milicentimos` + `coste_categoria`; campañas `pausa_automatica`, `pausada_at`, `reanudada_at`; conexión `aviso_gasto_80_mes` / `aviso_gasto_tope_mes`; propuestas `envio_intentos`, `ultimo_intento_at`; funciones `captacion_gasto_mes`, `captacion_muestra_cortacircuitos`, `captacion_embudo`, solo `service_role`) y `20261129180100_captacion_gasto_campana.sql`.
- Recordatorio: ya salía desde la fase 3 (uno, a los `recordatorio_dias` = 15, solo `contactado` con el primero entregado). Añadido: segunda mirada también en el recordatorio (si hay cualquier entrante, se cancela y pasa a `conversando`) y `sin_respuesta` 7 días después de un recordatorio fallido (si no, se quedaba en `contactado`).
- Cortacircuitos (antes de mandar cada campaña, en cada pasada): últimos 100 envíos intentados desde `reanudada_at`, muestra mínima 30; > 15 % fallidos o > 25 % «No» (prospectos con bloqueo) → `pausada` con motivo + aviso a admin y directores. Conexión no activa o calidad roja/amarilla → se pausan todas las campañas de la empresa. No se reanuda sola; reanudar a mano reinicia la muestra y el escalado (vuelve a 50) y se niega si la conexión sigue mal.
- Costes: `mando-logica.ts` (`TARIFAS_ES_MILICENTIMOS`: marketing 5850, utility 1660, fuente §7). Al pasar a entregado o leído se apunta el coste una vez; con `pricing` de Meta si llega. Gasto del mes (Madrid) = suma de filas + enviados sin estado a tarifa de marketing; al 80 % aviso al admin, al 100 % aviso y no sale frío ese mes; lo que cabe limita la pasada.
- Reintento del PDF en el cron `captacion-envios`: como mucho 3, cada 10 min, solo con la ventana de 24 h abierta, sin repetir si ya consta un documento saliente.
- Mando: `PanelMando` en `/captacion` (empresa) y en la campaña: embudo con SQL agregado, tasas sobre entregados, gasto frente al tope y pausas automáticas con su motivo.
- Pendiente: `webhook.ts` debe llamar `aplicarEstadosEnvios(companyId, extraerEstados(v), v)` para que se use el `pricing` real (hoy se cuenta todo a marketing); refrescar la calidad del número desde Meta de forma automática (hoy solo a mano); verlo a 390 px.

## Fase 5 — Asistente de IA (programada el 2026-11-27)

- Migración `20261129190000_captacion_asistente.sql` (aplicada): `captacion_faq` y `captacion_documentos` (RLS: leen gestores y comerciales; escribe el servidor); en conversaciones `ia_identificada_at`, `ia_silenciada_at/_motivo/_por`, `ia_devuelta_at`, `ia_mensajes`; en mensajes `procesado_ia_at`, `modelo_ia` y tokens (entrada, salida, caché). Trigger `app.captacion_silenciar_ia()`: un saliente humano (panel) o del móvil pone `modo = 'humano'` en la misma transacción (probado con datos que se deshicieron).
- SDK `@anthropic-ai/sdk` 1.14 y `ANTHROPIC_API_KEY`. Sin clave, todo apagado y el interruptor no enciende.
- Flujo: respuestas.ts (baja y «No» por delante) → `alEscribirLibre` → `asistenteTrasTexto()` con `after()`. Reclama el mensaje (`procesado_ia_at`), clasifica la primera respuesta con `claude-haiku-5-5` y salida estructurada (si → «Sí», no → baja), espera 8 s por ráfaga, pasa a `ia` sola una conversación de campaña que nadie ha tocado, puerta 1 (ventana, bloqueo, tope 12), persona/llamada por expresión, modelo con herramientas (`marcar_interes`, `pedir_llamada` → `alPedirLlamada`, `pasar_a_persona`), comprobación de euros contra el catálogo, puerta 2 justo antes de enviar, identificación del art. 50 en el primer mensaje.
- Pantallas: tarjeta «Asistente de IA» en `/configuracion/captacion` (solo admin; modelo), `/configuracion/captacion/faq` (Preguntas · Documentos · Probar), y en la bandeja burbuja «IA», aviso «Si escribes, el asistente se calla» y «Devolver al asistente».
- Queda fuera: herramienta `enviar_pdf`, búsqueda vectorial (fase 8), cron que recoja turnos perdidos si muere `after()`.

## Fase 8 — Endurecimiento (programada el 2026-11-27)

- Migración `20261129200000_captacion_fase8_endurecimiento.sql` (aplicada): índice `captacion_webhook_eventos(recibido_at)`; `captacion_envios.tipo` admite `documento` (CHECK ampliado); funciones solo `service_role`: `captacion_ultimo_movimiento`, `captacion_retencion_candidatos`, `captacion_anonimizar_prospectos`, `captacion_purgar_webhook_eventos` (nunca borra lo de menos de 30 días) y `captacion_salud_empresas`. Probada con datos de prueba dentro de un bloque anulado: solo se anonimiza el prospecto viejo sin lead; el de lead, el convertido, el que conversó hoy y el reciente no se tocan; el bloqueo sigue; la segunda pasada no hace nada.
- Retención (cron `captacion-diario`, 45 s de presupuesto antes de las búsquedas): todas las empresas con prospectos, tengan o no el módulo activo. Prospecto sin lead, fuera de `interesado`/`caliente`/`convertido` y con `retencion_dias` (365 sin conexión) sin movimiento (fila, mensajes, envíos, visitas): envíos en cola cancelados, conversaciones y mensajes borrados, visitas borradas, propuestas revocadas y sin datos, PDF borrado del bucket (si falla, se reintenta la noche siguiente) y prospecto vaciado. Se conservan teléfono, `osm_id`, `place_id`, etapa y fechas para no volver a escribirle. `captacion_bloqueos` no se toca. Eventos de webhook: 30 días, por tandas de 1.000. Lógica en `retencion-logica.ts`.
- Panel `/superadmin/captacion` («Salud de captación» en el menú del superadmin): por empresa con el módulo activo, conexión, calidad, límite, último aviso de Meta y último error, envíos de hoy, fallidos de 24 h, gasto del mes frente al tope, campañas en pausa con su motivo, avisos sin procesar o con error; avisos sin empresa; última ejecución y último fallo de `captacion-envios` y `captacion-diario`. Tarjetas a 390 px y tabla desde `lg`.
- Plantilla con cabecera DOCUMENT: en el formulario, uso «Propuesta (PDF) cuando ya han pasado 24 h», categoría utility o marketing; se sube a Meta un PDF de ejemplo sin datos de nadie (Resumable Upload) para el `header_handle`. Envío en `propuesta-envio.ts` (lo usan el «Sí» y el reintento): ventana abierta → documento normal; cerrada y plantilla aprobada de uso `documento` → plantilla, apuntada en `captacion_envios` (gasto del mes e índice único: una por prospecto, sin reintento automático si falla); cerrada y sin plantilla → pendiente como antes. No sale con el tope de gasto alcanzado ni a un bloqueado.
- Arreglos: «Bloqueos» y «FAQ del asistente» en `/captacion` para gestores y comerciales; una conversación `cerrada` se reabre (`humano`) si el contacto vuelve a escribir y no está bloqueado.
- Pendiente: que Meta acepte el token de negocio en la Resumable Upload (la guía pide token de usuario) [NV]; retención de conversaciones sin prospecto (contactos que escriben solos) y de visitas a los 12 meses (§8) sin decidir; búsqueda vectorial y segunda empresa, sin empezar.
