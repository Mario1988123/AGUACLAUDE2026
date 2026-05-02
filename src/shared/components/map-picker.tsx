"use client";

import { useEffect, useRef } from "react";

/**
 * Mini-mapa con chincheta arrastrable (Leaflet vía CDN, sin deps npm).
 * onChange se llama cuando el usuario arrastra el pin.
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

  // Inicializar mapa cuando hay coords y Leaflet cargado
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (latitude == null || longitude == null) return;
    let cancelled = false;

    function init() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L) {
        if (!cancelled) setTimeout(init, 100);
        return;
      }
      if (!containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([latitude, longitude], 17);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        }).addTo(mapRef.current);
        markerRef.current = L.marker([latitude, longitude], { draggable: true }).addTo(mapRef.current);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markerRef.current.on("dragend", (e: any) => {
          const { lat, lng } = e.target.getLatLng();
          onChange?.(lat, lng);
        });
      } else {
        mapRef.current.setView([latitude, longitude], 17);
        markerRef.current.setLatLng([latitude, longitude]);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (latitude == null || longitude == null) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground"
        style={{ height }}
      >
        Captura la ubicación para ver el mapa
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-xl border border-border"
      style={{ height }}
    />
  );
}
