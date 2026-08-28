/**
 * Construcción de enlaces a Google Maps a partir de una dirección.
 *
 * Existía la misma lógica copiada en 6 sitios (lista de clientes, lista de
 * leads, instalaciones, mantenimientos, mi-día, agenda) y cada copia tenía
 * criterios distintos para decidir si había datos suficientes. La copia de
 * clientes/leads exigía `city`, así que una dirección con calle pero sin
 * población NO mostraba el botón de Maps (queja del equipo comercial,
 * 2026-08-28). Aquí se unifica: basta con coordenadas O con cualquier parte
 * textual de la dirección.
 */

export interface MapsAddressParts {
  lat?: number | string | null;
  lng?: number | string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  province?: string | null;
}

function coords(a: MapsAddressParts): string | null {
  if (a.lat == null || a.lng == null) return null;
  const lat = Number(a.lat);
  const lng = Number(a.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0,0) es el clásico "geocoding falló" — no navegamos al golfo de Guinea.
  if (lat === 0 && lng === 0) return null;
  return `${lat},${lng}`;
}

/** Texto de la dirección para buscar en Maps. null si no hay nada útil. */
export function buildAddressQuery(a: MapsAddressParts): string | null {
  const street = [a.street, a.street_number].filter(Boolean).join(" ").trim();
  const parts = [street, a.postal_code, a.city, a.province].
    map((p) => (p ?? "").toString().trim()).
    filter(Boolean);
  if (parts.length === 0) return null;
  return [...parts, "España"].join(", ");
}

/** Enlace "ver en el mapa" (búsqueda). null si no hay datos suficientes. */
export function buildMapsSearchUrl(a: MapsAddressParts): string | null {
  const c = coords(a);
  if (c) return `https://www.google.com/maps/search/?api=1&query=${c}`;
  const q = buildAddressQuery(a);
  return q
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
    : null;
}

/**
 * Enlace "cómo llegar" (navegación paso a paso). Es el que quiere el
 * comercial/técnico en la calle: abre la app de Maps del móvil con la ruta
 * desde su posición actual.
 */
export function buildMapsDirectionsUrl(a: MapsAddressParts): string | null {
  const c = coords(a);
  if (c) return `https://www.google.com/maps/dir/?api=1&destination=${c}`;
  const q = buildAddressQuery(a);
  return q
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
    : null;
}
