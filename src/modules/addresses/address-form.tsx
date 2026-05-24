"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MapPin, Crosshair, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { MapPicker } from "@/shared/components/map-picker";
import {
  ADDRESS_KIND,
  KIND_LABEL,
  STREET_TYPE,
  STREET_TYPE_LABEL,
  type AddressKind,
  type StreetType,
} from "./schemas";
import { upsertAddressSafeAction } from "./actions";
import {
  provinceFromPostalCode,
  validateSpanishPostalCode,
} from "@/shared/lib/validations/spanish";
import { reverseGeocodeAction as reverseGeocode, forwardGeocodeAction as forwardGeocode } from "@/shared/lib/geocoding/actions";
import { detectStreetType } from "@/shared/lib/geocoding/street-type";
import {
  lookupMunicipalitiesByPostalCode,
  lookupPostalCodesByMunicipality,
  type MunicipalityHit,
} from "@/shared/lib/geocoding/municipalities";
import { PlacesAutocomplete } from "@/shared/components/places-autocomplete";
import type { AddressRow } from "./actions";

interface Props {
  customerId?: string;
  leadId?: string;
  initial?: AddressRow;
  onDone?: () => void;
}

const EMPTY = {
  kind: "home" as AddressKind,
  label: "",
  is_primary: false,
  contact_name: "",
  contact_phone: "",
  street_type: "calle" as StreetType,
  street: "",
  street_number: "",
  portal: "",
  floor: "",
  door: "",
  postal_code: "",
  city: "",
  province: "",
  notes: "",
};

