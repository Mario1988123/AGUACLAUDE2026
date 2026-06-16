-- =============================================================================
-- Flujo "Borrar cliente" (decisión 2026-06-16) — PARTE 2 de 2: columnas
-- =============================================================================
-- Todo aditivo + idempotente (if not exists). No borra ni reemplaza nada.
-- El valor de enum 'customer_churned' se añadió en 20260627100000 (separado
-- por la limitación de Postgres con enums recién creados).
-- =============================================================================

-- 1) Vincular una venta perdida a un CLIENTE (además de lead / free_trial).
--    on delete set null: si algún día se borra físicamente el cliente, la
--    fila de venta perdida sobrevive para estadística (queda sin customer_id).
alter table public.lost_sales
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists idx_ls_customer
  on public.lost_sales(customer_id) where customer_id is not null;

-- 2) Marcadores de "cliente perdido" (churn) en customers. NO es un borrado:
--    el cliente sigue existiendo (sabemos que tiene equipo nuestro instalado).
--    El borrado definitivo se hace luego desde /ventas-perdidas (anonimiza).
--      churn_type: 'sold_no_relation' (compró el equipo y corta relación)
--                | 'removed'          (alquiler/renting: se le retira la máquina)
alter table public.customers add column if not exists churned_at   timestamptz;
alter table public.customers add column if not exists churn_type   text;
alter table public.customers add column if not exists churn_reason text;

-- 3) Motivo de borrado RGPD. El código de borrado (rgpd-actions) ya intentaba
--    escribir esta columna de forma defensiva; la creamos para que el motivo
--    quede registrado de verdad.
alter table public.customers add column if not exists deleted_reason text;
