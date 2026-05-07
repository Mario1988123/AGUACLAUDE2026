# API pública — AGUACLAUDE CRM

> **Versión 1.0** — para integraciones de terceros (apps, webs, chatboxes).
> Permite crear leads, registrar conversaciones de chat, consultar estado y
> recibir webhooks cuando cambia el estado de un lead/cliente.
>
> **Base URL**: `https://aguaclaude2026.vercel.app/api/v1`
>
> Todas las peticiones y respuestas son JSON UTF-8.

---

## 1. Autenticación

Cada empresa cliente del CRM puede generar **API keys** desde su panel de admin
(`/configuracion/api-keys`). Cada key pertenece a UNA empresa y solo puede
crear/leer datos de esa empresa.

Incluye la API key en cada petición vía cabecera:

```
Authorization: Bearer <api_key>
```

Si no es válida, respuesta:
```json
{ "error": "unauthorized", "message": "API key inválida o revocada" }
```
Status: `401`.

**Importante**: la API key NO debe ir en código cliente público (frontend del
chatbox). Tu app debe tener un backend propio que reciba la conversación y
llame a nuestra API con la key. Si la metes en el frontend, cualquier
visitante de la web puede sacarla y crear leads basura.

---

## 2. Endpoints

### 2.1. **POST `/leads`** — Crear lead

Crea un nuevo lead en la empresa de la API key. Aplica deduplicación
automática por DNI/CIF, email y teléfono.

**Request body**:

```json
{
  "party_kind": "individual",          // "individual" o "company"
  "first_name": "Juan",                // si individual
  "last_name": "García",
  "legal_name": null,                  // si company
  "trade_name": null,
  "tax_id": "12345678Z",               // DNI/CIF (opcional, recomendado)
  "email": "juan@ejemplo.com",
  "phone_primary": "612345678",
  "origin": "web",                     // ver enum más abajo
  "potential": "B",                    // A, B, C o unknown
  "notes": "Vino del chatbox sobre osmosis",
  "address": {                         // opcional
    "street": "Calle Mayor 12",
    "postal_code": "46001",
    "city": "Valencia",
    "province": "Valencia",
    "country": "ES"
  },
  "external_id": "session_abc123",     // tu identificador, idempotencia
  "tags": ["chatbox", "osmosis"],
  "metadata": {                        // tu JSON arbitrario
    "utm_source": "google",
    "utm_campaign": "agua_verano",
    "first_message": "Hola, me interesa una osmosis"
  }
}
```

**Campos obligatorios**:
- `party_kind`
- `first_name` o `legal_name` según tipo
- `phone_primary` o `email` (al menos uno)

**Enum `origin`**: `web`, `referral`, `door_to_door`, `tmk`, `cold_call`,
`event`, `social`, `other`.

