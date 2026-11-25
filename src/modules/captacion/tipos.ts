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
  conectada_at: string | null;
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
