"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMaps,
  getGoogleMapsAvailability,
} from "@/shared/lib/google-maps/loader";

/**
 * Mini-mapa con chincheta. Si la empresa tiene Google Maps Tools activo
 * con la feature `interactive_maps` (resolvemos eso vía el client-key
 * endpoint dentro del loader), usa Google Maps JS. En caso contrario,
 * cae a Leaflet+OSM por CDN sin deps npm.
 *
 * API:
 *  - `latitude`/`longitude` cambian desde fuera → re-centrar + mover pin.
 *  - Drag del marcador → `onChange(lat, lng)`.
 *  - Click sobre el mapa → `onChange(lat, lng)`.
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
  const providerRef = useRef<"google" | "leaflet" | null>(null);
  const [providerStatus, setProviderStatus] = useState<
    "checking" | "google_loading" | "google" | "leaflet" | "google_failed"
  >("checking");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Inicializa el mapa una sola vez. REGLA (decisión usuario 2026-05-24):
  // si la empresa tiene Google Maps Tools activado, SIEMPRE intentar
  // Google primero — Leaflet/OSM solo cuando el módulo está disabled o
  // la carga de Google falla. Mientras Google se carga mostramos un
  // estado "checking/loading" para que el usuario no vea Leaflet ni
  // siquiera unos segundos.
  useEffect(() => {
    let cancelled = false;
    const center: [number, number] =
      latitude != null && longitude != null
        ? [latitude, longitude]
        : [40.4168, -3.7038];
    const zoom = latitude != null && longitude != null ? 17 : 5;

    async function tryGoogle(): Promise<boolean> {
      // "maps" se carga implícitamente; pedimos "marker" extra para
      // g.maps.Marker (con la API modular no viene en core).
      const g = await loadGoogleMaps(["marker"]);
      if (cancelled || !g || !containerRef.current) return false;
      try {
        const map = new g.maps.Map(containerRef.current, {
          center: { lat: center[0], lng: center[1] },
          zoom,
          disableDefaultUI: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        providerRef.current = "google";

        if (latitude != null && longitude != null) {
          markerRef.current = new g.maps.Marker({
            position: { lat: latitude, lng: longitude },
            map,
            draggable: true,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          markerRef.current.addListener("dragend", (e: any) => {
            const pos = e.latLng;
            onChangeRef.current?.(pos.lat(), pos.lng());
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addListener("click", (e: any) => {
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          if (markerRef.current) {
            markerRef.current.setPosition({ lat, lng });
          } else {
            markerRef.current = new g.maps.Marker({
              position: { lat, lng },
              map,
              draggable: true,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            markerRef.current.addListener("dragend", (ev: any) => {
              const p = ev.latLng;
              onChangeRef.current?.(p.lat(), p.lng());
            });
          }
          onChangeRef.current?.(lat, lng);
        });
        return true;
      } catch (e) {
        console.error("[MapPicker] google init failed:", e);
        return false;
      }
    }

    function ensureLeafletCss() {
      if (document.querySelector('link[data-leaflet="1"]')) return;
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      css.dataset.leaflet = "1";
      document.head.appendChild(css);
    }
    function ensureLeafletScript(): Promise<void> {
      return new Promise((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).L) return resolve();
        const existing = document.querySelector<HTMLScriptElement>(
          'script[data-leaflet="1"]',
        );
        if (existing) {
          existing.addEventListener("load", () => resolve());
          return;
        }
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.async = true;
        s.dataset.leaflet = "1";
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
      });
    }

    async function tryLeaflet(): Promise<boolean> {
      ensureLeafletCss();
      await ensureLeafletScript();
      if (cancelled) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L || !containerRef.current) return false;
      const map = L.map(containerRef.current).setView(center, zoom);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;
      providerRef.current = "leaflet";

      if (latitude != null && longitude != null) {
        markerRef.current = L.marker([latitude, longitude], {
          draggable: true,
        }).addTo(map);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markerRef.current.on("dragend", (e: any) => {
          const { lat, lng } = e.target.getLatLng();
          onChangeRef.current?.(lat, lng);
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(
            map,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          markerRef.current.on("dragend", (ev: any) => {
            const p = ev.target.getLatLng();
            onChangeRef.current?.(p.lat, p.lng);
          });
        }
        onChangeRef.current?.(lat, lng);
      });
      return true;
    }

    (async () => {
      // Paso 1: averiguar si la empresa tiene Google Maps Tools activo
      const avail = await getGoogleMapsAvailability();
      if (cancelled) return;
      if (!avail.available) {
        // Módulo gmaps disabled o sin key → Leaflet directamente
        setProviderStatus("leaflet");
        await tryLeaflet();
        return;
      }
      // Empresa CON Google activo: mostramos "cargando Google" mientras
      // se descarga el bundle. NO caemos a Leaflet hasta confirmar fallo.
      setProviderStatus("google_loading");
      const used = await tryGoogle();
      if (cancelled) return;
      if (used) {
        setProviderStatus("google");
      } else {
        // Google falló (timeout, error de red, key inválida) — fallback
        setProviderStatus("google_failed");
        await tryLeaflet();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronización externa de coords
  useEffect(() => {
    if (!mapRef.current) return;
    if (latitude == null || longitude == null) return;
    if (providerRef.current === "google") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      if (!g) return;
      mapRef.current.setCenter({ lat: latitude, lng: longitude });
      mapRef.current.setZoom(17);
      if (markerRef.current) {
        markerRef.current.setPosition({ lat: latitude, lng: longitude });
      } else {
        markerRef.current = new g.maps.Marker({
          position: { lat: latitude, lng: longitude },
          map: mapRef.current,
          draggable: true,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markerRef.current.addListener("dragend", (e: any) => {
          const pos = e.latLng;
          onChangeRef.current?.(pos.lat(), pos.lng());
        });
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L) return;
      mapRef.current.setView([latitude, longitude], 17);
      if (markerRef.current) {
        markerRef.current.setLatLng([latitude, longitude]);
      } else {
        markerRef.current = L.marker([latitude, longitude], {
          draggable: true,
        }).addTo(mapRef.current);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markerRef.current.on("dragend", (e: any) => {
          const { lat, lng } = e.target.getLatLng();
          onChangeRef.current?.(lat, lng);
        });
      }
    }
  }, [latitude, longitude]);

  useEffect(() => {
    return () => {
      if (providerRef.current === "leaflet" && mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          /* ignore */
        }
      }
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="relative">
        <div
          ref={containerRef}
          className="overflow-hidden rounded-xl border border-border"
          style={{ height }}
        />
        {(providerStatus === "checking" ||
          providerStatus === "google_loading") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-card/80 text-xs text-muted-foreground backdrop-blur-sm">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Cargando Google Maps…</span>
          </div>
        )}
      </div>
      {providerStatus === "google_failed" && (
        <p className="text-[11px] text-amber-700">
          ⚠ Falló la carga de Google Maps — mostrando OpenStreetMap. Revisa
          tu conexión o las restricciones de tu API key en Google Cloud.
        </p>
      )}
      {(latitude == null || longitude == null) && (
        <p className="text-[11px] text-muted-foreground">
          Pulsa &laquo;Usar mi ubicación&raquo;, &laquo;Buscar por dirección&raquo; o pincha
          directamente en el mapa para fijar la chincheta.
        </p>
      )}
    </div>
  );
}
