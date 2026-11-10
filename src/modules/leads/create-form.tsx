"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MapPin, Check, Crosshair, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createLeadAction } from "./actions";
import { LEAD_ORIGIN, LEAD_POTENTIAL, ORIGIN_LABEL } from "./schemas";
import {
  provinceFromPostalCode,
  validateSpanishPostalCode,
  provincesMatch,
} from "@/shared/lib/validations/spanish";
import { MapPicker } from "@/shared/components/map-picker";
import { PlacesAutocomplete } from "@/shared/components/places-autocomplete";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { PhoneInput } from "@/shared/components/phone-input";
import { DedupeWarning } from "@/shared/components/dedupe-warning";
import { useDedupe } from "@/shared/hooks/use-dedupe";
import { STREET_TYPE, STREET_TYPE_LABEL, type StreetType } from "@/modules/addresses/schemas";
import { detectStreetType } from "@/shared/lib/geocoding/street-type";
import { useDireccion, type ParcheDireccion } from "@/shared/lib/geocoding/use-direccion";
import { DireccionEstadoMapa } from "@/shared/components/direccion-estado-mapa";

/**
 * Wizard 2 pasos. Tablet-first.
 * Paso 1: Tipo + datos contacto + tlf/email + origen + potencial + notas (con dedupe live)
 * Paso 2: Dirección con auto-provincia desde CP
 */
