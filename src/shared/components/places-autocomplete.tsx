"use client";

import { useEffect, useRef, useState } from "react";

export interface PlacesAddress {
  street: string;
  street_number: string;
  postal_code: string;
  city: string;
  province: string;
  country: string;
  lat: number;
  lng: number;
  formatted: string;
}

interface Props {
  onSelect: (addr: PlacesAddress) => void;
  defaultValue?: string;
  /** Placeholder del input. */
  placeholder?: string;
  className?: string;
  /** Restringir el autocomplete a un país (ISO 3166-1 alpha-2). Default ES. */
  country?: string;
}

/**
 * Input con autocompletado de direcciones via Google Places (New).
 * Se carga el script de Maps JS API una sola vez por sesión.
 * Si `NEXT_PUBLIC_GOOGLE_MAPS_KEY` no está definida, el componente
 * se rinde como input plano sin autocompletado y muestra hint.
 *
 * No depende de @googlemaps/js-api-loader — cargamos el <script> a mano
 * para no añadir ~3 KB de dependencia al bundle de todos los formularios.
 */
export function PlacesAutocomplete({
  onSelect,
  defaultValue,
  placeholder = "Empieza a escribir la dirección…",
  className,
  country = "es",
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  useEffect(() => {
    if (!apiKey || typeof window === "undefined") return;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.google?.maps?.places) {
      setReady(true);
      return;
    }

    // Marker para que múltiples instancias del componente no carguen el
    // script dos veces. Cuando termine de cargarse, todos los listeners
    // se enteran via `google-maps-loaded` evento custom.
    if (!w.__gmapsLoading) {
      w.__gmapsLoading = true;
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=es&region=ES`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.dispatchEvent(new CustomEvent("google-maps-loaded"));
      };
      script.onerror = () => {
        window.dispatchEvent(new CustomEvent("google-maps-failed"));
      };
      document.head.appendChild(script);
    }

    function onLoaded() {
      if (cancelled) return;
      setReady(true);
    }
    function onFailed() {
      if (cancelled) return;
      setFailed(true);
    }
    window.addEventListener("google-maps-loaded", onLoaded);
    window.addEventListener("google-maps-failed", onFailed);
    return () => {
      cancelled = true;
      window.removeEventListener("google-maps-loaded", onLoaded);
      window.removeEventListener("google-maps-failed", onFailed);
    };
  }, [apiKey]);

  // Bind del Autocomplete al input cuando el script está listo.
  useEffect(() => {
    if (!ready || !ref.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps?.places?.Autocomplete) return;
    const ac = new g.maps.places.Autocomplete(ref.current, {
      componentRestrictions: { country },
      fields: ["address_components", "geometry", "formatted_address"],
      types: ["address"],
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place?.geometry?.location) return;
      const comp: Record<string, string> = {};
      for (const c of place.address_components ?? []) {
        const type = c.types[0];
        if (!type) continue;
        comp[type] = c.long_name;
      }
      onSelect({
        street: comp.route ?? "",
        street_number: comp.street_number ?? "",
        postal_code: comp.postal_code ?? "",
        city:
          comp.locality ??
          comp.administrative_area_level_3 ??
          comp.administrative_area_level_2 ??
          "",
        province:
          comp.administrative_area_level_2 ??
          comp.administrative_area_level_1 ??
          "",
        country: comp.country ?? "",
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        formatted: place.formatted_address ?? "",
      });
    });
    return () => {
      try {
        listener.remove();
      } catch {
        /* ignore */
      }
    };
  }, [ready, onSelect, country]);

  if (!apiKey) {
    return (
      <div className="space-y-1">
        <input
          ref={ref}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={
            className ??
            "h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Google Places no configurado. El admin debe añadir{" "}
          <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> en las variables de entorno
          para activar el autocompletado inteligente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        ref={ref}
        defaultValue={defaultValue}
        placeholder={
          ready
            ? placeholder
            : failed
              ? "Falló la carga de Google Maps — usa los campos manuales"
              : "Cargando autocompletado…"
        }
        disabled={!ready && !failed}
        className={
          className ??
          "h-12 w-full rounded-xl border border-input bg-background px-3 text-base disabled:opacity-50"
        }
      />
      {ready && (
        <p className="text-[11px] text-muted-foreground">
          🪄 Selecciona una sugerencia y los campos se rellenarán
          automáticamente. Después puedes editar lo que necesites.
        </p>
      )}
    </div>
  );
}
