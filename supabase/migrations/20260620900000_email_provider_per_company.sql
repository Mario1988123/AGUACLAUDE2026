-- =============================================================================
-- 20260620900000_email_provider_per_company.sql
-- Híbrido SMTP + Resend: cada empresa elige proveedor de email. El superadmin
-- decide qué empresas usan Resend (cuenta única de plataforma). Por defecto
-- 'smtp' → comportamiento actual sin cambios. Espejo de companies.gmaps_mode.
--
-- La config de dominio Resend (resend_domain_id, estado, DNS records) se guarda
-- en company_settings.extra->'email_resend' (jsonb, sin columnas nuevas).
-- El tracking reutiliza email_sends.resend_id + columnas opened_at/clicks_count.
-- =============================================================================

alter table public.companies
  add column if not exists email_provider text not null default 'smtp'
    check (email_provider in ('smtp', 'resend'));

comment on column public.companies.email_provider is
  'Proveedor de email de la empresa: smtp (propio, por defecto) o resend (cuenta de plataforma, requiere dominio verificado). Lo togglea el superadmin.';
