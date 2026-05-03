/**
 * Estructura de la configuración del programa de puntos por empresa.
 * Se persiste en company_settings.points_settings (jsonb).
 */
export interface PointsSettings {
  /** Puntos al telemarketer cuando crea un lead nuevo */
  points_lead_captured: number;
  /** Puntos base por cada equipo vendido en una propuesta aceptada */
  points_per_equipment_sold: number;
  /** % que recibe el telemarketer original cuando un comercial cierra una venta de un lead que él captó */
  tmk_split_percent: number;
  /** % a aplicar (reducción) cuando se vende por debajo del precio mínimo comercial autorizado */
  discount_penalty_percent: number;
  /** Puntos por completar una instalación */
  points_per_installation: number;
  /** Puntos por completar un mantenimiento */
  points_per_maintenance: number;
  /** Puntos por resolver una incidencia */
  points_per_incident: number;
}

export const DEFAULT_POINTS_SETTINGS: PointsSettings = {
  points_lead_captured: 5,
  points_per_equipment_sold: 50,
  tmk_split_percent: 20,
  discount_penalty_percent: 50,
  points_per_installation: 30,
  points_per_maintenance: 15,
  points_per_incident: 20,
};
