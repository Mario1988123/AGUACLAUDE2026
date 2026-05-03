/**
 * Cálculo de distancia entre dos coordenadas (lat, lng) usando la fórmula
 * de Haversine. Devuelve km en línea recta. Geometría pura, sin llamadas
 * externas. Suele subestimar la distancia real por carretera ~30%.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // radio de la Tierra en km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface RoutePoint {
  id: string;
  lat: number;
  lng: number;
  /** Datos opacos que viajan con el punto para mostrar al usuario */
  meta?: Record<string, unknown>;
}

export interface RouteResult {
  /** Orden propuesto (ids en secuencia) */
  ordered: RoutePoint[];
  /** Km totales del recorrido en línea recta */
  totalKm: number;
}

/**
 * Algoritmo greedy nearest-neighbor: empieza en `start` y salta sucesivamente
 * al punto restante más cercano hasta visitarlos todos. No es óptimo global
 * (el TSP óptimo es NP-hard) pero da resultados aceptables para 5-15 paradas
 * urbanas.
 */
export function nearestNeighborRoute(
  start: { lat: number; lng: number },
  points: RoutePoint[],
): RouteResult {
  const remaining = [...points];
  const ordered: RoutePoint[] = [];
  let cur = start;
  let totalKm = 0;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i]!;
      const d = haversineKm(cur.lat, cur.lng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    totalKm += bestDist;
    ordered.push(next);
    cur = { lat: next.lat, lng: next.lng };
  }
  return { ordered, totalKm };
}

/**
 * Calcula la distancia total recorrida si las paradas se visitan en el orden
 * dado, partiendo de `start`.
 */
export function totalDistanceKm(
  start: { lat: number; lng: number },
  points: RoutePoint[],
): number {
  let cur = start;
  let total = 0;
  for (const p of points) {
    total += haversineKm(cur.lat, cur.lng, p.lat, p.lng);
    cur = { lat: p.lat, lng: p.lng };
  }
  return total;
}
