# Encargo de auditoría — repaso del trabajo de la noche del 9 al 10 de septiembre de 2026

Este fichero es el encargo de una auditoría programada. Si lo estás leyendo como
agente de una rutina, esto es lo que tienes que hacer. Tienes contexto cero:
léelo entero antes de tocar nada.

## El proyecto

**AGUACLAUDE2026** (comercialmente *Hidromanager*) es un SaaS multi-tenant de
gestión para empresas de tratamiento de agua. Next.js 15 (App Router, server
actions) + Supabase (Postgres con RLS por `company_id`).

**Está en producción y cada commit a `main` despliega solo en Vercel.** No
commitees nada. Tu trabajo es mirar y escribir un informe.

## Qué se hizo esa noche

Cuatro commits, todos ya en `main`. Míralos con `git log` y `git show`:

| Commit | Qué es |
|---|---|
| `d60f8d4` | **Módulo de agente de voz IA.** Tres canales: saliente de mantenimientos, recepcionista entrante y campañas comerciales B2B. ~5.900 líneas TS + 3 migraciones SQL. Vive en `src/modules/voice-agent/`, `src/app/(tenant)/agente-voz/`, `src/app/api/voice-agent/` y `src/app/api/cron/voice-*`. Va APAGADO por defecto. |
| `461df12` | **Duplicados.** Una persona puede darse de alta además como empresa o autónomo. La regla está en `src/shared/lib/dedupe/rules.ts` (`isBlockingDuplicate`): el DNI/CIF repetido bloquea siempre; el email o el teléfono repetidos solo bloquean si coincide el `party_kind`. |
| `a6b3334` | **Geocoding.** Google Maps ahora registra el motivo real del fallo en vez de `no_result`. |
| `512a093` | **Traspaso de equipos.** Cambiar el titular de un equipo entre fichas del mismo dueño, en `src/modules/customers/transfer-equipment-actions.ts`. |

## Lo que tienes que hacer

### A) Que todo siga en pie

Ejecuta y reporta cualquier fallo con su salida exacta:

```bash
npm ci || npm install
npx tsc --noEmit
npm test
npm run build
```

### B) Revisar a fondo el traspaso de equipos (`512a093`)

Es lo más nuevo, toca dinero y **no tiene ni un test**. Lee entero
`src/modules/customers/transfer-equipment-actions.ts` y busca fallos **reales**
de corrección. Preguntas concretas que quiero contestadas:

1. Si un paso intermedio falla (por ejemplo, la copia de la dirección va bien
   pero el `update` de `customer_equipment` falla), ¿queda el estado a medias?
   No hay transacción: los `update` son llamadas sueltas de PostgREST. ¿Cuál es
   el peor estado alcanzable y merece la pena moverlo a una función de Postgres?
2. `include_children` mueve los hijos, pero ¿qué pasa con los **nietos**
   (`parent_equipment_id` de un hijo)? Comprueba si el modelo lo permite.
3. La cláusula `.not("status", "in", "(completed,cancelled)")` — ¿es sintaxis
   válida de PostgREST para un enum? Verifícalo en la documentación o en otro
   uso del repo. Si está mal, **no** mueve nada y falla en silencio.
4. `listTransferTargets` trae hasta 500 fichas. Con más clientes, ¿se corta?
   ¿Debería buscar por texto en vez de listar?
5. ¿Puede un usuario de la empresa A traspasar un equipo a una ficha de la
   empresa B? Sigue el `company_id` por todas las consultas y confírmalo.

### C) Buscar lo que se nos haya quedado suelto

- ¿Hay referencias a tablas, columnas o RPC que no existan? Contrasta el código
  contra las migraciones de `supabase/migrations/`.
- ¿Quedan `TODO`, `FIXME` o `console.log` olvidados en lo tocado esa noche?
- El módulo de voz declara herramientas en `src/modules/voice-agent/prompts.ts`
  (`SERVICE_TOOLS`, `COMMERCIAL_TOOLS`, `INBOUND_TOOLS`). ¿**Todas** están
  implementadas en `src/app/api/voice-agent/tools/[tool]/route.ts`? Una
  herramienta declarada y no implementada es una llamada que se rompe en
  directo. Compáralas una a una y di cuáles faltan, si falta alguna.
- Los dos crons nuevos están en `vercel.json`. ¿Comprueban la autenticación de
  cron igual que los demás? ¿Se saltan las empresas con el módulo apagado?

### D) Dos avisos importantes sobre cómo auditar ESTE proyecto

1. **El esquema local NO es el de producción.** Este repo tiene deriva crónica.
   Una auditoría previa dio un "CRÍTICO" de RLS que resultó ser falso justo por
   esto. Tú **no tienes acceso a la base de datos de producción**, así que
   cualquier hallazgo de esquema tienes que marcarlo explícitamente como *"por
   verificar contra producción"*. No lo des por hecho.
2. **`supabase_migrations.schema_migrations` no sirve** para saber qué está
   aplicado. Ignórala.

## Lo que YA sabemos que está pendiente (no hace falta que lo redescubras)

- **Cuenta de ElevenLabs + variables de entorno** (`ELEVENLABS_API_KEY`,
  `ELEVENLABS_PHONE_NUMBER_ID`, `VOICE_WEBHOOK_SECRET`). Sin ellas el agente
  simula y no llama a nadie. Es lo único que bloquea encender el módulo.
- **Facturación mensual de alquiler rota.** `src/app/api/cron/daily/route.ts`
  (~línea 1408) inserta en `invoices` una columna `pending_cents` **que no
  existe en producción**, y además omite cuatro columnas `NOT NULL` sin valor
  por defecto: `series_id`, `number`, `fiscal_year`, `full_reference`. No ha
  podido funcionar nunca. El mismo fallo mata los recordatorios de impago
  (~línea 1878). **Si puedes proponer el arreglo, hazlo en el informe** — que
  la cuota mensual pase por el mismo camino de numeración que la facturación
  manual, en vez de por un `insert` a pelo. No lo commitees.
- **WhatsApp entrante con IA**: sin construir, es la fase 2.
- **Transferencia en caliente de llamadas**: hay que configurarla en el panel de
  ElevenLabs.

## El entregable

Escribe `AUDITORIA_NOCTURNA_RESULTADO.md` en la raíz del repo con:

1. **Veredicto en tres líneas.** ¿Se puede dejar como está o hay que tocar algo
   ya?
2. **Hallazgos ordenados por gravedad** (CRÍTICO / IMPORTANTE / MENOR). Cada uno
   con: fichero y línea, qué pasa, cómo reproducirlo y el arreglo propuesto.
   Marca los que dependan del esquema de producción como *por verificar*.
3. **Lo que comprobaste y salió bien.** Explícitamente, para que se sepa qué
   quedó cubierto y qué no.
4. **Qué NO pudiste comprobar** y por qué.

Sé escéptico y concreto. Un hallazgo sin fichero, línea y forma de reproducirlo
no vale. Y si algo está bien, dilo: no inventes problemas para llenar el
informe.
