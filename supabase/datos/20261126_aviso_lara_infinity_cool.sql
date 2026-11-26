-- Pregunta a Lara (admin de Infinity), pedida por Mario el 26-11: ¿a qué modelo de Corsa corresponde «Infinity Cool»?
insert into public.notifications
  (company_id, recipient_user_id, kind, category, severity, title, body, action_url)
select
  'f02d586c-0dc6-49e4-83e5-e0f6e688237c',
  'aabd7fbf-585b-4076-bd30-c1d51fde489a',
  'datos.pregunta_infinity_cool',
  'alert',
  'info',
  'Pregunta: ¿qué equipo de Corsa es el «Infinity Cool»?',
  'Vamos a enganchar tus productos al catálogo de Corsa. El «Infinity Cool» (ref. Corsa A-253405) no aparece en el '
    || 'catálogo actual de Corsa. ¿Es el Nertus Direct, el Sindu u otro? Contéstaselo a Mario o escríbelo en la '
    || 'descripción del producto.',
  '/productos/c9662a6e-1c8f-4063-95c3-8d3c1d8c17ac'
where exists (
  select 1 from public.user_roles ur
   where ur.user_id = 'aabd7fbf-585b-4076-bd30-c1d51fde489a'
     and ur.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
     and ur.role_key = 'company_admin' and ur.revoked_at is null)
and not exists (
  select 1 from public.notifications n
   where n.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
     and n.recipient_user_id = 'aabd7fbf-585b-4076-bd30-c1d51fde489a'
     and n.kind = 'datos.pregunta_infinity_cool' and n.acted_at is null);
