-- Pregunta a LARA (admin de INFINITY AQUA) en su DASHBOARD: qué filtros llevan
-- las gamas de fuente que no tienen ninguno (2026-11-25). SIN APLICAR.
--
-- Mecanismo: un aviso normal (notifications) con kind 'datos.ayuda_filtros_fuentes'.
-- Con él, el dashboard de Lara pinta la tarjeta «Necesitamos tu ayuda»
-- (src/modules/dashboard/ayuda-datos-card.tsx), que calcula EN VIVO las gamas de
-- fuente sin filtros y enlaza a /productos/<id>?abrir=filtros. Cada gama
-- desaparece al asignarle filtros; cuando no queda ninguna, la tarjeta se va.
-- El aviso sale también en su campana.
--
-- ORDEN: aplicar ANTES supabase/datos/20261126_filtros_fuentes_infinity.sql; si
-- no, la tarjeta también le pedirá Basic S (Compact) e Indic, que se deducen del
-- maestro. Requiere desplegado el código de la tarjeta.
-- Lara: user_id aabd7fbf-585b-4076-bd30-c1d51fde489a (Lara Puigdelmas, company_admin, activa; comprobado 25-11).
-- Idempotente: si ya tiene el aviso abierto, no se crea otro.

begin;

insert into public.notifications
  (company_id, recipient_user_id, kind, category, severity, title, body, action_url)
select
  'f02d586c-0dc6-49e4-83e5-e0f6e688237c',
  'aabd7fbf-585b-4076-bd30-c1d51fde489a',
  'datos.ayuda_filtros_fuentes',
  'alert',
  'info',
  'Necesitamos tu ayuda: filtros de las fuentes',
  'Estas fuentes no tienen filtros asignados y no los hemos podido sacar del catálogo de Osmofilter. '
    || 'Entra en cada una y añade los filtros que se cambian en el mantenimiento (y la membrana si la lleva). '
    || 'Con eso, la carga de la furgoneta sabrá qué llevar a cada visita.',
  '/dashboard'
where exists (
  select 1 from public.user_roles ur
   where ur.user_id = 'aabd7fbf-585b-4076-bd30-c1d51fde489a'
     and ur.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
     and ur.role_key = 'company_admin'
     and ur.revoked_at is null
)
and not exists (
  select 1 from public.notifications n
   where n.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
     and n.recipient_user_id = 'aabd7fbf-585b-4076-bd30-c1d51fde489a'
     and n.kind = 'datos.ayuda_filtros_fuentes'
     and n.acted_at is null
     and n.auto_resolved_at is null
);

commit;

-- Comprobación:
--   select id, title, created_at from notifications
--    where recipient_user_id = 'aabd7fbf-585b-4076-bd30-c1d51fde489a'
--      and kind = 'datos.ayuda_filtros_fuentes';   -- 1 fila
-- Para retirarlo a mano: update notifications set acted_at = now() where id = '<id>';
