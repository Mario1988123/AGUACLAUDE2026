/**
 * Variables de muestra para previsualizar/enviar plantillas de prueba sin
 * datos reales. Centralizado para que el preview, el editor y el test-send
 * usen exactamente el mismo juego de datos.
 */
export function getSampleVars(
  overrides?: Record<string, string | number>,
): Record<string, string | number> {
  return {
    // Cliente
    customer_first_name: "Mario",
    customer_name: "Mario Ortigueira",
    customer_address: "Avenida de la Paz 14, 28012 Madrid",
    customer_email: "mario.ortigueira@gmail.com",
    customer_phone: "612 345 678",
    // Empresa
    company_name: "Hidromanager Demo SL",
    company_email: "info@hidromanager.es",
    company_phone: "900 100 200",
    // Cita / instalación / mantenimiento
    appointment_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
    appointment_time: "10:00",
    technician_name: "Juan García",
    technician_phone: "612 000 111",
    equipment_name: "Ósmosis AquaPro 5",
    equipment_summary: "Ósmosis AquaPro 5 + descalcificador",
    service_name: "Cambio de filtros",
    next_visit_date: new Date(Date.now() + 21 * 86400_000).toISOString(),
    months_since_install: 8,
    // Propuesta
    proposal_reference: "PROP-2026-0042",
    proposal_total: 89000, // 890 €
    proposal_validity: new Date(Date.now() + 30 * 86400_000).toISOString(),
    // Contrato
    contract_reference: "CTR-2026-0042",
    contract_ref: "CTR-2026-0042",
    sign_url: "https://crm.example.com/firmar-contrato/abc123xyz",
    days_to_expire: 14,
    // Factura
    invoice_reference: "F2026/0042",
    invoice_date: new Date().toISOString(),
    invoice_total: 12500, // 125 €
    invoice_due: new Date(Date.now() + 30 * 86400_000).toISOString(),
    // Confirmación pública (mantenimiento/instalación)
    confirm_url: "https://crm.example.com/m/abc123xyz",
    // Marketing
    discount_pct: 10,
    discount_code: "VUELVE10",
    price: 4900,
    month_name: "junio",
    tip_of_month: "Limpia el aireador del grifo una vez al mes.",
    news_content: "Hemos ampliado el horario de atención los sábados.",
    promo_content: "Descalcificador con 10% este mes.",
    promo_deadline: new Date(Date.now() + 20 * 86400_000).toISOString(),
    ...overrides,
  };
}
