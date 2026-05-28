-- =============================================================================
-- 20260620600000_notifications_category.sql
--
-- Separa NOTIFICACIONES en dos categorías:
--   - 'alert' → accionables / urgentes (incidencia, tarea vencida, asignación,
--     stock bajo, antifraude, validación pendiente). Llegan al bell del header.
--   - 'event' → eventos informativos (nuevo lead, contrato firmado, cliente
--     creado, instalación completada). Solo en /notificaciones (pestaña Eventos).
--
-- El bell del header pasa a contar SOLO category='alert' AND read_at IS NULL
-- AND auto_resolved_at IS NULL — los eventos no compiten por la atención.
-- =============================================================================

alter table public.notifications
  add column if not exists category text
    check (category in ('alert','event'))
    default 'event';

-- Backfill: re-clasificar las existentes como 'alert' según su kind
-- (las nuevas filas entrarán con default 'event' y notifier.ts pondrá el correcto)
update public.notifications
set category = 'alert'
where category = 'event'
  and (
    kind in (
      'incident.created',
      'installation.assigned',
      'installation.stock_shortage',
      'installation.geo_off_road',
      'installation.start_far_from_address',
      'installation.late_completion',
      'installation.incident',
      'wallet.pending_validation',
      'agenda.assigned',
      'contract.reassigned',
      'maintenance.customer_postponed',
      'gocardless.payment_exhausted',
      'gocardless.webhook_exhausted'
    )
    or kind like 'time_tracking.%'
    or kind like 'punch_request.%'
    or kind like 'absence.%'
  );

-- Lo demás se queda como 'event' (default)

-- Índice parcial para el polling del bell — solo alertas no leídas no resueltas
create index if not exists idx_notifications_alerts_unread
  on public.notifications(recipient_user_id, created_at desc)
  where category = 'alert' and read_at is null and auto_resolved_at is null;

comment on column public.notifications.category is
  'alert = accionable (bell header) · event = informativo (solo /notificaciones)';

-- =============================================================================
-- Trigger BEFORE INSERT que clasifica automáticamente según kind si la fila
-- entra sin category explícito o con el default 'event' pero su kind es
-- inequívocamente accionable. Duplica la lógica del helper TS categoryOfKind
-- en `src/modules/notifications/category-of-kind.ts` — si tocas uno, toca el
-- otro.
-- =============================================================================
create or replace function public.notifications_set_category()
returns trigger
language plpgsql
as $$
begin
  -- Si vienen con category explícito 'alert' lo respetamos (no degradamos)
  if new.category = 'alert' then
    return new;
  end if;

  -- Patrones por prefijo
  if new.kind like 'time_tracking.%'
     or new.kind like 'punch_request.%'
     or new.kind like 'absence.%'
     or new.kind like 'gocardless.%'
  then
    new.category := 'alert';
    return new;
  end if;

  -- Incidencias: todas alert salvo resolved
  if new.kind like 'incident.%' and new.kind <> 'incident.resolved' then
    new.category := 'alert';
    return new;
  end if;

  -- Lista explícita de alertas accionables
  if new.kind in (
    'installation.assigned',
    'installation.tomorrow',
    'installation.stock_shortage',
    'installation.geo_off_road',
    'installation.start_far_from_address',
    'installation.started_far',
    'installation.late_completion',
    'installation.incident',
    'installation.forgotten',
    'maintenance.tomorrow',
    'maintenance.customer_postponed',
    'wallet.pending_validation',
    'agenda.assigned',
    'agenda.reassigned',
    'agenda.rescheduled',
    'agenda.conflict_warning',
    'contract.reassigned',
    'lead.expired',
    'lead.unassigned_by_expiry',
    'stock.low',
    'verifactu.failed',
    'invoice.legal_action_suggested',
    'invoice.reminder_3_sent',
    'free_trial.expired',
    'gmaps.budget_alert',
    'warehouse.purchase_suggestion'
  ) then
    new.category := 'alert';
    return new;
  end if;

  -- Cualquier otro queda como 'event' (default seguro)
  if new.category is null then
    new.category := 'event';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_set_category_t on public.notifications;
create trigger notifications_set_category_t
  before insert on public.notifications
  for each row execute function public.notifications_set_category();

notify pgrst, 'reload schema';
