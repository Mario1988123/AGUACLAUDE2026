-- =============================================================================
-- 20260503270000_email_outbox.sql
-- Cola outbox de emails pendientes. La app inserta filas con send_at futuro
-- y un proveedor (Resend, SendGrid…) las consume cuando el usuario lo
-- configure. Hasta entonces, queda como histórico de "lo que tocaría enviar".
-- =============================================================================

create table if not exists public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  to_email        text not null,
  to_name         text,
  subject         text not null,
  body_text       text,
  body_html       text,
  /** "maintenance_reminder" | "contract_signed" | … */
  kind            text not null,
  /** Cuándo enviar */
  send_at         timestamptz not null default now(),
  /** Cuándo se envió de verdad (null = pendiente) */
  sent_at         timestamptz,
  /** Resultado del envío */
  status          text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  error           text,
  /** Vínculo opcional al subject que originó el email */
  subject_type    text,
  subject_id      uuid,
  created_at      timestamptz not null default now()
);

create index if not exists idx_email_outbox_pending
  on public.email_outbox(status, send_at)
  where status = 'pending';
create index if not exists idx_email_outbox_company
  on public.email_outbox(company_id, created_at desc);
