-- =============================================================================
-- 20260504100000_contract_install_pref_signatures.sql
-- Añade preferencia horaria de instalación al contrato y soporte completo
-- para firmas digitales (data URL del canvas) en contract_signatures.
-- =============================================================================

alter table public.contracts
  add column if not exists preferred_install_time_slot text
    check (preferred_install_time_slot in ('morning','afternoon','any','custom')),
  add column if not exists preferred_install_time_notes text;

comment on column public.contracts.preferred_install_time_slot is
  'Preferencia del cliente para la instalación: morning / afternoon / any / custom (texto libre en preferred_install_time_notes).';

-- contract_signatures: la firma puede ser data URL (base64 PNG) en vez de
-- ruta a Storage cuando se captura en canvas en el momento. El path queda
-- opcional para retrocompatibilidad.
alter table public.contract_signatures
  alter column signature_image_path drop not null,
  add column if not exists signature_data_url text;

comment on column public.contract_signatures.signature_data_url is
  'Data URL (base64 PNG) de la firma capturada en canvas. Alternativa a signature_image_path cuando no se sube la imagen a Storage.';
