-- =============================================================================
-- 20260702200000_error_reports_auto_capture.sql
-- Captura AUTOMÁTICA de errores (toasts) + agrupado de repetidos.
--
-- Hasta ahora error_reports solo guardaba reportes que el usuario escribía a
-- mano. Ahora también guardará, en silencio, cada aviso de error (toast) que
-- salta en la app, para que el superadmin identifique qué falla y con qué
-- frecuencia.
--
-- Columnas nuevas:
--   · source        → 'manual' (lo escribe el usuario) | 'auto_toast'
--                     (capturado solo al saltar notify.error)
--   · fingerprint   → "huella" para agrupar errores iguales (mensaje + ruta
--                     normalizados: se quitan números/ids variables)
--   · occurrences   → nº de veces que se ha visto ese mismo error
--   · last_seen_at  → última vez que se vio
--
-- Idempotente, aditivo. No toca datos existentes (source por defecto 'manual').
-- =============================================================================

alter table public.error_reports
  add column if not exists source text not null default 'manual';

-- El CHECK se añade aparte para que sea idempotente aunque la columna ya exista.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'error_reports_source_check'
  ) then
    alter table public.error_reports
      add constraint error_reports_source_check
      check (source in ('manual','auto_toast'));
  end if;
end $$;

alter table public.error_reports
  add column if not exists fingerprint text;
alter table public.error_reports
  add column if not exists occurrences integer not null default 1;
alter table public.error_reports
  add column if not exists last_seen_at timestamptz;

-- Dedup: una sola fila ABIERTA por (empresa, huella) para errores automáticos.
-- Solo aplica a auto_toast en estados abiertos. Los resueltos/cerrados quedan
-- como histórico; si el error vuelve tras cerrarse, abre fila nueva.
create unique index if not exists uniq_error_reports_auto_fingerprint
  on public.error_reports(company_id, fingerprint)
  where source = 'auto_toast' and status in ('new','triaged','in_progress');

-- Filtro/orden por origen en el panel del superadmin.
create index if not exists idx_err_source
  on public.error_reports(source, created_at desc);

notify pgrst, 'reload schema';
