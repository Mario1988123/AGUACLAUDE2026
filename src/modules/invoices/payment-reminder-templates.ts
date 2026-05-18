// Helpers puros (no "use server") para las plantillas de recordatorio
// de impago. Las server actions en payment-reminder-actions.ts importan
// desde aquí.

export type ReminderLevel = "first" | "second" | "final";

const TEMPLATES: Record<
  ReminderLevel,
  (ctx: { invoice_ref: string; customer_name: string; total_eur: string; due_days: number }) => {
    subject: string;
    body: string;
  }
> = {
  first: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `Recordatorio · Factura ${invoice_ref} pendiente`,
    body:
      `Hola ${customer_name},\n\n` +
      `Le recordamos que la factura ${invoice_ref} por importe de ${total_eur} ` +
      `vence en ${due_days} días.\n\n` +
      `Si ya ha realizado el pago, ignore este mensaje.\n\n` +
      `Quedamos a su disposición para cualquier duda.\n\n` +
      `Un saludo.`,
  }),
  second: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `2º aviso · Factura ${invoice_ref} vencida`,
    body:
      `Estimado/a ${customer_name},\n\n` +
      `La factura ${invoice_ref} por importe de ${total_eur} se encuentra ` +
      `vencida desde hace ${Math.abs(due_days)} días.\n\n` +
      `Le rogamos proceda al pago a la mayor brevedad posible. Si existe ` +
      `algún inconveniente, póngase en contacto con nosotros para acordar ` +
      `una solución.\n\n` +
      `Un saludo.`,
  }),
  final: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `REQUERIMIENTO FORMAL · Factura ${invoice_ref}`,
    body:
      `Sr./Sra. ${customer_name},\n\n` +
      `La factura ${invoice_ref} por importe de ${total_eur} continúa ` +
      `impagada tras ${Math.abs(due_days)} días desde su vencimiento, pese a ` +
      `nuestros avisos previos.\n\n` +
      `Le requerimos formalmente el pago en un plazo máximo de 7 días ` +
      `naturales a contar desde la recepción de esta comunicación. ` +
      `Transcurrido dicho plazo sin recibir el pago, nos veremos en la ` +
      `obligación de iniciar las acciones legales oportunas para la ` +
      `reclamación de la deuda y los gastos derivados.\n\n` +
      `Un saludo cordial.`,
  }),
};

export function getReminderTemplate(input: {
  level: ReminderLevel;
  invoice_ref: string;
  customer_name: string;
  total_cents: number;
  days_overdue: number;
}): { subject: string; body: string } {
  const total_eur = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(input.total_cents / 100);
  return TEMPLATES[input.level]({
    invoice_ref: input.invoice_ref,
    customer_name: input.customer_name,
    total_eur,
    due_days: input.days_overdue,
  });
}