**Response 201**:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "reference_code": "L-2026-0042",
  "status": "new",
  "duplicate_of": null,                // si es duplicado, ID del original
  "created_at": "2026-05-08T10:23:11Z"
}
```

Si **es duplicado** (mismo DNI/email/teléfono), no crea uno nuevo:

```json
{
  "id": "<id del lead existente>",
  "reference_code": "L-2026-0017",
  "status": "contacted",
  "duplicate_of": "<id del lead existente>",
  "duplicate_field": "phone",          // tax_id, email, phone
  "created_at": "2026-04-21T15:02:00Z"
}
```

**Errores**:
- `400` — `validation_error` con detalle del campo.
- `409` — solo si `external_id` repetido (idempotencia estricta).
- `429` — rate limit superado.

**Idempotencia**: si pasas `external_id` y vuelves a llamar con el mismo,
devolvemos el mismo lead sin crearlo dos veces. Útil para reintentos.

---

### 2.2. **POST `/chats`** — Iniciar conversación de chatbox

Registra una conversación. No requiere asociar lead todavía.

**Request body**:

```json
{
  "external_id": "chat_xyz789",        // tu ID de sesión, único por chat
  "channel": "web_chatbox",            // "web_chatbox", "whatsapp", "instagram", ...
  "visitor": {                         // datos opcionales del visitante
    "ip": "85.123.45.6",
    "user_agent": "Mozilla/5.0 ...",
    "page_url": "https://aguasl.com/osmosis",
    "language": "es"
  },
  "metadata": { "utm_source": "google" }
}
```

**Response 201**:
```json
{
  "id": "chat_550e8400-...",
  "external_id": "chat_xyz789",
  "created_at": "2026-05-08T10:23:11Z"
}
```

---

### 2.3. **POST `/chats/{chat_id}/messages`** — Añadir mensaje al chat

Cada vez que el bot o el usuario manda un mensaje, lo envías aquí. Esto
permite a los comerciales del CRM ver la conversación completa cuando se
asigna como lead.

**Request body**:
```json
{
  "role": "user",                      // "user" o "assistant"
  "content": "Hola, me interesa una osmosis para 4 personas",
  "timestamp": "2026-05-08T10:23:15Z"
}
```

**Response 201**:
```json
{ "id": "msg_...", "ok": true }
```

---

### 2.4. **POST `/chats/{chat_id}/convert`** — Convertir chat en lead

Cuando el chatbox detecta que el visitante quiere ser contactado (rellena
formulario, deja teléfono, etc.), llamas a este endpoint para crear el lead
asociado a la conversación.

**Request body**: igual que `POST /leads` (todos los campos del lead).

**Response 201**: igual que `POST /leads` + `chat_id` ligado.

Después de esto, en el CRM el comercial asignado verá el lead **CON la
conversación completa adjunta** en la timeline del lead.

---

### 2.5. **GET `/leads/{id_or_external_id}`** — Consultar estado del lead

Devuelve el estado actual del lead. Útil para que tu app pueda mostrar al
visitante el progreso ("Te ha contactado María García, comercial").

**Response 200**:
```json
{
  "id": "550e8400-...",
  "reference_code": "L-2026-0042",
  "status": "contacted",
  "assigned_user": {
    "name": "María García",
    "email": null,                    // NUNCA exponemos email del comercial
    "phone": null                     // ni teléfono
  },
  "next_action": "Pendiente de contacto telefónico",
  "created_at": "2026-05-08T10:23:11Z",
  "updated_at": "2026-05-08T11:05:00Z"
}
```

**Status posibles**: `new`, `contacted`, `proposal_created`, `proposal_sent`,
`free_trial_proposed`, `converted`, `lost`, `expired`.

---

### 2.6. **POST `/customers`** — Crear cliente directamente (B2B avanzado)

Solo si tu sistema ya tiene clientes confirmados (no candidatos). Para
chatboxes públicos usa `/leads`.

Mismo schema que `/leads` pero crea directamente un cliente. Requiere API key
con permiso `customers:write` (lo configura el admin al generar la key).

---

### 2.7. **GET `/health`** — Verificar conexión

Sin auth. Para que la otra app verifique que la API está viva.

**Response 200**: `{ "status": "ok", "version": "1.0", "time": "2026-05-08T10:23:11Z" }`

---

## 3. Webhooks (notificaciones del CRM hacia tu app)

Si configuras un webhook en `/configuracion/api-keys`, te notificaremos por
HTTP POST cuando ocurran eventos:

- `lead.created` — se creó un lead (también desde otro origen, no solo API)
- `lead.assigned` — un comercial se asignó el lead
- `lead.contacted` — el comercial marcó el lead como contactado
- `lead.converted` — el lead pasó a cliente
- `lead.lost` — venta perdida
- `customer.created` — cuando un lead se convierte en cliente
- `contract.signed` — el cliente firmó el contrato (cierre de venta)

**Payload ejemplo**:

```http
POST https://tu-app.com/webhooks/aguaclaude
Content-Type: application/json
X-Aguaclaude-Event: lead.converted
X-Aguaclaude-Signature: sha256=<HMAC>
X-Aguaclaude-Delivery: <uuid del evento>

{
  "event": "lead.converted",
  "occurred_at": "2026-05-08T11:05:00Z",
  "data": {
    "lead": { "id": "...", "reference_code": "L-2026-0042" },
    "customer": { "id": "...", "reference_code": "C-2026-0017" }
  }
}
```

**Verificar firma** (para evitar suplantación):

```js
const expected = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest("hex");
const isValid = `sha256=${expected}` === req.headers["x-aguaclaude-signature"];
```

**Reintentos**: si tu endpoint devuelve != 2xx, reintentamos con backoff
(1min, 5min, 30min, 2h). Tras 5 fallos abandonamos.

**Idempotencia**: usa `X-Aguaclaude-Delivery` (UUID) para deduplicar si
recibes el mismo evento dos veces.

---

## 4. Errores estándar

Todas las respuestas de error siguen el formato:

```json
{
  "error": "validation_error",
  "message": "Descripción legible en español",
  "details": {
    "field": "phone_primary",
    "rule": "spanish_phone_format"
  }
}
```

| Status | Code | Cuándo |
|---|---|---|
| 400 | `validation_error` | Datos inválidos, formato incorrecto |
| 401 | `unauthorized` | API key inválida o revocada |
| 403 | `forbidden` | API key sin permisos para ese recurso |
| 404 | `not_found` | Recurso no existe |
| 409 | `conflict` | Idempotencia: external_id repetido |
| 429 | `rate_limit` | Has superado el límite |
| 500 | `internal_error` | Error nuestro |

---

## 5. Rate limits

Por API key:
- **60 peticiones / minuto**
- **5.000 peticiones / día**

Cabeceras de respuesta:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1715164891
```

