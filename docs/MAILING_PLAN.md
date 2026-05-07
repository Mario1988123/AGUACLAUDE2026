# Plan módulo Mailing — propuesta para AGUACLAUDE2026

> Investigación 2026-05-08. Documento DE DISCUSIÓN, no implementación.

## Componentes propuestos

| Componente | Decisión por tomar |
|---|---|
| Editor campañas | MJML (templates code-first) vs GrapesJS (drag-drop) vs React Email (componentes) |
| Plantillas | Versionables, por empresa, con merge tags `{{customer_name}}` |
| Listas/segmentos | Estáticas (selección manual) + dinámicas (filtros sobre customers/leads) |
| Automatizaciones | Drip + triggers (BD + cron diario) |
| Tracking | Open pixel + click redirects + List-Unsubscribe header |
| Suppression | Por empresa + global por bounces/quejas |
| Cumplimiento | Doble opt-in + link baja obligatorio + log consentimientos |

## 5 opciones para "cada usuario manda con su email" — TRADE-OFFS

### A) OAuth Gmail/Outlook (cada usuario conecta su buzón) ⭐
- ✅ El email sale literalmente del usuario, máxima personalización + reply directo a su bandeja.
- ✅ Deliverability heredada del usuario.
- ❌ Límites Gmail: **500/día** por usuario gratis, 2.000/día Workspace.
- ❌ Aplicación tiene que pasar **verificación OAuth de Google** (proceso 4-6 semanas con auditoría de seguridad).
- ❌ Tokens caducan, hay que refrescar; complejidad UX.
- ❌ Para Outlook, similar pero más fácil (Microsoft Graph).
- 🎯 **Usado por**: HubSpot Sales (con su extensión), Pipedrive Smart Email BCC.

### B) SMTP del usuario (config manual con su servidor)
- ✅ Flexibilidad total, no depende de Google.
- ❌ El comercial no sabe configurar SMTP, soporte horrible.
- ❌ Passwords en BD (incluso cifrados es marrón).
- ❌ Dudosa escalabilidad por usuario.

### C) Sender único de empresa (recomendado ⭐⭐)
- ✅ Setup simple: el admin configura `info@aguasl.com` UNA VEZ + DNS.
- ✅ Reputación dominio compartido = todo el equipo se beneficia.
- ✅ Tracking centralizado.
- ❌ El email no parece del comercial. Mitigable con Reply-To dinámico + firma con foto/nombre del comercial.
- 🎯 **Usado por**: Mailchimp clásico, Brevo, ActiveCampaign masivo.

### D) Subdominio por usuario (`maria@aguasl.com`)
- ✅ Personalización + dominio empresa.
- ✅ Posible con AWS SES / Resend autenticando todo el dominio raíz.
- ❌ Cada usuario necesita una cuenta de email real (o solo "from", reply va al admin).
- 🎯 **Usado por**: ConvertKit creators.

### E) Reply-to dinámico (sender único + responder al comercial)
- ✅ Mantiene deliverability del dominio empresa.
- ✅ Cliente responde al comercial directo.
- ⚠ Gmail puede marcar Reply-to distinto de From como sospechoso (ARC headers).

## Mi sugerencia (a debatir)

**Combinar C + E para el 95% de casos** (campañas masivas) y **A opcional** para emails 1-a-1 importantes (propuesta personalizada):
- Empresa configura **un dominio** en `/configuracion/mailing` (DKIM/SPF/DMARC con DNS records).
- Todos los envíos masivos salen de `info@<dominio>` con **Reply-To = email del comercial**.
- El comercial pone su email + nombre + foto en su perfil → aparece en la firma.
- En el detalle de cliente/lead, botón **"Enviar email"** que redacta + manda con tracking.
- Opcional fase 2: integración OAuth Gmail/Outlook para los que quieran enviar 1-a-1 desde su buzón real.

## Proveedor SMTP recomendado

**Resend** (precios 2026):
- 100 emails/día gratis, 50.000/mes por **20$**.
- API moderna, webhooks por defecto, audit log.
- Soporte nativo React Email.
- Integra DKIM/SPF/DMARC auto verificando dominio.

Alternativas: **Brevo** (300 gratis/día, sin coste de marketing list), **Postmark** (caro pero mejor deliverability transaccional), **AWS SES** (más barato pero sin features marketing).

## Modelo de datos propuesto (12 tablas)

```
email_domains            (dominio empresa + estado verificación DKIM/SPF)
email_user_settings      (signature, foto, nombre del comercial)
email_lists              (listas estáticas)
email_segments           (filtros dinámicos sobre customers/leads/lost_sales)
email_segment_members    (cache pre-calculado)
email_templates          (plantillas reutilizables, MJML compilado a HTML)
email_campaigns          (envíos puntuales o programados)
email_automations        (drip / triggers)
email_automation_steps   (paso 1, 2, 3, ...)
email_sends              (1 por destinatario por campaña)
email_events             (open, click, bounce, complaint, unsubscribe)
email_suppressions       (lista negra por empresa)
email_unsubscribe_tokens (one-time tokens RFC 8058)
```

## Casos de uso específicos del CRM (mis sugerencias)

### Campañas
1. **Win-back** ventas perdidas hace 6 meses con descuento.
2. **Promo verano** descalcificadores a clientes en zonas de alta dureza (filtro por CP).
3. **Aniversario contrato** felicitación + cupón referidos.
4. **Alerta filtro próximo a caducar** a clientes con `customer_equipment` y plan mantenimiento.
5. **Newsletter mensual** con tips agua + nuevos productos.

### Automatizaciones (drip)
1. **Bienvenida** post-firma contrato: email 1 a la firma, email 2 a los 7 días con manual del equipo, email 3 al mes con encuesta.
2. **Lead frío**: si potential=A sin contactar 7 días → email del comercial.
3. **Free trial** sin decisión: día 5 recordatorio, día 9 último aviso.
4. **Pos-instalación**: día 1 felicitación + foto, día 30 mantenimiento, día 90 NPS.
5. **Cumpleaños cliente**: descuento personalizado.

## Fases de implementación sugeridas

### Fase 1 — MVP (1-2 días)
- Tabla `email_domains` + verificación DKIM/SPF/DMARC con Resend.
- UI `/configuracion/mailing` para añadir dominio.
- Botón "Enviar email" en ficha cliente/lead/venta perdida con plantilla simple.
- 1 tabla `email_sends` con tracking básico (open + click).

### Fase 2 — Campañas (3-4 días)
- Editor MJML/React-email con preview.
- Listas estáticas + segmentos dinámicos sobre customers/leads.
- Programación + envío masivo con throttling.
- Reportes (open rate, click rate).

### Fase 3 — Automatizaciones (3-4 días)
- Editor visual triggers.
- Cron diario evalúa condiciones.
- Drip campaigns paso a paso.

### Fase 4 — Avanzado
- A/B testing.
- OAuth Gmail/Outlook (1-a-1).
- Predictive send time.

## Cumplimiento RGPD/LSSI

- ✅ **Doble opt-in** obligatorio para nuevas suscripciones.
- ✅ **List-Unsubscribe** header en CADA email + link visible.
- ✅ Log de consentimientos (`email_consents` con IP, fecha, scope).
- ✅ Identificación clara del remitente (Razón social + CIF + dirección).
- ✅ Derechos ARCO en cada email.
- ✅ Censo Robinson respetado opcionalmente.
