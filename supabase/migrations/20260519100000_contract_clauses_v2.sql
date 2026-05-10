-- =============================================================================
-- 20260519100000_contract_clauses_v2.sql
-- Set ampliado de cláusulas tipo para los 3 planes (cash/rental/renting).
-- IDEMPOTENTE: solo añade cláusulas que no existan ya por (company, plan, title).
-- Las cláusulas que el usuario haya editado quedan intactas.
-- =============================================================================

create or replace function app.seed_default_clauses_v2(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_clauses jsonb := jsonb_build_array(
    -- ============= CASH (VENTA AL CONTADO) =============
    jsonb_build_object('plan', 'cash', 'order', 10, 'title', 'Objeto del contrato',
      'body', 'La Empresa vende y el Cliente compra los equipos descritos en el apartado de productos, con las prestaciones técnicas indicadas por el fabricante.'),
    jsonb_build_object('plan', 'cash', 'order', 20, 'title', 'Precio y forma de pago',
      'body', 'El precio total es el indicado en el plan de pagos. Se abona en los plazos y métodos detallados en este contrato. La falta de pago puede llevar aparejada la suspensión del servicio post-venta.'),
    jsonb_build_object('plan', 'cash', 'order', 30, 'title', 'Garantía',
      'body', 'Los equipos incluyen la garantía legal de fabricante (2 años) desde la fecha de instalación. La garantía cubre defectos de fabricación y NO cubre roturas por mal uso, manipulación por terceros, ni daños por instalación inadecuada de toma de agua.'),
    jsonb_build_object('plan', 'cash', 'order', 40, 'title', 'Instalación',
      'body', 'La Empresa realiza la instalación en la dirección indicada, en la franja horaria acordada. El Cliente garantiza acceso al punto de instalación, toma de agua y desagüe operativos, y enchufe disponible.'),
    jsonb_build_object('plan', 'cash', 'order', 50, 'title', 'Mantenimiento',
      'body', 'Si se ha contratado mantenimiento incluido, la Empresa realizará las visitas preventivas según la periodicidad y plazo indicados. En caso contrario, los mantenimientos se facturan aparte conforme tarifa vigente.'),
    jsonb_build_object('plan', 'cash', 'order', 60, 'title', 'Desistimiento',
      'body', 'El consumidor puede desistir del contrato en 14 días naturales desde la firma SIN necesidad de justificación, salvo que el equipo ya haya sido instalado. Para ejercer el derecho debe notificarlo por escrito. La devolución íntegra se realizará en 14 días.'),
    jsonb_build_object('plan', 'cash', 'order', 70, 'title', 'Protección de datos',
      'body', 'Los datos personales se tratan conforme al RGPD (UE 2016/679) y la LOPDGDD (LO 3/2018). Finalidad: ejecución del contrato, facturación y atención post-venta. Derechos ARCO en hola@empresa.es. Responsable: la Empresa.'),
    jsonb_build_object('plan', 'cash', 'order', 80, 'title', 'Jurisdicción',
      'body', 'Para cualquier controversia derivada del contrato las partes se someten a los Juzgados y Tribunales del domicilio del Cliente conforme al art. 52.2 LEC.'),

    -- ============= RENTAL (ALQUILER MENSUAL) =============
    jsonb_build_object('plan', 'rental', 'order', 10, 'title', 'Objeto del contrato',
      'body', 'La Empresa cede en alquiler al Cliente el uso de los equipos descritos, mediante pago de cuota mensual. La propiedad del equipo es y permanece de la Empresa.'),
    jsonb_build_object('plan', 'rental', 'order', 20, 'title', 'Cuota mensual',
      'body', 'La cuota mensual se cobrará por domiciliación bancaria en el IBAN facilitado, el primer día de cada mes. Incluye uso del equipo, mantenimientos preventivos y reposición de consumibles según plan.'),
    jsonb_build_object('plan', 'rental', 'order', 30, 'title', 'Permanencia y rescisión anticipada',
      'body', 'El contrato tiene un compromiso de permanencia mínimo igual a la duración indicada. La rescisión anticipada por parte del Cliente conlleva el pago del 50% de las cuotas restantes hasta el fin del compromiso, en concepto de penalización.'),
    jsonb_build_object('plan', 'rental', 'order', 40, 'title', 'Propiedad y custodia del equipo',
      'body', 'El equipo es propiedad de la Empresa. El Cliente actúa como depositario y debe custodiarlo con la diligencia debida. Los daños imputables a mal uso, manipulación por terceros o rotura no derivada del desgaste normal son responsabilidad del Cliente, quien deberá abonar el coste de reparación o reposición.'),
    jsonb_build_object('plan', 'rental', 'order', 50, 'title', 'Mantenimiento e incidencias',
      'body', 'La Empresa realizará mantenimientos preventivos en la periodicidad pactada e incidencias técnicas en los plazos del SLA según gravedad. El Cliente notificará incidencias a través de los canales habilitados (web, teléfono, WhatsApp).'),
    jsonb_build_object('plan', 'rental', 'order', 60, 'title', 'Impagos',
      'body', 'El impago de una cuota genera intereses de demora al tipo legal vigente. Dos impagos consecutivos o tres alternos en 12 meses facultan a la Empresa a resolver el contrato y proceder a la retirada del equipo, sin perjuicio de la reclamación de las cantidades adeudadas.'),
    jsonb_build_object('plan', 'rental', 'order', 70, 'title', 'Devolución del equipo',
      'body', 'A la terminación del contrato (por finalización, rescisión o resolución), el Cliente debe facilitar el acceso para la retirada del equipo en un plazo de 15 días. La negativa o demora injustificada faculta a la Empresa a facturar penalización por uso no autorizado.'),
    jsonb_build_object('plan', 'rental', 'order', 80, 'title', 'Cesión',
      'body', 'El Cliente NO puede ceder el uso del equipo a terceros, ni trasladarlo a otra dirección sin autorización previa por escrito de la Empresa.'),
    jsonb_build_object('plan', 'rental', 'order', 90, 'title', 'Protección de datos',
      'body', 'Los datos personales se tratan conforme al RGPD y LOPDGDD. Finalidad: ejecución del contrato de alquiler, facturación periódica y atención técnica. Conservación durante la vigencia del contrato y plazos legales posteriores. Derechos ARCO en hola@empresa.es.'),
    jsonb_build_object('plan', 'rental', 'order', 100, 'title', 'Jurisdicción',
      'body', 'Para cualquier controversia las partes se someten a los Juzgados y Tribunales del domicilio del Cliente.'),

    -- ============= RENTING (FINANCIACIÓN A LARGO PLAZO) =============
    jsonb_build_object('plan', 'renting', 'order', 10, 'title', 'Naturaleza del contrato',
      'body', 'El presente documento es ANEXO al contrato de renting suscrito con la entidad financiera indicada. La cuota mensual de renting se abona directamente a la entidad financiera. La Empresa actúa como proveedor del equipo y prestador del servicio técnico.'),
    jsonb_build_object('plan', 'renting', 'order', 20, 'title', 'Servicio técnico de la Empresa',
      'body', 'Durante toda la vigencia del renting, la Empresa garantiza: instalación, mantenimientos preventivos según plan, consumibles incluidos, asistencia técnica ante incidencias, y reposición o sustitución del equipo si procede.'),
    jsonb_build_object('plan', 'renting', 'order', 30, 'title', 'Permanencia',
      'body', 'El renting tiene la duración indicada por la financiera. La rescisión anticipada se rige por las condiciones del contrato de renting suscrito con la entidad financiera, NO por este anexo.'),
    jsonb_build_object('plan', 'renting', 'order', 40, 'title', 'Custodia del equipo',
      'body', 'El equipo es propiedad de la entidad financiera durante el renting. El Cliente actúa como depositario y debe custodiarlo con diligencia. Los daños por mal uso son responsabilidad del Cliente.'),
    jsonb_build_object('plan', 'renting', 'order', 50, 'title', 'Opción de compra',
      'body', 'La opción de compra al final del renting (si existe) se ejerce directamente con la entidad financiera, según las condiciones que ésta fije. La Empresa no participa en la gestión de la opción de compra.'),
    jsonb_build_object('plan', 'renting', 'order', 60, 'title', 'Devolución',
      'body', 'A la finalización del renting, salvo ejercicio de opción de compra con la financiera, el equipo debe devolverse en buen estado de conservación, descontando el desgaste por uso normal.'),
    jsonb_build_object('plan', 'renting', 'order', 70, 'title', 'Protección de datos',
      'body', 'Los datos personales se tratan conforme al RGPD y LOPDGDD. La Empresa puede comunicar datos del equipo y del servicio a la entidad financiera para la ejecución del renting.'),
    jsonb_build_object('plan', 'renting', 'order', 80, 'title', 'Jurisdicción',
      'body', 'Para controversias derivadas del servicio prestado por la Empresa: Juzgados del domicilio del Cliente. Para controversias del renting (cuota, financiación, opción de compra): las que rigen el contrato de renting con la financiera.')
  );
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_clauses)
  loop
    -- Solo insertar si no existe ya una cláusula con mismo (company, plan, title)
    if not exists (
      select 1 from public.contract_clause_templates
      where company_id = p_company_id
        and plan_type = (v_item->>'plan')::app.pricing_plan_type
        and title = v_item->>'title'
    ) then
      insert into public.contract_clause_templates (
        company_id, plan_type, title, body, display_order
      ) values (
        p_company_id,
        (v_item->>'plan')::app.pricing_plan_type,
        v_item->>'title',
        v_item->>'body',
        (v_item->>'order')::int
      );
    end if;
  end loop;
end;
$$;

grant execute on function app.seed_default_clauses_v2(uuid) to authenticated;

-- Backfill: ejecutar para todas las empresas existentes
do $$
declare c record;
begin
  for c in select id from public.companies where cancelled_at is null loop
    perform app.seed_default_clauses_v2(c.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
