/**
 * Precios Google Maps Platform en USD por 1 000 llamadas (2025).
 * Cuando Google los cambia, basta con tocar este fichero.
 * Fuente: https://mapsplatform.google.com/pricing/
 */
export const GOOGLE_API_PRICING_PER_1K: Record<GmapsApi, number> = {
  geocoding: 5.0,
  places_autocomplete: 2.83, // con session token
  places_details: 17.0,
  maps_js: 7.0, // por carga de mapa
  static_maps: 2.0,
  street_view: 7.0,
  directions: 5.0,
  routes_compute: 5.0,
  routes_optimize: 10.0,
  distance_matrix: 5.0, // por elemento (orígenes × destinos)
  roads: 20.0,
};

export type GmapsApi =
  | "geocoding"
  | "places_autocomplete"
  | "places_details"
  | "maps_js"
  | "static_maps"
  | "street_view"
  | "directions"
  | "routes_compute"
  | "routes_optimize"
  | "distance_matrix"
  | "roads";

export const GMAPS_API_LABEL: Record<GmapsApi, string> = {
  geocoding: "Geocoding",
  places_autocomplete: "Places Autocomplete",
  places_details: "Places Details",
  maps_js: "Maps JavaScript",
  static_maps: "Static Maps",
  street_view: "Street View",
  directions: "Directions",
  routes_compute: "Routes (compute)",
  routes_optimize: "Routes (waypoint optim)",
  distance_matrix: "Distance Matrix",
  roads: "Roads",
};

/** Crédito gratuito mensual de Google Cloud por proyecto (~$200 a 2025). */
export const FREE_TIER_USD = 200;

/**
 * Features del módulo Google Maps Tools. Geocoding+Autocomplete son
 * implícitos cuando gmaps_mode != disabled. El resto son opcionales
 * y se activan por empresa para controlar coste.
 */
export type GmapsFeature =
  | "interactive_maps" // Maps JS para MapPicker y AddressesClusterMap
  | "smart_routes" // Routes API waypoint optimization en /mi-día
  | "directions" // Routes/Directions API para mileage real
  | "static_pdfs" // Static Maps en PDFs y emails
  | "street_view" // Street View en fichas de cliente
  | "anti_fraud_roads"; // Roads API en cierre de instalación

export const GMAPS_FEATURE_LABEL: Record<GmapsFeature, string> = {
  interactive_maps: "Mapas interactivos (Google)",
  smart_routes: "Rutas inteligentes IA (Routes API)",
  directions: "Distancias reales con tráfico (mileage)",
  static_pdfs: "Mapas estáticos en PDFs y emails",
  street_view: "Street View en fichas de cliente",
  anti_fraud_roads: "Anti-fraude reforzado (Roads API)",
};

export const GMAPS_FEATURE_HINT: Record<GmapsFeature, string> = {
  interactive_maps:
    "~$7/1.000 cargas. Sustituye Leaflet/OSM por Google Maps en el selector de dirección y en /mi-día.",
  smart_routes:
    "~$10/planificación. Sustituye el TSP greedy por el optimizador de waypoints de Google con tráfico real.",
  directions:
    "~$5/1.000. Sustituye OSRM público (inestable) por Directions/Routes API con tráfico.",
  static_pdfs:
    "~$2/1.000. PNG embebido en parte instalación y emails de confirmación.",
  street_view:
    "~$7/1.000. Foto de fachada autocargada en la ficha del cliente.",
  anti_fraud_roads:
    "~$20/1.000. Verifica que el técnico está en una calle real al cerrar visita. Solo si tienes problemas reales de fraude GPS.",
};

/** Coste en micro-USD (1$ = 1.000.000) para precisión sin floats. */
export function microUsdForCall(api: GmapsApi, units = 1): number {
  const per1k = GOOGLE_API_PRICING_PER_1K[api];
  return Math.round(((per1k * units) / 1000) * 1_000_000);
}
