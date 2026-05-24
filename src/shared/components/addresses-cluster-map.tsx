"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/shared/lib/google-maps/loader";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string | null;
  /** Tipo de marker para colorearlo */
  kind?: "lead" | "customer" | "installation" | "maintenance" | "agenda";
  /** URL a la que enlazar en el popup */
  href?: string | null;
}

const KIND_COLOR: Record<NonNullable<MapPoint["kind"]>, string> = {
  lead: "#8b5cf6", // violeta
  customer: "#3b82f6", // azul
  installation: "#10b981", // verde
  maintenance: "#f59e0b", // ámbar
  agenda: "#ef4444", // rojo
};

const KIND_LABEL: Record<NonNullable<MapPoint["kind"]>, string> = {
  lead: "Lead",
  customer: "Cliente",
  installation: "Instalación",
  maintenance: "Mantenimiento",
  agenda: "Tarea",
};

/**
 * Mapa con clusters de N puntos (Leaflet + leaflet.markercluster vía CDN,
 * sin dependencia npm). Pensado para `/mi-dia`, futuros optimizadores de
 * ruta, vistas de leads/clientes geolocalizados, etc.
 *
 * Diseño:
 *  - Colorea cada marker según `kind` (lead/customer/installation/...).
 *  - Cluster cuando hay >N puntos próximos.
 *  - Popup con título + subtitle + link "Abrir".
 *  - Si no hay puntos válidos, no renderiza nada (no spamea mapas vacíos).
 *  - Auto-fit al cargar para que se vean todos los puntos.
 */