export function AddressForm({ customerId, leadId, initial, onDone }: Props) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    kind: (initial?.kind ?? EMPTY.kind) as AddressKind,
    label: initial?.label ?? EMPTY.label,
    is_primary: initial?.is_primary ?? EMPTY.is_primary,
    contact_name: initial?.contact_name ?? EMPTY.contact_name,
    contact_phone: initial?.contact_phone ?? EMPTY.contact_phone,
    street_type: (initial?.street_type ?? EMPTY.street_type) as StreetType,
    street: initial?.street ?? EMPTY.street,
    street_number: initial?.street_number ?? EMPTY.street_number,
    portal: initial?.portal ?? EMPTY.portal,
    floor: initial?.floor ?? EMPTY.floor,
    door: initial?.door ?? EMPTY.door,
    postal_code: initial?.postal_code ?? EMPTY.postal_code,
    city: initial?.city ?? EMPTY.city,
    province: initial?.province ?? EMPTY.province,
    notes: initial?.notes ?? EMPTY.notes,
    latitude: initial?.latitude ?? null,
    longitude: initial?.longitude ?? null,
    geo_source: null as null | "user_pin" | "user_location" | "geocoded",
  });

  const [gpsLoading, setGpsLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  // Sugerencias para datalist:
  //  · cpSuggestions  = municipios candidatos del CP actual (CP → ciudad)
  //  · citySuggestions = CPs candidatos de la ciudad escrita (ciudad → CP)
  const [cpSuggestions, setCpSuggestions] = useState<MunicipalityHit[]>([]);
  const [citySuggestions, setCitySuggestions] = useState<MunicipalityHit[]>([]);

  async function fillFromCoords(lat: number, lng: number, source: "user_pin" | "user_location" | "geocoded") {
    setForm((f) => ({ ...f, latitude: lat, longitude: lng, geo_source: source }));
    // Reverse geocoding → autorelleno campos vacíos (no machacamos lo que ya escribió)
    const rev = await reverseGeocode(lat, lng);
    if (!rev) {
      notify.warning("Coordenadas capturadas pero no se pudo identificar la calle");
      return;
    }
    setForm((f) => ({
      ...f,
      street_type: (STREET_TYPE.includes(rev.street_type as StreetType)
        ? (rev.street_type as StreetType)
        : f.street_type),
      street: f.street || rev.street,
      street_number: f.street_number || rev.street_number || "",
      postal_code: f.postal_code || rev.postal_code || "",
      city: f.city || rev.city || "",
      province: f.province || rev.province || "",
    }));
    notify.success("Dirección autorrellenada");
  }

  function captureMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.warning("Geolocalización no disponible en este dispositivo");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await fillFromCoords(pos.coords.latitude, pos.coords.longitude, "user_location");
        setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        notify.error(
          "No se pudo obtener ubicación",
          err.code === 1 ? "Permiso denegado" : "Sin señal GPS",
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  async function searchByAddress() {
    const parts = [
      form.street,
      form.street_number,
      form.postal_code,
      form.city,
      form.province,
      "España",
    ].filter(Boolean);
    if (parts.length < 2) {
      notify.warning("Escribe al menos calle y población");
      return;
    }
    setGeoLoading(true);
    const result = await forwardGeocode(parts.join(", "));
    setGeoLoading(false);
    if (!result) {
      notify.warning("No se encontró la dirección");
      return;
    }
    setForm((f) => ({
      ...f,
      latitude: result.lat,
      longitude: result.lng,
      geo_source: "geocoded",
    }));
    notify.success("Localizado en el mapa");
  }

  function clearLocation() {
    setForm((f) => ({ ...f, latitude: null, longitude: null, geo_source: null }));
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "postal_code" && typeof value === "string" && value.length === 5) {
        const p = provinceFromPostalCode(value);
        // Si el CP es válido y la provincia actual no coincide, la
        // pisamos. Evita el caso aberrante "CP 46xxx + Provincia Galicia".
        if (p) {
          if (!next.province || next.province.toLowerCase().trim() !== p.toLowerCase().trim()) {
            next.province = p;
          }
        }
      }
      return next;
    });
  }

  // Auto-geocode al completar el CP a 5 dígitos: centra el mapa en ese
  // código postal Y autocompleta ciudad/provincia desde el reverse de
  // OSM. Solo se dispara si no hay coords todavía (no pisa una chincheta
  // ya colocada manualmente).
  const cpRef = useRef<string>("");
  useEffect(() => {
    const cp = form.postal_code.trim();
    if (cp.length !== 5 || cp === cpRef.current) return;
    if (!validateSpanishPostalCode(cp)) return;
    if (form.latitude != null && form.longitude != null) {
      cpRef.current = cp; // sólo si no hay coords ya
      return;
    }
    cpRef.current = cp;
    let cancelled = false;
    (async () => {
      const res = await forwardGeocode(`${cp}, España`);
      if (cancelled || !res) return;
      await fillFromCoords(res.lat, res.lng, "geocoded");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.postal_code]);

  // Sugerencias CP → municipios para el datalist de "Población".
  // Disparo independiente del auto-geocode; aquí no toca coordenadas,
  // solo rellena un combobox.
  useEffect(() => {
    const cp = form.postal_code.trim();
    if (cp.length !== 5 || !validateSpanishPostalCode(cp)) {
      setCpSuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const list = await lookupMunicipalitiesByPostalCode(cp);
      if (cancelled) return;
      setCpSuggestions(list);
      // Si solo hay un municipio para ese CP y la ciudad está vacía o
      // coincide con la del único hit, lo autocompletamos.
      if (list.length === 1) {
        const only = list[0]!;
        setForm((f) => ({
          ...f,
          city: f.city || only.municipality,
          province: f.province || only.province,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.postal_code]);

  // Sugerencias ciudad → CPs para el datalist de "CP" (debounce 600ms
  // para no atacar Nominatim en cada keystroke).
  useEffect(() => {
    const city = form.city.trim();
    if (city.length < 3) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const list = await lookupPostalCodesByMunicipality(
        city,
        form.province || undefined,
      );
      if (cancelled) return;
      setCitySuggestions(list);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.city, form.province]);

  // Auto-geocode al teclear la calle (debounce 1.2 s). Solo si tenemos CP
  // y población — sin ellos OSM da resultados ambiguos. No pisa coords
  // si el user ya colocó chincheta a mano.
  const streetRef = useRef<string>("");
  useEffect(() => {
    const key = `${form.street}|${form.street_number}|${form.postal_code}|${form.city}`;
    if (key === streetRef.current) return;
    if (!form.street.trim() || !form.city.trim() || form.postal_code.length !== 5) return;
    if (form.geo_source === "user_pin" || form.geo_source === "user_location") return;
    const timer = setTimeout(async () => {
      streetRef.current = key;
      const query = [
        form.street,
        form.street_number,
        form.postal_code,
        form.city,
        "España",
      ]
        .filter(Boolean)
        .join(", ");
      const res = await forwardGeocode(query);
      if (!res) return;
      setForm((f) => ({
        ...f,
        latitude: res.lat,
        longitude: res.lng,
        geo_source: "geocoded",
      }));
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.street, form.street_number, form.postal_code, form.city]);

  /** Comprueba que CP, provincia y población forman una combinación posible. */
  function validateGeo(): string | null {
    const cp = form.postal_code?.trim() ?? "";
    if (!cp) {
      return "Falta el código postal.";
    }
    if (!validateSpanishPostalCode(cp)) {
      return `El código postal "${cp}" no es válido (5 dígitos, 01-52).`;
    }
    const expectedProvince = provinceFromPostalCode(cp);
    const current = form.province?.trim() ?? "";
    if (
      expectedProvince &&
      current &&
      current.toLowerCase() !== expectedProvince.toLowerCase()
    ) {
      return `El CP ${cp} pertenece a ${expectedProvince}, no a "${current}". Corrige la provincia o el CP.`;
    }
    if (expectedProvince && !current) {
      return `Indica la provincia. El CP ${cp} corresponde a ${expectedProvince}.`;
    }
    if (!form.city?.trim()) {
      return "Falta la población.";
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const geoErr = validateGeo();
    if (geoErr) {
      notify.error("Dirección incoherente", geoErr);
      return;
    }
    // Coordenadas SIEMPRE obligatorias (decisión 2026-05-19): el técnico
    // no puede iniciar parte ni validar GPS si faltan. Si no se han
    // podido geocodificar, el usuario debe colocar chincheta manual en
    // el mapa.
    if (form.latitude == null || form.longitude == null) {
      notify.error(
        "Faltan coordenadas",
        "Pulsa «Buscar en mapa» o coloca la chincheta manualmente — sin lat/lng el técnico no puede validar el GPS al instalar.",
      );
      return;
    }
    startTransition(async () => {
      const r = await upsertAddressSafeAction({
        ...form,
        id: initial?.id,
        customer_id: customerId,
        lead_id: leadId,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success(initial ? "Dirección actualizada" : "Dirección añadida");
      onDone?.();
    });
  }

  const geoWarning = validateGeo();

  const hasGeo = form.latitude != null && form.longitude != null;
  const mapsUrl = hasGeo
    ? `https://www.google.com/maps?q=${form.latitude},${form.longitude}`
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Búsqueda inteligente (Google Places). El propio componente
          consulta /api/maps/client-key y se rinde como input plano si
          la empresa no tiene Google Maps Tools activo. Sin clave
          seguimos funcionando con OSM Nominatim + datalist CP/municipio. */}
      {(
        <div className="space-y-1.5 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
          <Label>🪄 Búsqueda inteligente (Google)</Label>
          <PlacesAutocomplete
            placeholder="Calle, número, ciudad…"
            onSelect={(addr) => {
              // Google devuelve `route` con el tipo de vía incluido
              // ("Avenida de la Paz"). Lo dividimos para alimentar el
              // select street_type + campo street por separado.
              const { type, rest } = detectStreetType(addr.street);
              const validType = STREET_TYPE.includes(type as StreetType)
                ? (type as StreetType)
                : form.street_type;
              setForm((f) => ({
                ...f,
                street_type: addr.street ? validType : f.street_type,
                street: rest || f.street,
                street_number: addr.street_number || f.street_number,
                postal_code: addr.postal_code || f.postal_code,
                city: addr.city || f.city,
                province: addr.province || f.province,
                latitude: addr.lat,
                longitude: addr.lng,
                geo_source: "geocoded",
              }));
              notify.success("Dirección rellenada", addr.formatted);
            }}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Tipo</Label>
          <select
            id="kind"
            value={form.kind}
            onChange={(e) => update("kind", e.target.value as AddressKind)}
            className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
          >
            {ADDRESS_KIND.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">Etiqueta</Label>
          <Input
            id="label"
            value={form.label}
            onChange={(e) => update("label", e.target.value)}
            placeholder="Ej. Sede Madrid"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr_120px]">
        <div className="space-y-1.5">
          <Label>Vía</Label>
          <select
            value={form.street_type}
            onChange={(e) => update("street_type", e.target.value as StreetType)}
            className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
          >
            {STREET_TYPE.map((s) => (
              <option key={s} value={s}>
                {STREET_TYPE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="street">Nombre *</Label>
          <Input
            id="street"
            required
            value={form.street}
            onChange={(e) => {
              const raw = e.target.value;
              // Autodetectar tipo de vía si el usuario escribe "Avenida X"
              // al inicio. Si el prefijo coincide con un tipo conocido,
              // movemos el tipo al select y dejamos solo el resto en
              // el campo. Sólo si la cadena tiene al menos un espacio
              // (evita disparar al teclear "av" letra a letra).
              if (raw.includes(" ")) {
                const parsed = detectStreetType(raw);
                if (parsed.type !== "calle" && parsed.rest !== raw) {
                  const validType = STREET_TYPE.includes(
                    parsed.type as StreetType,
                  )
                    ? (parsed.type as StreetType)
                    : form.street_type;
                  setForm((f) => ({
                    ...f,
                    street_type: validType,
                    street: parsed.rest,
                  }));
                  return;
                }
              }
              update("street", raw);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="street_number">Número</Label>
          <Input
            id="street_number"
            value={form.street_number}
            onChange={(e) => update("street_number", e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Portal</Label>
          <Input value={form.portal} onChange={(e) => update("portal", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Piso</Label>
          <Input value={form.floor} onChange={(e) => update("floor", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Puerta</Label>
          <Input value={form.door} onChange={(e) => update("door", e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="postal_code">CP *</Label>
          <Input
            id="postal_code"
            inputMode="numeric"
            maxLength={5}
            value={form.postal_code}
            onChange={(e) => update("postal_code", e.target.value)}
            list="address-cp-options"
          />
          {/* CPs sugeridos según la población escrita. El user puede
              escribir libremente; el datalist es solo ayuda visual. */}
          <datalist id="address-cp-options">
            {citySuggestions.map((s) => (
              <option key={`${s.postal_code}-${s.municipality}`} value={s.postal_code}>
                {s.municipality}
                {s.province ? ` · ${s.province}` : ""}
              </option>
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">Población *</Label>
          <Input
            id="city"
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            list="address-city-options"
            autoComplete="off"
          />
          {/* Municipios sugeridos del CP actual. Si el usuario elige uno
              del desplegable, también ajustamos provincia. */}
          <datalist id="address-city-options">
            {cpSuggestions.map((s) => (
              <option
                key={`${s.postal_code}-${s.municipality}`}
                value={s.municipality}
              >
                {s.province ? `${s.province} (${s.postal_code})` : s.postal_code}
              </option>
            ))}
          </datalist>
          {cpSuggestions.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              Este CP tiene {cpSuggestions.length} municipios posibles — abre
              el desplegable o escribe libremente.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="province">Provincia</Label>
          <Input
            id="province"
            value={form.province}
            onChange={(e) => update("province", e.target.value)}
          />
        </div>
      </div>
      {geoWarning && form.postal_code.length >= 5 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          ⚠️ {geoWarning}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Persona de contacto</Label>
          <Input
            value={form.contact_name}
            onChange={(e) => update("contact_name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Teléfono de contacto</Label>
          <Input
            type="tel"
            value={form.contact_phone}
            onChange={(e) => update("contact_phone", e.target.value)}
          />
        </div>
      </div>

      {/* Geolocalización */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <MapPin className="h-4 w-4" /> Geolocalización
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={captureMyLocation} disabled={gpsLoading}>
            <Crosshair className="h-4 w-4" />
            {gpsLoading ? "Buscando GPS..." : "Usar mi ubicación"}
          </Button>
          <Button type="button" variant="outline" onClick={searchByAddress} disabled={geoLoading}>
            <Search className="h-4 w-4" />
            {geoLoading ? "Buscando..." : "Buscar por dirección"}
          </Button>
          {hasGeo && (
            <Button type="button" variant="ghost" onClick={clearLocation}>
              Borrar
            </Button>
          )}
        </div>

        <MapPicker
          latitude={form.latitude}
          longitude={form.longitude}
          onChange={(lat, lng) => {
            void fillFromCoords(lat, lng, "user_pin");
          }}
        />

        {hasGeo && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Lat {form.latitude?.toFixed(6)} · Lng {form.longitude?.toFixed(6)}
            </span>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <MapPin className="h-3 w-3" /> Ver en Google Maps
              </a>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          En PC el GPS usa la IP/WiFi (puede fallar mucho). En móvil/tablet con GPS funcionará bien.
          Puedes arrastrar la chincheta para corregir y se rellenará la dirección automáticamente.
        </p>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <input
          type="checkbox"
          checked={form.is_primary}
          onChange={(e) => update("is_primary", e.target.checked)}
          className="h-5 w-5 rounded"
        />
        <span className="text-sm font-semibold">Marcar como dirección principal</span>
      </label>

      <div className="flex justify-end gap-2">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : initial ? "Actualizar" : "Añadir dirección"}
        </Button>
      </div>
    </form>
  );
}
