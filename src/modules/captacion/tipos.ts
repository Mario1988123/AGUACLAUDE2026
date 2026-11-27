export interface ConexionCaptacion {
  estado: "pendiente" | "activa" | "suspendida" | "desconectada";
  waba_id: string | null;
  phone_number_id: string | null;
  numero_e164: string | null;
  nombre_visible: string | null;
  calidad: "verde" | "amarilla" | "roja" | "desconocida";
  limite_diario_meta: number;
  margen_seguridad: number;
  negocio_verificado: boolean;
  envios_activos: boolean;
  tope_gasto_mensual_cents: number;
  retencion_dias: number;
  presentacion_empresa: string | null;
  temas_prohibidos: string | null;
  /** Política de privacidad de la empresa (pie de /p/). Vacía: sin enlace. */
  url_privacidad: string | null;
  /** Precios que enseña la propuesta (cash, renting, rental). Vacío: ninguno. */
  propuesta_precios: Array<"cash" | "renting" | "rental">;
  conectada_at: string | null;
  /** El número sigue también en la app de WhatsApp Business. */
  coexistencia: boolean;
  sync_contactos_at: string | null;
  sync_historial_at: string | null;
  ultimo_webhook_at: string | null;
  ultimo_error: string | null;
}

export interface PlantillaCaptacion {
  id: string;
  nombre: string;
  idioma: string;
  categoria: "marketing" | "utility" | "authentication";
  estado: "aprobada" | "pendiente" | "rechazada" | "pausada" | "desactivada";
  estado_meta: string | null;
  motivo_rechazo: string | null;
  uso: "primer_contacto" | "recordatorio" | "documento" | null;
  sincronizada_at: string | null;
  /** Texto del cuerpo, con {{1}} sin sustituir. */
  cuerpo: string | null;
  /** Tiene los botones Sí/No y como mucho el nombre del negocio como variable. */
  sirveCaptacion: boolean;
  motivoNoSirve: string | null;
  /** Fase 8: lleva un documento en la cabecera y sirve para mandar la propuesta. */
  sirveDocumento: boolean;
}

export interface EstadoCaptacion {
  esAdmin: boolean;
  /** Datos públicos de la app de Meta (el SDK del navegador los necesita). */
  meta: {
    appId: string | null;
    configId: string | null;
    graphVersion: string;
    webhookFirmado: boolean;
  };
  /** CAPTACION_ENVIOS_ACTIVOS=1 en el entorno (tercera llave del frío). */
  enviosPlataforma: boolean;
  conexion: ConexionCaptacion | null;
  plantillas: PlantillaCaptacion[];
}
