-- =============================================================================
-- 20260525220000_parental_continuation_and_notif_resolve.sql
-- 1. Sexo del hijo (no del empleado): la madre biológica suele pedir
--    maternidad y el padre/pareja paternidad, pero el sistema sólo
--    necesita la fecha de nacimiento para las 6 semanas obligatorias.
--    Aún así, guardamos sex='M'|'F'|'X' para que admin gestione.
-- 2. time_absences.child_id: vincular ausencia parental a hijo concreto.
--    Esto permite que mater/paternidad de 16 semanas se reparta en
--    DOS cursos (6 obligatorias post-parto + 10 flex hasta 12 meses
--    del bebé) y el sistema sume correctamente.
-- 3. notifications.auto_resolved_at: marcar notificaciones cuando se
--    resuelve la entidad subject (ej. incidencia cerrada). Si no han
--    sido leídas, desaparecen del centro.
-- =============================================================================

alter table public.employee_children
  add column if not exists sex text check (sex in ('M','F','X'));

alter table public.time_absences
  add column if not exists child_id uuid references public.employee_children(id) on delete set null;
create index if not exists idx_time_absences_child on public.time_absences(child_id)
  where child_id is not null;

alter table public.notifications
  add column if not exists auto_resolved_at timestamptz,
  add column if not exists resolved_reason text;
create index if not exists idx_notifications_unread_subject
  on public.notifications(subject_type, subject_id, recipient_user_id)
  where read_at is null and auto_resolved_at is null;

notify pgrst, 'reload schema';
