-- =============================================================================
-- 20260627100000_notifications_respect_explicit_event.sql
--
-- Fix: el trigger notifications_set_category() pisaba el `category = 'event'`
-- explícito. Si un insert llegaba con category='event' pero su kind estaba en la
-- lista (o patrón) de alertas, el trigger lo degradaba/promovía a 'alert',
-- ignorando la intención explícita del emisor.
--
-- Esta migración es ADITIVA: usa CREATE OR REPLACE para redefinir SOLO la
-- función. Conserva el trigger, la tabla y todo lo demás. No toca datos ni la
-- migración anterior (20260623100000_notifications_category_sync.sql).
--
-- Cambio: además de respetar el 'alert' explícito, ahora también respetamos el
-- 'event' explícito (return NEW antes de aplicar la lista de alertas). El resto
-- de la clasificación por defecto (cuando NO se pasa category) queda intacta y
-- alineada con categoryOfKind() de TS.
-- =============================================================================

create or replace function public.notifications_set_category()
returns trigger
language plpgsql
as $$
begin
  -- Respetamos cualquier category explícita ('alert' o 'event'): el emisor
  -- decide. La clasificación automática es solo un default cuando no se indica.
  if new.category = 'alert' then
    return new;
  end if;
  if new.category = 'event' then
    return new;
  end if;

  -- A partir de aquí new.category es NULL → clasificamos por defecto.

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
