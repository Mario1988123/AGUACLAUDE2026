"use client";

import { useEffect, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
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
  /**
   * Si se pasa, cuando el usuario escribe y no elige sugerencia aparece el
   * botón «No aparece: escribirla a mano», que entrega el texto escrito para
   * que el formulario lo reparta en calle / número / población.
   */
  onManual?: (texto: string) => void;
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
  onManual,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  // Texto tecleado y si se eligió una sugerencia (oculta el botón manual).
  const [texto, setTexto] = useState(defaultValue ?? "");
  const [eligio, setEligio] = useState(false);
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
      setEligio(true);
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

  const alTeclear = (e: React.FormEvent<HTMLInputElement>) => {
    setTexto(e.currentTarget.value);
    setEligio(false);
  };

  const botonManual =
    onManual && !eligio && texto.trim().length >= 4 ? (
      <button
        type="button"
        onClick={() => onManual(texto.trim())}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 bg-background px-3 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/5 sm:w-auto sm:justify-start"
      >
        <PencilLine className="h-4 w-4 shrink-0" />
        <span>No aparece: escribirla a mano</span>
      </button>
    ) : null;

  if (unavailable) {
    return (
      <div className="space-y-1">
        <input
          ref={ref}
          onInput={alTeclear}
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
        {botonManual}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        ref={ref}
        onInput={alTeclear}
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
          {onManual ? " Si tu calle no sale, usa el botón de abajo." : ""}
        </p>
      )}
      {botonManual}
    </div>
  );
}