Si superas, te devolvemos `429` y debes esperar a que `X-RateLimit-Reset`
indique (epoch seconds).

---

## 6. Ejemplos completos

### 6.1. Chatbox web — flujo típico

```js
// Cuando el visitante abre el chat:
const chat = await fetch("https://aguaclaude2026.vercel.app/api/v1/chats", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    external_id: sessionId,
    channel: "web_chatbox",
    visitor: { page_url: window.location.href },
  }),
}).then((r) => r.json());

// Por cada mensaje:
await fetch(`https://aguaclaude2026.vercel.app/api/v1/chats/${chat.id}/messages`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    role: "user",
    content: "Quiero saber el precio de la osmosis",
  }),
});

// Cuando el visitante deja sus datos:
const lead = await fetch(`https://aguaclaude2026.vercel.app/api/v1/chats/${chat.id}/convert`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    party_kind: "individual",
    first_name: "Juan",
    last_name: "García",
    phone_primary: "612345678",
    email: "juan@ejemplo.com",
    origin: "web",
    potential: "B",
    notes: "Pidió presupuesto osmosis 4 personas",
    metadata: { source_chat_id: chat.external_id },
  }),
}).then((r) => r.json());

// El visitante recibe: "¡Gracias Juan! Te contactaremos en menos de 24h."
console.log("Lead creado:", lead.reference_code);
```

### 6.2. Curl rápido — crear lead

```bash
curl -X POST https://aguaclaude2026.vercel.app/api/v1/leads \
  -H "Authorization: Bearer ak_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "party_kind": "individual",
    "first_name": "Ana",
    "last_name": "Pérez",
    "phone_primary": "699111222",
    "origin": "web"
  }'
```

---

## 7. Limitaciones

- **No exponemos** datos personales del comercial asignado (solo nombre).
- **No exponemos** lista de clientes o leads completa por la API; solo
  consulta puntual por ID.
- **No permitimos** modificar leads ya convertidos.
- Las conversaciones de chat son **solo lectura** desde el CRM (no se pueden
  responder desde la API; el comercial responde por su canal habitual).

---

## 8. Plantilla mensaje para el desarrollador

> Hola, te paso la documentación de la API del CRM AGUACLAUDE para que
> integres el chatbox de la app con nuestro sistema de leads.
>
> **Endpoint base**: `https://aguaclaude2026.vercel.app/api/v1`
>
> **Cómo obtener la API key**:
> 1. Yo entro como admin de empresa.
> 2. Voy a `/configuracion/api-keys` y genero una nueva key.
> 3. Te paso la key (solo se muestra una vez).
>
> **Permisos por defecto**: `leads:write`, `chats:write`, `leads:read`.
>
> **Lo que necesitamos integrar**:
> 1. Cuando alguien abre el chatbox → `POST /chats` con un `external_id`
>    único de sesión.
> 2. Cada mensaje → `POST /chats/{id}/messages`.
> 3. Cuando deje sus datos → `POST /chats/{id}/convert` con los campos del
>    lead.
> 4. Opcional: configurar webhook para que te notifiquemos cuando un
>    comercial contacte al lead, así puedes mostrar feedback al visitante.
>
> **Importante de seguridad**: la API key NO va en el frontend del chatbox.
> Tu backend hace de proxy: el chat manda los mensajes a TU servidor, y tu
> servidor habla con nuestra API añadiendo la key. Así un script malicioso
> en otra web no puede usar la key para spam.
>
> **Rate limit**: 60/min, 5.000/día. Si tienes mucho tráfico avísame y
> ampliamos.
>
> **Sandbox**: aún no tenemos entorno de pruebas separado. Mientras tanto,
> usa una API key de "test" que generaremos con prefijo `ak_test_` (los
> leads creados con esa key se marcan como `test=true` y no aparecen en el
> dashboard del comercial).
>
> Cualquier duda, escríbeme.

---

## Estado de implementación

⚠ **Esta documentación describe la API ESPERADA. Aún no está implementada.**
Cuando confirmes el plan procedemos a:

1. Tabla `company_api_keys` (key cifrada, permisos, rate limit, last_used).
2. Tabla `external_chats` y `external_chat_messages` para guardar las conversaciones.
3. Endpoints `/api/v1/*` con auth + rate limit + validación Zod.
4. Tabla `webhooks` + cron de delivery con reintentos.
5. UI `/configuracion/api-keys` para generar/revocar keys + ver logs.

Estimación: **2-3 sesiones** de trabajo para tener todo funcional con
documentación + sandbox.
