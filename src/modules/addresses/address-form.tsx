"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
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
  provincesMatch,
} from "@/shared/lib/validations/spanish";
import { detectStreetType } from "@/shared/lib/geocoding/street-type";
import {
  lookupPostalCodesByMunicipality,
  type MunicipalityHit,
} from "@/shared/lib/geocoding/municipalities";
import { useDireccion, type ParcheDireccion } from "@/shared/lib/geocoding/use-direccion";
import { DireccionEstadoMapa } from "@/shared/components/direccion-estado-mapa";
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

  // Auto-corregir datos heredados: si la dirección guardada tiene
  // street="Avenida Pío XII" + street_type="calle" (data del pasado, antes
  // del parser), arreglamos al mount para que el usuario vea la versión
  // correcta del primer render.
  useEffect(() => {
    if (!form.street.includes(" ")) return;
    if (form.street_type !== "calle") return;
    const parsed = detectStreetType(form.street);
    if (parsed.type === "calle" || parsed.rest === form.street) return;
    if (!STREET_TYPE.includes(parsed.type as StreetType)) return;
    setForm((f) => ({
      ...f,
      street_type: parsed.type as StreetType,
      street: parsed.rest,
    }));
    // Solo se ejecuta una vez al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [gpsLoading, setGpsLoading] = useState(false);
  // CPs candidatos de la población escrita (datalist del CP). Los municipios
  // del CP (datalist de Población) y el autorrelleno CP ↔ población los da
  // el hook compartido.
  const [citySuggestions, setCitySuggestions] = useState<MunicipalityHit[]>([]);

  // Lógica compartida con leads/create-form: CartoCiudad → Google →
  // Nominatim, chincheta obligatoria si la calle no aparece en el mapa.
  const aplicarDireccion = useCallback((p: ParcheDireccion) => {
    setForm((f) => ({
      ...f,
      ...(p.street_type !== undefined && STREET_TYPE.includes(p.street_type as StreetType)
        ? { street_type: p.street_type as StreetType }
        : {}),
      ...(p.calle !== undefined ? { street: p.calle } : {}),
      ...(p.numero !== undefined ? { street_number: p.numero } : {}),
      ...(p.cp !== undefined ? { postal_code: p.cp } : {}),
      ...(p.poblacion !== undefined ? { city: p.poblacion } : {}),
      ...(p.provincia !== undefined ? { province: p.provincia } : {}),
      ...(p.lat !== undefined ? { latitude: p.lat } : {}),
      ...(p.lng !== undefined ? { longitude: p.lng } : {}),
      ...(p.geo_source !== undefined ? { geo_source: p.geo_source } : {}),
    }));
  }, []);
  const dir = useDireccion({
    valores: {
      street_type: form.street_type,
      calle: form.street,
      numero: form.street_number,
      cp: form.postal_code,
      poblacion: form.city,
      provincia: form.province,
      lat: form.latitude,
      lng: form.longitude,
    },
    aplicar: aplicarDireccion,
    // Chincheta (cuando la calle no es manual): solo rellena los huecos.
    modoChincheta: "huecos",
  });
  const cpSuggestions = dir.municipiosDelCp;

  function captureMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.warning("Geolocalización no disponible en este dispositivo");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // «Usar mi ubicación» SOBRESCRIBE todos los campos: es más fiable
        // que el texto tecleado.
        await dir.desdeCoordenadas(pos.coords.latitude, pos.coords.longitude, "gps");
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

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    if (key === "street_number") dir.marcarEscrito("numero");
    if (key === "postal_code") dir.marcarEscrito("cp");
    if (key === "city") dir.marcarEscrito("poblacion");
    if (key === "province") dir.marcarEscrito("provincia");
    if (key === "street") dir.marcarEscrito("calle");
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "postal_code" && typeof value === "string" && value.length === 5) {
        const p = provinceFromPostalCode(value);
        // Si el CP es válido y la provincia actual no coincide (ni como
        // variante cooficial), la pisamos. Evita el caso aberrante "CP
        // 46xxx + Provincia Galicia", pero respeta "Bizkaia" vs "Vizcaya".
        if (p && !provincesMatch(next.province, p)) {
          next.province = p;
        }
      }
      return next;
    });
  }

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
    // Tolerante a variantes cooficiales (Bizkaia/Vizcaya, A Coruña/La
    // Coruña…): solo avisamos si de verdad son provincias distintas.
    if (
      expectedProvince &&
      current &&
      !provincesMatch(current, expectedProvince)
    ) {
      return `El CP ${cp} pertenece a ${expectedProvince}, no a "${current}". Revisa la provincia o el CP.`;
    }
    if (expectedProvince && !current) {
      return `Indica la provincia. El CP ${cp} corresponde a ${expectedProvince}.`;
    }
    if (!form.city?.trim()) {
      return "Falta la población.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Geo: solo avisar, nunca bloquear (decisión 2026-06-10). El nombre de
    // provincia que devuelve el mapa puede ser una variante cooficial; el
    // banner amarillo ya informa si algo no cuadra, pero dejamos guardar.
    const geoErr = validateGeo();
    if (geoErr) {
      notify.warning("Revisa la dirección", geoErr);
    }
    // Coordenadas SIEMPRE obligatorias (decisión 2026-05-19): el técnico
    // no puede iniciar parte ni validar GPS si faltan. Si la calle no está en
    // ningún mapa ya no sale el error rojo: el hook centra el mapa en la calle
    // o el pueblo y pide arrastrar la chincheta; no se guarda hasta entonces.
    const coords = await dir.prepararGuardado(true);
    if (!coords || coords.lat == null || coords.lng == null) return;
    const lat = coords.lat;
    const lng = coords.lng;
    startTransition(async () => {
      const r = await upsertAddressSafeAction({
        ...form,
        latitude: lat,
        longitude: lng,
        // Si las coordenadas las acaba de resolver el guardado, `form` aún
        // no las tiene: vienen del geocodificador.
        geo_source:
          form.latitude === lat && form.longitude === lng ? form.geo_source : "geocoded",
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
            onManual={dir.alEscribirManual}
            onSelect={dir.alElegirSugerencia}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_120px]">
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
                  dir.marcarEscrito("calle");
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            onBlur={dir.alSalirPoblacion}
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
      {dir.pistaCp && <p className="text-xs text-muted-foreground">{dir.pistaCp}</p>}
      {geoWarning && form.postal_code.length >= 5 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          ⚠️ {geoWarning}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => void dir.buscarAhora()}
            disabled={dir.buscando}
          >
            <Search className="h-4 w-4" />
            {dir.buscando ? "Buscando..." : "Buscar por dirección"}
          </Button>
          {hasGeo && (
            <Button type="button" variant="ghost" onClick={dir.borrarUbicacion}>
              Borrar
            </Button>
          )}
        </div>

        <div ref={dir.mapaRef} className="scroll-mt-24 space-y-2">
          <MapPicker
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(lat, lng) => {
              void dir.desdeCoordenadas(lat, lng, "chincheta");
            }}
          />
          <DireccionEstadoMapa dir={dir} />
        </div>

        {hasGeo && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {dir.origen === "aproximada" ? "Aproximada · " : ""}
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
