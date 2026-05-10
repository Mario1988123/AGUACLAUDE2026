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
  /** Conversión informativa: € que vale cada punto. 0 = comisiones desactivadas. */
  euros_per_point: number;
  /**
   * Día del mes en que cierra el ciclo de comisiones.
   * 0 = fin de mes natural (cada 1 a 30/31 del mes).
   * 1-28 = ciclo del día X al día X-1 del mes siguiente (ej. 25 → del 25/05 al 24/06 cierra como ciclo "junio").
   */
  cycle_close_day: number;
  /**
   * Hitos / bonus por metas conseguidas en el mes. Se otorgan al alcanzar el
   * umbral indicado de puntos (sólo se aplica si llega al 100% del threshold).
   * Lista ordenada de menor a mayor threshold.
   */
  monthly_milestones: Array<{
    /** Puntos necesarios para desbloquear el hito */
    threshold: number;
    /** Puntos extra que se otorgan al cumplirlo */
    bonus_points: number;
    /** Etiqueta visible al usuario */
    label: string;
  }>;
}

export const DEFAULT_POINTS_SETTINGS: PointsSettings = {
  points_lead_captured: 5,
  points_per_equipment_sold: 50,
  tmk_split_percent: 20,
  discount_penalty_percent: 50,
  points_per_installation: 30,
  points_per_maintenance: 15,
  points_per_incident: 20,
  euros_per_point: 0,
  cycle_close_day: 0,
  monthly_milestones: [
    { threshold: 100, bonus_points: 25, label: "100 puntos" },
    { threshold: 250, bonus_points: 75, label: "250 puntos" },
    { threshold: 500, bonus_points: 200, label: "500 puntos" },
  ],
};
