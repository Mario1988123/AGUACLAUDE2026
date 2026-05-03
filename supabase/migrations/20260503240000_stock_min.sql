-- =============================================================================
-- 20260503240000_stock_min.sql
-- Stock mínimo por (warehouse, product). Cuando el stock cae por debajo
-- del umbral, se notifica al admin.
-- =============================================================================

alter table public.warehouse_stock
  add column if not exists min_quantity integer not null default 0;

create or replace function app.notify_stock_low() returns trigger as $$
declare
  admin_id uuid;
  prod_name text;
  wh_name text;
begin
  if new.min_quantity <= 0 then return new; end if;
  if new.quantity >= new.min_quantity then return new; end if;
  -- Solo dispara si cruzamos hacia abajo (antes >=, ahora <)
  if tg_op = 'UPDATE' and old.quantity < old.min_quantity then return new; end if;

  select name into prod_name from public.products where id = new.product_id;
  select name into wh_name from public.warehouses where id = new.warehouse_id;

  for admin_id in
    select user_id from public.user_roles
     where company_id = new.company_id
       and role_key in ('company_admin','technical_director')
       and revoked_at is null
  loop
    insert into public.notifications (
      company_id, recipient_user_id, kind, severity, title, body
    ) values (
      new.company_id, admin_id, 'stock_low', 'warning',
      '⚠ Stock bajo',
      format('%s en %s: %s unidades (mínimo %s)',
        coalesce(prod_name,'Producto'),
        coalesce(wh_name,'almacén'),
        new.quantity, new.min_quantity)
    );
  end loop;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_stock_low on public.warehouse_stock;
create trigger trg_stock_low
  after insert or update on public.warehouse_stock
  for each row execute function app.notify_stock_low();
