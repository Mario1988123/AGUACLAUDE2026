-- =============================================================================
-- 20260525160000_parental_8y_kinds.sql
-- Añadir los nuevos tipos de ausencia por la reforma 2026 del permiso parental:
--  - parental_paid_8y    → 2 semanas retribuidas hasta los 8 años del menor
--  - parental_unpaid_8y  → 6 semanas no retribuidas hasta los 8 años
-- Total = 8 semanas (Directiva UE 2019/1158 transpuesta por RD-ley 7/2024).
--
-- El tipo "parental_unpaid" se mantiene para compatibilidad con datos
-- existentes (no se borra; en uso = 0).
-- =============================================================================

do $$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
     where conrelid = 'public.time_absences'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.time_absences drop constraint %I', cname);
  end loop;
end $$;

alter table public.time_absences
  add constraint time_absences_kind_check
  check (kind in (
    'vacation','sick','personal','training','other',
    'paternity','maternity','marriage','bereavement',
    'lactation','parental_unpaid','parental_paid_8y','parental_unpaid_8y',
    'mudanza','civic_duty'
  ));

-- Mismo arreglo para user_leave_budgets
do $$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
     where conrelid = 'public.user_leave_budgets'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.user_leave_budgets drop constraint %I', cname);
  end loop;
end $$;

alter table public.user_leave_budgets
  add constraint user_leave_budgets_kind_check
  check (kind in (
    'vacation','sick','personal','training','other',
    'paternity','maternity','marriage','bereavement',
    'lactation','parental_unpaid','parental_paid_8y','parental_unpaid_8y',
    'mudanza','civic_duty'
  ));

notify pgrst, 'reload schema';
