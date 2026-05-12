"use client";

import { useEffect, useRef } from "react";

/**
 * Mini-mapa con chincheta (Leaflet vía CDN, sin deps npm).
 *
 * Tres formas de fijar la posición:
 *  1. Si `latitude`/`longitude` cambian desde fuera (botón GPS o búsqueda),
 *     el mapa centra ahí y mueve el pin.
 *  2. El usuario arrastra el marcador → `onChange(lat, lng)`.
 *  3. El usuario pincha en cualquier punto del mapa → `onChange(lat, lng)`.
 *
 * Si no hay coords iniciales, el mapa se centra en España con zoom 5 para
 * que el usuario pueda pinchar donde quiera y fijar la chincheta.
 */
export function MapPicker({
  latitude,
  longitude,
  onChange,
  height = 280,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange?: (lat: number, lng: number) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Cargar Leaflet desde CDN una sola vez
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) return;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    css.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    css.crossOrigin = "";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Inicializar mapa (siempre, aunque no haya coords). Sin coords iniciales
  // se centra en España con zoom 5; al click el usuario fija la chincheta.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    function init() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L) {
        if (!cancelled) setTimeout(init, 100);
        return;
      }
      if (!containerRef.current) return;
      if (mapRef.current) return; // ya inicializado
      // Vista inicial
      const center: [number, number] =
        latitude != null && longitude != null
          ? [latitude, longitude]
          : [40.4168, -3.7038]; // España (Madrid)
      const zoom = latitude != null && longitude != null ? 17 : 5;
      mapRef.current = L.map(containerRef.current).setView(center, zoom);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(mapRef.current);
      // Marcador solo si ya hay coords
      if (latitude != null && longitude != null) {
        markerRef.current = L.marker([latitude, longitude], {
          draggable: true,
        }).addTo(mapRef.current);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markerRef.current.on("dragend", (e: any) => {
          const { lat, lng } = e.target.getLatLng();
          onChangeRef.current?.(lat, lng);
        });
      }
      // Click en el mapa → mueve o crea la chincheta
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapRef.current.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(
            mapRef.current,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          markerRef.current.on("dragend", (ev: any) => {
            const p = ev.target.getLatLng();
            onChangeRef.current?.(p.lat, p.lng);
          });
        }
        onChangeRef.current?.(lat, lng);
      });
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizar cambios externos de coords → re-centrar y mover el pin.
  useEffect(() => {
    if (!mapRef.current) return;
    if (latitude == null || longitude == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;
    mapRef.current.setView([latitude, longitude], 17);
    if (!markerRef.current) {
      markerRef.current = L.marker([latitude, longitude], {
        draggable: true,
      }).addTo(mapRef.current);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markerRef.current.on("dragend", (e: any) => {
        const { lat, lng } = e.target.getLatLng();
        onChangeRef.current?.(lat, lng);
      });
    } else {
      markerRef.current.setLatLng([latitude, longitude]);
    }
  }, [latitude, longitude]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl border border-border"
        style={{ height }}
      />
      {(latitude == null || longitude == null) && (
        <p className="text-[11px] text-muted-foreground">
          Pulsa &laquo;Usar mi ubicación&raquo;, &laquo;Buscar por dirección&raquo; o pincha
          directamente en el mapa para fijar la chincheta.
        </p>
      )}
    </div>
  );
}