export function AddressesClusterMap({
  points,
  height = 360,
}: {
  points: MapPoint[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterRef = useRef<any>(null);

  const valid = points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lat) > 0.001 &&
      Math.abs(p.lng) > 0.001,
  );

  // 1) Cargar Leaflet + plugin markercluster una sola vez
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.L?.markerClusterGroup) {
      window.dispatchEvent(new CustomEvent("leaflet-cluster-loaded"));
      return;
    }
    function ensureCss(href: string) {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
    function ensureScript(src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          // ya estaba en curso; esperamos a que load
          const i = setInterval(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).L?.markerClusterGroup) {
              clearInterval(i);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(i);
            resolve();
          }, 5000);
          return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`load ${src}`));
        document.body.appendChild(s);
      });
    }
    ensureCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    ensureCss(
      "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
    );
    ensureCss(
      "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
    );
    (async () => {
      try {
        await ensureScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
        await ensureScript(
          "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
        );
        window.dispatchEvent(new CustomEvent("leaflet-cluster-loaded"));
      } catch (e) {
        console.error("[AddressesClusterMap] script load failed", e);
      }
    })();
  }, []);

  // 2) Crear el mapa + clusters. Intenta Google primero (si la empresa
  //    tiene `interactive_maps`); cae a Leaflet+OSM si no.
  useEffect(() => {
    if (!containerRef.current || valid.length === 0) return;
    let cancelled = false;

    async function tryGoogle(): Promise<boolean> {
      const g = await loadGoogleMaps(["marker"]);
      if (cancelled || !g || !containerRef.current) return false;
      try {
        // Limpia mapa Leaflet previo si existía
        if (mapRef.current && typeof mapRef.current.remove === "function") {
          try {
            mapRef.current.remove();
          } catch {
            /* ignore */
          }
          mapRef.current = null;
        }
        const bounds = new g.maps.LatLngBounds();
        for (const p of valid) bounds.extend({ lat: p.lat, lng: p.lng });
        const map = new g.maps.Map(containerRef.current, {
          center: bounds.getCenter(),
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: any[] = [];
        for (const p of valid) {
          const color = KIND_COLOR[p.kind ?? "agenda"];
          const label = KIND_LABEL[p.kind ?? "agenda"];
          const marker = new g.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            label: { text: label[0]!, color: "white", fontWeight: "bold" },
            icon: {
              path: g.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
          });
          const sub = p.subtitle
            ? `<div style="font-size:11px;color:#666;margin-top:2px">${escapeHtml(p.subtitle)}</div>`
            : "";
          const link = p.href
            ? `<div style="margin-top:6px"><a href="${escapeHtml(p.href)}" style="color:${color};font-weight:600;font-size:12px">Abrir →</a></div>`
            : "";
          const info = new g.maps.InfoWindow({
            content: `<div style="min-width:180px"><div style="font-size:10px;text-transform:uppercase;color:${color};font-weight:700">${label}</div><div style="font-weight:600;font-size:13px;margin-top:2px">${escapeHtml(p.title)}</div>${sub}${link}</div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          markers.push(marker);
        }
        map.fitBounds(bounds, 40);
        // Carga el clusterer vía CDN si no está
        await ensureClustererScript();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.markerClusterer?.MarkerClusterer) {
          clusterRef.current = new w.markerClusterer.MarkerClusterer({
            map,
            markers,
          });
        }
        return true;
      } catch (e) {
        console.error("[AddressesClusterMap] google init failed:", e);
        return false;
      }
    }

    function ensureClustererScript(): Promise<void> {
      return new Promise((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).markerClusterer?.MarkerClusterer) return resolve();
        const existing = document.querySelector<HTMLScriptElement>(
          'script[data-gmaps-clusterer="1"]',
        );
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => resolve());
          return;
        }
        const s = document.createElement("script");
        s.src =
          "https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js";
        s.async = true;
        s.dataset.gmapsClusterer = "1";
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.body.appendChild(s);
      });
    }

    function init() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L?.markerClusterGroup || !containerRef.current) return;

      // Limpia mapa previo si re-renderizamos con otros puntos
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          /* ignore */
        }
        mapRef.current = null;
      }

      const map = L.map(containerRef.current).setView([40.4, -3.7], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;

      const cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 50,
      });
      clusterRef.current = cluster;

      for (const p of valid) {
        const color = KIND_COLOR[p.kind ?? "agenda"];
        const label = KIND_LABEL[p.kind ?? "agenda"];
        const icon = L.divIcon({
          html: `<div style="background:${color};color:white;border:2px solid white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.3)">${label[0]}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          className: "",
        });
        const marker = L.marker([p.lat, p.lng], { icon });
        const sub = p.subtitle
          ? `<div style="font-size:11px;color:#666;margin-top:2px">${escapeHtml(p.subtitle)}</div>`
          : "";
        const link = p.href
          ? `<div style="margin-top:6px"><a href="${escapeHtml(p.href)}" style="color:${color};font-weight:600;font-size:12px">Abrir →</a></div>`
          : "";
        marker.bindPopup(
          `<div style="min-width:180px"><div style="font-size:10px;text-transform:uppercase;color:${color};font-weight:700">${label}</div><div style="font-weight:600;font-size:13px;margin-top:2px">${escapeHtml(p.title)}</div>${sub}${link}</div>`,
        );
        cluster.addLayer(marker);
      }
      map.addLayer(cluster);

      // Auto-fit a todos los puntos
      try {
        const group = L.featureGroup(valid.map((p) => L.marker([p.lat, p.lng])));
        map.fitBounds(group.getBounds().pad(0.15));
      } catch {
        /* fallback al view default */
      }
    }

    (async () => {
      const used = await tryGoogle();
      if (used || cancelled) return;
      // Fallback Leaflet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).L?.markerClusterGroup) {
        init();
      } else {
        function onReady() {
          if (cancelled) return;
          init();
        }
        window.addEventListener("leaflet-cluster-loaded", onReady);
      }
    })();

    return () => {
      cancelled = true;
    };
    // valid se recalcula cada render; usamos points.length + checksum corto
    // como dependencia estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|")]);

  if (valid.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Sin puntos geolocalizados para mostrar en el mapa.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-2xl border border-border"
      style={{ height }}
      role="application"
      aria-label={`Mapa con ${valid.length} ubicaciones`}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
