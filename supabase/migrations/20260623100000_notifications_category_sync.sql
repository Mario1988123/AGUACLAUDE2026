-- =============================================================================
-- 20260623100000_notifications_category_sync.sql
--
-- Sincroniza el trigger SQL notifications_set_category() con el helper TS
-- categoryOfKind() (src/modules/notifications/category-of-kind.ts).
--
-- Divergencias corregidas (estos kinds eran 'alert' en TS pero el trigger los
-- dejaba caer a 'event' si se insertaban SIN category explícito):
--   · installation.customer_rescheduled  (cliente pidió otra fecha → revisar)
--   · installation.customer_postponed    (cliente pospuso → llamar)
--   · loading_request.partial_delivery   (faltó stock al cargar furgoneta)
--
-- CREATE OR REPLACE: solo redefine la función, conserva el trigger y todo lo
-- demás. No toca datos.
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

  -- Lista explícita de alertas accionables (debe coincidir con categoryOfKind)
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
    'installation.customer_rescheduled',
    'installation.customer_postponed',
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
    'loading_request.partial_delivery',
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

notify pgrst, 'reload schema';
