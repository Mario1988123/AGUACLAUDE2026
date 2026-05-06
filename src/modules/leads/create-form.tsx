"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MapPin, Check, Crosshair, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createLeadAction } from "./actions";
import { LEAD_ORIGIN, LEAD_POTENTIAL, ORIGIN_LABEL } from "./schemas";
import { provinceFromPostalCode } from "@/shared/lib/validations/spanish";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { DedupeWarning } from "@/shared/components/dedupe-warning";
import { useDedupe } from "@/shared/hooks/use-dedupe";
import { STREET_TYPE, STREET_TYPE_LABEL, type StreetType } from "@/modules/addresses/schemas";
import { reverseGeocodeAction, forwardGeocodeAction } from "@/shared/lib/geocoding/actions";

/**
 * Wizard 3 pasos en lugar de scroll vertical largo. Tablet-first.
 * Paso 1: Tipo + datos contacto + email/tlf (con dedupe live)
 * Paso 2: Origen + potencial + notas
 * Paso 3: Dirección opcional con auto-provincia desde CP
 */
export function LeadCreateForm() {
  const [step, setStep] = useState(1);
  const [partyKind, setPartyKind] = useState<"individual" | "company">("individual");
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
  const [geoLoading, setGeoLoading] = useState(false);

  async function fillFromCoords(lat: number, lng: number, force = false) {
    setLatitude(lat);
    setLongitude(lng);
    const rev = await reverseGeocodeAction(lat, lng);
    if (!rev) {
      notify.warning(
        "Coordenadas capturadas",
        "El servicio de mapas no respondió. Rellena la calle a mano.",
      );
      return;
    }
    if (STREET_TYPE.includes(rev.street_type as StreetType)) {
      setStreetType(rev.street_type as StreetType);
    }
    const filled: string[] = [];
    // Functional updaters: leen el valor actual real, no el del cierre.
    // Solo machaca si force=true. Solo aplica si rev.X existe (no
    // sobreescribe lo escrito con un undefined).
    if (rev.street) {
      setStreet((cur) => (force || !cur ? rev.street : cur));
      filled.push("calle");
    }
    if (rev.street_number) {
      setStreetNumber((cur) =>
        force || !cur ? (rev.street_number as string) : cur,
      );
      filled.push("nº");
    }
    if (rev.postal_code) {
      setPostal((cur) => (force || !cur ? (rev.postal_code as string) : cur));
      filled.push("CP");
    }
    if (rev.city) {
      setCity((cur) => (force || !cur ? (rev.city as string) : cur));
      filled.push("ciudad");
    }
    if (rev.province) {
      setProvince((cur) => (force || !cur ? (rev.province as string) : cur));
      filled.push("provincia");
    }
    if (filled.length === 0) {
      notify.warning(
        "Coordenadas capturadas",
        "No se pudo identificar la dirección. Escríbela a mano.",
      );
    } else if (!rev.street) {
      notify.success(
        "Dirección parcial",
        `Rellenado ${filled.join(", ")}. La calle no está disponible — escríbela a mano.`,
      );
    } else {
      notify.success("Dirección autorrellenada");
    }
  }

  function captureMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.warning("Geolocalización no disponible en este dispositivo");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await fillFromCoords(pos.coords.latitude, pos.coords.longitude);
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
    const parts = [street, streetNumber, postal, city, province, "España"].filter(Boolean);
    if (parts.length < 2) {
      notify.warning("Escribe al menos calle y población");
      return;
    }
    setGeoLoading(true);
    const result = await forwardGeocodeAction(parts.join(", "));
    if (!result) {
      setGeoLoading(false);
      notify.warning("No se encontró la dirección");
      return;
    }
    // Tras encontrar las coordenadas, hacemos reverse-geocode para
    // completar/corregir los campos vacíos (ej. si solo escribió la
    // calle, ahora le rellenamos CP, ciudad y provincia).
    await fillFromCoords(result.lat, result.lng);
    setGeoLoading(false);
  }

  const dedupeMatches = useDedupe({ tax_id: taxId, email, phone });

  function onPostalChange(v: string) {
    setPostal(v);
    if (v.length === 5 && !province) {
      const p = provinceFromPostalCode(v);
      if (p) setProvince(p);
    }
  }

  function validateStep1(): boolean {
    if (partyKind === "company" && !legalName.trim()) {
      notify.warning("Razón social obligatoria");
      return false;
    }
    if (partyKind === "individual" && !firstName.trim()) {
      notify.warning("Nombre obligatorio");
      return false;
    }
    if (!phone.trim()) {
      notify.warning("Teléfono obligatorio");
      return false;
    }
    return true;
  }

  /** Dirección obligatoria al crear lead — antes se permitía guardar
   *  sin calle/CP/ciudad y al convertir a cliente saltaba el aviso de
   *  "sin dirección" cuando ya no podía corregirse cómodamente. */
  function validateStep3(): boolean {
    if (!street.trim()) {
      notify.warning("Calle obligatoria", "Escribe el nombre de la calle");
      return false;
    }
    if (!postal.trim() || postal.trim().length !== 5) {
      notify.warning("Código postal obligatorio", "5 dígitos");
      return false;
    }
    if (!city.trim()) {
      notify.warning("Población obligatoria");
      return false;
    }
    return true;
  }

  function next() {
    if (step === 1 && !validateStep1()) return;
    setStep((s) => Math.min(3, s + 1));
  }
  function back() {
    setStep((s) => Math.max(1, s - 1));
  }

  function submit() {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep3()) {
      setStep(3);
      return;
    }
    const fd = new FormData();
    fd.set("party_kind", partyKind);
    fd.set("legal_name", legalName);
    fd.set("trade_name", tradeName);
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
    if (latitude != null) fd.set("address_latitude", String(latitude));
    if (longitude != null) fd.set("address_longitude", String(longitude));
    startTransition(async () => {
      try {
        await createLeadAction(fd);
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
    <div className="space-y-4 rounded-2xl border bg-card p-6">
      {/* Indicador pasos */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
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
              {n < 3 && <div className={`h-0.5 w-8 ${n < step ? "bg-success" : "bg-muted"}`} />}
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Paso {step} de 3 ·{" "}
          {step === 1 ? "Datos contacto" : step === 2 ? "Origen y notas" : "Dirección"}
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                <Input
                  type="tel"
                  value={phoneCompany}
                  onChange={(e) => setPhoneCompany(e.target.value)}
                />
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono *</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
          </div>

          <DedupeWarning matches={dedupeMatches} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="space-y-2">
            <Label>Notas</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="w-full rounded-xl border border-input bg-background p-3 text-sm"
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 text-primary" />
            Dirección principal (opcional). Puedes usar tu ubicación o buscar por dirección.
          </div>

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
              onClick={searchByAddress}
              disabled={geoLoading}
            >
              <Search className="h-4 w-4" />
              {geoLoading ? "Buscando…" : "Buscar por dirección"}
            </Button>
            {latitude != null && longitude != null && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2 py-1 text-xs font-bold text-success">
                <MapPin className="h-3 w-3" /> Ubicación capturada
              </span>
            )}
          </div>

          {/* Vía + número */}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr_140px]">
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
              <Label>Nombre *</Label>
              <Input
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Gran Vía"
              />
            </div>
            <div className="space-y-2">
              <Label>Número</Label>
              <Input value={streetNumber} onChange={(e) => setStreetNumber(e.target.value)} />
            </div>
          </div>

          {/* Portal / Piso / Puerta */}
          <div className="grid gap-4 sm:grid-cols-3">
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
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>CP *</Label>
              <Input
                inputMode="numeric"
                maxLength={5}
                value={postal}
                onChange={(e) => onPostalChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Población *</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Input value={province} onChange={(e) => setProvince(e.target.value)} />
            </div>
          </div>
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
        {step < 3 ? (
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
