-- =============================================================================
-- Módulo «Captación WhatsApp» — fase 1: esqueleto y conexión.
-- Plan: docs/PLAN_MODULO_CAPTACION_WHATSAPP.md (§2.1, §3.1, §3.7, §4.1, §4.4).
--
-- Solo crea lo que necesita la fase 1:
--   · captacion_conexiones          una por empresa (número de la Cloud API)
--   · captacion_conexion_secretos   token de negocio y PIN, cifrados; solo servicio
--   · captacion_plantillas          copia local de las plantillas de la WABA
--   · captacion_webhook_eventos     todo lo que llega de Meta, para reprocesar y diagnosticar
--   · alta del módulo en modules_catalog (opt-in, apagado por defecto)
--
-- Aditiva e idempotente. Los estados van como text + check, no como enum.
--
-- Escrituras: ninguna política de escritura para `authenticated`. Todo lo que
-- cambia estas tablas pasa por server actions o por el webhook con el cliente
-- de servicio, que comprueban empresa y rol antes. Así un admin no puede, desde
-- PostgREST, poner `estado = 'activa'` a mano ni apuntar su conexión al
-- phone_number_id de otro número para quedarse con sus mensajes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Conexión de WhatsApp (una por empresa)
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_conexiones (
  company_id               uuid primary key references public.companies(id) on delete cascade,
  estado                   text not null default 'pendiente'
                             check (estado in ('pendiente', 'activa', 'suspendida', 'desconectada')),
  waba_id                  text,
  business_id              text,
  phone_number_id          text,
  numero_e164              text,
  nombre_visible           text,
  calidad                  text not null default 'desconocida'
                             check (calidad in ('verde', 'amarilla', 'roja', 'desconocida')),
  limite_diario_meta       integer not null default 250 check (limite_diario_meta >= 0),
  margen_seguridad         integer not null default 25 check (margen_seguridad >= 0),
  negocio_verificado       boolean not null default false,
  envios_activos           boolean not null default false,
  ia_activa                boolean not null default false,
  modelo_ia                text not null default 'claude-sonnet-5-5',
  presentacion_empresa     text,
  temas_prohibidos         text,
  tope_gasto_mensual_cents integer not null default 50000 check (tope_gasto_mensual_cents >= 0),
  retencion_dias           integer not null default 365 check (retencion_dias between 30 and 3650),
  conectada_at             timestamptz,
  conectada_por            uuid references auth.users(id) on delete set null,
  ultimo_webhook_at        timestamptz,
  ultimo_error             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.captacion_conexiones is
  'Número de WhatsApp Cloud API de cada empresa (módulo captacion). Lo escriben solo las server actions y el webhook.';
comment on column public.captacion_conexiones.phone_number_id is
  'Único en toda la plataforma: es lo que usa el webhook para saber de qué empresa es un mensaje.';
comment on column public.captacion_conexiones.envios_activos is
  'Segunda llave del mensaje en frío. Las otras: módulo activo y CAPTACION_ENVIOS_ACTIVOS=1 en Vercel.';

create unique index if not exists captacion_conexiones_phone_number_id_uk
  on public.captacion_conexiones(phone_number_id) where phone_number_id is not null;
create unique index if not exists captacion_conexiones_waba_id_uk
  on public.captacion_conexiones(waba_id) where waba_id is not null;

drop trigger if exists trg_captacion_conexiones_updated on public.captacion_conexiones;
create trigger trg_captacion_conexiones_updated
  before update on public.captacion_conexiones
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2) Secretos de la conexión — tabla aparte: la RLS protege filas, no columnas,
--    y captacion_conexiones la leen los directores.
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_conexion_secretos (
  company_id           uuid primary key references public.captacion_conexiones(company_id) on delete cascade,
  token_cifrado        text,
  token_rotado_at      timestamptz,
  pin_registro_cifrado text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.captacion_conexion_secretos is
  'Token de negocio y PIN de registro, cifrados con encryptSecret() (ENCRYPTION_KEY). Sin políticas: solo el cliente de servicio.';

drop trigger if exists trg_captacion_conexion_secretos_updated on public.captacion_conexion_secretos;
create trigger trg_captacion_conexion_secretos_updated
  before update on public.captacion_conexion_secretos
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3) Plantillas (copia local de las de la WABA)
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_plantillas (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  nombre           text not null,
  idioma           text not null,
  categoria        text not null
                     check (categoria in ('marketing', 'utility', 'authentication')),
  estado           text not null default 'pendiente'
                     check (estado in ('aprobada', 'pendiente', 'rechazada', 'pausada', 'desactivada')),
  estado_meta      text,
  motivo_rechazo   text,
  componentes      jsonb not null default '[]'::jsonb,
  uso              text check (uso in ('primer_contacto', 'recordatorio', 'documento')),
  meta_template_id text,
  sincronizada_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint captacion_plantillas_nombre_idioma_uk unique (company_id, nombre, idioma)
);