export function LeadCreateForm() {
  const [step, setStep] = useState(1);
  const [partyKind, setPartyKind] = useState<"individual" | "company">("individual");
  /** Toggle "Autónomo" — solo aplica si partyKind=company. */
  const [isAutonomo, setIsAutonomo] = useState(false);
  const [pending, startTransition] = useTransition();

  // Paso 1
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCompany, setPhoneCompany] = useState("");

  // Paso 2
  const [origin, setOrigin] = useState("other");
  const [potential, setPotential] = useState("unknown");
  const [notes, setNotes] = useState("");

  // Paso 3 — dirección con geolocalización + campos de portal/piso/puerta
  const [streetType, setStreetType] = useState<StreetType>("calle");
  const [street, setStreet] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [portal, setPortal] = useState("");
  const [floor, setFloor] = useState("");
  const [door, setDoor] = useState("");
  const [postal, setPostal] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // Lógica compartida con address-form: CartoCiudad → Google → Nominatim,
  // chincheta obligatoria si la calle no aparece, CP ↔ población.
  const aplicarDireccion = useCallback((p: ParcheDireccion) => {
    if (p.street_type !== undefined && STREET_TYPE.includes(p.street_type as StreetType)) {
      setStreetType(p.street_type as StreetType);
    }
    if (p.calle !== undefined) setStreet(p.calle);
    if (p.numero !== undefined) setStreetNumber(p.numero);
    if (p.cp !== undefined) setPostal(p.cp);
    if (p.poblacion !== undefined) setCity(p.poblacion);
    if (p.provincia !== undefined) setProvince(p.provincia);
    if (p.lat !== undefined) setLatitude(p.lat);
    if (p.lng !== undefined) setLongitude(p.lng);
  }, []);
  const dir = useDireccion({
    valores: {
      street_type: streetType,
      calle: street,
      numero: streetNumber,
      cp: postal,
      poblacion: city,
      provincia: province,
      lat: latitude,
      lng: longitude,
    },
    aplicar: aplicarDireccion,
    // En el alta de lead la chincheta manda: rellena todo lo que el mapa
    // sepa (salvo la calle si la escribió el usuario).
    modoChincheta: "todo",
  });

  function captureMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.warning("Geolocalización no disponible en este dispositivo");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // El GPS es más fiable que el texto tecleado a medias: pisa todo.
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

  const dedupeMatches = useDedupe({ tax_id: taxId, email, phone });

  function onPostalChange(v: string) {
    dir.marcarEscrito("cp");
    setPostal(v);
    if (v.length === 5) {
      const p = provinceFromPostalCode(v);
      // Si CP es válido y la provincia actual no coincide (ni como variante
      // cooficial) → pisar. Respeta "Bizkaia" vs "Vizcaya".
      if (p && !provincesMatch(province, p)) {
        setProvince(p);
      }
    }
  }

  /** Devuelve mensaje de aviso (no bloqueante) si CP o provincia no encajan. */
  function geoIncoherence(): string | null {
    const cp = postal.trim();
    if (!cp) return null;
    if (!validateSpanishPostalCode(cp)) {
      return `El código postal "${cp}" no es válido (5 dígitos, 01-52).`;
    }
    const expected = provinceFromPostalCode(cp);
    const current = province.trim();
    // Tolerante a variantes cooficiales: solo avisa si son provincias
    // realmente distintas.
    if (expected && current && !provincesMatch(current, expected)) {
      return `El CP ${cp} pertenece a ${expected}, no a "${current}".`;
    }
    return null;
  }

  function validateStep1(): boolean {
    // Empresa pura → razón social. Autónomo o particular → nombre.
    if (partyKind === "company" && !isAutonomo && !legalName.trim()) {
      notify.warning("Razón social obligatoria");
      return false;
    }
    if ((partyKind === "individual" || (partyKind === "company" && isAutonomo)) && !firstName.trim()) {
      notify.warning("Nombre obligatorio");
      return false;
    }
    if (!phone.trim()) {
      notify.warning("Teléfono obligatorio");
      return false;
    }
    return true;
  }

  /** Dirección 100% opcional al crear lead (decisión 2026-06-10). Se puede
   *  guardar sin calle/CP/población; la ficha del lead abre luego el
   *  formulario de dirección (con mapa) para completarla. Aquí solo
   *  comprobamos el formato del CP si el usuario escribió uno, y el
   *  conflicto CP↔provincia es un aviso amarillo, no un bloqueo. */
  function validateStep3(): boolean {
    if (postal.trim() && postal.trim().length !== 5) {
      notify.warning("Código postal incompleto", "Son 5 dígitos, o déjalo vacío");
      return false;
    }
    return true;
  }

  function next() {
    if (step === 1 && !validateStep1()) return;
    setStep((s) => Math.min(2, s + 1));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  async function submit() {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep3()) {
      setStep(2);
      return;
    }
    const fd = new FormData();
    fd.set("party_kind", partyKind);
    const autonomo = partyKind === "company" && isAutonomo;
    fd.set("is_autonomo", autonomo ? "true" : "false");
    // Autónomo = persona física: no tiene razón social, su "nombre legal"
    // a efectos fiscales es "first last". Guardamos eso para que el
    // resto del sistema lo lea como display_name si hace falta.
    fd.set(
      "legal_name",
      autonomo ? `${firstName} ${lastName}`.trim() : legalName,
    );
    fd.set("trade_name", autonomo ? "" : tradeName);
    fd.set("first_name", firstName);
    fd.set("last_name", lastName);
    fd.set("tax_id", taxId);
    fd.set("email", email);
    fd.set("phone_primary", phone);
    fd.set("phone_company", phoneCompany);
    fd.set("origin", origin);
    fd.set("potential", potential);
    fd.set("notes", notes);
    fd.set("address_street_type", streetType);
    fd.set("address_street", street);
    fd.set("address_street_number", streetNumber);
    fd.set("address_portal", portal);
    fd.set("address_floor", floor);
    fd.set("address_door", door);
    fd.set("address_postal_code", postal);
    fd.set("address_city", city);
    fd.set("address_province", province);
    // Coordenadas obligatorias SOLO si la dirección se va a guardar de
    // verdad (calle + CP; es lo que persiste el servidor). Así un lead sin
    // dirección, o con solo el CP, no obliga a fijar chincheta. El técnico
    // necesita lat/lng para validar GPS, pero eso aplica cuando hay calle.
    // Si la calle no está en ningún mapa (pasa: «Carrer Monasteri, Inca»),
    // ya no sale el error rojo: el hook centra el mapa en la calle o el
    // pueblo y pide mover la chincheta; no se guarda hasta que la mueva.
    const willPersistAddress = Boolean(street.trim() && postal.trim());
    const coords = await dir.prepararGuardado(willPersistAddress);
    if (!coords) return;
    const { lat, lng } = coords;
    if (lat != null) fd.set("address_latitude", String(lat));
    if (lng != null) fd.set("address_longitude", String(lng));
    startTransition(async () => {
      try {
        const res = await createLeadAction(fd);
        // En éxito redirige (NEXT_REDIRECT, no llega aquí). {ok:false} = aviso legible.
        if (res && res.ok === false) {
          notify.error("No se pudo crear", res.error);
        }
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("No se pudo crear", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      {/* Indicador pasos */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  n < step
                    ? "bg-success text-success-foreground"
                    : n === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {n < step ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 2 && <div className={`h-0.5 w-8 ${n < step ? "bg-success" : "bg-muted"}`} />}
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Paso {step} de 2 ·{" "}
          {step === 1 ? "Datos contacto y origen" : "Dirección"}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="space-y-3">
            <Label>Tipo</Label>
            <div className="flex gap-2">
              <label
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-sm font-semibold ${
                  partyKind === "individual"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input"
                }`}
              >
                <input
                  type="radio"
                  value="individual"
                  checked={partyKind === "individual"}
                  onChange={() => setPartyKind("individual")}
                  className="sr-only"
                />
                Particular
              </label>
              <label
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-sm font-semibold ${
                  partyKind === "company"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input"
                }`}
              >
                <input
                  type="radio"
                  value="company"
                  checked={partyKind === "company"}
                  onChange={() => setPartyKind("company")}
                  className="sr-only"
                />
                Empresa
              </label>
            </div>
          </div>

          {partyKind === "company" ? (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={isAutonomo}
                  onChange={(e) => setIsAutonomo(e.target.checked)}
                  className="h-5 w-5 rounded"
                />
                <div className="flex-1 font-bold">Autónomo</div>
              </label>
              {isAutonomo ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Nombre *</Label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Apellidos</Label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>DNI / NIE</Label>
                    <TaxIdInput kind="dni" value={taxId} onChange={setTaxId} placeholder="12345678A" />
                  </div>
                  <div className="space-y-2">
                    <Label>Tel. empresa</Label>
                    <PhoneInput value={phoneCompany} onChange={setPhoneCompany} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Razón social *</Label>
                    <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Nombre comercial</Label>
                    <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>CIF</Label>
                    <TaxIdInput kind="cif" value={taxId} onChange={setTaxId} placeholder="B12345678" />
                  </div>
                  <div className="space-y-2">
                    <Label>Tel. empresa</Label>
                    <PhoneInput value={phoneCompany} onChange={setPhoneCompany} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Persona de contacto
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label>Nombre</Label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Apellidos</Label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Apellidos</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>DNI / NIE</Label>
                <TaxIdInput kind="dni" value={taxId} onChange={setTaxId} placeholder="12345678A" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono *</Label>
              <PhoneInput value={phone} onChange={setPhone} required />
            </div>
          </div>

          <DedupeWarning matches={dedupeMatches} partyKind={partyKind} />

          <div className="border-t pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Origen</Label>
                <select
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                >
                  {LEAD_ORIGIN.map((o) => (
                    <option key={o} value={o}>
                      {ORIGIN_LABEL[o]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Potencial</Label>
                <select
                  value={potential}
                  onChange={(e) => setPotential(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                >
                  {LEAD_POTENTIAL.map((p) => (
                    <option key={p} value={p}>
                      {p === "unknown" ? "Sin clasificar" : `Clase ${p}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Label>Notas</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-input bg-background p-3 text-base md:text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 text-primary" />
            Dirección principal (opcional). Puedes usar tu ubicación o buscar por dirección.
          </div>

          {/* Búsqueda inteligente con Google Places. El componente
              consulta /api/maps/client-key dinámicamente y se rinde
              como input plano si la empresa no tiene Google Maps Tools
              activo o sin la feature interactive_maps. */}
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

          {/* Botones de geolocalización */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={captureMyLocation}
              disabled={gpsLoading}
            >
              <Crosshair className="h-4 w-4" />
              {gpsLoading ? "Buscando GPS…" : "Usar mi ubicación"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void dir.buscarAhora()}
              disabled={dir.buscando}
            >
              <Search className="h-4 w-4" />
              {dir.buscando ? "Buscando…" : "Buscar por dirección"}
            </Button>
            {latitude != null && longitude != null && dir.origen !== "aproximada" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2 py-1 text-xs font-bold text-success">
                <MapPin className="h-3 w-3" /> Ubicación capturada
              </span>
            )}
            {dir.origen === "aproximada" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-warning/15 px-2 py-1 text-xs font-bold text-foreground">
                <MapPin className="h-3 w-3" /> Ubicación aproximada
              </span>
            )}
          </div>

          {/* Mapa con chincheta arrastrable. Si aún no hay coordenadas se
              muestra placeholder. Cuando el usuario mueve la chincheta se
              hace reverse-geocode y se rellenan los campos. */}
          <div ref={dir.mapaRef} className="scroll-mt-24 space-y-2">
            <MapPicker
              latitude={latitude}
              longitude={longitude}
              onChange={(lat, lng) => {
                void dir.desdeCoordenadas(lat, lng, "chincheta");
              }}
            />
            <DireccionEstadoMapa dir={dir} />
            {latitude != null && longitude != null && !dir.aviso && (
              <p className="text-[11px] text-muted-foreground">
                Arrastra la chincheta o pincha en el mapa para ajustar la posición
                exacta. Si escribiste la calle a mano, se mantiene; el resto se
                completa según el mapa.
              </p>
            )}
          </div>

          {/* Vía + número */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr_140px]">
            <div className="space-y-2">
              <Label>Vía</Label>
              <select
                value={streetType}
                onChange={(e) => setStreetType(e.target.value as StreetType)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
              >
                {STREET_TYPE.map((s) => (
                  <option key={s} value={s}>
                    {STREET_TYPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={street}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Si el usuario escribe "Avenida X" al inicio, lo
                  // movemos al select. Sólo si hay espacio (evita el
                  // disparo letra a letra al teclear "av").
                  if (raw.includes(" ")) {
                    const { type, rest } = detectStreetType(raw);
                    if (
                      type !== "calle" &&
                      rest !== raw &&
                      STREET_TYPE.includes(type as StreetType)
                    ) {
                      setStreetType(type as StreetType);
                      dir.marcarEscrito("calle");
                      setStreet(rest);
                      return;
                    }
                  }
                  dir.marcarEscrito("calle");
                  setStreet(raw);
                }}
                placeholder="Gran Vía"
              />
            </div>
            <div className="space-y-2">
              <Label>Número</Label>
              <Input
                value={streetNumber}
                onChange={(e) => {
                  dir.marcarEscrito("numero");
                  setStreetNumber(e.target.value);
                }}
              />
            </div>
          </div>

          {/* Portal / Piso / Puerta */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Portal</Label>
              <Input value={portal} onChange={(e) => setPortal(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Piso</Label>
              <Input value={floor} onChange={(e) => setFloor(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Puerta</Label>
              <Input value={door} onChange={(e) => setDoor(e.target.value)} />
            </div>
          </div>

          {/* CP / Población / Provincia */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>CP</Label>
              <Input
                inputMode="numeric"
                maxLength={5}
                value={postal}
                onChange={(e) => onPostalChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Población</Label>
              <Input
                value={city}
                onChange={(e) => {
                  dir.marcarEscrito("poblacion");
                  setCity(e.target.value);
                }}
                onBlur={dir.alSalirPoblacion}
                list="lead-city-options"
                autoComplete="off"
              />
              <datalist id="lead-city-options">
                {dir.municipiosDelCp.map((m) => (
                  <option key={`${m.postal_code}-${m.municipality}`} value={m.municipality}>
                    {m.province ? `${m.province} (${m.postal_code})` : m.postal_code}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Input
                value={province}
                onChange={(e) => {
                  dir.marcarEscrito("provincia");
                  setProvince(e.target.value);
                }}
              />
            </div>
          </div>
          {dir.pistaCp && <p className="text-xs text-muted-foreground">{dir.pistaCp}</p>}
          {postal.length >= 5 && (() => {
            const err = geoIncoherence();
            return err ? (
              <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                ⚠️ {err}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Footer botones */}
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        {step > 1 ? (
          <Button variant="outline" onClick={back} disabled={pending}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/leads">Cancelar</Link>
          </Button>
        )}
        {step < 2 ? (
          <Button onClick={next} disabled={pending}>
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending} variant="success" size="lg">
            {pending ? "Creando..." : "Crear lead"}
          </Button>
        )}
      </div>
    </div>
  );
}
