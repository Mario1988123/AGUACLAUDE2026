-- =============================================================================
-- 20260604101200_email_templates_product_share.sql
-- Fase 1 del Plan Productos v2.
-- Seed de plantillas de email para envío de:
--   - Ficha técnica de un producto (PDF adjunto + URL pública)
--   - Catálogo de varios productos (solo URL pública en el cuerpo)
--
-- company_id = NULL ⇒ plantillas de sistema, visibles a todas las empresas.
-- is_system = true  ⇒ la empresa puede crear una copia editable bajo su
-- company_id si quiere personalizarlas (UI Fase 3 / Fase 4).
-- =============================================================================

-- Ficha técnica suelta: PDF adjunto + URL.
insert into public.email_templates
  (company_id, key, name, description, kind, subject, body_html, body_text, variables, is_system, is_active)
select
  null,
  'product_datasheet_share',
  'Envío de ficha técnica',
  'Email transaccional para enviar la ficha técnica de un producto a un cliente o lead. Incluye PDF adjunto y URL pública.',
  'transactional'::app.email_template_kind,
  'Ficha técnica solicitada — {{product_name}}',
  $$<!DOCTYPE html>
<html><body style="font-family:Nunito Sans,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.55;max-width:640px;margin:0 auto;padding:24px;">
  <p>Hola {{customer_name}},</p>
  <p>Te envío adjunta la ficha técnica del producto <strong>{{product_name}}</strong> que solicitaste.</p>
  <p>También puedes consultarla online en este enlace, válido durante los próximos 60 días:</p>
  <p style="margin:24px 0;">
    <a href="{{share_url}}" style="background:#4880FF;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600;">Ver ficha técnica online</a>
  </p>
  <p>Si tienes cualquier duda o quieres más información, respóndeme a este mismo correo o llámame.</p>
  <p>Un saludo,<br><strong>{{user_name}}</strong><br>{{company_name}}</p>
</body></html>$$,
  $$Hola {{customer_name}},

Te envío adjunta la ficha técnica del producto {{product_name}} que solicitaste.

También puedes consultarla online aquí (válido 60 días):
{{share_url}}

Si tienes cualquier duda o quieres más información, respóndeme a este correo o llámame.

Un saludo,
{{user_name}}
{{company_name}}$$,
  array['customer_name','product_name','share_url','user_name','company_name'],
  true,
  true
where not exists (
  select 1 from public.email_templates
   where company_id is null and key = 'product_datasheet_share'
);

-- Catálogo completo: solo URL en el cuerpo (decisión usuario: catálogo entero
-- NO se manda como PDF adjunto para no saturar el email del destinatario).
insert into public.email_templates
  (company_id, key, name, description, kind, subject, body_html, body_text, variables, is_system, is_active)
select
  null,
  'product_catalog_share',
  'Envío de catálogo de productos',
  'Email transaccional para enviar un catálogo de varios productos. Solo URL pública (sin PDF adjunto) para no saturar el correo.',
  'transactional'::app.email_template_kind,
  '{{catalog_name}} — Catálogo de productos',
  $$<!DOCTYPE html>
<html><body style="font-family:Nunito Sans,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.55;max-width:640px;margin:0 auto;padding:24px;">
  <p>Hola {{customer_name}},</p>
  <p>Te comparto el catálogo <strong>{{catalog_name}}</strong> con los productos que te interesaban. Puedes verlo y descargarlo en este enlace:</p>
  <p style="margin:24px 0;">
    <a href="{{share_url}}" style="background:#4880FF;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:600;">Ver catálogo online</a>
  </p>
  <p style="color:#666;font-size:13px;">El enlace estará disponible durante los próximos 60 días.</p>
  <p>Si quieres una propuesta concreta o tienes alguna duda, contesta a este correo o llámame.</p>
  <p>Un saludo,<br><strong>{{user_name}}</strong><br>{{company_name}}</p>
</body></html>$$,
  $$Hola {{customer_name}},

Te comparto el catálogo {{catalog_name}} con los productos que te interesaban. Puedes verlo y descargarlo en este enlace (válido 60 días):

{{share_url}}

Si quieres una propuesta concreta o tienes alguna duda, contesta a este correo o llámame.

Un saludo,
{{user_name}}
{{company_name}}$$,
  array['customer_name','catalog_name','share_url','user_name','company_name'],
  true,
  true
where not exists (
  select 1 from public.email_templates
   where company_id is null and key = 'product_catalog_share'
);

notify pgrst, 'reload schema';