comment on column public.captacion_plantillas.estado_meta is
  'Estado tal como lo da Meta (APPROVED, PAUSED, IN_APPEAL…). `estado` es su traducción.';

create index if not exists captacion_plantillas_meta_id_idx
  on public.captacion_plantillas(meta_template_id) where meta_template_id is not null;

drop trigger if exists trg_captacion_plantillas_updated on public.captacion_plantillas;
create trigger trg_captacion_plantillas_updated
  before update on public.captacion_plantillas
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) Registro de webhooks de Meta
-- -----------------------------------------------------------------------------
create table if not exists public.captacion_webhook_eventos (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  phone_number_id text,
  waba_id         text,
  campo           text not null,
  clave_dedupe    text not null,
  cuerpo          jsonb not null,
  recibido_at     timestamptz not null default now(),
  procesado_at    timestamptz,
  error           text,
  intentos        integer not null default 0,
  constraint captacion_webhook_eventos_dedupe_uk unique (clave_dedupe)
);

comment on table public.captacion_webhook_eventos is
  'Un registro por cambio recibido en /api/webhooks/whatsapp. company_id nulo = no se pudo resolver la empresa. Se purga a los 30 días (fase 8).';

create index if not exists captacion_webhook_eventos_pendientes_idx
  on public.captacion_webhook_eventos(recibido_at) where procesado_at is null;
create index if not exists captacion_webhook_eventos_empresa_idx
  on public.captacion_webhook_eventos(company_id, recibido_at desc);

-- -----------------------------------------------------------------------------
-- 5) RLS
-- -----------------------------------------------------------------------------
alter table public.captacion_conexiones        enable row level security;
alter table public.captacion_conexiones        force row level security;
alter table public.captacion_conexion_secretos enable row level security;
alter table public.captacion_conexion_secretos force row level security;
alter table public.captacion_plantillas        enable row level security;
alter table public.captacion_plantillas        force row level security;
alter table public.captacion_webhook_eventos   enable row level security;
alter table public.captacion_webhook_eventos   force row level security;

-- Conexión: superadmin todo; lectura para admin y directores de su empresa.
drop policy if exists captacion_conexiones_super on public.captacion_conexiones;
create policy captacion_conexiones_super on public.captacion_conexiones
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists captacion_conexiones_select on public.captacion_conexiones;
create policy captacion_conexiones_select on public.captacion_conexiones
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('telemarketing_director')
    )
  );

-- Plantillas: mismo criterio de lectura.
drop policy if exists captacion_plantillas_super on public.captacion_plantillas;
create policy captacion_plantillas_super on public.captacion_plantillas
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists captacion_plantillas_select on public.captacion_plantillas;
create policy captacion_plantillas_select on public.captacion_plantillas
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('telemarketing_director')
    )
  );

-- Secretos y eventos: SIN políticas. Además se retiran los permisos de tabla,
-- para que un fallo futuro de RLS (una política añadida por error) no los abra.
revoke all on table public.captacion_conexion_secretos from anon, authenticated;
revoke all on table public.captacion_webhook_eventos   from anon, authenticated;
-- Conexión y plantillas: solo lectura desde la sesión.
revoke insert, update, delete, truncate on table public.captacion_conexiones from anon, authenticated;
revoke insert, update, delete, truncate on table public.captacion_plantillas from anon, authenticated;
revoke all on table public.captacion_conexiones from anon;
revoke all on table public.captacion_plantillas from anon;

-- -----------------------------------------------------------------------------
-- 6) Alta del módulo. OPT-IN: apagado por defecto. Solo lo enciende el
--    superadmin (lleva contrato y coste); /configuracion/modulos no lo ofrece.
-- -----------------------------------------------------------------------------
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order)
values (
  'captacion',
  'Captación WhatsApp',
  'Busca negocios de un tipo en una zona, les escribe por WhatsApp con una plantilla aprobada y dos botones, bloquea para siempre a quien dice que no y pasa a la bolsa común a quien dice que sí. Lo activa Vercomi: tiene coste por mensaje.',
  'message-circle',
  false,
  false,
  false,
  76
)
on conflict (key) do update set
  label_es       = excluded.label_es,
  description_es = excluded.description_es,
  icon           = excluded.icon,
  is_parked      = excluded.is_parked,
  sort_order     = excluded.sort_order;

notify pgrst, 'reload schema';
