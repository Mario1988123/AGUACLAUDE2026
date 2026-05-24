"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/shared/lib/google-maps/loader";

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
 * Usa el loader compartido (`loadGoogleMaps`) que respeta la
 * configuración Google Maps Tools de la empresa: si está activado
 * (shared_key o own_key) descarga la API y autocompleta; si no, se
 * rinde como input plano y muestra hint.
 *
 * Carga la library `places` específicamente.
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
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = await loadGoogleMaps(["places"]);
      if (cancelled) return;
      if (!g) {
        setUnavailable(true);
        return;
      }
      if (!g.maps?.places) {
        setFailed(true);
        return;
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (unavailable) {
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
          Autocompletado Google no disponible para tu empresa. Configura
          Google Maps Tools en <code>/configuracion/google-maps</code> para
          activarlo (o usa los campos manuales debajo).
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
