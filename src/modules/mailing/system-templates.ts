/**
 * Plantillas pre-creadas del sistema. Se siembran en BD la primera vez
 * que la empresa abre /configuracion/mailing.
 *
 * Tono: cercano, en español. Variables tipo {{customer_name}}.
 * El admin puede personalizarlas (al duplicarlas se crean como custom).
 */

export interface SystemTemplate {
  key: string;
  name: string;
  description: string;
  kind: "transactional" | "marketing";
  subject: string;
  body_html: string;
  variables: string[];
}

const TEMPLATES: SystemTemplate[] = [
  // ===========================================================================
  // TRANSACCIONALES (sin opt-out)
  // ===========================================================================
  {
    key: "appointment_confirmation",
    name: "Confirmación de cita",
    description: "Cuando se programa una visita o instalación.",
    kind: "transactional",
    subject: "Tu cita con {{company_name}} está confirmada",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Hola {{customer_first_name}}!</h2>
      <p>Te confirmamos que tu cita está agendada:</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f5f9ff; border-radius: 8px; padding: 16px; margin: 16px 0; width: 100%;">
        <tr>
          <td style="padding: 12px 16px;">
            <strong>📅 Fecha:</strong> {{appointment_date|date}}<br>
            <strong>🕐 Hora:</strong> {{appointment_time}}<br>
            <strong>📍 Dirección:</strong> {{customer_address}}<br>
            <strong>👷 Técnico:</strong> {{technician_name}}
          </td>
        </tr>
      </table>
      <p>Si necesitas cambiar la fecha o la hora, contesta a este mismo email o llámanos al teléfono de abajo.</p>
      <p>¡Hasta pronto!</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "appointment_date",
      "appointment_time",
      "customer_address",
      "technician_name",
    ],
  },
  {
    key: "proposal_sent",
    name: "Envío de propuesta",
    description: "Adjunta la propuesta PDF al cliente.",
    kind: "transactional",
    subject: "Tu propuesta {{proposal_reference}} está lista",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}},</h2>
      <p>Te adjunto la propuesta personalizada que hemos preparado para ti.</p>
      <p style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 16px 0;">
        <strong>Referencia:</strong> {{proposal_reference}}<br>
        <strong>Total:</strong> {{proposal_total|money}}<br>
        <strong>Válida hasta:</strong> {{proposal_validity|date}}
      </p>
      <p>Tómate el tiempo que necesites para revisarla. Cualquier duda, escríbeme o llámame y la repasamos juntos.</p>
      <p>Gracias por confiar en nosotros.</p>
    `,
    variables: [
      "customer_first_name",
      "proposal_reference",
      "proposal_total",
      "proposal_validity",
    ],
  },
  {
    key: "contract_signed",
    name: "Bienvenida tras firma de contrato",
    description: "Confirmación + próximos pasos cuando se firma el contrato.",
    kind: "transactional",
    subject: "¡Bienvenido/a a {{company_name}}!",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Bienvenido/a a la familia, {{customer_first_name}}!</h2>
      <p>Acabas de firmar tu contrato con nosotros y queremos darte la bienvenida.</p>
      <p style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 12px 16px; margin: 16px 0;">
        <strong>Contrato:</strong> {{contract_reference}}<br>
        <strong>Tu equipo:</strong> {{equipment_summary}}
      </p>
      <p><strong>¿Qué pasa ahora?</strong></p>
      <ul>
        <li>Te llamaremos para concretar el día de la instalación.</li>
        <li>El día de la instalación recibirás un recordatorio por email.</li>
        <li>Después de instalar, tu equipo arranca y empezamos con los mantenimientos programados.</li>
      </ul>
      <p>Si tienes cualquier duda mientras tanto, este es nuestro canal directo.</p>
    `,
    variables: ["customer_first_name", "company_name", "contract_reference", "equipment_summary"],
  },
  {
    key: "invoice_sent",
    name: "Envío de factura",
    description: "Adjunta la factura PDF con QR Verifactu.",
    kind: "transactional",
    subject: "Factura {{invoice_reference}} de {{company_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}},</h2>
      <p>Te adjunto tu factura.</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f5f5f7; border-radius: 8px; padding: 16px; margin: 16px 0; width: 100%;">
        <tr>
          <td style="padding: 12px 16px;">
            <strong>Número:</strong> {{invoice_reference}}<br>
            <strong>Fecha:</strong> {{invoice_date|date}}<br>
            <strong>Importe total:</strong> {{invoice_total|money}}<br>
            <strong>Vencimiento:</strong> {{invoice_due|date}}
          </td>
        </tr>
      </table>
      <p>Si pagas por transferencia, encontrarás el IBAN en la propia factura.</p>
      <p>Cualquier duda con la factura, contesta a este email.</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "invoice_reference",
      "invoice_date",
      "invoice_total",
      "invoice_due",
    ],
  },
  {
    key: "maintenance_reminder",
    name: "Recordatorio de mantenimiento",
    description: "Aviso al cliente del próximo cambio de filtros.",
    kind: "transactional",
    subject: "🔔 Recordatorio: cambio de filtros próximo",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}},</h2>
      <p>Tu equipo <strong>{{equipment_name}}</strong> necesita un cambio de filtros próximamente.</p>
      <p style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px 16px; margin: 16px 0;">
        <strong>Próxima visita prevista:</strong> {{next_visit_date|date}}<br>
        <strong>Servicio:</strong> {{service_name}}
      </p>
      <p>En los próximos días te llamaremos para concretar el día y la hora.</p>
      <p>Si prefieres adelantar la visita o tienes otra incidencia, contesta a este email.</p>
    `,
    variables: [
      "customer_first_name",
      "equipment_name",
      "next_visit_date",
      "service_name",
    ],
  },
  {
    key: "installation_reminder",
    name: "Recordatorio víspera de instalación",
    description: "Email automático el día anterior con datos de la cita.",
    kind: "transactional",
    subject: "Mañana te instalamos tu equipo de {{company_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Hola {{customer_first_name}}!</h2>
      <p>Solo recordarte que <strong>mañana {{appointment_date|date}}</strong> tienes la instalación.</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f5f9ff; border-radius: 8px; padding: 16px; margin: 16px 0; width: 100%;">
        <tr>
          <td style="padding: 12px 16px;">
            <strong>🕐 Hora prevista:</strong> {{appointment_time}}<br>
            <strong>📍 Dirección:</strong> {{customer_address}}<br>
            <strong>👷 Técnico:</strong> {{technician_name}} ({{technician_phone}})
          </td>
        </tr>
      </table>
      <p><strong>Recuerda:</strong></p>
      <ul>
        <li>Necesitamos acceso al punto de agua (cocina o donde se instale).</li>
        <li>Despeja la zona unos minutos antes para que el técnico pueda trabajar.</li>
        <li>Si surge algo y no puedes estar en casa, avísanos lo antes posible.</li>
      </ul>
      <p>¡Hasta mañana!</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "appointment_date",
      "appointment_time",
      "customer_address",
      "technician_name",
      "technician_phone",
    ],
  },

  // ===========================================================================
  // MARKETING (con opt-out)
  // ===========================================================================
  {
    key: "winback_lost_sale",
    name: "Recuperación de venta perdida",
    description: "Email para clientes que rechazaron la propuesta hace 6+ meses.",
    kind: "marketing",
    subject: "{{customer_first_name}}, ¿hablamos otra vez? 💧",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}},</h2>
      <p>Hace tiempo que estuvimos en contacto sobre el tratamiento del agua de tu casa, y queríamos ponernos al día.</p>
      <p>Desde entonces hemos mejorado un montón:</p>
      <ul>
        <li>✅ Equipos más silenciosos y compactos.</li>
        <li>✅ Plan de mantenimiento incluido en la cuota.</li>
        <li>✅ Garantía ampliada.</li>
      </ul>
      <p style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 14px 16px; margin: 16px 0;">
        🎁 Si vuelves con nosotros este mes te aplicamos un <strong>{{discount_pct}}% de descuento</strong> sobre la instalación.
      </p>
      <p>Si te apetece que te lo cuente sin compromiso, responde a este email o llámame al teléfono de abajo.</p>
      <p>¡Un saludo!</p>
    `,
    variables: ["customer_first_name", "discount_pct"],
  },
  {
    key: "newsletter_monthly",
    name: "Newsletter mensual",
    description: "Email mensual con tips de agua + novedades de la empresa.",
    kind: "marketing",
    subject: "💧 Lo último en agua del mes — {{month_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Hola {{customer_first_name}}!</h2>
      <p>Te traemos el resumen mensual con todo lo importante sobre el agua de tu casa:</p>

      <h3 style="margin: 24px 0 8px 0; color: #4880FF;">💡 Tip del mes</h3>
      <p>{{tip_of_month}}</p>

      <h3 style="margin: 24px 0 8px 0; color: #4880FF;">📰 Novedades</h3>
      <p>{{news_content}}</p>

      <h3 style="margin: 24px 0 8px 0; color: #4880FF;">🎁 Promo del mes</h3>
      <p>{{promo_content}}</p>

      <p style="margin-top: 24px;">¿Tienes una duda concreta? Escríbenos a este email y te respondemos.</p>
    `,
    variables: [
      "customer_first_name",
      "month_name",
      "tip_of_month",
      "news_content",
      "promo_content",
    ],
  },
  {
    key: "summer_promo",
    name: "Promoción verano",
    description: "Campaña estacional de descalcificadores en zonas duras.",
    kind: "marketing",
    subject: "☀ Llega el verano — protege tu agua del calor",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">{{customer_first_name}}, llega el calor 🌞</h2>
      <p>El agua dura del verano puede dañar tu lavadora, lavavajillas y caldera. Por eso este mes tenemos una oferta especial:</p>
      <p style="background: linear-gradient(135deg, #4880FF, #6ea3ff); color: white; padding: 24px; border-radius: 12px; text-align: center; margin: 24px 0; font-size: 18px;">
        🎁 <strong>{{discount_pct}}% de descuento</strong><br>
        en descalcificadores domésticos
      </p>
      <p>Instalación incluida + 6 meses de mantenimiento gratis.</p>
      <p>Promoción válida hasta <strong>{{promo_deadline|date}}</strong>.</p>
      <p>Responde a este email si quieres que te lo cuente o que pase a verte sin compromiso.</p>
    `,
    variables: ["customer_first_name", "discount_pct", "promo_deadline"],
  },
  {
    key: "anniversary",
    name: "Aniversario de cliente",
    description: "Felicitación al cumplirse un año del contrato.",
    kind: "marketing",
    subject: "🎉 Hace un año que confiaste en nosotros, {{customer_first_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Feliz aniversario, {{customer_first_name}}!</h2>
      <p>Hace exactamente un año que firmaste con nosotros tu equipo {{equipment_name}}. Queríamos darte las gracias por confiar en {{company_name}} todo este tiempo.</p>
      <p>De regalo, una bonificación que puedes usar tú o pasársela a un amigo:</p>
      <p style="background: #f3e5f5; border: 2px dashed #9c27b0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 12px;">
        <span style="font-size: 12px; color: #888;">Código de descuento</span><br>
        <strong style="font-size: 24px; color: #6a1b9a; letter-spacing: 2px;">{{discount_code}}</strong><br>
        <span style="font-size: 13px; color: #555;">{{discount_pct}}% en cualquier nuevo equipo</span>
      </p>
      <p>Si conoces a alguien que pueda interesarle nuestro servicio, te lo agradecemos. ✨</p>
    `,
    variables: [
      "customer_first_name",
      "equipment_name",
      "company_name",
      "discount_code",
      "discount_pct",
    ],
  },
  {
    key: "filter_change_promo",
    name: "Promo cambio de filtros",
    description: "Para clientes con equipo sin plan de mantenimiento contratado.",
    kind: "marketing",
    subject: "Es hora de cambiar tus filtros — {{customer_first_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}},</h2>
      <p>Hace ya {{months_since_install}} meses que instalamos tu equipo. Es buen momento para revisar los filtros y asegurar que sigue funcionando perfecto.</p>
      <p>Te ofrecemos:</p>
      <ul>
        <li>🔧 Cambio completo de filtros</li>
        <li>🧪 Análisis del agua sin coste</li>
        <li>🛡 Garantía ampliada de 6 meses</li>
      </ul>
      <p style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 14px 16px; margin: 16px 0;">
        Precio especial cliente: <strong>{{price|money}}</strong>
      </p>
      <p>¿Cuándo te viene bien que pasemos? Contesta y lo agendamos.</p>
    `,
    variables: ["customer_first_name", "months_since_install", "price"],
  },
  {
    key: "maintenance_confirm_request",
    name: "Confirmar próxima visita (14 días antes)",
    description:
      "Cron envía 14 días antes de un mantenimiento. Cliente puede confirmar, elegir otra fecha o posponer.",
    kind: "transactional",
    subject: "¿Te viene bien tu próxima revisión, {{customer_first_name}}?",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}}</h2>
      <p>Tu próxima visita de mantenimiento con <strong>{{company_name}}</strong> está prevista para:</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 8px; padding: 16px; margin: 16px 0; width: 100%;">
        <tr>
          <td style="padding: 14px 18px; font-size: 16px;">
            <strong>📅 {{appointment_date|date}}</strong> a las <strong>{{appointment_time}}</strong><br>
            <span style="color:#555;">📍 {{customer_address}}</span>
          </td>
        </tr>
      </table>
      <p>¿Te viene bien esa fecha?</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="{{confirm_url}}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 4px;">
          Sí, lo confirmo
        </a>
        <a href="{{confirm_url}}?action=reschedule" style="display: inline-block; background: white; color: #0ea5e9; border: 2px solid #0ea5e9; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 4px;">
          Elegir otra fecha
        </a>
        <a href="{{confirm_url}}?action=postpone" style="display: inline-block; background: white; color: #6b7280; border: 1px solid #d1d5db; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 4px;">
          Posponer / llámame
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">Si no haces nada, daremos por buena la fecha propuesta y te recordaremos por email el día anterior.</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "appointment_date",
      "appointment_time",
      "customer_address",
      "confirm_url",
    ],
  },
  {
    key: "maintenance_day_before",
    name: "Recordatorio víspera mantenimiento",
    description:
      "Cron envía 24h antes. Cliente puede reconfirmar (nada cambia) o posponer (marca needs_callback).",
    kind: "transactional",
    subject: "Mañana pasamos a verte, {{customer_first_name}} 👋",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}}</h2>
      <p>Solo un recordatorio: <strong>mañana {{appointment_date|date}} a las {{appointment_time}}</strong> te visitará nuestro técnico <strong>{{technician_name}}</strong> para tu mantenimiento.</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin: 16px 0; width: 100%;">
        <tr><td style="padding: 12px 16px;">
          <strong>📍</strong> {{customer_address}}
        </td></tr>
      </table>
      <p>¿Sigue todo correcto?</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="{{confirm_url}}?action=reconfirm" style="display: inline-block; background: #16a34a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 4px;">
          Sí, perfecto
        </a>
        <a href="{{confirm_url}}?action=postpone" style="display: inline-block; background: white; color: #b45309; border: 2px solid #f59e0b; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 4px;">
          No puedo, posponer
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">Si necesitas cambiar la hora, mejor llámanos para coordinar — el técnico ya tiene la ruta del día preparada.</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "appointment_date",
      "appointment_time",
      "customer_address",
      "technician_name",
      "confirm_url",
    ],
  },
  {
    key: "installation_confirm_request",
    name: "Confirmar cita de instalación",
    description:
      "Email al cliente con la fecha de instalación propuesta. Puede confirmar, elegir otra fecha o posponer desde el enlace.",
    kind: "transactional",
    subject: "¿Te viene bien la fecha de tu instalación, {{customer_first_name}}?",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}}</h2>
      <p>Ya estamos preparando la instalación de tu equipo con <strong>{{company_name}}</strong>. La fecha que tenemos prevista es:</p>
      <table cellspacing="0" cellpadding="0" border="0" style="background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 8px; padding: 16px; margin: 16px 0; width: 100%;">
        <tr>
          <td style="padding: 14px 18px; font-size: 16px;">
            <strong>📅 {{appointment_date|date}}</strong> a las <strong>{{appointment_time}}</strong><br>
            <span style="color:#555;">📍 {{customer_address}}</span>
          </td>
        </tr>
      </table>
      <p>¿Te viene bien esa fecha?</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="{{confirm_url}}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; margin: 4px;">
          Sí, me viene bien
        </a>
        <a href="{{confirm_url}}?action=reschedule" style="display: inline-block; background: white; color: #0ea5e9; border: 2px solid #0ea5e9; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 4px;">
          Elegir otra fecha
        </a>
        <a href="{{confirm_url}}?action=postpone" style="display: inline-block; background: white; color: #6b7280; border: 1px solid #d1d5db; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin: 4px;">
          Posponer / llámame
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">Si eliges otra fecha, revisaremos la disponibilidad de nuestro técnico y la ruta del día y te confirmaremos. Si no haces nada, daremos por buena la fecha propuesta.</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "appointment_date",
      "appointment_time",
      "customer_address",
      "confirm_url",
    ],
  },
  {
    key: "contract_signed_copy",
    name: "Copia del contrato firmado",
    description:
      "Se envía automáticamente al cliente tras firmar (remoto o tablet) con su copia en PDF adjunta.",
    kind: "transactional",
    subject: "Tu contrato firmado con {{company_name}}",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">¡Gracias, {{customer_first_name}}!</h2>
      <p>Tu contrato con <strong>{{company_name}}</strong> ha quedado firmado correctamente.</p>
      <p style="background: #e8f5e9; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 16px 0;">
        <strong>Referencia:</strong> {{contract_ref}}<br>
        Adjuntamos tu copia firmada en PDF.
      </p>
      <p>Guarda este email como justificante. En breve nos pondremos en contacto
      para concretar los siguientes pasos (instalación o puesta en marcha).</p>
      <p>Si tienes cualquier duda, responde a este mismo correo.</p>
    `,
    variables: ["customer_first_name", "company_name", "contract_ref"],
  },
  {
    key: "contract_send_remote_sign",
    name: "Envío de contrato para firma remota",
    description: "Link con token para que el cliente firme online sin cuenta.",
    kind: "transactional",
    subject: "Tu contrato con {{company_name}} está listo para firmar",
    body_html: `
      <h2 style="margin: 0 0 16px 0; color: #222;">Hola {{customer_first_name}}!</h2>
      <p>Tu contrato con <strong>{{company_name}}</strong> está listo. Puedes
      revisarlo y firmarlo online en menos de 2 minutos.</p>
      <p style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 14px 16px; margin: 16px 0;">
        Referencia: <strong>{{contract_ref}}</strong>
      </p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="{{sign_url}}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
          Revisar y firmar contrato
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">El enlace caduca en {{days_to_expire}} días.
      Si tienes alguna duda antes de firmar, responde a este email y te
      atenderemos personalmente.</p>
    `,
    variables: [
      "customer_first_name",
      "company_name",
      "contract_ref",
      "sign_url",
      "days_to_expire",
    ],
  },
];

export function getSystemTemplates(): SystemTemplate[] {
  return TEMPLATES;
}

export function getSystemTemplateByKey(key: string): SystemTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
