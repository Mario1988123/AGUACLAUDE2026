# Cómo publicar la landing en hidromanager.es

DNS comprobado: **hidromanager.es** apunta a `82.25.87.200` (Hostinger).
**crm.hidromanager.es** apunta a Vercel — eso queda como está, es el CRM.

## Opción A — Subir a Hostinger por FTP (más rápida)

1. Entra en `https://hpanel.hostinger.com` con tu cuenta.
2. Ve a **Hosting → Administrar → Archivos → Administrador de archivos**.
3. Abre la carpeta `public_html/` del dominio `hidromanager.es`.
4. **Borra** o renombra cualquier `index.html` que ya esté (el "página en construcción" de Hostinger).
5. Sube TODOS los archivos de esta carpeta `landing-site/`:
   - `index.html`
   - `styles.css`
   - `app.js`
   - carpeta `assets/` completa
6. Abre `https://hidromanager.es` — debería verse la landing.

## Opción B — Subir por FTP con cliente (FileZilla)

- Host: el FTP que da Hostinger (típicamente `ftp.hidromanager.es` o `82.25.87.200`)
- Usuario y contraseña: los del panel Hostinger
- Subir el contenido de `landing-site/` a `/public_html/`

## Opción C — Mover hidromanager.es a Vercel también

Si prefieres tener tanto el dominio raíz como `crm.` en Vercel:
1. Crea en Vercel un **proyecto separado** (por ejemplo `hidromanager-landing`).
2. Sube esta carpeta a un repo nuevo de GitHub (`hidromanager-web`).
3. Conéctalo a Vercel y añade el dominio `hidromanager.es` y `www.hidromanager.es`.
4. Cambia los DNS en Hostinger:
   - Quita registros A actuales (`82.25.87.200`).
   - Añade un registro A: `@` → `76.76.21.21` (IP Vercel).
   - Añade un registro CNAME: `www` → `cname.vercel-dns.com`.
5. Espera 5-30 minutos para propagación DNS.

## Notas

- El sitio es 100 % estático (sin build, sin Node, sin base de datos).
- El formulario de contacto NO envía nada todavía — solo muestra mensaje de OK.
  Para activarlo de verdad, opciones:
  - Conectar a un webhook (Make/Zapier/n8n) → enviar a tu CRM o email.
  - Hostinger tiene formulario built-in si lo activas en el panel.
  - O cambiar `app.js` para hacer fetch a un endpoint del CRM (`/api/public/lead`).
- `og-cover.svg` es la imagen que verás cuando alguien comparta el link en WhatsApp / Twitter. Si quieres una versión `.png` para mejor compatibilidad, conviértela con cualquier herramienta online (svg→png 1200×630).
- El logo `logo.svg` está vectorial, se ve nítido en cualquier resolución.

## Estructura

```
landing-site/
├── index.html          # Landing completa
├── styles.css          # Estilos (CSS plano)
├── app.js              # Slider + mockup animado
├── README-DEPLOY.md    # Este archivo
└── assets/
    ├── favicon.svg
    ├── logo.svg            # Logo color (para nav)
    ├── logo-white.svg      # Logo blanco (footer/fondo oscuro)
    └── og-cover.svg        # Imagen compartir redes 1200×630
```
