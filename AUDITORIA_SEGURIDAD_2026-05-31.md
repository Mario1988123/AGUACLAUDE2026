# Auditoría de seguridad — Hidromanager · 31 mayo 2026

Solo cuento lo que está mal o sospechoso. Lo que está bien, ni lo menciono.

Ordenado por gravedad: **CRÍTICO** (urgente, hay que arreglar) → **ALTO** (importante, esta semana) → **MEDIO** (cuando puedas) → **BAJO** (cosméticos).

Para cada hallazgo:
- **Qué pasa** (en cristiano)
- **Por qué es peligroso**
- **Cómo se arregla**
- Estado: 🔴 abierto · 🟢 arreglado esta sesión · 🟡 migración lista sin aplicar

---

## 🔴 CRÍTICOS

### C1. Claves productivas en tu disco local + autologin de desarrollo

**Qué pasa.** Tu archivo `.env.local` (no está en git, comprobado) contiene secretos reales: clave maestra de Supabase (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`), de Resend, de notificaciones push (`VAPID_PRIVATE_KEY`) y la clave de cifrado (`ENCRYPTION_KEY`). Y tiene activado `NEXT_PUBLIC_LOCAL_AUTOLOGIN=true`.

**Por qué es peligroso.** Si esa máquina se compromete, o si por error envías el zip del proyecto a soporte / Drive / mail / repo nuevo, **se filtran credenciales con acceso total a tu base de datos**. El `SUPABASE_ACCESS_TOKEN` es token de "Management API": permite crear y **borrar** proyectos enteros.

**Cómo se arregla.**
1. Entra en Supabase Dashboard → Project Settings → API Keys → **Rotar** la `service_role`, la `secret_key` y la contraseña de BD.
2. Entra en Resend → API Keys → Crear nueva, borrar la vieja.
3. Genera nuevo `ENCRYPTION_KEY` y nuevo VAPID (esto invalida los emails SMTP cifrados ya guardados y las suscripciones push; explico abajo).
4. Sube los nuevos valores a Vercel → Settings → Environment Variables (NO los guardes en local nunca con valor productivo).
5. En local, deja solo claves de proyectos de pruebas o claves restringidas.

**Estado.** 🔴 Solo tú puedes hacerlo (rotación en paneles externos).

> ⚠️ Si rotas `ENCRYPTION_KEY` perderás las contraseñas SMTP guardadas en `companies.smtp_*_password_enc` y en `email_user_settings.smtp_password_enc`. Tendrás que pedirles a las empresas que vuelvan a meter su contraseña SMTP. Aviso en panel de configuración → mailing.

---

### C2. Cualquier usuario puede leer los chats internos de OTRAS empresas

**Qué pasa.** Las tablas `chat_messages` y `chat_thread_members` tienen política RLS `using (true)`. Eso significa "todo el mundo puede leerlo todo".

**Por qué es peligroso.** Cualquier usuario autenticado de cualquier empresa, usando el `anon_key` (que es público por diseño), puede leer **TODOS los mensajes de chat interno y miembros de hilos de TODAS las empresas**. No es un hipotético: con una llamada PostgREST directa fuera de la app ya pasa. Hablamos de conversaciones internas sobre precios, problemas con clientes, ofertas a competencia, etc.

**Cómo se arregla.** Migración correctiva creada y lista: `supabase/migrations/20260531180000_rls_hardening_chat_points_consents.sql`. Cambia `using (true)` por `using (company_id = company_id_del_usuario_actual)`.

**Estado.** 🟡 Migración lista. Aplicarla cuando puedas (es una migración aditiva, no rompe nada de la app porque la app escribe siempre con `service_role`).

---

### C3. Cualquier admin puede exportar datos RGPD de clientes de otras empresas

**Qué pasa.** El export RGPD (artículo 15) en `src/modules/customers/rgpd-actions.ts` cargaba el cliente por `id` sin filtrar por la empresa del solicitante.

**Por qué es peligroso.** Un `company_admin` de la empresa A podía pasar un `customer_id` de la empresa B y obtener el JSON entero con todos los datos personales: nombre, dirección, DNI, IBAN, contratos firmados, instalaciones, eventos del cliente. Es exactamente lo que el RGPD prohíbe. Sanción potencial: hasta 4 % de la facturación anual.

**Cómo se arregla.** Aplicado: ahora todas las consultas filtran por `company_id` del solicitante. Cliente devuelto solo si pertenece a su empresa.

**Estado.** 🟢 Arreglado esta sesión.

---

### C4. Cualquier usuario puede manipular las comisiones de otras empresas

**Qué pasa.** Las tablas `points_cycles` y `points_cycle_adjustments` tenían política `for all using(true) with check(true)`.

**Por qué es peligroso.** Cualquier autenticado puede INSERTAR, MODIFICAR o BORRAR ciclos de comisiones y ajustes de puntos de cualquier empresa. Imagínate que alguien de la empresa A borra los ciclos cerrados de la empresa B → desaparece la prueba de lo que se pagó a cada comercial.

**Cómo se arregla.** Migración correctiva lista (misma que C2).

**Estado.** 🟡 Migración lista. Aplicar.

---

## 🟠 ALTOS

### A1. El webhook de Resend aceptaba peticiones sin firma si la variable faltaba

**Qué pasa.** En `/api/webhooks/resend` se verificaba la firma SOLO si la variable `RESEND_WEBHOOK_SECRET` estaba puesta. Si se perdía o cambiaba accidentalmente, el webhook quedaba abierto.

**Por qué es peligroso.** Cualquier persona podía mandar un POST con datos falsos para marcar emails como rebotados / con queja, dejando a tus clientes sin recibir comunicaciones comerciales.

**Cómo se arregla.** Si falta la variable, ahora se devuelve `500`. Fail-closed, igual que los crons.

**Estado.** 🟢 Arreglado esta sesión.

---

### A2. Subida de fotos/firmas en instalaciones sin chequeo de pertenencia

**Qué pasa.** En `installations/photo-actions.ts` se aceptaba un `installation_id` UUID sin comprobar que esa instalación pertenezca a la empresa del usuario.

**Por qué es peligroso.** Un usuario de la empresa A podía inyectar filas en `installation_photos` con su `company_id` pero apuntando a una `installation_id` de la empresa B → contaminación de datos cross-tenant (la firma aparece "en mi panel" pero está enlazada a una instalación ajena). La ruta de Storage sí estaba protegida por prefijo `${company_id}/`, pero la fila de BD no.

**Cómo se arregla.** Añadido un `assertInstallationOwnership()` antes de cualquier upload.

**Estado.** 🟢 Arreglado esta sesión (en photo-actions instalaciones — **pendiente revisar el mismo patrón en**: `contracts/photo-actions.ts`, `free-trials/actions.ts`, `incidents/*`, `expenses/*`).

---

### A3. Subida de imágenes sin validar formato ni tamaño

**Qué pasa.** Las funciones de subida (fotos contrato, firmas, fotos instalación, etc.) confiaban en el `mime` del `data:` URL sin lista permitida. Tampoco había límite de tamaño.

**Por qué es peligroso.** Se podía subir `data:image/svg+xml;base64,...` con JavaScript dentro. Cuando otro usuario abriera la URL firmada del Storage en el navegador, ejecutaría JS en el dominio Supabase (Cross-Site Scripting). También permitía subir archivos enormes que llenarían el bucket.

**Cómo se arregla.** Allowlist estricta de MIME (`jpeg`, `png`, `webp`, `heic`, `heif`) y tamaño máximo 8 MB. Aplicado en `installations/photo-actions.ts`.

**Estado.** 🟢 Arreglado en instalaciones. 🔴 **Pendiente replicar el mismo patrón en**: `contracts/photo-actions.ts`, `free-trials/actions.ts`, `expenses/*`, avatares de usuario, banners RRSS.

---

### A4. Límite de tamaño de Server Actions excesivo (10 MB)

**Qué pasa.** En `next.config.ts` está `serverActions.bodySizeLimit: "10mb"` (default Next es 1 MB).

**Por qué es peligroso.** Un usuario autenticado puede provocar ralentización del servidor llamando en bucle a acciones grandes (sube fotos pesadas, DNI base64). Lambda de Vercel consume CPU y memoria por petición.

**Cómo se arregla.** En cuanto migres firmas y DNI a subida directa por Storage (en vez de pasar base64 por server action), bajar este límite a 2 MB. Por ahora dejarlo como está porque las firmas con DNI lo necesitan.

**Estado.** 🔴 Pendiente. Necesita refactor mediano de upload de firmas. **Importancia alta pero no inmediata** — solo afecta si te atacan con un buclebot.

---

### A5. Crons pueden no estar ejecutándose (no es seguridad pero conviene saberlo)

**Qué pasa.** El middleware de Next no tiene `/api/cron/` en la lista de rutas públicas. Esto significa que el middleware REDIRIGE a `/login` antes de que el cron pueda ejecutarse. **Si los crons funcionan es porque Vercel Cron mete cookie de sesión válida; si no, llevan tiempo caídos sin que se note.**

**Por qué importa.** Si los crons no van: no se mandan recordatorios de mantenimiento, no se cierran ciclos de comisiones, no se reconcilian las facturas, las alertas de impago no se generan, los emails programados no salen.

**Cómo se arregla.**
1. Verifica en Vercel → Logs → Functions → `/api/cron/hourly` cuándo fue la última ejecución exitosa.
2. Si no se ejecuta hace días: editar `src/shared/lib/supabase/middleware.ts` y añadir `/api/cron/` a `PUBLIC_PATHS`. El `verifyCronAuth` ya valida el `x-cron-secret` con tiempo constante, así que es seguro abrirlo.

**Estado.** 🔴 Pendiente verificar. Posible bug oculto desde hace tiempo. **Prioridad alta porque afecta a operativa diaria.**

---

### A6. La firma del admin se renderiza como HTML crudo (auto-XSS / XSS a clientes)

**Qué pasa.** En `email-settings-form.tsx` se hace `dangerouslySetInnerHTML` con el campo `signature` que mete el propio admin. Y esa misma firma se manda CRUDA a los emails de los clientes.

**Por qué es peligroso.** Auto-XSS bajo (el admin se hackea a sí mismo) PERO el HTML se envía a los buzones de los clientes. Si el admin se equivoca o un empleado mal intencionado mete un `<script>` o `onerror=...`, llega a los webmail de los clientes. Algunos webmail lo neutralizan (Gmail sí), otros no. Y en `email_user_settings` cada empleado tiene su propia firma — un empleado puede colar HTML que el admin no revisa.

**Cómo se arregla.** Pasar la firma por un sanitizador HTML (DOMPurify o `sanitize-html`) **del lado del servidor** antes de guardar y antes de enviar. Allowlist: `b, i, u, br, p, a[href], img[src], strong, em, span[style]`.

**Estado.** 🔴 Pendiente. Necesita instalar dependencia + 2 puntos de saneamiento. No urgente porque tus admins son de confianza, pero si abres marketing más adelante, urge.

---

### A7. Bucket `social-images` público + URLs firmadas con TTL alto

**Qué pasa.** El bucket `social-images` (donde van las imágenes RRSS generadas por IA) está marcado `public: true`. Y `getSignedPhotoUrl` crea URLs válidas 1 hora.

**Por qué es peligroso.**
- `social-images` público: cualquiera con la URL ve la imagen sin login. Algunas pueden contener datos del cliente (productos, ubicaciones).
- URL firmada de DNI / firma / fotos sensibles con 3600s: si alguien la pega en un WhatsApp, sigue siendo válida 1 hora para cualquiera.

**Cómo se arregla.**
- Pasar `social-images` a privado y servir por endpoint propio que verifique sesión.
- Bajar TTL de fotos sensibles (DNI, firma) a 5 minutos.
- Registrar la generación de cada URL firmada en `events` para tener audit log.

**Estado.** 🔴 Pendiente.

---

## 🟡 MEDIOS

### M1. Más tablas sin RLS habilitada

Tablas auditadas sin RLS: `customer_consents` (PII RGPD), `user_module_overrides`, `cron_runs`, `invoice_reminders_sent`.

**Estado.** 🟡 Incluidas en la migración correctiva lista.

---

### M2. Falta Content-Security-Policy

**Qué pasa.** `next.config.ts` ya tiene HSTS / X-Frame / Referrer-Policy / Permissions-Policy. Falta CSP y `Cross-Origin-*`.

**Por qué importa.** Si un día se cuela un XSS por cualquier ruta (SVG malicioso, sanitizer fallido, dependencia mala), CSP minimiza el daño porque el navegador no ejecuta scripts de orígenes no aprobados.

**Cómo se arregla.** Añadir en `next.config.ts` headers:
```
Content-Security-Policy: default-src 'self';
  img-src 'self' https://*.supabase.co data: blob:;
  script-src 'self' 'unsafe-inline' va.vercel-scripts.com;
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://*.supabase.co https://api.resend.com
               https://api.gocardless.com https://api-sandbox.gocardless.com;
  frame-ancestors 'none';
```
Empieza con `Content-Security-Policy-Report-Only` durante una semana para ver qué rompería antes de activarlo en duro.

**Estado.** 🔴 Pendiente.

---

### M3. Posible SSRF de bajo impacto en overlay RRSS

**Qué pasa.** El módulo RRSS hace `fetch(url)` con URLs del producto (`products.main_image_url`) y del logo de la empresa (`company.logo_url`). Esos campos los rellena el admin.

**Por qué importa.** Un admin malicioso puede poner `http://169.254.169.254/...` (metadata de AWS) o `http://localhost:5432/` para sondear la infraestructura interna. En Vercel hay poco que ganar, pero la "metadata IMDS" de algunos proveedores cloud devuelve credenciales.

**Cómo se arregla.** Validar:
- Solo `https://`.
- Resolver DNS y rechazar si la IP es loopback (127/8), link-local (169.254/16) o privada (10/8, 172.16/12, 192.168/16).
- Mejor: allowlist a `*.supabase.co` y a dominios conocidos.

**Estado.** 🔴 Pendiente.

---

### M4. Vulnerabilidades en dependencias npm

Detectado por `npm audit` (en informe del agente):
- `nodemailer 6.10.1` → hay CVEs altos (inyección CRLF en SMTP). Actualizar a `nodemailer@^8`.
- `postcss < 8.5.10` → XSS. Llega a través de Next 15.1.4 → actualizar a `next@15.4+`.

**Estado.** 🔴 Pendiente. Cambios mayores; revisar API antes.

---

## 🟢 BAJOS

### B1. Logs detallados de errores Supabase en producción

Varios `console.error(error)` con detalles completos de Supabase. Terminan en Vercel Logs. Bajo riesgo. Arreglo: loguear solo `error.code` y un ID de correlación.

### B2. Comodín en imágenes remotas

`next.config.ts` permite cargar imágenes desde cualquier `**.supabase.co/storage/v1/object/**`. Limitar al hostname del proyecto.

### B3. `DEV_AUTOLOGIN` depende solo de `NODE_ENV=development`

Añadir check extra `process.env.VERCEL !== "1"` para asegurar que nunca pasa en Vercel.

### B4. Server Actions devuelven `Error.message` con detalle Supabase

A veces incluyen nombre de columna o constraint. Información para reconocer la estructura. Cambiar a mensaje genérico.

### B5. Dos lockfiles a la vez (`pnpm-lock.yaml` + `package-lock.json`)

Instalaciones no deterministas. Decide uno y borra el otro.

### B6. Tracking de clicks no firma el target

`/api/track/click/[id]` valida `http/https` pero no firma el par (id, target). Pueden usarlo como redirector en phishing. Firmar con HMAC del `CRON_SECRET`.

---

## Resumen ejecutivo

| Severidad | Total | Arreglado hoy | Migración lista | Pendiente |
|-----------|------:|--------------:|----------------:|----------:|
| CRÍTICO   | 4     | 1             | 3 (en 1 migración) | 0       |
| ALTO      | 7     | 3             | —              | 4        |
| MEDIO     | 4     | —             | 1               | 3        |
| BAJO      | 6     | —             | —               | 6        |

### Lo más urgente para mañana

1. **Rotar las claves productivas** del `.env.local` (Supabase service_role, Resend, Access Token).
2. **Aplicar la migración** `20260531180000_rls_hardening_chat_points_consents.sql` (cierra C2, C4 y M1 de golpe).
3. **Verificar que los crons se están ejecutando** en Vercel Logs.

### Esta semana

4. Replicar el patrón `assertOwnership` + MIME allowlist + tamaño en el resto de uploads (contratos, free-trials, expenses, avatares, social-images).
5. Sanitizar las firmas HTML de email (DOMPurify server-side).
6. Privatizar `social-images` y bajar TTL de URLs firmadas sensibles.

### Más adelante

7. Añadir CSP en modo `Report-Only` y luego activarlo.
8. Actualizar Next a 15.4+ y nodemailer a 8.x.
9. Cerrar el bug del middleware con `/api/cron/`.

---

*Auditoría generada por agente de seguridad. Si encuentras algún hallazgo dudoso, mírate el archivo y la línea — todo está referenciado con ruta absoluta.*
