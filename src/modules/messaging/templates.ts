/**
 * Plantillas de mensajes para WhatsApp / Email. Variables soportadas:
 * {nombre}, {empresa}, {comercial}, {ref}, {fecha}.
 *
 * No se persisten en BD para evitar tabla nueva — se renderizan en cliente
 * con substitución sencilla. Si en futuro hace falta editor admin, mover a BD.
 */

export interface MessageTemplate {
  key: string;
  label: string;
  channel: "whatsapp" | "email" | "any";
  subject?: string;
  body: string;
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "saludo_inicial",
    label: "Saludo inicial",
    channel: "any",
    subject: "Encantado de saludarle",
    body:
      "Hola {nombre},\n\nSoy {comercial} de {empresa}. Le contacto para presentarle nuestras soluciones de tratamiento de agua.\n\n¿Cuándo le vendría bien que pase a hacerle un análisis de agua sin compromiso?\n\nUn saludo,\n{comercial}",
  },
  {
    key: "recordatorio_cita",
    label: "Recordatorio de cita",
    channel: "whatsapp",
    body:
      "Hola {nombre}, le recuerdo que mañana tenemos cita. ¡Hasta entonces! — {comercial}",
  },
  {
    key: "envio_propuesta",
    label: "Envío propuesta",
    channel: "email",
    subject: "Su propuesta {ref}",
    body:
      "Hola {nombre},\n\nLe adjunto la propuesta {ref} con las condiciones que comentamos.\n\nQuedo a su disposición para cualquier duda.\n\nUn saludo,\n{comercial}\n{empresa}",
  },
  {
    key: "seguimiento_propuesta",
    label: "Seguimiento propuesta",
    channel: "any",
    subject: "¿Pudo ver la propuesta?",
    body:
      "Hola {nombre}, le escribo por si pudo revisar la propuesta {ref} que le envié. ¿Tiene alguna duda? — {comercial}",
  },
  {
    key: "instalacion_confirmada",
    label: "Confirmación instalación",
    channel: "whatsapp",
    body:
      "Hola {nombre}, le confirmamos la instalación para el {fecha}. Pasaremos durante la mañana. ¡Hasta entonces! — {empresa}",
  },
  {
    key: "agradecimiento",
    label: "Agradecimiento tras instalación",
    channel: "any",
    subject: "Gracias por confiar en nosotros",
    body:
      "Hola {nombre},\n\nQuería agradecerle personalmente que haya confiado en {empresa}. Cualquier incidencia con su equipo, no dude en escribirnos.\n\nUn saludo,\n{comercial}",
  },
];

export function renderTemplate(
  template: MessageTemplate,
  vars: { nombre?: string; empresa?: string; comercial?: string; ref?: string; fecha?: string },
): { subject: string | null; body: string } {
  function sub(s: string): string {
    return s
      .replace(/{nombre}/g, vars.nombre ?? "")
      .replace(/{empresa}/g, vars.empresa ?? "")
      .replace(/{comercial}/g, vars.comercial ?? "")
      .replace(/{ref}/g, vars.ref ?? "")
      .replace(/{fecha}/g, vars.fecha ?? new Date().toLocaleDateString("es-ES"));
  }
  return {
    subject: template.subject ? sub(template.subject) : null,
    body: sub(template.body),
  };
}
