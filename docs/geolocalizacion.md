# Geolocalización en el CRM — estado y guía de mejoras

Estado 2026-05-24.

## Lo que YA funciona

### Datos en BD
- Tabla central `addresses` (`supabase/migrations/20260501120900_addresses.sql`).
  - Columnas `latitude` y `longitude` (`numeric(9,6)`) — guardadas siempre.
  - `geo_source` (`user_pin` / `user_location` / `geocoded` / `none`) — trazabilidad de cómo se obtuvieron las coords.
  - `kind` distingue fiscal/home/office/site/warehouse/installation/shipping/billing/other.
  - FK excluyente a `customers` o `leads`. Las `installations`, `warehouses` y `agenda_events` referencian por `address_id`.
- `customers` y `leads` **no tienen columnas de address propias** — todo vive en `addresses` con `is_primary`.

### Geocoding
- `src/shared/lib/geocoding/actions.ts` provee `forwardGeocodeAction(query)` y `reverseGeocodeAction(lat, lng)`.
- Backend: **OpenStreetMap Nominatim** — gratis, sin API key, **límite 1 req/seg** (lo respetamos con cache 60 s).
- No requiere variables de entorno.

### UI
- `src/modules/addresses/address-form.tsx` — formulario compartido por leads/customers/installations.
- `src/shared/components/map-picker.tsx` — mapa Leaflet con tiles OSM, pin arrastrable.
- Botones "Usar mi ubicación" (GPS navegador) y "Buscar por dirección" (forward geocode manual).
- **Auto-geocode** (añadido 2026-05-24):
  - Al completar el CP a 5 dígitos → forward geocode `"##### , España"` + reverse → autocompleta ciudad/provincia + centra el mapa.
  - Al teclear la calle (debounce 1.2 s) → si hay CP y ciudad, geocode `"calle, número, CP, ciudad, España"` y mueve la chincheta.
  - No pisa coords si el usuario ya colocó chincheta a mano (respeta `geo_source = user_pin / user_location`).
- Validación cruzada: CP ↔ provincia con `provinceFromPostalCode()` (dataset estático `src/modules/time-tracking/localities.ts`).
- Coordenadas **obligatorias** para guardar — sin lat/lng el técnico no puede validar GPS al instalar (decisión 2026-05-19).

### Para qué se usa
- Cliente firma instalación en obra → app captura lat/lng del técnico → se compara con la dirección guardada (anti-fraude GPS).
- `expenses/routing-actions.ts` calcula rutas para liquidar kilometraje.
- Futuro: optimizador de rutas IA para `/mi-dia`.

---

## Mejoras pendientes — guía paso a paso

### Mejora 1 — Combobox CP ↔ municipio (sin Google)

**Problema actual:** `provinceFromPostalCode` solo da la provincia. Un CP como `28010` puede tener varios barrios/municipios y hoy el usuario los escribe a mano.

**Solución:**
1. Descargar dataset público español de CPs ↔ municipios. Fuente recomendada: **INE Códigos Postales** o el CSV abierto de `geoapi.es`. ~50 k filas, ~3 MB.
2. Crear tabla:
   ```sql
   create table public.postal_code_municipalities (
     postal_code text not null,
     municipality text not null,
     province text not null,
     primary key (postal_code, municipality)
   );
   create index idx_pcm_pc on public.postal_code_municipalities (postal_code);
   create index idx_pcm_muni on public.postal_code_municipalities (lower(municipality));
   ```
3. Migración que cargue el CSV (`COPY postal_code_municipalities FROM '/tmp/cps.csv' CSV HEADER`).
4. Endpoint `listMunicipalitiesByPostalCode(cp: string)` que devuelve array.
5. En `AddressForm`: cuando CP cambia a 5 dígitos, fetch del endpoint → si devuelve 1 → autocompleta city; si devuelve N → muestra `<select>` con las opciones y mantener `<input>` editable abajo ("Otro").
6. Inverso: en el campo "Población" añadir un `<datalist>` con todos los municipios de la provincia actual; al elegir uno, si solo tiene 1 CP, autocompletarlo.

**Coste:** ~3 h, sin claves de API.

### Mejora 2 — Google Places Autocomplete (opcional, paga si superas el free tier)

Si quieres calidad enterprise (sugerencias mientras tecleas el nombre de la calle, validación de dirección real):

1. **Crear proyecto en Google Cloud** y habilitar **Places API (New)** + **Maps JavaScript API**.
2. Generar API key con restricciones: HTTP referrer (`*.tudominio.com/*`), límite de cuota.
3. En Vercel añadir variable de entorno: `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (es safe poner NEXT_PUBLIC porque se valida por referrer).
4. Instalar lib opcional: `npm i @googlemaps/js-api-loader` (~3 KB).
5. Crear componente `src/shared/components/places-autocomplete.tsx`:
   ```tsx
   "use client";
   import { useEffect, useRef } from "react";
   import { Loader } from "@googlemaps/js-api-loader";

   export function PlacesAutocomplete({
     onSelect,
     defaultValue,
   }: {
     onSelect: (a: {
       street: string;
       street_number?: string;
       postal_code?: string;
       city?: string;
       province?: string;
       country?: string;
       lat: number;
       lng: number;
     }) => void;
     defaultValue?: string;
   }) {
     const ref = useRef<HTMLInputElement>(null);
     useEffect(() => {
       const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
       if (!key || !ref.current) return;
       const loader = new Loader({ apiKey: key, libraries: ["places"] });
       loader.load().then((google) => {
         const ac = new google.maps.places.Autocomplete(ref.current!, {
           componentRestrictions: { country: "es" },
           fields: ["address_components", "geometry"],
         });
         ac.addListener("place_changed", () => {
           const p = ac.getPlace();
           const comp = Object.fromEntries(
             (p.address_components ?? []).map((c) => [c.types[0], c.long_name]),
           );
           onSelect({
             street: comp.route ?? "",
             street_number: comp.street_number,
             postal_code: comp.postal_code,
             city: comp.locality ?? comp.administrative_area_level_3,
             province: comp.administrative_area_level_2,
             country: comp.country,
             lat: p.geometry?.location?.lat() ?? 0,
             lng: p.geometry?.location?.lng() ?? 0,
           });
         });
       });
     }, [onSelect]);
     return (
       <input
         ref={ref}
         defaultValue={defaultValue}
         placeholder="Empieza a escribir la dirección…"
         className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
       />
     );
   }
   ```
6. En `AddressForm` añadir un toggle "Búsqueda inteligente (Google)" arriba del formulario. Si está activado, mostrar `<PlacesAutocomplete>` que al seleccionar rellena todos los campos. Si la key no existe en env, ocultar el toggle automáticamente.
7. **Precios** (a 2026): los primeros 1 000 autocompletes/mes son gratis con tarjeta vinculada. A partir de ahí ~$2.83 por 1 000.

### Mejora 3 — Mapa con clusters de leads/clientes (rutas IA)

Para `/mi-dia` y futuro optimizador:
1. Crear `src/modules/routes/map.tsx` que renderice todas las direcciones del scope del usuario en un mapa Leaflet con `react-leaflet-cluster`.
2. Server action `listAddressesInBoundingBox(swLat, swLng, neLat, neLng)` para no traer todo de golpe.
3. Pintar leads en color A, clientes en B, instalaciones de hoy en C.
4. Optimizador: enviar lista de paradas + base (almacén) a un endpoint que llame a OSRM (gratis) o Google Routes (pago) y devuelva el orden óptimo. OSRM está ya considerado en `expenses/routing-actions.ts` — investigar si lo podemos reusar.

### Mejora 4 — Geocoding masivo en background

Al importar leads/clientes por CSV puedes acabar con 500 registros sin coords. Crear cron `cron/hourly/geocode-backlog` que:
- Selecciona `addresses` con `latitude IS NULL` y `street IS NOT NULL`, máximo 50 por tick (respetar 1 req/seg = 50 segundos por tick).
- Forward geocode + UPDATE.
- Marcar `geo_source='geocoded'`.
- Si falla 3 veces, marcar `geo_source='none'` con `notes='auto-geocode failed'` para que un humano la revise.

---

## Resumen de decisiones

- **Stack**: OSM Nominatim (gratis) por defecto. Google Places **opcional** detrás de un toggle si el cliente lo quiere y pone la API key.
- **Coords obligatorias** al guardar dirección. No se relaja.
- **Tabla `addresses` única** — no se duplican columnas en customers/leads/installations.
- **Validación CP↔provincia** estricta (no se puede guardar "CP 28010" con provincia "Sevilla").
- **Auto-geocode debounced** al teclear, no en cada keystroke (1.2 s).
